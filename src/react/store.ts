// React 封装里不碰 DOM 的那部分：把引擎的状态做成 useSyncExternalStore 认的“外部仓库”、创建实例、接事件、
// 面板的几处判断。都是纯函数，tests/react.test.tsx 直接测；组件和 hook 只是把它们接到 React 上。

import type { HeroInfo, HoverInfo, LayerInfo, NodeInfo, SelectInfo, Strata, StrataOptions } from '../engine/index.js'
import { DEFAULT_LOCALE, message, type Locale, type MessageKey } from '../locale.js'
import type { StrataEvents, StrataPlugin } from '../plugin.js'
import { DARK, type Theme } from '../theme.js'
import type { DataIssue, StrataData } from '../types.js'

// ─── 状态仓库 ────────────────────────────────────────────────────────────────

/** Engine state available as React state (`useStrataState`): where the value is read and which event changes it. */
export interface StrataState {
  /** Each layer and whether it is visible (`strata.layers`). */
  layers: LayerInfo[]
  /** Hero, follow flag and weights (`strata.hero`); `null` without an instance. */
  hero: HeroInfo | null
  /** Expanded nodes (`strata.expanded`). */
  expanded: string[]
  /** Focused layer (`strata.focus`, `focus` event). Only with a single layer; `null` with several (the hero says which layer you look at). */
  focus: string | null
  /** The instance's language and text overrides (`strata.locale`, `strata.messages`, `locale` event). */
  locale: { locale: Locale; messages: Readonly<Partial<Record<MessageKey, string>>> }
  /** The instance's theme (`strata.theme`, `theme` event); `null` without an instance. */
  theme: Theme | null
}

export type StrataStateKey = keyof StrataState

/** The members of `Strata` the state stores use (tests can pass a fake). */
export type StrataSource = Pick<Strata, 'on' | 'layers' | 'hero' | 'expanded' | 'focus' | 'locale' | 'messages' | 'theme'>

interface Spec<K extends StrataStateKey> {
  event: keyof StrataEvents
  read(s: StrataSource): StrataState[K]
  /** 事件来了以后的新值：缺省就是事件带的东西 */
  next?(s: StrataSource, v: unknown): StrataState[K]
}

const SPECS: { [K in StrataStateKey]: Spec<K> } = {
  layers: { event: 'layers', read: (s) => s.layers },
  hero: { event: 'hero', read: (s) => s.hero },
  expanded: { event: 'expanded', read: (s) => s.expanded },
  focus: { event: 'focus', read: (s) => s.focus },
  // 文案覆盖换了而语言没变时也要重画：两样一起读
  locale: { event: 'locale', read: (s) => ({ locale: s.locale, messages: s.messages }), next: (s) => ({ locale: s.locale, messages: s.messages }) },
  theme: { event: 'theme', read: (s) => s.theme },
}

/** The values without an instance. */
export const EMPTY_STATE: Readonly<StrataState> = Object.freeze({ layers: [], hero: null, expanded: [], focus: null, locale: { locale: DEFAULT_LOCALE, messages: {} }, theme: null })

/** Structural equality over JSON-like values: unchanged content keeps the old reference, so React does not re-render. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

export interface StateStore<V> {
  subscribe(onChange: () => void): () => void
  getSnapshot(): V
}

/** A store for one state key, for `useSyncExternalStore`. Snapshots are cached: the same reference until an event brings different content. Subscribing reads again, so events between creation and subscription are not lost. */
export function createStateStore<K extends StrataStateKey>(strata: StrataSource | null, key: K): StateStore<StrataState[K]> {
  const spec = SPECS[key] as Spec<K>
  if (!strata) {
    const empty = EMPTY_STATE[key] as StrataState[K]
    return { subscribe: () => () => {}, getSnapshot: () => empty }
  }
  let value = spec.read(strata)
  const listeners = new Set<() => void>()
  const set = (next: StrataState[K]) => {
    if (sameValue(next, value)) return
    value = next
    listeners.forEach((cb) => cb())
  }
  let off: (() => void) | null = null
  return {
    subscribe(onChange) {
      listeners.add(onChange)
      if (!off) {
        // 事件带的值就是新的状态（focus 事件带的和 strata.focus 是同一个）
        off = strata.on(spec.event, (v) => set(spec.next ? spec.next(strata, v) : (v as StrataState[K])))
        set(spec.read(strata))
      }
      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0 && off) {
          off()
          off = null
        }
      }
    },
    getSnapshot: () => value,
  }
}

// ─── 创建实例 ────────────────────────────────────────────────────────────────

/** Creates the engine; default `new Strata(host, options)`. */
export type StrataFactory = (host: HTMLElement, options: StrataOptions) => Strata

/** The APIs returned by a list of plugins, in the same order. */
export type PluginApis<P extends readonly StrataPlugin<unknown>[]> = { -readonly [K in keyof P]: P[K] extends StrataPlugin<infer A> ? A : never }

export type MountResult =
  | { ok: true; strata: Strata; apis: unknown[]; names: string[]; issues: DataIssue[] | null }
  | { ok: false; error: unknown }

/** Creates an instance: create → install plugins in order → `setData` if there is data. If any step throws, what was created is disposed and the error is returned (`StrataError('webgl-unavailable')` without WebGL); `<StrataCanvas>` then renders `fallback`. */
export function mountStrata(
  host: HTMLElement,
  create: StrataFactory,
  options: StrataOptions,
  plugins: readonly StrataPlugin<unknown>[],
  data: StrataData | null | undefined,
): MountResult {
  let strata: Strata | null = null
  try {
    strata = create(host, options)
    const apis = plugins.map((p) => strata!.use(p))
    const issues = data ? strata.setData(data) : null
    return { ok: true, strata, apis, names: plugins.map((p) => p.name), issues }
  } catch (error) {
    try {
      strata?.dispose()
    } catch {
      // 销毁也失败了：不盖住原来的错误
    }
    return { ok: false, error }
  }
}

// ─── 事件回调 ────────────────────────────────────────────────────────────────

/** Event callback props (prop name → core event). */
export interface StrataEventProps {
  onHover?: (info: HoverInfo | null) => void
  onSelect?: (info: SelectInfo) => void
  onFocus?: (layer: string | null) => void
  onHero?: (hero: HeroInfo) => void
  onLayers?: (layers: LayerInfo[]) => void
  onExpanded?: (ids: string[]) => void
  onContextLost?: () => void
  onContextRestored?: () => void
  onLocale?: (locale: Locale) => void
  onTheme?: (theme: Theme) => void
}

export const EVENT_PROPS = {
  onHover: 'hover',
  onSelect: 'select',
  onFocus: 'focus',
  onHero: 'hero',
  onLayers: 'layers',
  onExpanded: 'expanded',
  onContextLost: 'contextlost',
  onContextRestored: 'contextrestored',
  onLocale: 'locale',
  onTheme: 'theme',
} as const satisfies Record<keyof StrataEventProps, keyof StrataEvents>

/** Subscribes all event props at once; callbacks are read from `current()` each time, so new functions need no resubscription. Returns the function that unsubscribes all. */
export function bindEvents(strata: Pick<Strata, 'on'>, current: () => StrataEventProps): () => void {
  const offs = (Object.keys(EVENT_PROPS) as (keyof StrataEventProps)[]).map((prop) =>
    strata.on(EVENT_PROPS[prop], (v: unknown) => (current()[prop] as ((v: unknown) => void) | undefined)?.(v)),
  )
  return () => offs.forEach((off) => off())
}

// ─── 面板的判断 ──────────────────────────────────────────────────────────────

/** Several layers (with a hero): clicking a layer makes it the hero; with a single layer it focuses. */
export const isDual = (hero: HeroInfo | null): hero is HeroInfo & { id: string } => !!hero && hero.id !== null

/** The argument for `focusLayer` when a layer row is clicked: the layer with several layers; with one, `null` when it is already focused. */
export function layerClickTarget(hero: HeroInfo | null, focus: string | null, layer: string): string | null {
  if (isDual(hero)) return layer
  return focus === layer ? null : layer
}

/** Whether a layer row is pressed: the hero with several layers, the focused layer with one. */
export function layerPressed(hero: HeroInfo | null, focus: string | null, l: LayerInfo): boolean {
  return l.visible && (isDual(hero) ? hero.id === l.id : focus === l.id)
}

/** Opacity of a layer row's mark: dim when hidden; the hero weight with several layers; full for the focused layer (or none focused) with one. */
export function layerMarkOpacity(hero: HeroInfo | null, focus: string | null, l: LayerInfo): number {
  if (!l.visible) return 0.15
  if (isDual(hero)) return 0.3 + 0.7 * (Object.hasOwn(hero.mix, l.id) ? hero.mix[l.id] : 0)
  return focus === null || focus === l.id ? 1 : 0.35
}

/** The two ends of the hero balance slider: only with exactly two layers and a hero. */
export function heroPair(hero: HeroInfo | null, layers: LayerInfo[]): [LayerInfo, LayerInfo] | null {
  return isDual(hero) && layers.length === 2 ? [layers[0], layers[1]] : null
}

/** A path step's status: lit, skipped (in a hidden layer), or pending. */
export function stepStatus(id: string, live: { ids: string[]; reached: number }): 'lit' | 'skipped' | 'pending' {
  const at = live.ids.indexOf(id)
  if (at >= 0) return at < live.reached ? 'lit' : 'pending'
  return live.ids.length > 0 ? 'skipped' : 'pending'
}

/** Counts occurrences per key, in order of first appearance. */
export function countBy<T>(items: Iterable<T>, key: (x: T) => string | undefined): [string, number][] {
  const out = new Map<string, number>()
  for (const x of items) {
    const k = key(x)
    if (k !== undefined) out.set(k, (out.get(k) ?? 0) + 1)
  }
  return [...out.entries()]
}

/** Joins class names, dropping empty ones. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

/** A text function: message key + variables → text. */
export type TextFn = (key: MessageKey, vars?: Record<string, string | number>) => string

/** A panel's text function: the instance's (with `StrataOptions.messages` overrides) when following its language; otherwise the given language without overrides. */
export function textFor(strata: Pick<Strata, 'locale' | 'text'> | null, locale?: Locale): TextFn {
  if (strata && (locale === undefined || locale === strata.locale)) return (key, vars) => strata.text(key, vars)
  const loc = locale ?? strata?.locale ?? DEFAULT_LOCALE
  return (key, vars) => message(loc, key, vars)
}

/** The second and third tooltip lines: layer · group; for expandable nodes "N fields · double-click to expand" ("N inside" without a noun), for expanded ones "double-click to collapse". */
export function tipLines(info: NodeInfo, t: TextFn): { where: string; fold: string | null } {
  const where = [info.layerName, info.groupName].filter(Boolean).join(' · ')
  if (info.expanded) return { where, fold: t('ui.tip-collapse') }
  if (info.folds <= 0) return { where, fold: null }
  return { where, fold: info.childNoun ? t('ui.tip-expand-noun', { n: info.folds, noun: info.childNoun }) : t('ui.tip-expand', { n: info.folds }) }
}

/** The number of a layer row: from `counts` if given (`false` for none), otherwise the layer's top-level node count (`LayerInfo.count`). */
export function layerCount(counts: ReadonlyMap<string, number> | Readonly<Record<string, number>> | false | undefined, layer: LayerInfo): number | undefined {
  if (counts === false) return undefined
  if (counts === undefined) return layer.count
  return counts instanceof Map ? counts.get(layer.id) : Object.hasOwn(counts, layer.id) ? (counts as Record<string, number>)[layer.id] : undefined
}

/** The development warning text when `<StrataCanvas>`'s host has zero height; `null` otherwise. */
export function zeroHeightWarning(height: number, t: TextFn): string | null {
  return height > 0 ? null : t('warn.canvas-zero-height')
}

// ─── 主题 → 面板的 CSS 变量 ──────────────────────────────────────────────────

/** #rgb / #rrggbb → "r, g, b"；认不得是 null */
function rgbOf(hex: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')
}

/** 带透明度的颜色；认不得的颜色原样 */
const alpha = (hex: string, a: number) => {
  const rgb = rgbOf(hex)
  return rgb ? `rgba(${rgb}, ${a})` : hex
}

/** 面板要用的那几个变量按主题怎么算 */
function allVars(t: Theme): Record<string, string> {
  const ink = t.label.primary
  return {
    '--kgs-bg': t.background,
    '--kgs-overlay': alpha(t.background, 0.72),
    '--kgs-border': alpha(ink, 0.07),
    '--kgs-border-strong': alpha(ink, 0.13),
    '--kgs-text': ink,
    '--kgs-text-2': t.label.secondary,
    '--kgs-text-3': t.plate.caption,
    '--kgs-accent': t.accent,
    '--kgs-accent-rgb': rgbOf(t.accent) ?? '159, 230, 255',
    '--kgs-hover': alpha(ink, 0.04),
    '--kgs-pressed': alpha(ink, 0.07),
    '--kgs-track': alpha(ink, 0.14),
  }
}

let darkVars: Record<string, string> | null = null

/** The theme's panel colours as `--kgs-*` variables, only those that differ from `DARK` (an unchanged theme gives none, so your own variables keep working). `<StrataCanvas>` writes them on its container as a zero-specificity rule and updates them after `setTheme`. */
export function themeVars(theme: Theme | null | undefined): Record<string, string> {
  if (!theme) return {}
  darkVars ??= allVars(DARK)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(allVars(theme))) if (v !== darkVars[k]) out[k] = v
  return out
}

/** A CSS rule setting these variables on `sel` (wrapped in `:where()`, zero specificity); `''` without variables. */
export function themeRule(sel: string, vars: Readonly<Record<string, string>>): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v.replace(/[;{}<>]/g, '')}`)
    .join(';')
  return body ? `:where(${sel}){${body}}` : ''
}
