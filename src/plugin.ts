// 插件契约：核心 Strata 只管画一张多层的图；路径回放、看变化这些都是插件，用 strata.use(plugin) 装上。
//
// 插件分两种做法，可以兼有：
// - 叠加层（StrataOverlay）：在核心自己的样子上再叠一点东西。路径回放就是这种：交给样式一串要强调的节点，
//   再往 Looks 里写自己的线、序号、涟漪。
// - 模式（StrataMode）：接管这一帧画什么——换一张底子、自己产出 Looks。看变化就是这种。同一时刻最多一个模式接管，
//   交还以后回到核心的全景。
//
// 每一帧的 Looks 走固定的管线，写入方各管各的：
//   ① 基础样式：核心的 styler（带上叠加层给的强调串），或者接管的模式
//   ② 叠加层：按装的顺序 paint
//   ③ 核心的统一后处理：隐藏层的淡出（presence），全景和接管的模式都走这里
//
// 这个文件只放类型和两个小工具（事件、视图状态的登记），不引入渲染器，可以单独测。

import type { HoverInfo, HeroInfo, LayerInfo, SelectInfo, StrataView } from './engine/types.js'
import { DEFAULT_LOCALE, message, StrataError, type Locale, type MessageKey } from './locale.js'
import type { Model } from './model.js'
import type { RendererBase, StrataRenderer } from './renderer/index.js'
import type { Spotlight } from './styler.js'
import type { Theme } from './theme.js'
import type { Looks, Normalized, Resolved, StrataData, StrataLayout } from './types.js'

/** A plugin: `install` gets what the core offers and returns the plugin's API (`strata.use` hands it back, fully typed). */
export interface StrataPlugin<Api> {
  /** Name. Only one plugin per name can be installed on an instance; modes and view slots are recorded under it. */
  readonly name: string
  install(ctx: StrataContext): Api
}

/** Timing of one frame. */
export interface FrameInfo {
  /** The engine clock in seconds, since the instance was created. */
  time: number
  /** Seconds since the last frame (at most 0.05). */
  dt: number
}

/** An overlay: draws on top of the core's own look while no mode has taken over. */
export interface StrataOverlay {
  /** Asked before step ① of each frame: a sequence of nodes to emphasize (the core's style dims the rest), or `null`. With several overlays the last installed wins. */
  spotlight?(): Spotlight | null
  /** Step ②, after the style: change the emphasized nodes' ranks and labels, write your own part of `Looks.extra`. */
  paint?(looks: Looks, frame: FrameInfo): void
}

/** A mode: takes over what each frame draws. */
export interface StrataMode {
  /** The model of this picture: layers, hero, hover info and shots follow it. */
  readonly model: Model
  /** What the renderer draws. Nodes and edges may differ from `model` (the union of two versions while comparing); indexes match those of `looks`. */
  readonly base: RendererBase
  /** Step ①: this frame's look. */
  looks(frame: FrameInfo): Looks
  /** The pointer is over node `i` (`-1` = none). */
  hover?(i: number): void
  /** Node `i` was clicked (`-1` = empty space). */
  select?(i: number): void
  /** The core took the frame back: new data, another plugin's mode took over, or the instance is being disposed. Not called when the plugin releases it itself. */
  released?(): void
}

/** What `takeOver` returns. */
export interface ModeHandle {
  /** Whether this mode is still in charge. */
  readonly active: boolean
  /**
   * Hands the frame back to the core's normal view. `rebuild`: regenerate the normal view for the
   * current expanded nodes (needed when nodes were expanded or collapsed meanwhile); clears the selection.
   * Does nothing when no longer in charge.
   */
  release(opts?: { rebuild?: boolean }): void
}

/**
 * What changed in the core, as `onChange` reports it: `data` new data; `model` the normal view's model
 * was rebuilt (expand, collapse, theme); `hidden` hidden layers changed; `mode` a mode took over; `theme`
 * the theme changed (`setTheme`: rebuild your own models and colours from `ctx.theme`).
 */
export type StrataChange = 'data' | 'model' | 'hidden' | 'mode' | 'theme'

/** A point on a plate: layer index and plate coordinates. The core converts it to world space with the layer's current height and scale. */
export interface PlatePoint {
  layer: number
  x: number
  z: number
}

/** A plugin's own part of the view state. */
export interface ViewSlot<V> {
  get(): V
  /** Called only when `setView` was given this key (not `undefined`). */
  set(value: V): void
}

/** Options of `ctx.fit` / `ctx.fitPoints`. */
export interface FitOptions {
  /** Camera elevation in radians. */
  elevation: number
  /** Margin factor around the points. */
  margin: number
  /** Seconds; `0` jumps. Default `1.2`. */
  duration?: number
}

/** The core's public events (event name → payload). */
export interface StrataEvents {
  /** The node under the pointer; `null` when it leaves, after expand/collapse, and when a mode takes over. Only the pointer causes it. */
  hover: HoverInfo | null
  /** The selection changed: a click (`source: 'pointer'`), or `select()` / restoring with `setView` (`source: 'api'`). */
  select: SelectInfo
  /** Every rendered frame, with the engine clock in seconds. */
  tick: number
  /** The focused layer changed (single layer only); the new `strata.focus`. */
  focus: string | null
  /** The hero, its weights or the follow flag changed. */
  hero: HeroInfo
  /** Layer visibility changed. */
  layers: LayerInfo[]
  /** The set of expanded nodes changed; the new `strata.expanded`. */
  expanded: string[]
  /** The WebGL context was lost: the loop pauses until the browser restores it (see `contextrestored`). */
  contextlost: null
  /** The context is back: GPU resources are re-uploaded and the loop resumes. */
  contextrestored: null
  /** The language or the text overrides changed (`setLocale`). */
  locale: Locale
  /** The theme changed (`setTheme`); the new full theme. */
  theme: Theme
}

/**
 * What the core offers a plugin, and nothing more: the core's private state is not exposed.
 * Ids wherever possible (`followTo` takes a layer id, `fit` node ids). Indexes remain only where hot
 * paths and drawing need them: `hidden`, `indexOf`, `fitPoints`' `PlatePoint`, a mode's `hover` /
 * `select`. They refer to the picture drawn now (`current`) and change after new data or expanding.
 * The types of `model` and `renderer` are in `kgstrata/internals` (not covered by semver).
 *
 * There is no `emit`: plugins cannot fake core events. Use your own `Emitter` for your plugin's events,
 * and the methods below (`select`, `releaseFocus`, `followTo`, …) to change core state; the core emits
 * the matching events itself (taking over and releasing already emit `hover(null)`).
 */
export interface StrataContext {
  /** The object last passed to `setData`, as given (`strata.data`); `null` before. */
  readonly data: StrataData | null
  /** The normal view's model; `null` before `setData`. Unchanged while a mode has taken over. */
  readonly model: Model | null
  /** The model drawn now: the mode's while one has taken over, otherwise `model`. */
  readonly current: Model | null
  /** Name of the plugin whose mode has taken over, or `null`. */
  readonly mode: string | null
  readonly renderer: StrataRenderer
  /** The engine clock in seconds. */
  readonly time: number
  readonly reducedMotion: boolean
  /** The core's current language (`StrataOptions.locale`, default `'en'`; `setLocale` changes it and emits `locale`). */
  readonly locale: Locale
  /** The instance's current theme (`setTheme` changes it; `onChange` then gets `'theme'`). Build your own models and colours from it. */
  readonly theme: Theme
  /** One text in the instance's language, with its overrides (`StrataOptions.messages`). */
  text(key: MessageKey, vars?: Record<string, string | number>): string
  /** The instance was disposed: drop results that arrive asynchronously. */
  readonly disposed: boolean
  /** Hidden layers (layer indexes of `current`). */
  readonly hidden: ReadonlySet<number>
  /** Expanded node ids, as given (including nodes without children). */
  readonly expanded: ReadonlySet<string>
  /** A node's index in the normal view; a folded child counts as its drawn ancestor. `-1` if absent. */
  indexOf(id: string): number
  /** Normalizes data with the engine's options (`nodeStyles`), dropping what has issues. */
  normalize(input: StrataData): Normalized
  /** Lays out with the engine's rules: plate radius grows with the node count, the anchor follows the `anchor` option. */
  layoutOf(data: Resolved): StrataLayout
  /** Takes over the frame: the mode's base is drawn and its looks are used. Hero weights carry over by layer id; hidden layers stay hidden. */
  takeOver(mode: StrataMode): ModeHandle
  /** Regenerates the normal view for the current expanded nodes and clears the selection; without a mode also redraws and re-arranges it. */
  rebuild(): void
  /** Adds an overlay. Returns the function that removes it. */
  overlay(layer: StrataOverlay): () => void
  /** Called every frame before step ①. */
  onFrame(cb: (frame: FrameInfo) => void): () => void
  onChange(cb: (change: StrataChange) => void): () => void
  /** Asked when nodes are expanded or collapsed: return `true` to handle it yourself (the diff plugin re-compares), and the core does not rebuild the normal view. */
  onExpand(cb: () => boolean | void): () => void
  onDispose(cb: () => void): () => void
  /** Registers a part of the view state (read by `strata.view`, applied by `setView`). The key must not clash with a core key or another plugin's. */
  registerView<V>(key: string, slot: ViewSlot<V>): void
  /** Subscribes to a core event. */
  on<K extends keyof StrataEvents>(event: K, cb: (v: StrataEvents[K]) => void): () => void
  /**
   * Follow: makes this layer the hero (layer id, in the picture drawn now; only while `follow` is on;
   * unknown layers are ignored). `refit`: what the camera does afterwards: `'overview'` reframes the
   * overview (unless the user moved the camera), `'none'` stays (default), a function is called when the
   * hero actually changed (the plugin reframes itself).
   */
  followTo(layer: string, refit?: 'overview' | 'none' | (() => void)): void
  /** With a single layer and a focused layer: releases the focus (does not move the camera). */
  releaseFocus(): void
  /** Selects a node by id, `null` clears. Same as `strata.select`: emits `select` (`source: 'api'`), and the hero follows while `follow` is on. */
  select(id: string | null): void
  /**
   * Frames these nodes (ids, in the layout of the picture drawn now; a folded child counts as its drawn
   * ancestor, unknown ids are skipped). Uses the layers' target heights and scales while they move;
   * leaves the stack view first.
   */
  fit(nodes: readonly string[], opts: FitOptions): void
  /** Like `fit`, with points on the plates instead of nodes. */
  fitPoints(points: readonly PlatePoint[], opts: FitOptions): void
  /**
   * Hands the camera back after `fit` / `fitPoints`: returns to the overview if a plugin framed the camera
   * and the user has not moved it since (or it is still on the overview); otherwise does nothing. Call it
   * when what you framed goes away. Releasing a mode does this by itself. `duration` in seconds (default 1.3).
   */
  releaseCamera(opts?: { duration?: number }): void
}

// ─── 小工具 ──────────────────────────────────────────────────────────────────

/** A typed event emitter: `E` maps event names to payloads. Use one for your plugin's own events. */
export class Emitter<E> {
  // 事件名 → 回调
  private listeners = new Map<keyof E, Set<(v: never) => void>>()

  /** Subscribes; returns the unsubscribe function. */
  on<K extends keyof E>(event: K, cb: (v: E[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb as (v: never) => void)
    this.listeners.set(event, set)
    return () => void set.delete(cb as (v: never) => void)
  }

  /** Calls every listener of `event` with `v`. */
  emit<K extends keyof E>(event: K, v: E[K]) {
    this.listeners.get(event)?.forEach((cb) => (cb as (v: E[K]) => void)(v))
  }

  /** Removes all listeners. */
  clear() {
    this.listeners.clear()
  }
}

/** The core's view state keys; plugins cannot register them. */
export const CORE_VIEW_KEYS: readonly (keyof StrataView)[] = ['heroMix', 'follow', 'hidden', 'expanded', 'selected', 'group', 'focus', 'spread', 'camera']

// 插件登记的视图状态：读 view 时一并读出来，setView 时按 key 分给各自的插件
export class ViewRegistry {
  private slots = new Map<string, ViewSlot<unknown>>()

  private readonly locale: () => Locale

  // locale：登记冲突时报错用的语言（给函数就每次现取：实例的语言会变）
  constructor(locale: Locale | (() => Locale) = DEFAULT_LOCALE) {
    this.locale = typeof locale === 'function' ? locale : () => locale
  }

  register<V>(key: string, slot: ViewSlot<V>) {
    if ((CORE_VIEW_KEYS as readonly string[]).includes(key)) throw new StrataError('view-core-key', message(this.locale(), 'error.view-core-key', { key }))
    if (this.slots.has(key)) throw new StrataError('view-key-taken', message(this.locale(), 'error.view-key-taken', { key }))
    this.slots.set(key, slot as ViewSlot<unknown>)
  }

  // 各插件现在的那一段
  read(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, slot] of this.slots) out[key] = slot.get()
    return out
  }

  // 给了的项（不是 undefined）交给登记它的插件；没人登记的项不管
  apply(view: Record<string, unknown>) {
    for (const [key, slot] of this.slots) if (view[key] !== undefined) slot.set(view[key])
  }
}
