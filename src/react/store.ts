// React 封装里不碰 DOM 的那部分：把引擎的状态做成 useSyncExternalStore 认的“外部仓库”、创建实例、接事件、
// 面板的几处判断。都是纯函数，tests/react.test.tsx 直接测；组件和 hook 只是把它们接到 React 上。

import type { HeroInfo, HoverInfo, LayerInfo, Strata, StrataOptions } from '../engine.js'
import type { StrataEvents, StrataPlugin } from '../plugin.js'
import type { DataIssue, StrataData } from '../types.js'

// ─── 状态仓库 ────────────────────────────────────────────────────────────────

/** 能变成 React 状态的几项：值从哪儿读、哪个事件说它变了 */
export interface StrataState {
  /** 每一层现在显示还是隐藏（strata.layers） */
  layers: LayerInfo[]
  /** 谁是主角、跟不跟随、每层的分量（strata.heroInfo）；还没有实例时是 null */
  hero: HeroInfo | null
  /** 展开着的节点（strata.expanded） */
  expanded: string[]
  /** 点中的层：focus 事件带的（几张图并存时是点中的那层，只有一张图时是聚焦的层） */
  focus: string | null
}

export type StrataStateKey = keyof StrataState

/** 仓库只用到引擎的这几样：测试里可以拿假的顶上 */
export type StrataSource = Pick<Strata, 'on' | 'layers' | 'heroInfo' | 'expanded' | 'getView'>

interface Spec<K extends StrataStateKey> {
  event: keyof StrataEvents
  read(s: StrataSource): StrataState[K]
}

const SPECS: { [K in StrataStateKey]: Spec<K> } = {
  layers: { event: 'layers', read: (s) => s.layers },
  hero: { event: 'hero', read: (s) => s.heroInfo },
  expanded: { event: 'expand', read: (s) => s.expanded },
  focus: { event: 'focus', read: (s) => s.getView().focus },
}

/** 没有实例时的值 */
export const EMPTY_STATE: Readonly<StrataState> = Object.freeze({ layers: [], hero: null, expanded: [], focus: null })

/** 结构上相等（只比 JSON 能表示的那些）：内容没变就沿用旧的引用，React 不重画 */
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

/**
 * 一项状态的仓库。快照是缓存的：getSnapshot 每次返回同一个引用，事件来了、内容真的变了才换。
 * 订阅时再读一遍：创建仓库到订阅之间漏掉的事件也补上。
 */
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
        // 事件带的值就是新的状态；focus 事件带的是点中的层，和 getView().focus 在几张图并存时不同，以事件为准
        off = strata.on(spec.event, (v) => set(v as StrataState[K]))
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

/** 造一个引擎：缺省是 new Strata(host, options)；测试、或者想自己包一层的时候换掉 */
export type StrataFactory = (host: HTMLElement, options: StrataOptions) => Strata

/** 一串插件各自返回的接口，顺序和 plugins 一样 */
export type PluginApis<P extends readonly StrataPlugin<unknown>[]> = { -readonly [K in keyof P]: P[K] extends StrataPlugin<infer A> ? A : never }

export type MountResult =
  | { ok: true; strata: Strata; apis: unknown[]; names: string[]; issues: DataIssue[] | null }
  | { ok: false; error: unknown }

/**
 * 创建一个实例：造出来 → 按顺序装插件 → 有数据就 setData。任何一步抛了都当作失败：已经造出来的销毁掉，
 * 交回错误（拿不到 WebGL 时是 StrataError，code 'webgl-unavailable'），由组件渲染 fallback。
 */
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

/** 组件上的事件回调（props 名 → 核心的事件） */
export interface StrataEventProps {
  onHover?: (info: HoverInfo | null) => void
  onSelect?: (info: HoverInfo | null) => void
  onFocus?: (layer: string | null) => void
  onHero?: (hero: HeroInfo) => void
  onLayers?: (layers: LayerInfo[]) => void
  onExpand?: (ids: string[]) => void
  onContextLost?: () => void
  onContextRestored?: () => void
}

export const EVENT_PROPS = {
  onHover: 'hover',
  onSelect: 'select',
  onFocus: 'focus',
  onHero: 'hero',
  onLayers: 'layers',
  onExpand: 'expand',
  onContextLost: 'contextlost',
  onContextRestored: 'contextrestored',
} as const satisfies Record<keyof StrataEventProps, keyof StrataEvents>

/**
 * 一次把所有事件接上，回调每次从 current() 现取：props 换了新的函数不用重新订阅。返回全部摘掉的函数。
 */
export function bindEvents(strata: Pick<Strata, 'on'>, current: () => StrataEventProps): () => void {
  const offs = (Object.keys(EVENT_PROPS) as (keyof StrataEventProps)[]).map((prop) =>
    strata.on(EVENT_PROPS[prop], (v: unknown) => (current()[prop] as ((v: unknown) => void) | undefined)?.(v)),
  )
  return () => offs.forEach((off) => off())
}

// ─── 面板的判断 ──────────────────────────────────────────────────────────────

/** 几张图并存（分主次）：点一层是让它当主角；只有一张图时是聚焦 */
export const isDual = (hero: HeroInfo | null): hero is HeroInfo & { id: string } => !!hero && hero.id !== null

/** 点了层列表的一行：交给 focusLayer 的参数。几张图并存时就是这层；一张图时再点一次放开 */
export function layerClickTarget(hero: HeroInfo | null, focus: string | null, layer: string): string | null {
  if (isDual(hero)) return layer
  return focus === layer ? null : layer
}

/** 这一行算不算“按下”：几张图并存时它是主角，一张图时它是聚焦的层 */
export function layerPressed(hero: HeroInfo | null, focus: string | null, l: LayerInfo): boolean {
  return l.visible && (isDual(hero) ? hero.id === l.id : focus === l.id)
}

/** 层前面那根小条的亮度：隐藏的很暗；并存时按当主角的分量；一张图时聚焦的和没聚焦时全亮 */
export function layerMarkOpacity(hero: HeroInfo | null, focus: string | null, l: LayerInfo): number {
  if (!l.visible) return 0.15
  if (isDual(hero)) return 0.3 + 0.7 * (Object.hasOwn(hero.mix, l.id) ? hero.mix[l.id] : 0)
  return focus === null || focus === l.id ? 1 : 0.35
}

/** 主次滑杆的两头：正好两层、分主次时才有 */
export function heroPair(hero: HeroInfo | null, layers: LayerInfo[]): [LayerInfo, LayerInfo] | null {
  return isDual(hero) && layers.length === 2 ? [layers[0], layers[1]] : null
}

/** 路径的一步现在什么样：点亮了、在隐藏层里被跳过了，还是还没走到 */
export function stepStatus(id: string, live: { ids: string[]; reached: number }): 'lit' | 'skipped' | 'pending' {
  const at = live.ids.indexOf(id)
  if (at >= 0) return at < live.reached ? 'lit' : 'pending'
  return live.ids.length > 0 ? 'skipped' : 'pending'
}

/** 数一数：每个键出现几次，按第一次出现的顺序 */
export function countBy<T>(items: Iterable<T>, key: (x: T) => string | undefined): [string, number][] {
  const out = new Map<string, number>()
  for (const x of items) {
    const k = key(x)
    if (k !== undefined) out.set(k, (out.get(k) ?? 0) + 1)
  }
  return [...out.entries()]
}

/** 拼 class 名，空的去掉 */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')
