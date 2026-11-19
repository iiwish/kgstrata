// kgstrata 的核心 Strata。它只做编排：各块的事在旁边的文件里——
//   hero.ts 主次的状态机（纯的）  layers.ts 隐藏层和每层摆在哪  expansion.ts 数据到模型、节点的展开
//   shots.ts 镜头取景  pointer.ts 指针  view.ts 视图状态  plugins.ts 插件宿主和每帧的管线
// 它们共用的那份状态在 core.ts，只在这个目录里流转。

import { DEFAULT_LOCALE, message, type Locale, type MessageKey, type MessageOverrides } from '../locale.js'
import { Emitter, type StrataEvents, type StrataPlugin } from '../plugin.js'
import { StrataRenderer } from '../renderer/index.js'
import { isFatal, normalize } from '../resolve.js'
import { createTheme, type DeepPartial, type Theme } from '../theme.js'
import type { DataIssue, StrataData } from '../types.js'
import { emit, hiddenOf, indexOf, layerIndex, layersOf, type Core } from './core.js'
import { Expansion, layoutOf, normalizeOptions, rebuildModel } from './expansion.js'
import { adoptMix, heroOnLoad, NO_HERO, yieldHero } from './hero.js'
import { followTo, heroNow, heroTo, mixTo, switchTo } from './hero-actions.js'
import { arrange, HiddenLayers, layerInfos } from './layers.js'
import { PluginHost } from './plugins.js'
import { hoverAt, nodeInfo, Pointer } from './pointer.js'
import { FrameLoop } from './loop.js'
import { camera } from './shots.js'
import type { HeroInfo, Inset, LayerInfo, SelectSource, ShotName, ShotOptions, StrataOptions, StrataView } from './types.js'
import { applyView, focusOf, groupOf, readView, selectedOf, viewTargetOf, type ViewTarget } from './view.js'

export type { HeroInfo, HoverInfo, Inset, LayerInfo, LayoutProvider, NodeInfo, PointerPosition, SelectInfo, SelectSource, ShotName, ShotOptions, StrataOptions, StrataView } from './types.js'

// kgstrata 的核心：数据 → 布局 → 样式 → 渲染。管主次、隐藏层、节点的展开、悬停和选中、镜头、事件。
// 路径回放、看变化这些是插件（strata.use），核心不认识它们；每帧的管线见 plugin.ts。
/**
 * A layered 3D view: data → layout → style → render. Handles the hero, hidden layers, expanding,
 * hover and selection, the camera and events. Path replay and version comparison are plugins (`use`).
 */
export class Strata {
  // 渲染器不公开：插件用 ctx.renderer（类型在 kgstrata/internals）
  private readonly renderer: StrataRenderer
  private readonly core: Core
  private readonly plugins: PluginHost
  private readonly pointer: Pointer
  // 调用方给的原始数据
  private source: StrataData | null = null
  private readonly loop: FrameLoop
  // setView 按顺序调的那些动作（见 view.ts）
  private readonly viewTarget: ViewTarget
  // 面板挡住的四边（setInset）
  private _inset: Required<Inset> = { top: 0, right: 0, bottom: 0, left: 0 }
  /** `prefers-reduced-motion: reduce` at creation: no idle rotation, path replay jumps to the end. */
  readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  /**
   * Creates the WebGL canvas inside `container` and starts the loop. Nothing is drawn until `setData`.
   * Throws `StrataError` (`code: 'webgl-unavailable'`) when no WebGL context can be created; nothing is attached then.
   */
  constructor(container: HTMLElement, options: StrataOptions = {}) {
    const locale = options.locale ?? DEFAULT_LOCALE
    const theme = createTheme(options.theme)
    this.renderer = new StrataRenderer(container, { theme, locale })
    const c: Core = (this.core = {
      renderer: this.renderer,
      events: new Emitter<StrataEvents>(),
      options,
      hidden: new HiddenLayers(options.hidden),
      expansion: new Expansion(options.expanded),
      reducedMotion: this.reducedMotion,
      state: { hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: 0 },
      model: null,
      styler: null,
      active: null,
      modeHover: -1,
      hero: NO_HERO,
      follow: !!options.follow,
      secondaryScale: options.secondaryScale !== undefined ? Math.min(1, Math.max(0.2, options.secondaryScale)) : 0.56,
      spread: 1,
      overlay: false,
      autoFrame: true,
      pluginFramed: false,
      time: 0,
      looks: null,
      disposed: false,
      locale,
      messages: { ...options.messages },
      theme,
    })
    this.plugins = new PluginHost(c, { select: (id) => this.select(id), followTo: (l, r) => followTo(c, l, r), text: (k, v) => this.text(k, v) })
    const el = this.renderer.gl.domElement
    this.pointer = new Pointer(el, (x, y, l) => this.renderer.pick(x, y, l), () => c.looks, {
      hover: (i) => hoverAt(c, i, this.pointer),
      click: (i) => this.click(i),
      double: (i) => {
        const info = nodeInfo(c, i, !!c.active)
        if (info.expanded) this.expand(info.id, false)
        else if (info.folds > 0) this.expand(info.id, true)
      },
    })
    this.renderer.rig.idleRotate = !this.reducedMotion
    this.renderer.rig.controls.addEventListener('start', () => {
      c.autoFrame = false
      c.pluginFramed = false
    })
    this.loop = new FrameLoop(c, this.plugins)
    this.viewTarget = viewTargetOf(c, this, this.plugins.views, (id) => this.selectIndex(indexOf(c, id), 'api', false))
  }

  /** The instance's current language (`StrataOptions.locale`, default `'en'`; `setLocale` changes it). */
  get locale(): Locale {
    return this.core.locale
  }

  /** The instance's resolved theme: the options applied on top of `DARK` (`setTheme` changes it). One per instance. */
  get theme(): Theme {
    return this.core.theme
  }

  /** Per-instance text overrides (`StrataOptions.messages`; `setLocale` can replace them). */
  get messages(): Readonly<MessageOverrides> {
    return this.core.messages
  }

  /** One text in the instance's language, with its overrides (the React panels use it too). */
  text(key: MessageKey, vars?: Record<string, string | number>): string {
    return message(this.core.locale, key, vars, this.core.messages)
  }

  /**
   * Switches the language; with `messages`, also replaces the text overrides (otherwise they are kept).
   * Later issue messages, errors, tooltip nouns and React panels follow. Emits `locale`. The diff plugin
   * re-compares in the new language unless it was given its own. Issues already returned are not rewritten.
   */
  setLocale(locale: Locale, messages?: MessageOverrides) {
    if (this.core.disposed) return
    this.core.locale = locale
    if (messages !== undefined) this.core.messages = { ...messages }
    emit(this.core, 'locale', locale)
  }

  /**
   * Replaces the theme. `overrides` apply on top of `DARK`, like the option (so `setTheme({})` returns to
   * `DARK`). Rebuilds the clear colour, backdrop, plates, label atlas and node and line colours; layout,
   * selection, hidden layers, expanded nodes and camera do not change. Plugins get `onChange('theme')`; emits `theme`.
   */
  setTheme(overrides: DeepPartial<Theme> = {}) {
    const c = this.core
    if (c.disposed) return
    c.theme = createTheme(overrides)
    this.renderer.setTheme(c.theme)
    if (this.source && c.expansion.baseLayout) {
      // 色板变了组的颜色就变了：重新整理一遍（结构一样，布局照用），按现在的展开状态重建模型
      this.keepSelected(() => {
        c.expansion.renormalize(normalize(this.source!, normalizeOptions(c)).data)
        rebuildModel(c)
        if (c.model && !c.active) this.renderer.setBase(c.model.renderer)
      })
      arrange(c)
    }
    this.plugins.notify('theme')
    emit(c, 'theme', c.theme)
  }

  /** Installs a plugin and returns its API. Two plugins with the same name throw `StrataError('plugin-installed')`. */
  use<Api>(plugin: StrataPlugin<Api>): Api {
    return this.plugins.use(plugin)
  }

  /** Name of the plugin whose mode has taken over the frame (`'diff'` while comparing), or `null`. */
  get mode(): string | null {
    return this.core.active?.owner ?? null
  }

  /** The object last passed to `setData`, as given; `null` before. */
  get data(): StrataData | null {
    return this.source
  }

  /** Subscribes to a core event. Returns the unsubscribe function. */
  on<K extends keyof StrataEvents>(event: K, cb: (v: StrataEvents[K]) => void): () => void {
    return this.core.events.on(event, cb)
  }

  /**
   * Validates the data, drops broken items, lays out and draws the rest. Returns the issues (empty when clean).
   * When the whole input is unusable (wrong contract `version`: an `error` without `id`, see `isFatal`)
   * nothing changes: the view and `data` stay as they were. An unusable injected layout adds a
   * `'layout-incomplete'` warning and the layout is computed instead.
   */
  setData(input: StrataData): DataIssue[] {
    const c = this.core
    if (c.disposed) return []
    const { data: normal, issues } = normalize(input, normalizeOptions(c))
    if (issues.some(isFatal)) return issues
    this.source = input
    // 换了数据：接管的模式、插件挂在旧数据上的东西都作废
    this.plugins.dropMode()
    c.expansion.load(normal, (collapsed) => layoutOf(c, collapsed, issues))
    rebuildModel(c)
    const model = c.model!
    const layers = model.data.layers
    // 几张图并存：选项里指定的那一层（不写就是布局的基准层）当主角，其余的缩小、变暗，退成配角
    const wanted = c.options.hero !== undefined ? layers.findIndex((l) => l.id === c.options.hero) : -1
    c.hero = heroOnLoad(layers.length, wanted, model.renderer.anchor)
    if (c.hero.hero >= 0 && c.options.heroMix) c.hero = adoptMix(c.hero, layers.map((l) => l.id), c.options.heroMix, hiddenOf(c))
    // 不能把图全藏了：至少留一张；主角不能是隐藏的
    c.hidden.keepOne(layers, model.renderer.anchor)
    c.hero = yieldHero(c.hero, hiddenOf(c))
    c.hero = { ...c.hero, home: c.hero.hero }
    c.hidden.resetPresence(layers)
    c.overlay = false
    c.state = { hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: c.time }
    this.renderer.setBase(model.renderer)
    arrange(c)
    this.shot('overview', { duration: 0 })
    emit(c, 'hero', this.hero)
    emit(c, 'layers', this.layers)
    emit(c, 'expanded', this.expanded)
    return issues
  }

  /** Expanded nodes that actually have children. */
  get expanded(): string[] {
    return this.core.expansion.expanded
  }

  /**
   * Sets the full set of expanded nodes; everything else collapses. An expanded node's children (the
   * fields of a table) are drawn around it and the relations rolled up to it go back to them. Top-level
   * positions do not change. Emits `expanded` and `hover(null)`.
   */
  setExpanded(ids: Iterable<string>) {
    const c = this.core
    if (c.disposed || !c.expansion.set(ids) || !c.expansion.normal) return
    emit(c, 'expanded', this.expanded)
    // 插件可以接手这次展开（看变化时两版按新的展开状态重新比一遍），这时全景不重建
    if (this.plugins.claimExpand()) return
    this.keepSelected(() => rebuildModel(c))
    if (!c.model) return
    this.renderer.setBase(c.model.renderer)
    c.state.hover = -1
    emit(c, 'hover', null)
    this.plugins.notify('model')
    arrange(c)
    if (c.autoFrame) this.shot('overview', { duration: 0.6 })
  }

  /** Expands one node, or collapses it with `on = false`. */
  expand(id: string, on = true) {
    this.setExpanded(this.core.expansion.toggled(id, on))
  }

  /** The current view state (hero weights, hidden layers, selection, spacing, camera, plugin slots), by id; a new object each time. Restore it with `setView`. */
  get view(): StrataView {
    return readView(this.core, this.plugins.views.read())
  }

  /** Restores a view state. Every field is optional; layers and nodes that no longer exist are skipped. Emits `hero` and `layers`. */
  setView(view: Partial<StrataView>) {
    if (!this.core.disposed) applyView(view, this.viewTarget)
  }

  /** Each layer, whether it is visible, and its number of top-level nodes. */
  get layers(): LayerInfo[] {
    return layerInfos(this.core)
  }

  /**
   * Shows or hides a layer (layer id). Remaining layers keep their positions and proportions are
   * recomputed; layers it separated get dashed bridge lines; a hidden hero hands over to the nearest
   * visible layer. The last visible layer cannot be hidden. Returns the layer's `LayerInfo` after the
   * call (`visible` is what applied), or `null` for an unknown layer. Emits `layers` (and `hero` if the hero changed).
   */
  setLayerVisible(layer: string, visible: boolean): LayerInfo | null {
    const c = this.core
    const after = () => this.layers.find((l) => l.id === layer) ?? null
    if (c.disposed || c.hidden.set(layersOf(c), layer, visible) !== 'changed') return after()
    const before = c.hero.hero
    c.hero = yieldHero(c.hero, hiddenOf(c))
    arrange(c)
    this.plugins.notify('hidden')
    if (c.autoFrame) this.shot('overview', { duration: 0.6 })
    emit(c, 'layers', this.layers)
    if (c.hero.hero !== before) emit(c, 'hero', this.hero)
    return after()
  }

  /** The current hero, follow flag and weights. */
  get hero(): HeroInfo {
    return heroNow(this.core)
  }

  /**
   * Continuous hero weights 0..1 per layer (layer id → weight); missing and hidden layers count as 0.
   * The layer with the largest weight is the hero. All zero is treated as empty. No effect with a single
   * layer. Returns the hero state after the call; its `mix` is what applies. Emits `hero`.
   */
  setHeroMix(mix: Record<string, number>): HeroInfo {
    if (!this.core.disposed) mixTo(this.core, mix)
    return this.hero
  }

  /**
   * Makes this layer (layer id) the hero and its "home". Ignored for unknown or hidden layers and with a
   * single layer. Returns the hero state after the call: if its `id` is not `layer`, nothing changed.
   */
  setHero(layer: string): HeroInfo {
    if (!this.core.disposed) heroTo(this.core, layer)
    return this.hero
  }

  /** Whether the hero follows the selection (and what plugins follow: the path, a selected change). */
  get follow(): boolean {
    return this.core.follow
  }

  /** Turns "the hero follows the selection" on or off. Emits `hero`; returns the hero state after the call. */
  setFollow(on: boolean): HeroInfo {
    if (!this.core.disposed) {
      this.core.follow = on
      emit(this.core, 'hero', this.hero)
    }
    return this.hero
  }

  /**
   * With a single layer: focuses it (frames it; `strata.focus` and the `focus` event carry its id);
   * `null` releases. With several layers the hero says which layer you look at, so this is `setHero(layer)`
   * and `null` returns to the hero's home: nothing is focused and `hero` is emitted instead of `focus`.
   */
  focusLayer(layer: string | null) {
    const c = this.core
    if (c.disposed) return
    if (c.hero.hero >= 0) {
      if (layer !== null) heroTo(c, layer)
      else switchTo(c, c.hero.home, 'overview')
      return
    }
    const found = layer === null ? -1 : (c.model?.data.layers.findIndex((l) => l.id === layer) ?? -1)
    const i = found >= 0 ? found : null
    c.overlay = false
    c.state.focusLayer = i
    emit(c, 'focus', i === null ? null : layer)
    arrange(c)
    if (i === null) this.shot('overview')
    else camera(c, 'layer', 1.3, i)
  }

  /** Layer spacing multiplier (default 1). */
  get spread(): number {
    return this.core.spread
  }

  /** Sets the layer spacing multiplier (default 1). Leaves the stack view. */
  setSpread(s: number) {
    if (this.core.disposed) return
    this.core.spread = s
    this.core.overlay = false
    arrange(this.core)
  }

  /** Space covered by panels on each side, in CSS pixels (`setInset`). */
  get inset(): Required<Inset> {
    return { ...this._inset }
  }

  /**
   * Tells the engine which part of the canvas panels cover, in CSS pixels per side (missing sides are 0;
   * `setInset({})` clears). Shots centre the picture in the remaining area. An inset that leaves less
   * than 40% of the width or height is ignored on that axis.
   */
  setInset(inset: Inset) {
    if (this.core.disposed) return
    const side = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
    this._inset = { top: side(inset.top), right: side(inset.right), bottom: side(inset.bottom), left: side(inset.left) }
    this.renderer.setInset(this._inset)
  }

  /** The selected node's id (`select`); `null` when nothing is selected. */
  get selected(): string | null {
    return selectedOf(this.core)
  }

  /** The focused layer's id (`focusLayer`, `focus` event). Only with a single layer; `null` with several (the hero says which layer you look at). */
  get focus(): string | null {
    return focusOf(this.core)
  }

  /** The emphasized group, `"grouping/group"` (`highlightGroup`); `null` when none. */
  get group(): string | null {
    return groupOf(this.core)
  }

  /** Emphasizes one group: `"grouping/group"`, or a bare group id; `null` clears. */
  highlightGroup(id: string | null) {
    if (this.core.disposed) return
    const groups = this.core.model?.data.groups ?? []
    this.core.state.group = id ? groups.findIndex((g) => g.id === id || g.id.slice(g.id.indexOf('/') + 1) === id) : -1
  }

  /**
   * Selects a node by id (`null` or an unknown id clears; a folded child selects its drawn ancestor).
   * Same path as a click: emits `select` with `source: 'api'`, and with `follow` on its layer becomes
   * the hero (the camera reframes only if the user has not moved it).
   */
  select(id: string | null) {
    if (this.core.disposed) return
    this.selectIndex(indexOf(this.core, id), 'api', true)
  }

  // 选中全景里的第 i 个节点（-1 清掉）。follow：跟随开着时主角跟不跟过去；hit：指针点中的节点（source 'pointer' 时）
  private selectIndex(i: number, source: SelectSource, follow: boolean, hit = i) {
    const c = this.core
    c.state.selected = i
    if (follow && i >= 0 && c.model) followTo(c, c.model.base.nodes[i].layer, 'overview')
    const pointer = source === 'pointer' ? this.pointerAt(hit >= 0 && c.model ? c.model.base.nodes[hit].id : null) : null
    emit(c, 'select', { node: i >= 0 && c.model ? nodeInfo(c, i, false) : null, source, pointer })
  }

  private pointerAt(hit: string | null) {
    return { x: this.pointer.x, y: this.pointer.y, hit }
  }

  // 点了一下：接管的模式自己处理；全景里再点一次选中的节点是放开，跟随开着时点中的那层换上来当主角
  private click(i: number) {
    const c = this.core
    if (!c.active) return this.selectIndex(i === c.state.selected ? -1 : i, 'pointer', true, i)
    c.active.mode.select?.(i)
    const node = i >= 0 ? nodeInfo(c, i, true) : null
    emit(c, 'select', { node, source: 'pointer', pointer: this.pointerAt(node?.id ?? null) })
  }

  // 重建模型的前后，选中按 id 接上（下标会变）
  private keepSelected(rebuild: () => void) {
    const c = this.core
    const id = c.state.selected >= 0 ? c.model?.base.nodes[c.state.selected]?.id : undefined
    rebuild()
    c.state.selected = indexOf(c, id)
  }

  /**
   * Moves the camera: `'overview'` frames all visible layers, `'top'` is the stack view (a top-down map
   * with one layer), `'layer'` frames `opts.layer` (unknown ids do nothing). `opts.duration` in seconds
   * (default 1.3; `0` jumps).
   */
  shot(name: ShotName, opts: ShotOptions = {}) {
    if (this.core.disposed) return
    const duration = opts.duration ?? 1.3
    if (name !== 'layer') return camera(this.core, name, duration)
    const i = layerIndex(this.core, opts.layer)
    if (i >= 0) camera(this.core, 'layer', duration, i)
  }

  /** Stops the loop, frees GPU resources and removes the canvas. Safe to call more than once; afterwards every other method is a no-op. */
  dispose() {
    if (this.core.disposed) return
    this.core.disposed = true
    this.loop.stop()
    this.pointer.detach()
    this.plugins.dispose()
    this.core.events.clear()
    this.renderer.dispose()
  }
}
