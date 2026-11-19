// 看变化的面板 kgstrata/react/diff：<DiffPanel> 五类变化的计数、叠加 / 之前 / 之后、回放条、每一处变化的列表。
// 引入看变化的入口（也就带上了 kgdiff）：只有用这个面板的人才要装 kgdiff。

import { useEffect, useState } from 'react'
import type { Strata } from '../engine/index.js'
import { familyColors, type ChangeFamily, type DiffApi, type DiffView, type FamilyColor, type StrataDiff } from '../diff/index.js'
import type { MessageKey } from '../locale.js'
import type { Theme } from '../theme.js'
import { usePlugin, useStrataOr, useStrataState, useText } from './context.js'
import type { PanelProps } from './panels.js'
import { countBy, cx } from './store.js'

export interface DiffPanelProps extends PanelProps {
  /** The diff plugin's API; default: the one installed through `<StrataCanvas plugins>` (name `'diff'`). */
  diff?: DiffApi | null
  /** Colours per change family; default as kgdiff draws them in 3D (`familyColors(strata.theme)`, following the theme's `diffScheme`). */
  colors?: Partial<Record<ChangeFamily, FamilyColor>>
  /** How often the replay bar polls the plugin, in seconds; default 0.1. */
  pollEvery?: number
  /** Give the comparison directly instead of reading the plugin (server rendering, tests). */
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

const colorCache = new Map<Theme['diffScheme'], Record<ChangeFamily, FamilyColor>>()

/** Changes per layer (layer id → count). A change counts on the layer most of its nodes are in (`DiffHunk.layer`, the one `follow` switches to). */
export function changesByLayer(diff: StrataDiff | null | undefined): Record<string, number> {
  const out: Record<string, number> = Object.create(null)
  for (const h of diff?.hunks ?? []) if (h.layer) out[h.layer] = (out[h.layer] ?? 0) + 1
  return out
}

/** 面板自己的那份状态：从插件现在的回放状态起步 */
function initial(view: Readonly<DiffView> | null | undefined, playing: boolean) {
  return {
    layer: (view && view.layer !== 'replay' ? view.layer : 'union') as Layer,
    hunk: view?.selectedHunk ?? null,
    t: view?.t ?? 0,
    playing,
  }
}

/** Version comparison panel: changes from the plugin's `enter` event (also after it re-compares), nothing after `exit`. The replay bar polls the plugin every 0.1 s. */
export function DiffPanel(props: DiffPanelProps) {
  const strata: Strata | null = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  const theme = useStrataState(strata, 'theme')
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
  const scheme = theme?.diffScheme ?? 'dark'
  let fallbackColors = colorCache.get(scheme)
  if (!fallbackColors) colorCache.set(scheme, (fallbackColors = familyColors(scheme)))
  const colors = { ...fallbackColors, ...props.colors }
  const families = countBy(diff.hunks, (h) => h.family)
  const { layer, hunk, t: time, playing } = st

  return (
    <div className={cx('kgs-diff', props.className)} style={props.style}>
      <div className="kgs-diff-families">
        {families.map(([f, n]) => {
          const c = colors[f as ChangeFamily]
          return (
            <span key={f} className="kgs-diff-family" data-family={f} style={{ color: c?.text }}>
              <i style={{ background: c?.base }} />
              {FAMILY_KEYS[f as ChangeFamily] ? t(FAMILY_KEYS[f as ChangeFamily]) : f} {n}
            </span>
          )
        })}
      </div>
      <div className="kgs-seg" role="group" aria-label={t('ui.diff-layers')}>
        {LAYERS.map(([k, key]) => (
          <button
            key={k}
            type="button"
            aria-pressed={!playing && layer === k && time === 0}
            onClick={() => {
              setSt((s) => ({ ...s, layer: k, hunk: null, t: 0, playing: false }))
              api?.play(false)
              api?.update({ layer: k, t: 0, selectedHunk: null })
            }}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <div className="kgs-replay">
        <button
          type="button"
          className="kgs-play"
          aria-label={t(playing ? 'ui.diff-pause' : 'ui.diff-play')}
          aria-pressed={playing}
          onClick={() => {
            setSt((s) => ({ ...s, hunk: null, playing: !playing }))
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
          value={time}
          aria-label={t('ui.diff-timeline')}
          onChange={(e) => {
            const v = Number(e.target.value)
            api?.play(false)
            api?.update({ layer: 'replay', t: v, selectedHunk: null })
            setSt((s) => ({ ...s, t: v, playing: false }))
          }}
        />
      </div>
      <ol className="kgs-hunks" aria-label={t('ui.diff-hunks')}>
        {diff.hunks.map((h) => {
          const live = time > 0 && time >= h.start && time <= h.end
          return (
            <li key={h.id}>
              <button
                type="button"
                aria-pressed={hunk === h.id}
                className={cx(live && 'kgs-live')}
                onClick={() => {
                  const next = hunk === h.id ? null : h.id
                  setSt((s) => ({ ...s, hunk: next }))
                  api?.selectHunk(next)
                  if (next === null) strata?.shot('overview')
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
