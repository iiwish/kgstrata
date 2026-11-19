// 每帧的循环：排下一帧、算 dt、画布尺寸变了重新取景、走插件宿主的管线、交给渲染器画。
// WebGL 上下文丢了就停下，还回来再接上。

import { emit, type Core } from './core.js'
import type { PluginHost } from './plugins.js'
import { camera } from './shots.js'

export class FrameLoop {
  private raf = 0
  private last = 0
  private aspect = 0
  private fitHeight = 1
  /** WebGL 上下文丢了：循环停着，等它还回来 */
  private lost = false

  constructor(
    private readonly c: Core,
    private readonly host: PluginHost,
  ) {
    const el = c.renderer.gl.domElement
    el.addEventListener('webglcontextlost', this.onLost)
    el.addEventListener('webglcontextrestored', this.onRestored)
    this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    const c = this.c
    // 销毁了、上下文丢了：不再排下一帧（上下文还回来时 onRestored 重新起）
    if (c.disposed || this.lost) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016
    this.last = now
    c.renderer.resize()
    // 取景的宽高比、没被挡住的高度比例变了（画布尺寸、setInset）：还停在总览就重新取景
    const { fitAspect, fitHeight } = c.renderer.rig
    if (Math.abs(fitAspect - this.aspect) > 1e-3 || Math.abs(fitHeight - this.fitHeight) > 1e-3) {
      this.aspect = fitAspect
      this.fitHeight = fitHeight
      if (c.autoFrame) camera(c, 'overview', 0)
    }
    c.time += dt
    const looks = this.host.frame(dt)
    if (!looks) return
    c.looks = looks
    c.renderer.frame(looks, dt, c.time)
    emit(c, 'tick', c.time)
  }

  /** 上下文丢了：停掉循环，告诉外面。three.js 自己会 preventDefault，浏览器才会还回来 */
  private onLost = (e: Event) => {
    e.preventDefault()
    if (this.c.disposed || this.lost) return
    this.lost = true
    cancelAnimationFrame(this.raf)
    emit(this.c, 'contextlost', null)
  }

  /** 上下文还回来了：渲染器补上 three.js 不管的那几样，循环从头接上（这一帧的 dt 按缺省算，不会一下跳很远） */
  private onRestored = () => {
    if (this.c.disposed || !this.lost) return
    this.lost = false
    this.c.renderer.restore()
    this.last = 0
    this.raf = requestAnimationFrame(this.tick)
    emit(this.c, 'contextrestored', null)
  }

  /** 停下，摘掉监听：渲染器销毁时会主动丢掉上下文，先摘掉就不会发 contextlost */
  stop() {
    cancelAnimationFrame(this.raf)
    const el = this.c.renderer.gl.domElement
    el.removeEventListener('webglcontextlost', this.onLost)
    el.removeEventListener('webglcontextrestored', this.onRestored)
  }
}
