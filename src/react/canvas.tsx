// <StrataCanvas>：创建、换数据、销毁一个 Strata，children 能用 useStrata 拿到它。
// 结构：<div class="kgs-canvas">（定位容器，缺省 position: relative、铺满父元素、有个最小高度）里面先是画布的宿主
// <div class="kgs-canvas-host">（绝对定位铺满），再是 children：面板直接 position: absolute 就盖在画布上。

import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ForwardedRef, type ReactElement, type ReactNode, type Ref } from 'react'
import { Strata, type StrataOptions } from '../engine/index.js'
import { DEFAULT_LOCALE, message, type Locale } from '../locale.js'
import type { StrataPlugin } from '../plugin.js'
import type { DataIssue, StrataData } from '../types.js'
import { StrataProvider, useStrataState } from './context.js'
import { bindEvents, cx, mountStrata, textFor, themeRule, themeVars, zeroHeightWarning, type PluginApis, type StrataEventProps, type StrataFactory } from './store.js'

// 开发模式：打包工具把 process.env.NODE_ENV 换成字面量；浏览器里没换（没有 process）时当作不是开发模式
declare const process: { env: { NODE_ENV?: string } }
function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== 'production'
  } catch {
    return false
  }
}

/** Default rules of the container. The component renders them in its own `<style>`, so no stylesheet is needed. Wrapped in `:where()` (zero specificity): your `className`, `style` and `styles.css` win (fixed height: `style={{ height: 600 }}`; no minimum: `minHeight: 0`). */
export const CANVAS_CSS = ':where(.kgs-canvas){position:relative;width:100%;height:100%;min-height:320px}'
/** Inline style of the canvas host: fills the container, children sit over it. */
export const CANVAS_HOST_STYLE: Readonly<CSSProperties> = Object.freeze({ position: 'absolute', inset: 0 })

export interface StrataCanvasProps<P extends readonly StrataPlugin<unknown>[] = readonly StrataPlugin<unknown>[]> extends StrataEventProps {
  /** The data to draw. `setData` runs again only when the reference changes: memoize it (`useMemo`), or every render re-lays out. */
  data: StrataData | null | undefined
  /** Read once at creation (like `new Strata`). Change the `key` to recreate with other options. */
  options?: StrataOptions
  /** Plugins installed in order after creation, before the first `setData`. Read once at creation. */
  plugins?: P
  /** Class of the container (`.kgs-canvas`). */
  className?: string
  /** Style of the container. Default rules: `position: relative; width: 100%; height: 100%; min-height: 320px` (`CANVAS_CSS`). */
  style?: CSSProperties
  /**
   * Called once created (plugins installed, data given once). `apis` are the plugins' APIs in the order of `plugins`.
   * May return a cleanup function, called before disposal (strict mode creates twice and disposes once).
   */
  onReady?: (strata: Strata, apis: PluginApis<P>) => void | (() => void)
  /** The issues of every `setData` (called with `[]` when clean). */
  onIssues?: (issues: DataIssue[]) => void
  /** Creation failed (`StrataError` with `code: 'webgl-unavailable'` without WebGL). */
  onError?: (error: unknown) => void
  /** What to render when creation failed. Default: one line of text (in `options.locale`). */
  fallback?: ReactNode | ((error: unknown) => ReactNode)
  /** Rendered inside the container after the canvas host (over the canvas); `useStrata` / `usePlugin` give the instance. Put panels here with `position: absolute`. */
  children?: ReactNode
  /** How to create the engine; default `new Strata(host, options)`. Replace it in tests or to wrap it. */
  create?: StrataFactory
}

// 服务端渲染时 useLayoutEffect 不跑，React 18 还会为它打一条警告：服务端换成 useEffect（同样不跑，但不警告）
const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect

const defaultCreate: StrataFactory = (host, options) => new Strata(host, options)
const NO_PLUGINS: readonly StrataPlugin<unknown>[] = []

/** What `<StrataCanvas>` renders when creation failed: `fallback` if given, otherwise one line of text in `locale`. */
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
  useIsomorphicLayoutEffect(() => {
    latest.current = props
  })
  const [strata, setStrata] = useState<Strata | null>(null)
  const [plugins, setPlugins] = useState<ReadonlyMap<string, unknown>>(new Map())
  const [error, setError] = useState<{ error: unknown } | null>(null)
  /** 最后一次交给 setData 的数据：引用没变就不重新给 */
  const applied = useRef<StrataData | null | undefined>(undefined)

  useImperativeHandle(ref, () => strata as Strata, [strata])
  // 主题里面板要用的颜色写成容器上的 --kgs-* 变量（只写改过的那几个），setTheme 以后跟着变
  const scope = useId()
  const theme = useStrataState(strata, 'theme')
  const themeCss = themeRule(`[data-kgs-scope="${scope.replace(/["\\]/g, '')}"]`, themeVars(theme))

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
    // 开发模式：宿主高度是 0（父元素没给高度）时提醒一次
    if (isDev()) {
      const warning = zeroHeightWarning(host.current!.clientHeight, textFor(s))
      if (warning) console.warn(warning)
    }
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
    <div className={cx('kgs-canvas', className)} style={style} data-kgs-scope={themeCss ? scope : undefined}>
      <style>{CANVAS_CSS + themeCss}</style>
      <div ref={host} className="kgs-canvas-host" style={CANVAS_HOST_STYLE} />
      <StrataProvider strata={strata} plugins={plugins}>
        {children}
      </StrataProvider>
    </div>
  )
}

/**
 * A 3D view. Creates, updates and disposes a `Strata`; the two mounts of strict mode each create and dispose their own.
 * `ref` gives the instance (`null` until created). Without WebGL it renders `fallback` and does not throw.
 *
 *   <StrataCanvas data={data} options={{ locale: 'zh-CN' }} style={{ height: 600 }}>
 *     <aside style={{ position: 'absolute', left: 16, top: 16 }}><LayerList /></aside>
 *   </StrataCanvas>
 */
export const StrataCanvas = forwardRef(StrataCanvasImpl) as unknown as <P extends readonly StrataPlugin<unknown>[] = readonly StrataPlugin<unknown>[]>(
  props: StrataCanvasProps<P> & { ref?: Ref<Strata | null> },
) => ReactElement | null
