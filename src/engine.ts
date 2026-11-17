import { bridgesOf } from './bridge.js'
import { layoutStrata, placeChildren } from './layout.js'
import { DEFAULT_LOCALE, message, StrataError, type Locale } from './locale.js'
import { buildModel, type Model } from './model.js'
import { composeFrame, fadePresence, spotlightOf } from './pipeline.js'
import {
  Emitter,
  ViewRegistry,
  type FrameInfo,
  type ModeHandle,
  type PlatePoint,
  type StrataChange,
  type StrataContext,
  type StrataEvents,
  type StrataMode,
  type StrataOverlay,
  type StrataPlugin,
} from './plugin.js'
import { FLOAT, StrataRenderer } from './renderer/index.js'
import { normalize, project } from './resolve.js'
import { stageOf, type Stage } from './stage.js'
import { Styler, type StyleState } from './styler.js'
import { createTheme, type DeepPartial, type Theme } from './theme.js'
import type { DataIssue, Looks, NodeStyle, Normalized, Resolved, StrataData, StrataLayout } from './types.js'

/** 盘面的半径随节点数长（按最大的那层算）：几十个节点 26，几千个节点按面积放大，节点不至于叠成一团 */
function radiusFor(data: Resolved) {
  const most = Math.max(0, ...data.layers.map((l) => l.nodes.length))
  return 26 * Math.max(1, Math.sqrt(most / 110))
}

/** 核心的镜头。框住别的东西（路径、某一处变化）的镜头归各自的插件，用 ctx.fit */
export type ShotName = 'overview' | 'top' | 'layer'

export interface StrataOptions {
  /**
   * 几张图并存时，哪一层当主角（铺满画面、原大原亮），其余的缩小、变暗当配角。
   * 写层的 id；不写就是第一张图。
   */
  hero?: string
  /**
   * 主角跟着你在问的东西走：选中哪一层的节点（插件也可以让它跟：路径走到哪一层、看哪一处变化），主角就换到哪一层。
   * 缺省 false：主角固定，只有 setHero 才换。
   */
  followHero?: boolean
  /** 紧挨主角的那层缩到多大，缺省 0.56；再远的层按比例更小（见 stage.ts） */
  secondaryScale?: number
  /**
   * 哪一张图做布局的基准（层的 id）：它自己按力导摆，别的图向它对齐。
   * 不写就挑和别的图映射最多的那张。主角不写时也跟它走。
   */
  anchor?: string
  /** 一开始就隐藏的层（层的 id）。运行时用 setLayerVisible 开关 */
  hidden?: string[]
  /** 一开始就展开的节点（节点的 id）：它的子节点（表的字段）画出来。运行时用 setExpanded / expand 开关 */
  expanded?: string[]
  /**
   * 不想二选一时：给每一层一个当主角的分量 0..1（层的 id → 分量），写了它就不看 hero。
   * 1 原大、原亮，0 是配角，都写 0.5 就是两层一样大。没写到的图按 0 算。
   */
  heroMix?: Record<string, number>
  /** 节点类型 → 画成什么样（形状、等宽字）。数据只说“是什么”，样子在这里配 */
  nodeStyles?: Record<string, NodeStyle>
  /**
   * 给人看的字用什么语言：setData 返回的问题描述、报错，插件不写语言时也跟它。缺省 'en'。
   * 问题和错误的 code 不随语言变
   */
  locale?: Locale
  /** 主题：盖在夜景主题（DARK）上，只写要改的项（见 theme.ts 的 createTheme）。只在创建时读一次 */
  theme?: DeepPartial<Theme>
}

/**
 * 视图状态：现在看的是什么样子。可以存下来、放进地址里、换个地方原样恢复。
 * 都用 id，不依赖顺序和下标。
 * 这里是核心的那几项；插件可以登记自己的一段（ctx.registerView），并用 declare module 把类型补到这里来。
 */
export interface StrataView {
  /** 每张图当主角的分量 0..1（层的 id → 分量） */
  hero: Record<string, number>
  /** 主角是不是跟着选中走 */
  follow: boolean
  /** 隐藏的层 */
  hidden: string[]
  /** 展开的节点：它们的子节点画出来了 */
  expanded: string[]
  /** 选中的节点 */
  selected: string | null
  /** 强调的组（“维度 id/组 id”） */
  group: string | null
  /** 只有一张图时聚焦的层 */
  focus: string | null
  /** 层距的倍数 */
  spread: number
  camera: { position: [number, number, number]; target: [number, number, number] }
}

/** layers 事件带的东西：每一层现在显示还是隐藏 */
export interface LayerInfo {
  id: string
  name: string
  visible: boolean
}

/** hero 事件带的东西：现在谁是主角、是不是在跟随 */
export interface HeroInfo {
  /** 分量最大的那一层；只有一张图、不分主次时是 null */
  id: string | null
  follow: boolean
  /** 每张图当主角的分量 0..1（层的 id → 分量） */
  mix: Record<string, number>
}

export interface HoverInfo {
  id: string
  label: string
  layer: string
  group: string | null
  /** 它里面收着几个没画出来的子节点（表的字段）；大于 0 就能展开 */
  folds: number
  /** 它现在是不是展开着 */
  expanded: boolean
  x: number
  y: number
}

/** 正在接管的模式，和它是哪个插件的 */
interface Active {
  mode: StrataMode
  owner: string
}

/**
 * kgstrata 的核心：数据 → 布局 → 样式 → 渲染。管主次、隐藏层、节点的展开、悬停和选中、镜头、事件。
 * 路径回放、看变化这些是插件（strata.use），核心不认识它们；每帧的管线见 plugin.ts。
 */
export class Strata {
  readonly renderer: StrataRenderer
  private model: Model | null = null
  /** 调用方给的原始数据 */
  private source: StrataData | null = null
  /** 整理过的数据：什么都不丢的那一份。展开、收起都从它重新生成要画的图 */
  private normal: Normalized | null = null
  /** 全部收起时的布局：展开只在它上面添子节点，顶层节点不动 */
  private baseLayout: StrataLayout | null = null
  private collapsed: Resolved | null = null
  /** 展开的节点 */
  private expandedIds = new Set<string>()
  private styler: Styler | null = null
  private state: StyleState = { hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: 0 }
  /** 正在接管的模式；null = 核心自己画全景 */
  private active: Active | null = null
  /** 接管的模式里指着的节点（模式自己的下标） */
  private modeHover = -1
  private raf = 0
  private last = 0
  private time = 0
  private frameInfo: FrameInfo = { time: 0, dt: 0 }
  private spread = 1
  private looks: Looks | null = null
  private events = new Emitter<StrataEvents>()
  private pointer = { x: -1, y: -1, down: 0, moved: false }
  /** 还停在总览、用户没动过镜头：画布尺寸变了就重新取景 */
  private autoFrame = true
  private aspect = 0
  /** 正在叠看：层距收到了几乎为零 */
  private overlay = false
  /** 几张图并存时，主角是哪一层：分量最大的那层（-1 = 只有一张图，不分主次） */
  private hero = -1
  /** 每层当主角的分量 0..1；不是 graph 的层恒为 1（不参与主次）。只有一张图时为 null */
  private heroMix: number[] | null = null
  private secondaryScale = 0.56
  /** 隐藏的层，按 id 记：换数据、进出模式时还认得 */
  private hiddenIds = new Set<string>()
  /** 每层在不在场 0..1：隐藏时从 1 缓到 0 */
  private presence: number[] = []
  /** 主角的“家”：点总览、没有东西可跟时回到这一层 */
  private heroHome = -1
  private followHero: boolean
  private disposed = false
  // 插件
  private plugins = new Map<string, unknown>()
  private overlays: StrataOverlay[] = []
  private frameHooks = new Set<(frame: FrameInfo) => void>()
  private changeHooks = new Set<(change: StrataChange) => void>()
  private expandHooks = new Set<() => boolean | void>()
  private disposeHooks = new Set<() => void>()
  private views: ViewRegistry
  /** WebGL 上下文丢了：循环停着，等它还回来 */
  private contextLost = false
  readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  /** 这个实例的语言（选项里不写是 'en'） */
  readonly locale: Locale
  /** 这个实例的主题：选项盖在 DARK 上的结果。各实例各一份，互不影响 */
  readonly theme: Theme

  /**
   * 拿不到 WebGL 上下文时抛 StrataError（code 'webgl-unavailable'），这时页面上什么都没挂。
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly options: StrataOptions = {},
  ) {
    this.locale = options.locale ?? DEFAULT_LOCALE
    this.theme = createTheme(options.theme)
    this.views = new ViewRegistry(this.locale)
    this.renderer = new StrataRenderer(host, { theme: this.theme, locale: this.locale })
    this.followHero = !!options.followHero
    for (const id of options.hidden ?? []) this.hiddenIds.add(id)
    for (const id of options.expanded ?? []) this.expandedIds.add(id)
    if (options.secondaryScale !== undefined) this.secondaryScale = Math.min(1, Math.max(0.2, options.secondaryScale))
    const el = this.renderer.gl.domElement
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointerleave', this.onLeave)
    el.addEventListener('dblclick', this.onDouble)
    el.addEventListener('webglcontextlost', this.onContextLost)
    el.addEventListener('webglcontextrestored', this.onContextRestored)
    this.renderer.rig.idleRotate = !this.reducedMotion
    this.renderer.rig.controls.addEventListener('start', () => (this.autoFrame = false))
    this.raf = requestAnimationFrame(this.loop)
  }

  /** 装一个插件，返回它的接口。同名的插件只能装一个 */
  use<Api>(plugin: StrataPlugin<Api>): Api {
    // 销毁以后不抛：同名的交回原来那个；没装过的照样装（它拿到的 ctx 是 disposed 的，各个能力都不做事）
    if (this.disposed && this.plugins.has(plugin.name)) return this.plugins.get(plugin.name) as Api
    if (this.plugins.has(plugin.name)) throw new StrataError('plugin-installed', message(this.locale, 'error.plugin-installed', { name: plugin.name }))
    const api = plugin.install(this.contextFor(plugin.name))
    this.plugins.set(plugin.name, api)
    return api
  }

  /** 现在接管的模式是哪个插件的；null = 核心自己画的全景 */
  get mode(): string | null {
    return this.active?.owner ?? null
  }

  /** setData 给进来的数据（原样） */
  get data() {
    return this.source
  }

  on<K extends keyof StrataEvents>(event: K, cb: (v: StrataEvents[K]) => void): () => void {
    return this.events.on(event, cb)
  }

  private emit<K extends keyof StrataEvents>(event: K, v: StrataEvents[K]) {
    this.events.emit(event, v)
  }

  private notify(change: StrataChange) {
    for (const cb of this.changeHooks) cb(change)
  }

  /** 现在画的模型：有模式接管时是模式的 */
  private get current(): Model | null {
    return this.active?.mode.model ?? this.model
  }

  /**
   * 换数据。先查一遍（重复的 id、指向不存在的节点的关系……），有问题的项丢掉，其余的照常画；
   * 查出来的问题原样返回，调用方决定要不要报给用户。
   */
  setData(input: StrataData): DataIssue[] {
    if (this.disposed) return []
    const { data: normal, issues } = normalize(input, this.normalizeOptions)
    this.source = input
    this.normal = normal
    // 换了数据：接管的模式、插件挂在旧数据上的东西都作废
    const was = this.active
    this.active = null
    was?.mode.released?.()
    this.notify('data')
    this.collapsed = project(normal)
    this.baseLayout = this.layoutOf(this.collapsed)
    this.build()
    const model = this.model!
    const data = model.data
    // 几张图并存：选项里指定的那一层（不写就是布局的基准层）当主角，其余的缩小、变暗，退成配角
    const multi = data.layers.length >= 2
    const wanted = this.options.hero !== undefined ? data.layers.findIndex((l) => l.id === this.options.hero) : -1
    this.heroHome = this.hero = multi ? (wanted >= 0 ? wanted : model.renderer.primary) : -1
    this.heroMix = multi ? this.oneHot(this.hero) : null
    if (multi && this.options.heroMix) this.adoptMix(this.options.heroMix)
    // 不能把图全藏了：至少留一张；主角不能是隐藏的
    if (data.layers.length > 0 && data.layers.every((l) => this.hiddenIds.has(l.id))) this.hiddenIds.delete(data.layers[Math.max(0, model.renderer.primary)].id)
    this.yieldHero()
    this.heroHome = this.hero
    this.presence = data.layers.map((l) => (this.hiddenIds.has(l.id) ? 0 : 1))
    this.overlay = false
    this.state = { hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: this.time }
    this.renderer.setBase(model.renderer)
    this.applyLayout()
    this.shot('overview', undefined, 0)
    this.emit('hero', this.heroInfo)
    this.emit('layers', this.layers)
    this.emit('expand', this.expanded)
    return issues
  }

  /** 整理数据用的选项：节点的样子、色板（主题的）、问题描述的语言 */
  private get normalizeOptions() {
    return { nodeStyles: this.options.nodeStyles, palette: this.theme.palette, locale: this.locale }
  }

  /** 布局一份要画的图：盘面的半径随节点数长，基准层按选项 */
  private layoutOf(data: Resolved): StrataLayout {
    return layoutStrata(data, { radius: radiusFor(data), primary: this.options.anchor })
  }

  /** 按现在展开的节点生成要画的图：顶层节点用收起时的布局，展开出来的子节点围着父节点摆 */
  private build() {
    if (!this.normal || !this.collapsed || !this.baseLayout) return
    const open = this.expanded
    const data = open.length > 0 ? project(this.normal, open) : this.collapsed
    const layout = open.length > 0 ? placeChildren(this.baseLayout, data) : this.baseLayout
    this.model = buildModel(data, layout, this.theme)
    this.styler = new Styler(this.model)
  }

  /** 节点现在在画面上的下标；收在父节点里的算在父节点头上。没有就是 -1 */
  private indexOf(id: string | null | undefined, m: Model | null = this.model): number {
    if (!id || !m) return -1
    return m.index.get(id) ?? m.index.get(m.data.folded?.[id] ?? '') ?? -1
  }

  /** 现在展开着的节点（数据里有子节点的才算） */
  get expanded(): string[] {
    const parents = new Set<string>()
    for (const n of this.normal?.nodes ?? []) if (n.parent !== undefined) parents.add(n.parent)
    return [...this.expandedIds].filter((id) => parents.has(id))
  }

  /**
   * 展开这些节点（别的都收起）。展开一个节点：它的子节点（表的字段）围着它画出来，
   * 原来上卷到它身上的关系回到各个子节点上。顶层节点的位置不动。
   */
  setExpanded(ids: Iterable<string>) {
    if (this.disposed) return
    const next = new Set(ids)
    if (next.size === this.expandedIds.size && [...next].every((id) => this.expandedIds.has(id))) return
    this.expandedIds = next
    if (!this.normal) return
    this.emit('expand', this.expanded)
    // 插件可以接手这次展开（看变化时两版按新的展开状态重新比一遍），这时全景不重建
    if ([...this.expandHooks].some((cb) => cb() === true)) return
    const selected = this.state.selected >= 0 ? this.model?.base.nodes[this.state.selected]?.id : undefined
    this.build()
    if (!this.model) return
    this.renderer.setBase(this.model.renderer)
    this.state.selected = this.indexOf(selected)
    this.state.hover = -1
    this.emit('hover', null)
    this.notify('model')
    this.applyLayout()
    if (this.autoFrame) this.shot('overview', undefined, 0.6)
  }

  /** 展开或收起一个节点 */
  expand(id: string, on = true) {
    const next = new Set(this.expandedIds)
    if (on) next.add(id)
    else next.delete(id)
    this.setExpanded(next)
  }

  /** 现在的视图状态：主次、隐藏、选中、层距、镜头，加上插件登记的那几段。都用 id，可以存下来再用 setView 恢复 */
  getView(): StrataView {
    const m = this.model
    const cam = this.renderer.rig.camera.position
    const tgt = this.renderer.rig.controls.target
    const core: StrataView = {
      hero: this.heroInfo.mix,
      follow: this.followHero,
      hidden: [...this.hiddenIds].filter((id) => this.current?.data.layers.some((l) => l.id === id)),
      expanded: this.expanded,
      selected: this.state.selected >= 0 && m ? (m.base.nodes[this.state.selected]?.id ?? null) : null,
      group: this.state.group >= 0 && m ? (m.data.groups[this.state.group]?.id ?? null) : null,
      focus: this.state.focusLayer !== null && m ? (m.data.layers[this.state.focusLayer]?.id ?? null) : null,
      spread: this.spread,
      camera: { position: [cam.x, cam.y, cam.z], target: [tgt.x, tgt.y, tgt.z] },
    }
    return Object.assign(core, this.views.read())
  }

  /** 恢复视图状态。可以只给一部分；数据里已经没有的层、节点会被跳过 */
  setView(view: Partial<StrataView>) {
    if (this.disposed) return
    const layers = this.current?.data.layers ?? []
    if (view.follow !== undefined) this.followHero = view.follow
    if (view.spread !== undefined) this.spread = view.spread
    if (view.expanded !== undefined) this.setExpanded(view.expanded)
    if (view.hidden !== undefined) {
      const want = new Set(view.hidden)
      // 先显示再隐藏：不会中途把图全藏掉
      for (const l of layers) if (!want.has(l.id)) this.setLayerVisible(l.id, true)
      for (const l of layers) if (want.has(l.id)) this.setLayerVisible(l.id, false)
    }
    if (view.hero !== undefined) this.setHeroMix(view.hero)
    else this.applyLayout()
    if (view.focus !== undefined && this.hero < 0) this.focusLayer(view.focus)
    if (view.group !== undefined) this.highlightGroup(view.group)
    // 插件登记的那几段（比如路径）：在选中之前，它们可能会清掉选中
    this.views.apply(view as Record<string, unknown>)
    if (view.selected !== undefined) this.select(view.selected)
    if (view.camera) {
      this.autoFrame = false
      this.renderer.rig.fly({ pos: view.camera.position, target: view.camera.target }, 0)
    } else if (this.autoFrame) this.shot('overview', undefined, 0)
    this.emit('hero', this.heroInfo)
    this.emit('layers', this.layers)
  }

  /** 每一层现在显示还是隐藏 */
  get layers(): LayerInfo[] {
    const layers = this.current?.data.layers ?? []
    return layers.map((l) => ({ id: l.id, name: l.name, visible: !this.hiddenIds.has(l.id) }))
  }

  /** 隐藏的层的下标 */
  private hiddenSet(): Set<number> {
    const out = new Set<number>()
    ;(this.current?.data.layers ?? []).forEach((l, i) => this.hiddenIds.has(l.id) && out.add(i))
    return out
  }

  /**
   * 显示或隐藏一层（层的 id）。
   * 隐藏以后：这一层的节点、关系、盘面都不画；剩下的层留在原位，比例按剩下的层重算；
   * 被它隔开的两层之间画穿透线（见 bridge.ts）；主角被隐藏时让给最近的可见图。
   * 最后一张可见的图不能隐藏，这时返回 false。
   */
  setLayerVisible(layer: string, visible: boolean): boolean {
    if (this.disposed) return false
    const layers = this.current?.data.layers ?? []
    const i = layers.findIndex((l) => l.id === layer)
    if (i < 0) return false
    const id = layers[i].id
    if (visible === !this.hiddenIds.has(id)) return true
    if (!visible) {
      if (!layers.some((l, k) => k !== i && !this.hiddenIds.has(l.id))) return false
      this.hiddenIds.add(id)
    } else this.hiddenIds.delete(id)
    const heroBefore = this.hero
    this.yieldHero()
    this.applyLayout()
    this.notify('hidden')
    if (this.autoFrame) this.shot('overview', undefined, 0.6)
    this.emit('layers', this.layers)
    if (this.hero !== heroBefore) this.emit('hero', this.heroInfo)
    return true
  }

  /** 隐藏的层不能当主角：分量清零；主角被藏了就让给最近的可见图（先看主角的“家”） */
  private yieldHero() {
    const m = this.current
    if (!m || !this.heroMix || this.hero < 0) return
    const hidden = this.hiddenSet()
    for (const i of hidden) this.heroMix[i] = 0
    const visibleGraphs = m.data.layers.map((_, i) => (hidden.has(i) ? -1 : i)).filter((i) => i >= 0)
    if (visibleGraphs.length === 0) return
    if (hidden.has(this.heroHome)) this.heroHome = visibleGraphs.reduce((a, b) => (Math.abs(b - this.heroHome) < Math.abs(a - this.heroHome) ? b : a))
    if (!hidden.has(this.hero) && this.heroMix.some((v) => v > 0)) return
    const from = this.hero
    const next = hidden.has(from) ? visibleGraphs.reduce((a, b) => (Math.abs(b - from) < Math.abs(a - from) ? b : a)) : from
    this.hero = next
    this.heroMix = m.data.layers.map((_, i) => (i === next ? 1 : 0))
  }

  /** 现在谁是主角 */
  get heroInfo(): HeroInfo {
    const layers = this.current?.data.layers ?? []
    // 没有原型的对象：层的 id 叫 constructor、__proto__ 时，按 id 取值也不会读到原型上去
    const mix: Record<string, number> = Object.create(null)
    if (this.heroMix) layers.forEach((l, i) => (mix[l.id] = this.heroMix![i] ?? 0))
    return { id: this.hero >= 0 ? (layers[this.hero]?.id ?? null) : null, follow: this.followHero, mix }
  }

  /** 第 i 层分量 1、其余的层分量 0 */
  private oneHot(i: number): number[] {
    const layers = this.current?.data.layers ?? []
    return layers.map((_, li) => (li === i ? 1 : 0))
  }

  /** 把“层的 id → 分量”收进 heroMix，主角改成分量最大的那层（一样大时不换） */
  private adoptMix(mix: Record<string, number>) {
    const m = this.current
    if (!m || !this.heroMix) return
    this.heroMix = m.data.layers.map((l) => {
      if (this.hiddenIds.has(l.id)) return 0
      const v = Object.hasOwn(mix, l.id) ? mix[l.id] : undefined
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
    })
    let best = this.hero
    for (let i = 0; i < this.heroMix.length; i++) if (this.heroMix[i] > (this.heroMix[best] ?? -1) + 1e-6) best = i
    this.hero = best
    // 分量全给了隐藏的层：等于没给，主角留在原来那层
    if (!this.heroMix.some((v) => v > 0)) this.heroMix = this.oneHot(this.hero)
  }

  /**
   * 连续的主次：给每张图一个当主角的分量 0..1（层的 id → 分量），没写到的图按 0 算。
   * 1 原大、原亮，0 是配角，中间按比例；两层都写 0.5 就一样大。分量最大的那层算主角。
   * 只有一张图（不分主次）时不起作用。
   */
  setHeroMix(mix: Record<string, number>) {
    if (this.disposed || this.hero < 0 || !this.heroMix) return
    this.adoptMix(mix)
    this.overlay = false
    this.applyLayout()
    // 用户没动过镜头时跟着重新取景；拖着连续变的时候用短的飞行，一路跟上
    if (this.autoFrame) this.shot('overview', undefined, 0.35)
    this.emit('hero', this.heroInfo)
  }

  /**
   * 指定主角（层的 id）。这一层也成为主角的“家”。
   * 只有一张图（不分主次）时不起作用。
   */
  setHero(layer: string) {
    if (this.disposed || this.hero < 0) return
    const layers = this.current?.data.layers ?? []
    const i = layers.findIndex((l) => l.id === layer)
    if (i < 0 || this.hiddenIds.has(layers[i].id)) return
    this.heroHome = i
    this.switchHero(i, 'overview')
  }

  /** 开关“主角跟着你在问的东西走” */
  setFollowHero(on: boolean) {
    if (this.disposed) return
    this.followHero = on
    this.emit('hero', this.heroInfo)
  }

  /** 换主角。refit：换完以后镜头怎么办（总览重新取景 / 不动 / 换了就调这个函数重新取景） */
  private switchHero(i: number, refit: 'overview' | 'none' | (() => void)) {
    if (this.hero < 0 || i < 0) return
    const mix = this.oneHot(i)
    const changed = i !== this.hero || this.overlay || !this.heroMix || mix.some((v, k) => v !== this.heroMix![k])
    this.hero = i
    this.heroMix = mix
    this.overlay = false
    this.applyLayout()
    if (refit === 'overview') this.shot('overview')
    else if (typeof refit === 'function' && changed) refit()
    if (changed) this.emit('hero', this.heroInfo)
  }

  /** 跟随：主角换到这个节点所在的那一层 */
  private followTo(layer: number, refit: 'overview' | 'none' | (() => void)) {
    // 已经是这层独当主角就不用换；分量是混着的（比如各一半）也要换过去
    if (!this.followHero || this.hero < 0 || (layer === this.hero && (this.heroMix?.[layer] ?? 1) >= 1)) return
    if (this.hiddenSet().has(layer)) return
    // 用户没动过镜头时才重新取景；动过就只换大小，不抢镜头
    this.switchHero(layer, refit === 'overview' && !this.autoFrame ? 'none' : refit)
  }

  /** 把层距、主次交给渲染器。叠看时所有层一样大、压在一起 */
  private applyLayout() {
    const m = this.current
    if (this.overlay || !this.heroMix || !m) {
      this.state.stage = null
      this.state.bridges = this.overlay ? this.state.bridges : []
      this.renderer.setLayout(this.overlay ? null : this.state.focusLayer, this.overlay ? 0.03 : this.spread, null)
      return
    }
    // 分主次：每层多大、多亮、隔多远，由 stage.ts 按分量算。隐藏的层不占位置：只拿可见的层去算
    const hidden = this.hiddenSet()
    const radii = m.renderer.plates.plates.map((p) => p.radius)
    const vis = radii.map((_, i) => i).filter((i) => !hidden.has(i))
    const sub = stageOf({ radii: vis.map((i) => radii[i]), mix: vis.map((i) => this.heroMix![i] ?? 0), secondaryScale: this.secondaryScale, spread: this.spread })
    const stage: Stage = { scales: radii.map(() => 1), levels: radii.map(() => 0), sides: radii.map(() => 1), heights: radii.map(() => 0), tightness: sub.tightness }
    vis.forEach((li, k) => {
      stage.scales[li] = sub.scales[k]
      stage.levels[li] = sub.levels[k]
      stage.sides[li] = sub.sides[k]
      stage.heights[li] = sub.heights[k]
    })
    // 隐藏的层淡出的时候停在上下两个可见层中间，大小跟小的那个
    for (const li of hidden) {
      const above = vis.filter((i) => i < li).pop()
      const below = vis.find((i) => i > li)
      const near = [above, below].filter((i): i is number => i !== undefined)
      if (near.length === 0) continue
      stage.heights[li] = near.reduce((a, i) => a + stage.heights[i], 0) / near.length
      stage.scales[li] = Math.min(...near.map((i) => stage.scales[i]))
    }
    this.state.stage = stage
    this.renderer.setLayout(null, this.spread, stage)
    // 穿透：被隐藏的层隔开的节点之间的关系。有模式接管时不画（那里的线归模式管）
    if (!this.active && this.model) {
      const base = this.model.base
      const cross = base.edges.filter((e) => e.kind === 'cross').map((e): [number, number] => [e.s, e.t])
      this.state.bridges = bridgesOf(base.nodes.map((n) => n.layer), cross, hidden)
    }
  }

  // ─── 模式的接管和交还 ──────────────────────────────────────────────────────

  /** 模式接管：换底子、层全部放开、主角的分量按层的 id 对过去 */
  private takeOver(owner: string, mode: StrataMode): ModeHandle {
    // 销毁以后：不接管，回执一直是不在接管
    if (this.disposed) return { active: false, release: () => {} }
    const prev = this.active
    const entry: Active = { mode, owner }
    this.active = entry
    // 同一个插件换一个新的模式（比如展开以后重新比了一遍）不算被收回
    if (prev && prev.owner !== owner) prev.mode.released?.()
    this.modeHover = -1
    this.renderer.setBase(mode.base)
    // 接管时层全部展开：聚焦状态同步清掉，悬停也清掉
    this.state.focusLayer = null
    this.state.hover = -1
    this.emit('focus', null)
    this.emit('hover', null)
    this.overlay = false
    // 模式的层不一定和全景的一样多：主角的分量按层的 id 对过去，对不上就回到模式的基准层
    if (this.heroMix && this.model) {
      const old = new Map(this.model.data.layers.map((l, i) => [l.id, this.heroMix![i] ?? 0]))
      const next = mode.model.data.layers.map((l) => old.get(l.id) ?? 0)
      if (next.some((v) => v > 0)) {
        this.heroMix = next
        this.hero = next.indexOf(Math.max(...next))
      } else {
        this.hero = Math.max(0, mode.model.layout.primary)
        this.heroMix = mode.model.data.layers.map((_, i) => (i === this.hero ? 1 : 0))
      }
      this.yieldHero()
    }
    this.presence = mode.model.data.layers.map((l) => (this.hiddenIds.has(l.id) ? 0 : 1))
    this.notify('mode')
    this.applyLayout()
    this.emit('layers', this.layers)
    const engine = this
    return {
      get active() {
        return engine.active === entry
      },
      release: (opts) => {
        if (this.active !== entry) return
        this.state.hover = -1
        this.emit('hover', null)
        this.active = null
        this.restore(!!opts?.rebuild)
      },
    }
  }

  /** 回到核心的全景（不重新布局）。rebuild：按现在的展开状态重新生成全景，选中清掉 */
  private restore(rebuild: boolean) {
    if (this.disposed || !this.model) return
    if (rebuild) {
      this.build()
      this.state.selected = -1
    }
    if (this.active) return
    this.renderer.setBase(this.model!.renderer)
    this.presence = this.model!.data.layers.map((l) => (this.hiddenIds.has(l.id) ? 0 : 1))
    this.yieldHero()
    this.applyLayout()
    this.emit('layers', this.layers)
  }

  // ─── 交互 ──────────────────────────────────────────────────────────────────

  /**
   * 点一层（层的 id）。几张图并存时：让它当主角（null = 回到主角的“家”）。
   * 只有一张图时：聚焦这一层，其余层收起。
   */
  focusLayer(layer: string | null) {
    if (this.disposed) return
    if (this.hero >= 0) {
      this.emit('focus', layer)
      if (layer !== null) this.setHero(layer)
      else this.switchHero(this.heroHome, 'overview')
      return
    }
    const found = layer === null ? -1 : (this.model?.data.layers.findIndex((l) => l.id === layer) ?? -1)
    const i = found >= 0 ? found : null
    this.overlay = false
    this.state.focusLayer = i
    this.emit('focus', i === null ? null : layer)
    this.applyLayout()
    if (i === null) this.shot('overview')
    else this.shot('layer', i)
  }

  setSpread(s: number) {
    if (this.disposed) return
    this.spread = s
    this.overlay = false
    this.applyLayout()
  }

  /** 右侧有面板挡着时告诉引擎，画面在剩下的区域里居中 */
  setInset(px: number) {
    if (this.disposed) return
    this.renderer.setInset(px)
  }

  /** 强调一个组。给组的 id；几个分组维度里有重名的组时写成“维度 id/组 id” */
  highlightGroup(id: string | null) {
    if (this.disposed) return
    const groups = this.model?.data.groups ?? []
    this.state.group = id ? groups.findIndex((g) => g.id === id || g.id.slice(g.id.indexOf('/') + 1) === id) : -1
  }

  select(id: string | null) {
    if (this.disposed) return
    this.state.selected = this.indexOf(id)
  }

  shot(name: ShotName, arg?: number, duration = 1.3) {
    if (this.disposed) return
    const r = this.renderer
    this.autoFrame = name === 'overview'
    const plates = this.current?.renderer.plates.plates ?? []
    // 镜头按目标高度算：层还在缓动时也能对准
    // 从叠看换到别的镜头：先把层距放回去，后面按放回去之后的高度取景
    if (name !== 'top' && this.overlay) {
      this.overlay = false
      this.applyLayout()
    }
    const goalY = (layer: number) => r.goalY(layer)
    // 配角那一层是缩小的：取景按缩小之后的位置算
    const sc = (layer: number) => r.goalScale(layer)
    const rim = (li: number): [number, number, number][] => {
      const R = (plates[li]?.radius ?? 20) * sc(li)
      const y = goalY(li)
      return [[R, y, 0], [-R, y, 0], [0, y, R], [0, y, -R]]
    }
    if (name === 'overview') {
      const hidden = this.hiddenSet()
      const pts = plates.flatMap((_, li) => (hidden.has(li) ? [] : rim(li)))
      // 有主角时镜头贴近：主角那一层铺满画面，配角露在它的上方或下方
      // 上面多留一点：弧线和名字会高出盘面
      if (this.hero >= 0) r.rig.frame(pts, { elevation: 0.5, azimuth: 0, padX: 0.05, padTop: 0.12, padBottom: 0.05, duration })
      else r.rig.fit(pts, { elevation: 0.55, azimuth: 0, margin: 0.86, duration })
      return
    }
    if (name === 'top') {
      const m = this.current
      const prim = m?.renderer.primary ?? 0
      const R = Math.max(...plates.map((p) => p.radius))
      if ((m?.data.layers.length ?? 0) >= 2) {
        // 几张图叠在一起对照：层距收到几乎为零，从正上方看。重合的关系是一致的，只有一层有的就是缺口
        if (this.state.focusLayer !== null) {
          this.state.focusLayer = null
          this.emit('focus', null)
        }
        this.overlay = true
        this.applyLayout()
        r.rig.fly({ pos: [0, R * 6.2, 0.01], target: [0, 0, 0], fov: 21 })
        return
      }
      // 只有一张图时，俯视就是主图层的地图：其余层收起来
      if (!this.active && this.state.focusLayer !== prim) {
        this.state.focusLayer = prim
        r.setLayout(prim, this.spread)
        this.emit('focus', m?.data.layers[prim]?.id ?? null)
      }
      r.rig.fly({ pos: [0, goalY(prim) + R * 6.2, 0.01], target: [0, goalY(prim), 0], fov: 21 })
      return
    }
    if (name === 'layer' && arg !== undefined) {
      r.rig.fit(rim(arg), { elevation: 0.72, margin: 1.02 })
    }
  }

  /** 镜头框住盘面上的这些点（给插件用：路径、某一处变化） */
  private fitPoints(points: PlatePoint[], opts: { elevation: number; margin: number }) {
    if (this.disposed) return
    const r = this.renderer
    this.autoFrame = false
    // 从叠看换过来：先把层距放回去，再按放回去之后的高度取景
    if (this.overlay) {
      this.overlay = false
      this.applyLayout()
    }
    const pts = points.map((p): [number, number, number] => {
      const sc = r.goalScale(p.layer)
      return [p.x * sc, r.goalY(p.layer) + FLOAT, p.z * sc]
    })
    r.rig.fit(pts, opts)
  }

  // ─── 每帧 ──────────────────────────────────────────────────────────────────

  private loop = (now: number) => {
    // 销毁了、上下文丢了：不再排下一帧（上下文还回来时 onContextRestored 重新起）
    if (this.disposed || this.contextLost) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016
    this.last = now
    this.renderer.resize()
    const aspect = this.renderer.rig.fitAspect
    if (Math.abs(aspect - this.aspect) > 1e-3) {
      this.aspect = aspect
      if (this.autoFrame) this.shot('overview', undefined, 0)
    }
    this.time += dt
    const frame = this.frameInfo
    frame.time = this.time
    frame.dt = dt
    for (const cb of this.frameHooks) cb(frame)
    // 钩子里可能把引擎销毁了
    if (this.disposed) return
    const active = this.active
    const looks = composeFrame(
      // ① 接管的模式，或者核心的样式（带上叠加层要强调的串）
      () => {
        if (active) return active.mode.looks(frame)
        if (!this.styler) return null
        this.state.time = this.time
        this.state.spot = spotlightOf(this.overlays)
        return this.styler.resolve(this.state)
      },
      // ② 叠加层只叠在核心的全景上
      this.overlays,
      frame,
      // ③ 隐藏的层淡出
      (l) => this.applyPresence(l, dt),
      !active,
    )
    if (!looks) return
    this.looks = looks
    this.renderer.frame(looks, dt, this.time)
    this.emit('tick', this.time)
  }

  /** 隐藏的层：节点、关系、盘面一起淡出。全景和接管的模式都走这里 */
  private applyPresence(looks: Looks, dt: number) {
    const m = this.current
    if (!m) return
    const layers = m.data.layers
    if (this.presence.length !== layers.length) this.presence = layers.map((l) => (this.hiddenIds.has(l.id) ? 0 : 1))
    const goals = layers.map((l) => (this.hiddenIds.has(l.id) ? 0 : 1))
    const nodes = (this.active?.mode.base ?? m.base).nodes
    // 穿透线等隐藏的层淡下去了再显出来
    this.state.bridgeIn = fadePresence(looks, this.presence, goals, (i) => nodes[i].layer, nodes.length, dt)
  }

  /** 上下文丢了：停掉循环，告诉外面。three.js 自己会 preventDefault，浏览器才会还回来 */
  private onContextLost = (e: Event) => {
    e.preventDefault()
    if (this.disposed || this.contextLost) return
    this.contextLost = true
    cancelAnimationFrame(this.raf)
    this.emit('contextlost', null)
  }

  /** 上下文还回来了：渲染器补上 three.js 不管的那几样，循环从头接上（这一帧的 dt 按缺省算，不会一下跳很远） */
  private onContextRestored = () => {
    if (this.disposed || !this.contextLost) return
    this.contextLost = false
    this.renderer.restore()
    this.last = 0
    this.raf = requestAnimationFrame(this.loop)
    this.emit('contextrestored', null)
  }

  private onMove = (e: PointerEvent) => {
    const rect = this.renderer.gl.domElement.getBoundingClientRect()
    this.pointer.x = e.clientX - rect.left
    this.pointer.y = e.clientY - rect.top
    if (e.buttons && Math.hypot(this.pointer.x - this.downAt.x, this.pointer.y - this.downAt.y) > 4) this.pointer.moved = true
    if (!this.looks || e.buttons) return
    const i = this.renderer.pick(this.pointer.x, this.pointer.y, this.looks)
    this.setHover(i)
  }

  private setHover(i: number) {
    const a = this.active
    const prev = a ? this.modeHover : this.state.hover
    if (a) {
      this.modeHover = i
      a.mode.hover?.(i)
    } else this.state.hover = i
    this.renderer.gl.domElement.style.cursor = i >= 0 ? 'pointer' : ''
    if (prev === i) {
      if (i >= 0) this.emit('hover', this.info(i))
      return
    }
    this.emit('hover', i >= 0 ? this.info(i) : null)
  }

  private info(i: number): HoverInfo {
    const a = this.active
    const model = a ? a.mode.model : this.model!
    const n = (a ? a.mode.base : model.base).nodes[i]
    const look = this.looks?.nodes[i]
    const spec = model.specs[model.index.get(n.id) ?? -1]
    return {
      id: n.id,
      // 全景里名字就是数据里的；模式画的名字可能不一样（kgdiff 给改名的节点出新名字），按它画的来
      label: (a ? look?.label?.text : undefined) ?? spec?.label ?? n.id,
      layer: model.data.layers[n.layer]?.name ?? '',
      group: n.group >= 0 ? (model.data.groups[n.group]?.name ?? null) : null,
      folds: spec?.folds?.length ?? 0,
      expanded: this.expandedIds.has(n.id) && model.specs.some((x) => x.parent === n.id),
      x: this.pointer.x,
      y: this.pointer.y,
    }
  }

  private downAt = { x: 0, y: 0 }
  private onDown = (e: PointerEvent) => {
    const rect = this.renderer.gl.domElement.getBoundingClientRect()
    this.downAt = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    // 触屏轻点往往没有 pointermove：位置以按下 / 抬起时为准
    this.pointer.x = this.downAt.x
    this.pointer.y = this.downAt.y
    this.pointer.down = 1
    this.pointer.moved = false
  }

  private onUp = (e: PointerEvent) => {
    const rect = this.renderer.gl.domElement.getBoundingClientRect()
    this.pointer.x = e.clientX - rect.left
    this.pointer.y = e.clientY - rect.top
    const moved = this.pointer.moved
    this.pointer.down = 0
    if (moved || !this.looks) return
    const i = this.renderer.pick(this.pointer.x, this.pointer.y, this.looks)
    if (this.active) {
      this.active.mode.select?.(i)
    } else {
      this.state.selected = i === this.state.selected ? -1 : i
      // 跟随：点中了配角那层的节点，那一层换上来当主角
      if (this.state.selected >= 0 && this.model) this.followTo(this.model.base.nodes[i].layer, 'overview')
    }
    this.emit('select', i >= 0 ? this.info(i) : null)
  }

  private onLeave = () => this.setHover(-1)

  /** 双击一个有子节点的节点：展开 / 收起 */
  private onDouble = (e: MouseEvent) => {
    if (!this.looks) return
    const rect = this.renderer.gl.domElement.getBoundingClientRect()
    const i = this.renderer.pick(e.clientX - rect.left, e.clientY - rect.top, this.looks)
    if (i < 0) return
    const info = this.info(i)
    if (info.expanded) this.expand(info.id, false)
    else if (info.folds > 0) this.expand(info.id, true)
  }

  // ─── 给插件的能力 ──────────────────────────────────────────────────────────

  private contextFor(name: string): StrataContext {
    // ctx 的 getter 里要拿到引擎，箭头函数里直接用 this
    const self = this
    const hook = <T>(set: Set<T>, cb: T) => {
      set.add(cb)
      return () => void set.delete(cb)
    }
    return {
      get model() {
        return self.model
      },
      get current() {
        return self.current
      },
      get mode() {
        return self.mode
      },
      renderer: this.renderer,
      get time() {
        return self.time
      },
      reducedMotion: this.reducedMotion,
      locale: this.locale,
      theme: this.theme,
      get disposed() {
        return self.disposed
      },
      get hidden() {
        return self.hiddenSet()
      },
      get expanded() {
        return self.expandedIds
      },
      indexOf: (id) => this.indexOf(id),
      normalize: (input) => normalize(input, this.normalizeOptions).data,
      layoutOf: (data) => this.layoutOf(data),
      takeOver: (mode) => this.takeOver(name, mode),
      rebuild: () => this.restore(true),
      overlay: (layer) => {
        this.overlays.push(layer)
        return () => {
          const k = this.overlays.indexOf(layer)
          if (k >= 0) this.overlays.splice(k, 1)
        }
      },
      onFrame: (cb) => hook(this.frameHooks, cb),
      onChange: (cb) => hook(this.changeHooks, cb),
      onExpand: (cb) => hook(this.expandHooks, cb),
      onDispose: (cb) => hook(this.disposeHooks, cb),
      registerView: (key, slot) => this.views.register(key, slot),
      on: (event, cb) => this.events.on(event, cb),
      emit: (event, v) => this.events.emit(event, v),
      followTo: (layer, refit = 'none') => this.followTo(layer, refit),
      releaseFocus: () => {
        if (this.state.focusLayer === null) return
        this.state.focusLayer = null
        this.applyLayout()
        this.emit('focus', null)
      },
      select: (id) => this.select(id),
      fit: (points, opts) => this.fitPoints(points, opts),
    }
  }

  /** 销毁：停掉循环、放掉 GPU 资源、从页面上摘掉画布。可以调几次；之后再调别的方法都安静地什么也不做 */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const el = this.renderer.gl.domElement
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointerleave', this.onLeave)
    el.removeEventListener('dblclick', this.onDouble)
    // 渲染器销毁时会主动丢掉上下文：先摘掉监听，不发 contextlost
    el.removeEventListener('webglcontextlost', this.onContextLost)
    el.removeEventListener('webglcontextrestored', this.onContextRestored)
    for (const cb of this.disposeHooks) cb()
    this.events.clear()
    this.renderer.dispose()
    void this.host
  }
}
