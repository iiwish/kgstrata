// 实例怎么交给子组件，和几个 hook：拿实例、接事件、把引擎的状态变成 React 状态。

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { Strata } from '../engine.js'
import { DEFAULT_LOCALE, type Locale } from '../locale.js'
import type { StrataEvents } from '../plugin.js'
import { createStateStore, type StrataState, type StrataStateKey } from './store.js'

interface StrataContextValue {
  strata: Strata | null
  /** 装上的插件：名字 → 接口 */
  plugins: ReadonlyMap<string, unknown>
}

const NO_PLUGINS: ReadonlyMap<string, unknown> = new Map()
const Ctx = createContext<StrataContextValue>({ strata: null, plugins: NO_PLUGINS })

export interface StrataProviderProps {
  strata: Strata | null
  /** 装上的插件（名字 → 接口），usePlugin 从这里取。<StrataCanvas> 自己会填 */
  plugins?: ReadonlyMap<string, unknown>
  children?: ReactNode
}

/** 把实例交给子组件。<StrataCanvas> 已经把 children 包在里面了；自己 new Strata 的时候用它 */
export function StrataProvider({ strata, plugins = NO_PLUGINS, children }: StrataProviderProps) {
  const value = useMemo(() => ({ strata, plugins }), [strata, plugins])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 最近的 <StrataCanvas> / <StrataProvider> 的实例；还没创建好（或者拿不到 WebGL）时是 null */
export function useStrata(): Strata | null {
  return useContext(Ctx).strata
}

/** 装在实例上的插件的接口，按名字取（'path'、'diff'）；没装是 null */
export function usePlugin<Api>(name: string): Api | null {
  return (useContext(Ctx).plugins.get(name) as Api | undefined) ?? null
}

/** 面板用：props 里给了实例就用它，没给就用上下文里的 */
export function useStrataOr(strata: Strata | null | undefined): Strata | null {
  const fromContext = useStrata()
  return strata === undefined ? fromContext : strata
}

/** 界面文字的语言：显式给的 > 实例的 > 'en' */
export function useLocale(strata: Strata | null, locale?: Locale): Locale {
  return locale ?? strata?.locale ?? DEFAULT_LOCALE
}

/**
 * 订阅一个核心事件。cb 每次渲染都可以是新的函数：存在 ref 里现取，不会反复订阅。strata 是 null 时什么也不做
 */
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

/**
 * 引擎的一项状态，当 React 状态用：'layers'（每层显示还是隐藏）、'hero'（主角）、'expanded'（展开的节点）、
 * 'focus'（点中的层）。事件来了、内容真的变了才重画。strata 是 null 时是空值（[] / null）
 */
export function useStrataState<K extends StrataStateKey>(strata: Strata | null | undefined, key: K): StrataState[K] {
  const store = useMemo(() => createStateStore(strata ?? null, key), [strata, key])
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
