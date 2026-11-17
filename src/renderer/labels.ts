import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  NoColorSpace,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Camera,
} from 'three'
import { rgb } from '../color.js'
import type { Theme } from '../theme.js'
import type { LabelLook } from '../types.js'

// 标签：字画进一张图集（R = 字，G = 描边），屏幕上按固定像素大小贴出来。
// 每帧在屏幕空间按优先级避让，压住的淡出。字、描边分通道，颜色在着色器里上，换色不用重画。
const ATLAS = 2048
const STEM = 9 // 节点到标签的短竖线（px）
const PAD = 3
/** 一屏最多显示的标签数 */
const MAX_SHOWN = 160

const vertex = /* glsl */ `
  attribute vec3 iAnchor;
  attribute vec4 iRect;   // 偏移 x、偏移 y（底边，px，向上为正）、宽、高
  attribute vec4 iUv;
  attribute vec3 iColor;
  attribute float iAlpha;
  uniform vec2 uResolution;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 clip = projectionMatrix * viewMatrix * vec4(iAnchor, 1.0);
    vec2 px = vec2(iRect.x + position.x * iRect.z, iRect.y + (position.y + 0.5) * iRect.w);
    clip.xy += px * 2.0 / uResolution * clip.w;
    gl_Position = clip;
    vUv = mix(iUv.xy, iUv.zw, position.xy + 0.5);
    vColor = iColor;
    vAlpha = iAlpha;
  }`

const fragment = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uHalo;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    float fill = t.r;
    float halo = t.g;
    float a = max(fill, halo * 0.82) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uHalo, vColor, fill), a);
    #include <colorspace_fragment>
  }`

interface Entry {
  u0: number
  v0: number
  u1: number
  v1: number
  /** 逻辑像素 */
  w: number
  h: number
  stem: boolean
}

export interface LabelItem {
  look: LabelLook
  /** 世界坐标的锚点（节点顶上） */
  x: number
  y: number
  z: number
  /** 附在哪个主标签上面（旧名），-1 表示自己就是主标签 */
  parent: number
  /** 节点自身的透明度，标签透明度乘它 */
  alpha: number
}

export class Labels {
  readonly mesh: InstancedMesh
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private texture: CanvasTexture
  private entries = new Map<string, Entry>()
  private shelfX = 0
  private shelfY = 0
  private shelfH = 0
  private scale: number
  private anchor: InstancedBufferAttribute
  private rect: InstancedBufferAttribute
  private uv: InstancedBufferAttribute
  private color: InstancedBufferAttribute
  private alphaAttr: InstancedBufferAttribute
  /** 每个槽位当前显示的透明度（淡入淡出） */
  private shown: Float32Array
  private capacity: number
  private readonly v = new Vector3()
  private readonly grid = new Map<number, number[]>()
  private rects: Float32Array
  private sizes = new Map<string, { w: number; h: number }>()
  private heights: Float32Array
  /** 每个标签这一帧的缩放（近大远小） */
  private zoom: Float32Array
  private onScreen: Uint8Array
  private accepted: Uint8Array
  private ent: (Entry | null)[]

  /** theme：字体、描边色按它 */
  constructor(
    private readonly theme: Theme,
    capacity = 6000,
  ) {
    this.capacity = capacity
    this.scale = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = this.canvas.height = ATLAS
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!
    this.reset()
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = NoColorSpace
    this.texture.minFilter = LinearFilter
    this.texture.magFilter = LinearFilter
    this.texture.generateMipmaps = false
    const geo = new PlaneGeometry(1, 1)
    const mk = (size: number) => new InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(DynamicDrawUsage)
    this.anchor = mk(3)
    this.rect = mk(4)
    this.uv = mk(4)
    this.color = mk(3)
    this.alphaAttr = mk(1)
    geo.setAttribute('iAnchor', this.anchor)
    geo.setAttribute('iRect', this.rect)
    geo.setAttribute('iUv', this.uv)
    geo.setAttribute('iColor', this.color)
    geo.setAttribute('iAlpha', this.alphaAttr)
    const halo = rgb(theme.label.halo)
    const mat = new ShaderMaterial({
      uniforms: { uAtlas: { value: this.texture }, uResolution: { value: new Vector2(1, 1) }, uHalo: { value: new Color().setRGB(halo[0], halo[1], halo[2]) } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.mesh = new InstancedMesh(geo, mat, capacity)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.renderOrder = 10
    this.shown = new Float32Array(capacity)
    this.rects = new Float32Array(capacity * 4)
    this.heights = new Float32Array(capacity)
    this.zoom = new Float32Array(capacity).fill(1)
    this.onScreen = new Uint8Array(capacity)
    this.accepted = new Uint8Array(capacity)
    this.ent = new Array(capacity).fill(null)
  }

  /** 上下文丢了又还回来：图集整张重新上传 */
  touch() {
    this.texture.needsUpdate = true
  }

  get capacityOf() {
    return this.capacity
  }

  setResolution(w: number, h: number) {
    ;((this.mesh.material as ShaderMaterial).uniforms.uResolution.value as Vector2).set(w, h)
  }

  private reset() {
    const g = this.ctx
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = '#000'
    g.fillRect(0, 0, ATLAS, ATLAS)
    this.entries.clear()
    this.shelfX = this.shelfY = this.shelfH = 0
  }

  private key(l: LabelLook, stem: boolean) {
    return `${l.text}|${l.size}|${l.weight}|${l.mono ? 1 : 0}|${l.strike ? 1 : 0}|${stem ? 1 : 0}`
  }

  /** 只量尺寸、不画：避让要先知道每个标签多大，画进图集的只是最后显示的那些 */
  private measure(l: LabelLook, stem: boolean): { w: number; h: number } {
    const key = this.key(l, stem)
    const hit = this.sizes.get(key)
    if (hit) return hit
    const g = this.ctx
    g.font = `${l.weight} ${l.size * this.scale}px ${l.mono ? this.theme.mono : this.theme.font}`
    const tw = g.measureText(l.text).width / this.scale
    const th = Math.ceil(l.size * 1.35)
    const v = { w: Math.ceil(tw + PAD * 2), h: th + PAD * 2 + (stem ? STEM : 0) }
    if (this.sizes.size > 20000) this.sizes.clear()
    this.sizes.set(key, v)
    return v
  }

  private entry(l: LabelLook, stem: boolean): Entry | null {
    const key = this.key(l, stem)
    const hit = this.entries.get(key)
    if (hit) return hit
    const s = this.scale
    const g = this.ctx
    g.font = `${l.weight} ${l.size * s}px ${l.mono ? this.theme.mono : this.theme.font}`
    const tw = g.measureText(l.text).width / s
    const { w, h } = this.measure(l, stem)
    const th = Math.ceil(l.size * 1.35)
    const pw = w * s
    const ph = h * s
    if (this.shelfX + pw > ATLAS) {
      this.shelfX = 0
      this.shelfY += this.shelfH + 2
      this.shelfH = 0
    }
    if (this.shelfY + ph > ATLAS) return null
    const x = this.shelfX
    const y = this.shelfY
    this.shelfX += pw + 2
    this.shelfH = Math.max(this.shelfH, ph)
    // 描边进 G、字进 R：底是黑的，叠加后两个通道各自就是覆盖率
    const cx = x + pw / 2
    const cy = y + (PAD + th / 2) * s
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.globalCompositeOperation = 'lighter'
    g.lineWidth = 3.2 * s
    g.strokeStyle = 'rgb(0,255,0)'
    g.strokeText(l.text, cx, cy)
    g.fillStyle = 'rgb(255,0,0)'
    g.fillText(l.text, cx, cy)
    if (l.strike) g.fillRect(x + PAD * s, cy - 0.6 * s, tw * s, 1.3 * s)
    if (stem) {
      g.fillStyle = 'rgb(110,0,0)'
      g.fillRect(cx - 0.5 * s, y + (PAD * 2 + th) * s, 1 * s, (STEM - 1) * s)
    }
    g.globalCompositeOperation = 'source-over'
    const e: Entry = { u0: x / ATLAS, v0: 1 - (y + ph) / ATLAS, u1: (x + pw) / ATLAS, v1: 1 - y / ATLAS, w, h, stem }
    this.entries.set(key, e)
    this.texture.needsUpdate = true
    return e
  }

  /**
   * items 顺序固定（槽位 = 下标），这样淡入淡出才连得上。
   * width / height：画布的 CSS 像素尺寸。
   */
  update(items: LabelItem[], camera: Camera, width: number, height: number, dt: number, focusDist = 0) {
    const n = Math.min(items.length, this.capacity)
    const heights = this.heights
    // 1. 投影、量尺寸（不画）
    const order: number[] = []
    const onScreen = this.onScreen
    onScreen.fill(0, 0, n)
    for (let i = 0; i < n; i++) {
      const it = items[i]
      if (it.look.alpha * it.alpha <= 0.01 && this.shown[i] < 0.01) continue
      const sz = this.measure(it.look, it.parent < 0)
      // 近大远小：字号是在镜头对准的距离上的大小，近处放大、远处缩小，夹在 0.78 到 1.4 倍之间
      let k = 1
      if (focusDist > 0) {
        const depth = -this.v.set(it.x, it.y, it.z).applyMatrix4(camera.matrixWorldInverse).z
        k = depth > 0 ? Math.min(1.4, Math.max(0.78, focusDist / depth)) : 1
      }
      this.zoom[i] = k
      this.v.set(it.x, it.y, it.z).project(camera)
      if (this.v.z > 1 || this.v.z < -1) continue
      const sx = (this.v.x * 0.5 + 0.5) * width
      const sy = (1 - (this.v.y * 0.5 + 0.5)) * height
      if (sx < -80 || sx > width + 80 || sy < -40 || sy > height + 40) continue
      onScreen[i] = 1
      heights[i] = sz.h * k
      this.rects[i * 4] = sx - (sz.w * k) / 2
      this.rects[i * 4 + 2] = sx + (sz.w * k) / 2
      if (it.parent < 0) {
        this.rects[i * 4 + 1] = sy - sz.h * k
        this.rects[i * 4 + 3] = sy - STEM * k
      }
      if (it.look.alpha * it.alpha > 0.01) order.push(i)
    }
    // 旧名摞在主标签上面
    for (const i of order) {
      const p = items[i].parent
      if (p < 0 || !onScreen[p]) continue
      const top = this.rects[p * 4 + 1]
      this.rects[i * 4 + 1] = top - heights[i] + 2
      this.rects[i * 4 + 3] = top + 2
    }
    // 2. 按优先级贪心占位；一屏最多 MAX_SHOWN 个，大图也不糊
    order.sort((a, b) => items[b].look.priority - items[a].look.priority || a - b)
    this.grid.clear()
    const accepted = this.accepted
    accepted.fill(0, 0, n)
    const CELL = 64
    let shownCount = 0
    for (const i of order) {
      if (shownCount >= MAX_SHOWN) break
      const p = items[i].parent
      if (p >= 0 && !accepted[p]) continue
      const x0 = this.rects[i * 4] - 2
      const y0 = this.rects[i * 4 + 1] - 1
      const x1 = this.rects[i * 4 + 2] + 2
      const y1 = this.rects[i * 4 + 3] + 1
      const cx0 = Math.floor(x0 / CELL)
      const cx1 = Math.floor(x1 / CELL)
      const cy0 = Math.floor(y0 / CELL)
      const cy1 = Math.floor(y1 / CELL)
      let hit = false
      for (let cx = cx0; cx <= cx1 && !hit; cx++) {
        for (let cy = cy0; cy <= cy1 && !hit; cy++) {
          const list = this.grid.get(cx * 73856 + cy)
          if (!list) continue
          for (const j of list) {
            if (j === p) continue
            if (x0 < this.rects[j * 4 + 2] && x1 > this.rects[j * 4] && y0 < this.rects[j * 4 + 3] && y1 > this.rects[j * 4 + 1]) {
              hit = true
              break
            }
          }
        }
      }
      if (hit) continue
      accepted[i] = 1
      shownCount++
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cx * 73856 + cy
          const list = this.grid.get(key)
          if (list) list.push(i)
          else this.grid.set(key, [i])
        }
      }
    }
    // 3. 只给要显示（含正在淡出）的标签画图集；满了就清空，只重画这一帧要的
    const k = Math.min(1, dt * 9)
    const ent: (Entry | null)[] = this.ent
    for (let pass = 0; pass < 2; pass++) {
      let full = false
      for (let i = 0; i < n; i++) {
        ent[i] = null
        const target = accepted[i] ? items[i].look.alpha * items[i].alpha : 0
        if (pass === 0) this.shown[i] += (target - this.shown[i]) * k
        if (this.shown[i] < 0.01 || !onScreen[i]) continue
        const e = this.entry(items[i].look, items[i].parent < 0)
        if (!e) {
          full = true
          break
        }
        ent[i] = e
      }
      if (!full) break
      this.reset()
    }
    let m = 0
    for (let i = 0; i < n; i++) {
      const e = ent[i]
      if (!e) continue
      const it = items[i]
      const c = rgb(it.look.color)
      this.anchor.setXYZ(m, it.x, it.y, it.z)
      // 偏移：主标签底边对着锚点，旧名往上再摞一层
      const off = it.parent < 0 ? 0 : heights[it.parent] - 2
      this.rect.setXYZW(m, 0, off, e.w * this.zoom[i], e.h * this.zoom[i])
      this.uv.setXYZW(m, e.u0, e.v0, e.u1, e.v1)
      this.color.setXYZ(m, c[0], c[1], c[2])
      this.alphaAttr.setX(m, this.shown[i])
      m++
    }
    this.mesh.count = m
    for (const a of [this.anchor, this.rect, this.uv, this.color, this.alphaAttr]) a.needsUpdate = true
  }

  /** 槽位重新分配时（换了数据）清掉淡入淡出状态 */
  resetFades() {
    this.shown.fill(0)
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
    this.texture.dispose()
  }
}
