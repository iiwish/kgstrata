// 看变化的面板 kgstrata/react/diff：<DiffPanel> 五类变化的计数、叠加 / 之前 / 之后、回放条、每一处变化的列表。
// 引入看变化的入口（也就带上了 kgdiff）：只有用这个面板的人才要装 kgdiff。

import { useEffect, useState } from 'react'
import type { Strata } from '../engine.js'
import { familyColors, type ChangeFamily, type DiffApi, type DiffView, type FamilyColor, type StrataDiff } from '../diff/index.js'
import { message, type MessageKey } from '../locale.js'
import { useLocale, usePlugin, useStrataOr } from './context.js'
import type { PanelProps } from './panels.js'
import { countBy, cx } from './store.js'

export interface DiffPanelProps extends PanelProps {
  /** 看变化插件的接口；不给就用 <StrataCanvas plugins> 里装的那个（名字 'diff'） */
  diff?: DiffApi | null
  /** 每类变化的颜色；缺省和 3D 里 kgdiff 画的一样（familyColors()） */
  colors?: Partial<Record<ChangeFamily, FamilyColor>>
  /** 回放条多久跟一次插件的进度（秒），缺省 0.1 */
  pollEvery?: number
  /** 不看插件，直接给这份差异（服务端渲染、测试） */
  current?: StrataDiff | null
}

type Layer = 'union' | 'before' | 'after'
const LAYERS: [Layer, MessageKey][] = [
  ['union', 'ui.diff-union'],
  ['before', 'ui.diff-before'],
  ['after', 'ui.diff-after'],
]
const FAMILY_KEYS: Record<ChangeFamily, MessageKey> = {
  added: 'ui.diff-family.added',
  removed: 'ui.diff-family.removed',
  content: 'ui.diff-family.content',
  structure: 'ui.diff-family.structure',
  identity: 'ui.diff-family.identity',
}

let defaultColors: Record<ChangeFamily, FamilyColor> | null = null

/** 每一层有几处变化（层的 id → 数）：一处变化算在它第一个节点所在的那层。layers 是看变化时的层（strata.layers），和 diff.base 的层下标对齐 */
export function changesByLayer(diff: StrataDiff | null | undefined, layers: readonly { id: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const h of diff?.hunks ?? []) {
    const first = (h.nodes.length ? h.nodes : h.context)[0]
    const li = first !== undefined ? diff!.base.nodes[first]?.layer : undefined
    const id = li !== undefined ? layers[li]?.id : undefined
    if (id !== undefined) out[id] = (out[id] ?? 0) + 1
  }
  return out
}

/** 面板自己的那份状态：从插件现在的回放状态起步 */
function initial(view: Readonly<DiffView> | null | undefined, playing: boolean) {
  return {
    layer: (view && view.layer !== 'replay' ? view.layer : 'union') as Layer,
    hunk: view?.selectedHunk ?? -1,
    t: view?.t ?? 0,
    playing,
  }
}

/**
 * 看变化的面板。差异从插件的 enter 事件来（展开、收起以后重新比了也跟着换），exit 以后不出；
 * 回放的进度每 0.1 秒跟一次插件。
 */
export function DiffPanel(props: DiffPanelProps) {
  const strata: Strata | null = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  const fromContext = usePlugin<DiffApi>('diff')
  const api = props.diff !== undefined ? props.diff : fromContext
  const [entered, setEntered] = useState<{ api: DiffApi | null; diff: StrataDiff | null }>(() => ({ api, diff: api?.current ?? null }))
  const [st, setSt] = useState(() => initial(api?.view, api?.playing ?? false))

  useEffect(() => {
    if (!api) return
    setEntered({ api, diff: api.current })
    const offEnter = api.on('enter', (d) => setEntered({ api, diff: d }))
    const offExit = api.on('exit', () => setEntered({ api, diff: null }))
    return () => {
      offEnter()
      offExit()
    }
  }, [api])

  // 回放的进度：跟着引擎的时钟，隔一会儿读一次
  const every = props.pollEvery ?? 0.1
  useEffect(() => {
    if (!api || !strata) return
    let last = 0
    return strata.on('tick', (now) => {
      if (now - last < every) return
      last = now
      const v = api.view
      if (v) setSt((s) => (s.t === v.t && s.playing === api.playing ? s : { ...s, t: v.t, playing: api.playing }))
    })
  }, [api, strata, every])

  const diff = props.current !== undefined ? props.current : entered.api === api ? entered.diff : null
  if (!diff) return null
  const colors = { ...(defaultColors ??= familyColors()), ...props.colors }
  const families = countBy(diff.hunks, (h) => h.family)
  const { layer, hunk, t, playing } = st

  return (
    <div className={cx('kgs-diff', props.className)} style={props.style}>
      <div className="kgs-diff-families">
        {families.map(([f, n]) => {
          const c = colors[f as ChangeFamily]
          return (
            <span key={f} className="kgs-diff-family" data-family={f} style={{ color: c?.text }}>
              <i style={{ background: c?.base }} />
              {FAMILY_KEYS[f as ChangeFamily] ? message(locale, FAMILY_KEYS[f as ChangeFamily]) : f} {n}
            </span>
          )
        })}
      </div>
      <div className="kgs-seg" role="group" aria-label={message(locale, 'ui.diff-layers')}>
        {LAYERS.map(([k, key]) => (
          <button
            key={k}
            type="button"
            aria-pressed={!playing && layer === k && t === 0}
            onClick={() => {
              setSt((s) => ({ ...s, layer: k, hunk: -1, t: 0, playing: false }))
              api?.play(false)
              api?.setView({ layer: k, t: 0, selectedHunk: -1 })
            }}
          >
            {message(locale, key)}
          </button>
        ))}
      </div>
      <div className="kgs-replay">
        <button
          type="button"
          className="kgs-play"
          aria-label={message(locale, playing ? 'ui.diff-pause' : 'ui.diff-play')}
          aria-pressed={playing}
          onClick={() => {
            setSt((s) => ({ ...s, hunk: -1, playing: !playing }))
            api?.play(!playing)
          }}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </button>
        <input
          className="kgs-range"
          type="range"
          min={0}
          max={diff.duration}
          step={1}
          value={t}
          aria-label={message(locale, 'ui.diff-timeline')}
          onChange={(e) => {
            const v = Number(e.target.value)
            api?.play(false)
            api?.setView({ layer: 'replay', t: v, selectedHunk: -1 })
            setSt((s) => ({ ...s, t: v, playing: false }))
          }}
        />
      </div>
      <ol className="kgs-hunks" aria-label={message(locale, 'ui.diff-hunks')}>
        {diff.hunks.map((h) => {
          const live = t > 0 && t >= h.start && t <= h.end
          return (
            <li key={h.id}>
              <button
                type="button"
                aria-pressed={hunk === h.index}
                className={cx(live && 'kgs-live')}
                onClick={() => {
                  const next = hunk === h.index ? -1 : h.index
                  setSt((s) => ({ ...s, hunk: next }))
                  api?.selectHunk(next)
                  if (next < 0) strata?.shot('overview')
                }}
              >
                <i style={{ background: colors[h.family]?.base }} />
                <span>{h.title}</span>
                {h.subtitle && <em>{h.subtitle}</em>}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
