import { PerspectiveCamera, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// 镜头：轨道控制 + 平滑飞行。飞行中用户一动就停；俯视时把视角收窄成近似正交（像一张地图）
export interface Shot {
  pos: [number, number, number]
  target: [number, number, number]
  fov?: number
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class CameraRig {
  readonly camera: PerspectiveCamera
  readonly controls: OrbitControls
  private from = { pos: new Vector3(), target: new Vector3(), fov: 38 }
  private to = { pos: new Vector3(), target: new Vector3(), fov: 38 }
  private t = 1
  private duration = 1.2
  idleRotate = true
  /** 取景用的宽高比：右侧有面板挡着时只算没被挡住的那块 */
  fitAspect = 1
  private idleSince = 0

  constructor(dom: HTMLElement) {
    this.camera = new PerspectiveCamera(38, 1, 0.1, 900)
    this.camera.position.set(0, 34, 70)
    this.controls = new OrbitControls(this.camera, dom)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.minDistance = 8
    this.controls.maxDistance = 220
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.rotateSpeed = 0.6
    this.controls.autoRotateSpeed = 0.28
    this.controls.addEventListener('start', () => {
      this.t = 1
      this.idleSince = performance.now() + 6000
    })
  }

  fly(shot: Shot, duration = 1.2) {
    // 大图的镜头要退得更远：放宽轨道的最远距离和远裁剪面
    const d = Math.hypot(shot.pos[0] - shot.target[0], shot.pos[1] - shot.target[1], shot.pos[2] - shot.target[2])
    this.controls.maxDistance = Math.max(220, d * 1.6)
    if (this.camera.far < d * 3) {
      this.camera.far = d * 3
      this.camera.updateProjectionMatrix()
    }
    this.from.pos.copy(this.camera.position)
    this.from.target.copy(this.controls.target)
    this.from.fov = this.camera.fov
    this.to.pos.set(...shot.pos)
    this.to.target.set(...shot.target)
    this.to.fov = shot.fov ?? 38
    this.t = 0
    this.duration = duration
    if (duration <= 0) {
      this.t = 1
      this.camera.position.copy(this.to.pos)
      this.controls.target.copy(this.to.target)
      this.camera.fov = this.to.fov
      this.camera.updateProjectionMatrix()
    }
  }

  /** 让一组点都进画面：按包围球算距离，从当前方位看过去（俯仰保持斜看） */
  fit(points: [number, number, number][], opts: { elevation?: number; margin?: number; azimuth?: number; duration?: number } = {}) {
    if (!points.length) return
    const c = new Vector3()
    for (const p of points) c.add(new Vector3(...p))
    c.divideScalar(points.length)
    let r = 0
    for (const p of points) r = Math.max(r, c.distanceTo(new Vector3(...p)))
    r = Math.max(r, 5) * (opts.margin ?? 1.25)
    const fov = (38 * Math.PI) / 180
    const aspect = Math.max(this.fitAspect, 0.3)
    // 竖屏时按水平视角算，整组盘才放得下
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect)
    const dist = r / Math.sin(Math.min(fov, hfov) / 2)
    const el = opts.elevation ?? 0.62
    const az = opts.azimuth ?? Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z)
    const pos: [number, number, number] = [c.x + Math.sin(az) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.cos(az) * Math.cos(el) * dist]
    this.fly({ pos, target: [c.x, c.y, c.z] }, opts.duration ?? 1.2)
  }

  /**
   * 贴着框：从给定的俯角和方位看过去，找一个最近的距离，让这些点都落在画面里（四周留 pad 的空）。
   * 按真实的透视投影算，不用包围球估——扁的、一头大一头小的一摞层，包围球会估得忽远忽近。
   */
  frame(points: [number, number, number][], opts: { elevation: number; azimuth?: number; padX?: number; padTop?: number; padBottom?: number; duration?: number }) {
    if (!points.length) return
    const el = opts.elevation
    const az = opts.azimuth ?? Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z)
    // 镜头朝向不变，只挪目标点和距离：先把视线方向的三个轴定下来
    const back = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    const right = new Vector3(Math.cos(az), 0, -Math.sin(az))
    const up = new Vector3().crossVectors(back, right)
    const ty = Math.tan(((38 * Math.PI) / 180) / 2)
    const tx = ty * Math.max(this.fitAspect, 0.3)
    const limX = 1 - (opts.padX ?? 0.05)
    const top = 1 - (opts.padTop ?? 0.1)
    const bottom = 1 - (opts.padBottom ?? 0.06)
    const c = new Vector3()
    for (const p of points) c.add(new Vector3(...p))
    c.divideScalar(points.length)
    let radius = 0
    for (const p of points) radius = Math.max(radius, c.distanceTo(new Vector3(...p)))
    const v = new Vector3()
    /** 镜头在 target + back·dist 时，这些点在画面里占到哪（-1..1） */
    const extent = (target: Vector3, dist: number) => {
      let x = 0
      let y0 = Infinity
      let y1 = -Infinity
      for (const p of points) {
        v.set(p[0], p[1], p[2]).sub(target).addScaledVector(back, -dist)
        const depth = Math.max(-v.dot(back), 1e-3)
        x = Math.max(x, Math.abs(v.dot(right) / (depth * tx)))
        const y = v.dot(up) / (depth * ty)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
      return { x, y0, y1 }
    }
    const target = c.clone()
    let dist = radius * 3
    // 距离和上下居中互相影响：来回几轮就稳了
    for (let round = 0; round < 4; round++) {
      let lo = radius * 0.3
      let hi = radius * 12
      for (let it = 0; it < 28; it++) {
        const mid = (lo + hi) / 2
        const e = extent(target, mid)
        if (e.x <= limX && e.y1 <= top && -e.y0 <= bottom) hi = mid
        else lo = mid
      }
      dist = hi
      // 上下留的空不一样：把这摞东西在留完空的那块区域里摆正
      const e = extent(target, dist)
      const want = (top - bottom) / 2
      target.addScaledVector(up, ((e.y0 + e.y1) / 2 - want) * dist * ty)
    }
    const pos = target.clone().addScaledVector(back, dist)
    this.fly({ pos: [pos.x, pos.y, pos.z], target: [target.x, target.y, target.z] }, opts.duration ?? 1.2)
  }

  get flying() {
    return this.t < 1
  }

  update(dt: number) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration)
      const k = ease(this.t)
      this.camera.position.lerpVectors(this.from.pos, this.to.pos, k)
      this.controls.target.lerpVectors(this.from.target, this.to.target, k)
      const fov = this.from.fov + (this.to.fov - this.from.fov) * k
      if (Math.abs(fov - this.camera.fov) > 1e-3) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }
    }
    this.controls.autoRotate = this.idleRotate && this.t >= 1 && performance.now() > this.idleSince
    this.controls.update(dt)
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / Math.max(h, 1)
    this.fitAspect = this.camera.aspect
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    this.controls.dispose()
  }
}
