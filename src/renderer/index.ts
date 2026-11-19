import { CanvasTexture, Color, HalfFloatType, NoToneMapping, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { message, StrataError, type Locale } from '../locale.js'
import { DARK, LAYER_GAP, type Theme } from '../theme.js'
import type { BaseEdge, BaseNode, EdgeLook, LabelLook, Looks } from '../types.js'
import { CameraRig } from './camera.js'
import { Edges } from './edges.js'
import { createFog, placeFog, type Fog } from './fog.js'
import { Labels, type LabelItem } from './labels.js'
import { MARK, Marks } from './marks.js'
import { Nodes, drawnRadius, shrink } from './nodes.js'
import { Plates, type PlatesInput } from './plates.js'

/** 节点中心离盘面的高度：浮在盘面上面一点 */
export const FLOAT = 0.45

export interface RendererBase {
  nodes: BaseNode[]
  edges: BaseEdge[]
  layers: number
  /** 基准层的下标 */
  anchor: number
  plates: PlatesInput
}

/**
 * 拿一个 WebGL 渲染器；拿不到（浏览器不支持、被禁用、显卡黑名单、上下文数到了上限）时抛 StrataError('webgl-unavailable')，
 * 原来的错误放在 cause 里。
 */
function createGL(locale: Locale | undefined): WebGLRenderer {
  try {
    return new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch (cause) {
    const err = new StrataError('webgl-unavailable', message(locale, 'error.webgl-unavailable'))
    ;(err as { cause?: unknown }).cause = cause
    throw err
  }
}

export interface RendererOptions {
  /** 这个渲染器用的主题；不写是 DARK */
  theme?: Theme
  /** 报错用的语言；不写是 'en' */
  locale?: Locale
}

/**
 * 四边有面板挡着时镜头怎么设：虚拟画布往一边多出两边之差，只画其中 w × h 的一块，镜头轴线就落在没被挡住那块的正中。
 * 取景只算没被挡住的那块：fitAspect 是它的宽高比，fitHeight 是它占虚拟画布高度的比例（竖直视角按它收窄）。
 * 一个方向上挡掉六成以上就不管那个方向：剩下的太窄，居中也没意义
 */
export function insetView(w: number, h: number, inset: { top: number; right: number; bottom: number; left: number }) {
  const [l, r] = inset.left + inset.right < w * 0.6 ? [inset.left, inset.right] : [0, 0]
  const [t, b] = inset.top + inset.bottom < h * 0.6 ? [inset.top, inset.bottom] : [0, 0]
  if (!l && !r && !t && !b) return { offset: null, fitAspect: w / h, fitHeight: 1 }
  const dx = r - l
  const dy = b - t
  const fullW = w + Math.abs(dx)
  const fullH = h + Math.abs(dy)
  return {
    offset: { fullW, fullH, x: dx > 0 ? dx : 0, y: dy > 0 ? dy : 0 },
    fitAspect: (w - l - r) / (h - t - b),
    fitHeight: (h - t - b) / fullH,
  }
}

export class StrataRenderer {
  readonly gl: WebGLRenderer
  // 显式标注不带泛型的 Scene：推断出来的 Scene<Object3DEventMap> 写进 .d.ts，@types/three < 0.184 下会报 “Scene is not generic”
  readonly scene: Scene = new Scene()
  private overlay = new Scene()
  readonly rig: CameraRig
  private _theme: Theme
  /** 这个渲染器自己的雾：所有材质挂的是这一份的 uniform，和同一页上别的实例互不相干 */
  readonly fog: Fog
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private passes: { dispose(): void }[] = []
  private plates: Plates
  private nodes: Nodes
  private marks: Marks
  private edges: Edges
  /** 这一帧要画的所有线：底子里的，加上穿透线、路径、标记。每帧复用 */
  private drawn: EdgeLook[] = []
  private labels: Labels
  private base: RendererBase | null = null
  /** 节点世界坐标，每帧更新 */
  world: Float32Array = new Float32Array(0)
  private ends = new Float32Array(0)
  private items: LabelItem[] = []
  private itemLooks: LabelLook[] = []
  /** 每层当前高度（缓动中）和目标高度 */
  heights: number[] = []
  private heightGoal: number[] = []
  /** 每层当前的缩放（缓动中）和目标：主角 1，配角按比例缩小 */
  scales: number[] = []
  private scaleGoal: number[] = []
  private backdrop: CanvasTexture
  /** dispose 过了：之后的调用什么都不做 */
  private disposed = false
  width = 1
  height = 1
  private pixel = 1
  /** 四边被面板挡住的宽度（CSS 像素）：投影中心挪到没被挡住那块的正中 */
  private inset = { top: 0, right: 0, bottom: 0, left: 0 }

  constructor(
    private readonly host: HTMLElement,
    opts: RendererOptions = {},
  ) {
    // 先拿上下文：拿不到就在这里抛，后面什么都还没建、没挂到页面上
    this.gl = createGL(opts.locale)
    const theme = (this._theme = opts.theme ?? DARK)
    this.fog = createFog(theme.fog.near, theme.fog.far)
    this.plates = new Plates(theme, this.fog)
    this.nodes = new Nodes(this.fog)
    this.marks = new Marks(this.fog, 8192)
    this.edges = new Edges(this.fog)
    this.labels = new Labels(theme, 8000)
    this.backdrop = makeBackdrop(theme)
    this.gl.outputColorSpace = SRGBColorSpace
    this.gl.toneMapping = NoToneMapping
    this.gl.setClearColor(new Color(theme.background), 1)
    this.pixel = Math.min(window.devicePixelRatio || 1, 2)
    this.gl.setPixelRatio(this.pixel)
    host.appendChild(this.gl.domElement)
    this.gl.domElement.style.display = 'block'
    this.gl.domElement.style.touchAction = 'none'
    this.rig = new CameraRig(this.gl.domElement)
    this.scene.background = this.backdrop
    this.scene.add(this.plates.group, this.edges.mesh, this.marks.mesh, this.nodes.mesh)
    this.overlay.add(this.labels.mesh)
    // 泛光只吃亮度 > 1 的东西：半浮点缓冲把超过 1 的亮度留下来
    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
    this.composer = new EffectComposer(this.gl, rt)
    const renderPass = new RenderPass(this.scene, this.rig.camera)
    // 阈值 1：只有亮度超过 1 的才泛光。静止时没有东西超过 1；悬停、选中、路径、变化才会
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.38, 0.32, 1.0)
    const output = new OutputPass()
    this.composer.addPass(renderPass)
    this.composer.addPass(this.bloom)
    this.composer.addPass(output)
    this.passes = [renderPass, this.bloom, output]
  }

  /** 这个渲染器现在用的主题 */
  get theme(): Theme {
    return this._theme
  }

  /**
   * 换主题：清屏色、背景贴图、盘面（点阵、底色、层名、领域名）、标签图集按新主题重建。
   * 节点和线的颜色不在这里：它们每帧从 Looks 来（由模型和样式按主题算）。不重新布局。
   */
  setTheme(theme: Theme) {
    if (this.disposed) return
    this._theme = theme
    this.gl.setClearColor(new Color(theme.background), 1)
    this.backdrop.dispose()
    this.backdrop = makeBackdrop(theme)
    this.scene.background = this.backdrop
    this.plates.setTheme(theme)
    if (this.base) this.plates.build(this.base.plates, this.pixel)
    this.overlay.remove(this.labels.mesh)
    const cap = this.labels.capacityOf
    this.labels.dispose()
    this.labels = new Labels(theme, cap)
    this.labels.setResolution(this.width, this.height)
    this.overlay.add(this.labels.mesh)
  }

  setBase(base: RendererBase) {
    if (this.disposed) return
    this.base = base
    // 标签槽位、标记数量跟着节点数长：每个节点两个标签槽位、最多四个标记
    if (base.nodes.length * 2 > this.labels.capacityOf) {
      this.overlay.remove(this.labels.mesh)
      this.labels.dispose()
      this.labels = new Labels(this.theme, base.nodes.length * 2 + 512)
      this.labels.setResolution(this.width, this.height)
      this.overlay.add(this.labels.mesh)
    }
    if (base.nodes.length * 4 > this.marks.capacity) {
      this.scene.remove(this.marks.mesh)
      this.marks.dispose()
      this.marks = new Marks(this.fog, base.nodes.length * 4 + 512)
      this.scene.add(this.marks.mesh)
    }
    this.nodes.build(base.nodes)
    this.plates.build(base.plates, this.pixel)
    this.world = new Float32Array(base.nodes.length * 3)
    this.items = []
    this.itemLooks = []
    for (let i = 0; i < base.nodes.length * 2; i++) {
      this.itemLooks.push({ text: '', color: '#ffffff', alpha: 0, size: 12, weight: 400, strike: false, priority: 0 })
      this.items.push({ look: this.itemLooks[i], x: 0, y: 0, z: 0, parent: i % 2 === 1 ? i - 1 : -1, alpha: 0 })
    }
    this.labels.resetFades()
    if (this.heights.length !== base.layers) {
      this.setLayout(null, 1)
      this.heights = [...this.heightGoal]
      this.scales = [...this.scaleGoal]
    }
  }

  /**
   * 层的展开：focus 聚焦的层（null 为不聚焦），spread 整体间距倍数。
   * stage：分主次时由 stage.ts 算好的每层高度和缩放；给了它就不看 focus 和 spread。
   */
  setLayout(focus: number | null, spread: number, stage: { heights: number[]; scales: number[] } | null = null) {
    if (stage) {
      this.heightGoal = [...stage.heights]
      this.scaleGoal = [...stage.scales]
      if (this.scales.length !== this.scaleGoal.length) this.scales = [...this.scaleGoal]
      return
    }
    const L = this.base?.layers ?? 0
    const h = new Array(L).fill(0)
    // 盘面越大层距越大，不然大图的几层挤成一片
    const R = this.base ? Math.max(...this.base.plates.plates.map((p) => p.radius)) : 30
    const scale = Math.pow(Math.max(1, R / 30), 0.6)
    for (let i = L - 2; i >= 0; i--) {
      let gap = LAYER_GAP * spread * scale
      if (focus !== null) gap *= i === focus || i + 1 === focus ? 1.3 : 0.42
      h[i] = h[i + 1] + gap
    }
    const mid = (h[0] + h[L - 1]) / 2
    this.heightGoal = h.map((y) => y - mid)
    this.scaleGoal = h.map(() => 1)
    if (this.scales.length !== L) this.scales = [...this.scaleGoal]
  }

  /** 层的目标缩放（层还在缓动时，镜头按它取景） */
  goalScale(layer: number) {
    return this.scaleGoal[layer] ?? 1
  }

  layerY(layer: number) {
    return this.heights[layer] ?? 0
  }

  /** 层的目标高度（层还在缓动时，镜头按它取景） */
  goalY(layer: number) {
    return this.heightGoal[layer] ?? this.heights[layer] ?? 0
  }

  setInset(inset: { top: number; right: number; bottom: number; left: number }) {
    const o = this.inset
    if (o.top === inset.top && o.right === inset.right && o.bottom === inset.bottom && o.left === inset.left) return
    this.inset = { ...inset }
    this.width = 0
    this.resize()
  }

  resize() {
    if (this.disposed) return
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    // 拖到另一块屏幕、浏览器缩放：像素比变了要跟着换
    const pixel = Math.min(window.devicePixelRatio || 1, 2)
    if (pixel !== this.pixel) {
      this.pixel = pixel
      this.gl.setPixelRatio(pixel)
      this.plates.setPixel(pixel)
      this.overlay.remove(this.labels.mesh)
      const cap = this.labels.capacityOf
      this.labels.dispose()
      this.labels = new Labels(this.theme, cap)
      this.overlay.add(this.labels.mesh)
      this.width = 0
    }
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.gl.setSize(w, h, false)
    this.gl.domElement.style.width = `${w}px`
    this.gl.domElement.style.height = `${h}px`
    this.composer.setPixelRatio(this.pixel)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w, h)
    this.rig.resize(w, h)
    const cam = this.rig.camera
    const v = insetView(w, h, this.inset)
    if (v.offset) {
      cam.aspect = v.offset.fullW / v.offset.fullH
      cam.setViewOffset(v.offset.fullW, v.offset.fullH, v.offset.x, v.offset.y, w, h)
    } else cam.clearViewOffset()
    this.rig.fitAspect = v.fitAspect
    this.rig.fitHeight = v.fitHeight
    cam.updateProjectionMatrix()
    this.edges.setResolution(w, h)
    this.labels.setResolution(w, h)
  }

  frame(looks: Looks, dt: number, time: number) {
    const base = this.base
    if (!base || this.disposed || this.gl.getContext().isContextLost()) return
    this.resize()
    // 层高缓动
    for (let i = 0; i < this.heights.length; i++) {
      this.heights[i] += ((this.heightGoal[i] ?? 0) - this.heights[i]) * Math.min(1, dt * 4)
      this.scales[i] += ((this.scaleGoal[i] ?? 1) - this.scales[i]) * Math.min(1, dt * 4)
    }
    this.plates.setPose(this.heights, this.scales)
    const S = this.scales
    // 节点世界坐标
    const W = this.world
    for (let i = 0; i < base.nodes.length; i++) {
      const l = looks.nodes[i]
      if (!l) continue
      const sc = S[l.layer] ?? 1
      W[i * 3] = l.x * sc
      W[i * 3 + 1] = this.layerY(l.layer) + l.lift + FLOAT
      W[i * 3 + 2] = l.z * sc
    }
    // 边两端
    const drawn = this.drawn
    drawn.length = 0
    for (const e of looks.edges) drawn.push(e)
    for (const e of looks.extra.bridges) drawn.push(e)
    for (const e of looks.extra.path) drawn.push(e)
    for (const e of looks.extra.marks) drawn.push(e)
    if (this.ends.length < drawn.length * 6) this.ends = new Float32Array(drawn.length * 6 + 600)
    for (let i = 0; i < drawn.length; i++) {
      const e = drawn[i]
      const sa = S[e.a.layer] ?? 1
      const sb = S[e.b.layer] ?? 1
      this.ends[i * 6] = e.a.x * sa
      this.ends[i * 6 + 1] = this.layerY(e.a.layer) + e.a.lift + FLOAT
      this.ends[i * 6 + 2] = e.a.z * sa
      this.ends[i * 6 + 3] = e.b.x * sb
      this.ends[i * 6 + 4] = this.layerY(e.b.layer) + e.b.lift + FLOAT
      this.ends[i * 6 + 5] = e.b.z * sb
    }
    this.rig.update(dt)
    // 标签避让要用这一帧的相机矩阵（OrbitControls 只改了朝向，矩阵要到渲染时才更新）
    this.rig.camera.updateMatrixWorld()
    const focusDist = this.rig.camera.position.distanceTo(this.rig.controls.target)
    placeFog(this.fog, focusDist, this._theme.fog)
    this.plates.update(looks, this.rig.camera)
    this.nodes.update(base.nodes, looks.nodes, W, this.height, S)
    this.edges.update(drawn, this.ends, time)
    // 标记：光晕、外环、幽灵、脉冲
    this.marks.begin()
    for (let i = 0; i < base.nodes.length; i++) {
      const l = looks.nodes[i]
      if (!l || !l.visible) continue
      const r = drawnRadius(base.nodes[i]) * Math.max(l.scale, 0.0001) * shrink(S[l.layer] ?? 1)
      const x = W[i * 3]
      const y = W[i * 3 + 1]
      const z = W[i * 3 + 2]
      if (l.halo) this.marks.push(x, y, z, r * l.halo.size * 2, l.halo.color, l.halo.alpha * l.alpha, MARK.halo)
      if (l.ring) this.marks.push(x, y, z, r * 2 * 1.75, l.ring.color, l.ring.alpha * l.alpha, MARK.ring)
      if (l.ghost) this.marks.push(x, y, z, r * 2 * 1.5, l.color, Math.min(1, l.alpha * 1.4), MARK.ghost)
      if (l.pulse > 0 && l.pulse < 1) this.marks.push(x, y, z, r * 2 * 5, l.ring?.color ?? l.color, l.alpha, MARK.pulse, l.pulse)
    }
    this.marks.end()
    // 标签：每个节点两个槽位（主标签、旧名）
    for (let i = 0; i < base.nodes.length; i++) {
      const l = looks.nodes[i]
      const main = this.items[i * 2]
      const old = this.items[i * 2 + 1]
      const r = drawnRadius(base.nodes[i]) * (l ? Math.max(l.scale, 0) * shrink(S[l.layer] ?? 1) : 0)
      const ax = W[i * 3]
      const ay = W[i * 3 + 1] + r + 0.12
      const az = W[i * 3 + 2]
      main.x = old.x = ax
      main.y = old.y = ay
      main.z = old.z = az
      const vis = !!l && l.visible
      main.alpha = old.alpha = vis ? l.alpha : 0
      copyLabel(this.itemLooks[i * 2], vis ? l.label : null, l?.badge ?? null)
      copyLabel(this.itemLooks[i * 2 + 1], vis ? l.label2 : null, null)
    }
    this.labels.update(this.items, this.rig.camera, this.width, this.height, dt, focusDist)
    this.composer.render(dt)
    this.gl.autoClear = false
    this.gl.clearDepth()
    this.gl.render(this.overlay, this.rig.camera)
    this.gl.autoClear = true
  }

  /** 屏幕坐标（CSS 像素）下最近的节点 */
  pick(sx: number, sy: number, looks: Looks): number {
    const base = this.base
    if (!base || this.disposed) return -1
    const v = new Vector3()
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < base.nodes.length; i++) {
      const l = looks.nodes[i]
      if (!l || !l.visible || l.alpha < 0.12) continue
      v.set(this.world[i * 3], this.world[i * 3 + 1], this.world[i * 3 + 2]).project(this.rig.camera)
      if (v.z > 1) continue
      const x = (v.x * 0.5 + 0.5) * this.width
      const y = (1 - (v.y * 0.5 + 0.5)) * this.height
      const d = Math.hypot(x - sx, y - sy)
      if (d < 14 && d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  /**
   * WebGL 上下文还回来以后：three.js 自己重建了 GL 状态，几何、材质、贴图、渲染目标在下一帧按需重新上传；
   * 这里补上它不管的：清屏色（它的背景对象是新建的）、画布尺寸和后期的渲染目标（强制按现在的大小重设一遍）、
   * 画布贴图（标签图集、盘面上的字、背景，标成要重新上传）。
   */
  restore() {
    if (this.disposed) return
    this.gl.setClearColor(new Color(this.theme.background), 1)
    this.backdrop.needsUpdate = true
    this.plates.touch()
    this.labels.touch()
    this.width = 0
    this.resize()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.plates.dispose()
    this.nodes.dispose()
    this.marks.dispose()
    this.edges.dispose()
    this.backdrop.dispose()
    this.labels.dispose()
    this.rig.dispose()
    // EffectComposer.dispose 不管各个 pass：泛光的一串渲染目标要自己放
    for (const p of this.passes) p.dispose()
    this.composer.dispose()
    this.gl.dispose()
    // 开发时双挂载、热更新会反复建上下文，不主动丢弃会撞上浏览器的上下文数上限
    this.gl.forceContextLoss()
    this.gl.domElement.remove()
  }
}

function copyLabel(dst: LabelLook, src: LabelLook | null, badge: string | null) {
  if (!src) {
    dst.alpha = 0
    return
  }
  dst.text = badge ? `${src.text}  ${badge}` : src.text
  dst.color = src.color
  dst.alpha = src.alpha
  dst.size = src.size
  dst.weight = src.weight
  dst.strike = src.strike
  dst.priority = src.priority
  dst.mono = src.mono
}

/** 背景：中间略亮的深蓝，四周暗下去。幅度很低，只是让画面有个纵深，不是一团光 */
function makeBackdrop(theme: Theme) {
  const S = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S * 0.5, 0, S / 2, S * 0.5, S * 0.75)
  g.addColorStop(0, theme.backdrop.center)
  g.addColorStop(0.6, theme.backdrop.mid)
  g.addColorStop(1, theme.backdrop.edge)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
