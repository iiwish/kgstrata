// <StrataCanvas>：创建、换数据、销毁一个 Strata，children 能用 useStrata 拿到它。

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ForwardedRef, type ReactElement, type ReactNode, type Ref } from 'react'
import { Strata, type StrataOptions } from '../engine.js'
import { DEFAULT_LOCALE, message, type Locale } from '../locale.js'
import type { StrataPlugin } from '../plugin.js'
import type { DataIssue, StrataData } from '../types.js'
import { StrataProvider } from './context.js'
import { bindEvents, cx, mountStrata, type PluginApis, type StrataEventProps, type StrataFactory } from './store.js'

export interface StrataCanvasProps<P extends readonly StrataPlugin<unknown>[] = readonly StrataPlugin<unknown>[]> extends StrataEventProps {
  /** 要画的数据。引用变了才重新 setData：每次渲染都新造一份对象会每次重排，记得 useMemo */
  data: StrataData | null | undefined
  /** 只在创建时读一次（和 new Strata 一样）；之后改它不起作用，要换就换 key 重建 */
  options?: StrataOptions
  /** 创建后、第一次 setData 之前按顺序装上的插件。也只在创建时读 */
  plugins?: P
  className?: string
  style?: CSSProperties
  /**
   * 创建好了（插件装上、数据给过一次）。apis 是各插件的接口，顺序和 plugins 一样。
   * 可以返回一个函数：销毁之前调它（严格模式下会创建两次、销毁一次）
   */
  onReady?: (strata: Strata, apis: PluginApis<P>) => void | (() => void)
  /** 每次 setData 查出来的问题（没有问题也调，给的是空数组） */
  onIssues?: (issues: DataIssue[]) => void
  /** 创建失败（拿不到 WebGL 时是 StrataError，code 'webgl-unavailable'） */
  onError?: (error: unknown) => void
  /** 创建失败时画什么。缺省是一行说明（按 options.locale） */
  fallback?: ReactNode | ((error: unknown) => ReactNode)
  /** 渲染在画布后面（兄弟节点），用 useStrata / usePlugin 拿实例。面板放这里 */
  children?: ReactNode
  /** 怎么造引擎：缺省 new Strata(host, options)。测试里换成假的，或者自己包一层 */
  create?: StrataFactory
}

const defaultCreate: StrataFactory = (host, options) => new Strata(host, options)
const NO_PLUGINS: readonly StrataPlugin<unknown>[] = []

/** 创建失败时画的东西：给了 fallback 用它，没给是一行按语言的说明 */
export function canvasFallback(error: unknown, fallback: StrataCanvasProps['fallback'], locale: Locale = DEFAULT_LOCALE): ReactNode {
  if (typeof fallback === 'function') return fallback(error)
  if (fallback !== undefined) return fallback
  return (
    <div className="kgs-fallback" role="alert">
      {message(locale, 'error.webgl-unavailable')}
    </div>
  )
}

function StrataCanvasImpl(props: StrataCanvasProps, ref: ForwardedRef<Strata | null>) {
  const { data, options, className, style, fallback, children } = props
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  // 事件回调、onIssues 每次现取：换了新函数不用重建
  useLayoutEffect(() => {
    latest.current = props
  })
  const [strata, setStrata] = useState<Strata | null>(null)
  const [plugins, setPlugins] = useState<ReadonlyMap<string, unknown>>(new Map())
  const [error, setError] = useState<{ error: unknown } | null>(null)
  /** 最后一次交给 setData 的数据：引用没变就不重新给 */
  const applied = useRef<StrataData | null | undefined>(undefined)

  useImperativeHandle(ref, () => strata as Strata, [strata])

  // 创建和销毁只跟着挂载走：options、plugins、create 都只在这里读一次
  useEffect(() => {
    const p = latest.current
    const res = mountStrata(host.current!, p.create ?? defaultCreate, p.options ?? {}, p.plugins ?? NO_PLUGINS, p.data)
    if (!res.ok) {
      setError({ error: res.error })
      p.onError?.(res.error)
      return
    }
    const s = res.strata
    applied.current = p.data
    const offEvents = bindEvents(s, () => latest.current)
    if (res.issues) p.onIssues?.(res.issues)
    setStrata(s)
    setPlugins(new Map(res.names.map((n, i) => [n, res.apis[i]])))
    const cleanup = p.onReady?.(s, res.apis as never)
    return () => {
      if (typeof cleanup === 'function') cleanup()
      offEvents()
      s.dispose()
      setStrata(null)
      setPlugins(new Map())
    }
  }, [])

  // 数据换了（引用变了）才重新 setData
  useEffect(() => {
    if (!strata || !data || applied.current === data) return
    applied.current = data
    latest.current.onIssues?.(strata.setData(data))
  }, [strata, data])

  if (error) return <>{canvasFallback(error.error, fallback, options?.locale)}</>
  return (
    <>
      <div ref={host} className={cx('kgs-canvas', className)} style={style} />
      <StrataProvider strata={strata} plugins={plugins}>
        {children}
      </StrataProvider>
    </>
  )
}

/**
 * 一个 3D 视图。负责创建、换数据、销毁；严格模式下的两次挂载各建各的、各销毁各的。
 * ref 拿到实例（创建好之前是 null）。拿不到 WebGL 时渲染 fallback，不抛。
 *
 *   <StrataCanvas data={data} options={{ locale: 'zh-CN' }} style={{ height: 600 }}>
 *     <LayerList />
 *   </StrataCanvas>
 */
export const StrataCanvas = forwardRef(StrataCanvasImpl) as unknown as <P extends readonly StrataPlugin<unknown>[] = readonly StrataPlugin<unknown>[]>(
  props: StrataCanvasProps<P> & { ref?: Ref<Strata | null> },
) => ReactElement | null
