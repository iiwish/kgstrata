// 核心的公开类型：选项、视图状态、事件带的东西。放在这里，插件用 declare module '../engine/types.js' 给 StrataView 补自己的一段。
// 公开接口上的 JSDoc 用英文（使用者在编辑器里悬停看到的是它，和英文文档一致）；内部实现的注释照旧用中文。

import type { Locale, MessageOverrides } from '../locale.js'
import type { DeepPartial, Theme } from '../theme.js'
import type { LayoutOptions, NodeStyle, Resolved, StrataLayout } from '../types.js'

/** The core camera shots. Shots that frame something else (a path, one change) belong to their plugins (`ctx.fit`). */
export type ShotName = 'overview' | 'top' | 'layer'

/** Options of `strata.shot()`. */
export interface ShotOptions {
  /** Layer id framed by the `'layer'` shot. Unknown ids do nothing. Ignored by the other shots. */
  layer?: string
  /** Seconds; `0` jumps. Default `1.3`. */
  duration?: number
}

/**
 * Space covered by panels over the canvas, in CSS pixels per side. Framing centres the picture in the
 * remaining area. Missing sides are `0`.
 */
export interface Inset {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

/**
 * Injects a layout. The engine asks it whenever it lays out a graph (the collapsed normal view; the
 * union of both versions while comparing). Return a `StrataLayout` to use it (if nodes are missing or
 * the layer count does not match, `setData` returns a `'layout-incomplete'` warning and computes the
 * layout itself); return `null` / `undefined` to let the engine compute it. `defaults` is what the
 * engine would pass to `layoutStrata` (plate radius, anchor layer), so `layoutStrata(data, defaults)`
 * reproduces the built-in result.
 */
export type LayoutProvider = (data: Resolved, defaults: LayoutOptions) => StrataLayout | null | undefined

export interface StrataOptions {
  /**
   * With several layers: the layer id that is the hero (full size, full brightness); the others shrink
   * and dim. Default: the layout's anchor layer (`anchor`, or the layer with the most mappings).
   * Ignored when `heroMix` is given.
   */
  hero?: string
  /**
   * The hero follows what you ask about: selecting a node makes its layer the hero (plugins can follow
   * too: the path reaching a layer, a selected change). Default `false`: only `setHero` changes it.
   * Change it later with `setFollow`.
   */
  follow?: boolean
  /** Size of the layer next to the hero, relative to the hero. Default `0.56`, clamped to 0.2..1; layers further away get smaller. */
  secondaryScale?: number
  /**
   * Layer id used as the layout anchor: laid out by force simulation, the others are aligned to it.
   * Default: the layer with the most mappings. Also the hero when `hero` is not given.
   */
  anchor?: string
  /** Injects a precomputed layout (see `LayoutProvider`). Expanded children are still added on top of it with `placeChildren`. */
  layout?: LayoutProvider
  /** Layer ids hidden at start. Change them later with `setLayerVisible`. */
  hidden?: string[]
  /** Node ids expanded at start (their children are drawn). Change them later with `setExpanded` / `expand`. */
  expanded?: string[]
  /**
   * Per-layer hero weight 0..1 (layer id → weight), instead of a single `hero`. `1` is full size and
   * brightness, `0` a supporting layer; `0.5` on two layers makes them the same size. Layers not listed count as 0.
   */
  heroMix?: Record<string, number>
  /** Node `type` → how it is drawn (shape, monospace label, child noun). Merged over `DEFAULT_NODE_STYLES`. */
  nodeStyles?: Record<string, NodeStyle>
  /**
   * Language of the text people read: issue messages, errors, React panels, and plugins that are not
   * given their own. Default `'en'`. Built in: `'en'`, `'zh-CN'`; register others with `registerLocale`.
   * Issue and error codes do not change. Change it later with `setLocale`.
   */
  locale?: Locale
  /** Per-instance text overrides (message key → text), used whatever the language. */
  messages?: MessageOverrides
  /** Theme overrides applied on top of the dark theme `DARK` (see `createTheme`). Change it later with `setTheme`. */
  theme?: DeepPartial<Theme>
}

/**
 * The view state: what is on screen, by id (no order or index). Plain JSON: store it, put it in a URL,
 * restore it elsewhere with `setView`. These are the core fields; plugins add their own
 * (`ctx.registerView`, typed with `declare module`).
 */
export interface StrataView {
  /** Hero weight per layer 0..1 (layer id → weight), as in `StrataOptions.heroMix` / `setHeroMix`. */
  heroMix: Record<string, number>
  /** Whether the hero follows the selection (`setFollow`). */
  follow: boolean
  /** Hidden layer ids. */
  hidden: string[]
  /** Expanded node ids (their children are drawn). */
  expanded: string[]
  /** Selected node id. */
  selected: string | null
  /** Emphasized group, `"grouping/group"`. */
  group: string | null
  /** Focused layer id. Only with a single layer; with several layers the hero says which layer you look at, and this is `null`. */
  focus: string | null
  /** Layer spacing multiplier (`setSpread`). */
  spread: number
  /** Camera position and target. */
  camera: { position: [number, number, number]; target: [number, number, number] }
}

/** One layer, as the `layers` event and `strata.layers` give it. */
export interface LayerInfo {
  id: string
  name: string
  visible: boolean
  /** Top-level nodes in this layer (folded children and expanded children not counted). */
  count: number
}

/** The hero state, as the `hero` event and `strata.hero` give it. */
export interface HeroInfo {
  /** The layer with the largest weight; `null` with a single layer (no hero). */
  id: string | null
  /** Whether the hero follows the selection (`setFollow`). */
  follow: boolean
  /** Hero weight per layer 0..1 (layer id → weight). */
  mix: Record<string, number>
}

/** A node, as hover and select events carry it. Ids throughout; names for display are separate fields. */
export interface NodeInfo {
  id: string
  /** The label as drawn (a diff mode may show a new name). */
  label: string
  /** Layer id. */
  layer: string
  /** Layer name. */
  layerName: string
  /** Group id, `"grouping/group"`; `null` when the node has no group. */
  group: string | null
  /** Group name; `null` when the node has no group. */
  groupName: string | null
  /** Number of folded children (fields of a table); greater than 0 means it can be expanded. */
  folds: number
  /** What those children are called (the node type's `NodeStyle.childNoun`, in the current language); `null` when not configured. */
  childNoun: string | null
  /** Whether it is expanded now. */
  expanded: boolean
}

/** Pointer position in CSS pixels, relative to the canvas. */
export interface PointerPosition {
  x: number
  y: number
}

/** What the `hover` event carries: the node, and where the pointer is. */
export interface HoverInfo extends NodeInfo {
  pointer: PointerPosition
}

/** Who caused a selection: the pointer, or code (`select()`, restoring with `setView`, plugins). */
export type SelectSource = 'pointer' | 'api'

/** What the `select` event carries. */
export interface SelectInfo {
  /** The selected node; `null` when the selection was cleared (empty space, clicking the selected node again, `select(null)`). */
  node: NodeInfo | null
  source: SelectSource
  /**
   * Where the pointer was, and `hit`: the node under it (id; `null` = empty space). Clicking the
   * selected node again gives `node: null` and `hit` that node, so "let go" and "clicked empty space"
   * can be told apart. `null` for `source: 'api'`.
   */
  pointer: (PointerPosition & { hit: string | null }) | null
}
