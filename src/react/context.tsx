// 实例怎么交给子组件，和几个 hook：拿实例、接事件、把引擎的状态变成 React 状态。

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { Strata } from '../engine/index.js'
import type { Locale } from '../locale.js'
import type { StrataEvents } from '../plugin.js'
import { createStateStore, textFor, type StrataState, type StrataStateKey, type TextFn } from './store.js'

interface StrataContextValue {
  strata: Strata | null
  /** 装上的插件：名字 → 接口 */
  plugins: ReadonlyMap<string, unknown>
}

const NO_PLUGINS: ReadonlyMap<string, unknown> = new Map()
const Ctx = createContext<StrataContextValue>({ strata: null, plugins: NO_PLUGINS })

export interface StrataProviderProps {
  strata: Strata | null
  /** Installed plugins (name → API), read by `usePlugin`. `<StrataCanvas>` fills it itself. */
  plugins?: ReadonlyMap<string, unknown>
  children?: ReactNode
}

/** Provides an instance to its children. `<StrataCanvas>` already wraps its children; use it when you create `Strata` yourself. */
export function StrataProvider({ strata, plugins = NO_PLUGINS, children }: StrataProviderProps) {
  const value = useMemo(() => ({ strata, plugins }), [strata, plugins])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The instance of the nearest `<StrataCanvas>` / `<StrataProvider>`; `null` until created (or without WebGL). */
export function useStrata(): Strata | null {
  return useContext(Ctx).strata
}

/** The API of a plugin installed on the instance, by name (`'path'`, `'diff'`); `null` if not installed. */
export function usePlugin<Api>(name: string): Api | null {
  return (useContext(Ctx).plugins.get(name) as Api | undefined) ?? null
}

/** For panels: the instance from props if given, otherwise from context. */
export function useStrataOr(strata: Strata | null | undefined): Strata | null {
  const fromContext = useStrata()
  return strata === undefined ? fromContext : strata
}

/** The panel language: the given one > the instance's (re-renders after `setLocale`) > `'en'`. */
export function useLocale(strata: Strata | null, locale?: Locale): Locale {
  const live = useStrataState(strata, 'locale')
  return locale ?? live.locale
}

/** A panel's text function, with the instance's text overrides while following its language; re-renders after `setLocale`. With another `locale` given, texts are in that language. */
export function useText(strata: Strata | null, locale?: Locale): TextFn {
  const live = useStrataState(strata, 'locale')
  // live 变了（语言、覆盖）才换一个新的函数
  return useMemo(() => textFor(strata, locale), [strata, locale, live])
}

/** Subscribes to a core event. `cb` may be a new function on every render (it is read from a ref, no resubscription). Does nothing while `strata` is `null`. */
export function useStrataEvent<K extends keyof StrataEvents>(strata: Strata | null | undefined, event: K, cb: (v: StrataEvents[K]) => void) {
  const latest = useRef(cb)
  useEffect(() => {
    latest.current = cb
  })
  useEffect(() => {
    if (!strata) return
    return strata.on(event, (v) => latest.current(v))
  }, [strata, event])
}

/** One piece of engine state as React state: `'layers'`, `'hero'`, `'expanded'`, `'focus'` (single layer only), `'locale'`, `'theme'`. Re-renders only when the content changes. Empty values (`[]` / `null`) while `strata` is `null`. */
export function useStrataState<K extends StrataStateKey>(strata: Strata | null | undefined, key: K): StrataState[K] {
  const store = useMemo(() => createStateStore(strata ?? null, key), [strata, key])
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
