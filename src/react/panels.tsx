// 核心的几个面板：层列表、主角跟随、主次滑杆、层距、镜头按钮、悬停提示。
// 都只输出带 kgs- 前缀的结构，样子在可选的 styles.css 里；位置由用的人定。
// 实例从 props 拿（strata），不给就用最近的 <StrataCanvas> / <StrataProvider> 的。字跟着实例的 locale，也可以用 locale 盖掉。

import { useState, type CSSProperties } from 'react'
import type { HeroInfo, HoverInfo, LayerInfo, Strata } from '../engine/index.js'
import type { Locale } from '../locale.js'
import { useStrataEvent, useStrataOr, useStrataState, useText } from './context.js'
import { cx, heroPair, isDual, layerClickTarget, layerCount, layerMarkOpacity, layerPressed, tipLines } from './store.js'

/** Props every panel takes. */
export interface PanelProps {
  /** The instance; default: the one from context (`<StrataCanvas>` / `<StrataProvider>`). */
  strata?: Strata | null
  /** Language of the panel's text; default: the instance's `locale`. */
  locale?: Locale
  className?: string
  style?: CSSProperties
}

/** Layer id → number (a `Record` or a `Map`). */
export type LayerCounts = Readonly<Record<string, number>> | ReadonlyMap<string, number>

const countOf = (c: LayerCounts | undefined, id: string): number | undefined => (c instanceof Map ? c.get(id) : c && Object.hasOwn(c, id) ? (c as Record<string, number>)[id] : undefined)

// ─── 层列表 ──────────────────────────────────────────────────────────────────

export interface LayerListProps extends PanelProps {
  /** The number at the right of each row. Default: the layer's top-level node count (`LayerInfo.count`); `false` for none. */
  counts?: LayerCounts | false
  /** A badge per layer (for example the number of changes in it). By default shown only while the layer is hidden, so nothing disappears silently. */
  badges?: LayerCounts
  /** When badges show: `'hidden'` (default) only while hidden, `'always'` always. */
  badgeWhen?: 'hidden' | 'always'
  /** Badge tooltip; default "N changes in this layer". */
  badgeTitle?: (n: number, layer: LayerInfo) => string
  /** Give the layers directly instead of reading the instance (server rendering, tests). */
  layers?: LayerInfo[]
  hero?: HeroInfo | null
  focus?: string | null
}

/** 眼睛：显示着是睁眼，隐藏着划一道 */
function Eye({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      <path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.9" />
      {!open && <path d="M3 13L13 3" />}
    </svg>
  )
}

/** Layer list. Clicking a row makes it the hero with several layers, or focuses it with one (click again to release); the eye button shows or hides the layer. */
export function LayerList(props: LayerListProps) {
  const strata = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  const liveLayers = useStrataState(strata, 'layers')
  const liveHero = useStrataState(strata, 'hero')
  const liveFocus = useStrataState(strata, 'focus')
  const layers = props.layers ?? liveLayers
  const hero = props.hero !== undefined ? props.hero : liveHero
  const focus = props.focus !== undefined ? props.focus : liveFocus
  const badgeTitle = props.badgeTitle ?? ((n: number) => t('ui.layer-changes', { n }))
  return (
    <ol className={cx('kgs-layer-list', props.className)} style={props.style} aria-label={t('ui.layers')}>
      {layers.map((l) => {
        const visible = l.visible
        const badge = countOf(props.badges, l.id) ?? 0
        const count = layerCount(props.counts, l)
        const showBadge = badge > 0 && (props.badgeWhen === 'always' || !visible)
        return (
          <li key={l.id} className={cx('kgs-layer', !visible && 'kgs-off')}>
            <button
              type="button"
              className="kgs-layer-main"
              disabled={!visible}
              aria-pressed={layerPressed(hero, focus, l)}
              onClick={() => strata?.focusLayer(layerClickTarget(hero, focus, l.id))}
            >
              <i className="kgs-layer-mark" style={{ opacity: layerMarkOpacity(hero, focus, l) }} />
              <span className="kgs-layer-name">{l.name}</span>
              {showBadge && (
                <u className="kgs-layer-badge" title={badgeTitle(badge, l)}>
                  {badge}
                </u>
              )}
              <em className="kgs-layer-count">{count ?? ''}</em>
            </button>
            <button
              type="button"
              className="kgs-layer-eye"
              aria-pressed={visible}
              aria-label={t(visible ? 'ui.layer-hide' : 'ui.layer-show', { layer: l.name })}
              title={t(visible ? 'ui.layer-hide-title' : 'ui.layer-show-title')}
              onClick={() => strata?.setLayerVisible(l.id, !visible)}
            >
              <Eye open={visible} />
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ─── 主角跟随 ────────────────────────────────────────────────────────────────

export interface FollowToggleProps extends PanelProps {
  hero?: HeroInfo | null
}

/** Toggles "the hero follows the selection and the path" (`setFollow`). Not shown with a single layer. */
export function FollowToggle(props: FollowToggleProps) {
  const strata = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  const live = useStrataState(strata, 'hero')
  const hero = props.hero !== undefined ? props.hero : live
  if (!isDual(hero)) return null
  return (
    <button
      type="button"
      className={cx('kgs-follow', props.className)}
      style={props.style}
      aria-pressed={hero.follow}
      title={t('ui.follow-title')}
      onClick={() => strata?.setFollow(!hero.follow)}
    >
      <b className="kgs-switch" aria-hidden="true" />
      <span>{t('ui.follow')}</span>
    </button>
  )
}

// ─── 滑杆 ────────────────────────────────────────────────────────────────────

export interface HeroMixSliderProps extends PanelProps {
  hero?: HeroInfo | null
  layers?: LayerInfo[]
}

/** Hero balance slider for exactly two layers (`setHeroMix`): left end the first layer is the hero, right end the second, middle both the same size. */
export function HeroMixSlider(props: HeroMixSliderProps) {
  const strata = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  const liveHero = useStrataState(strata, 'hero')
  const liveLayers = useStrataState(strata, 'layers')
  const hero = props.hero !== undefined ? props.hero : liveHero
  const pair = heroPair(hero, props.layers ?? liveLayers)
  if (!pair || !hero) return null
  const [a, b] = pair
  return (
    <label className={cx('kgs-slider', 'kgs-hero-mix', props.className)} style={props.style} title={t('ui.hero-mix-title')}>
      <span>{t('ui.hero-mix')}</span>
      <input
        className="kgs-range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={Object.hasOwn(hero.mix, b.id) ? hero.mix[b.id] : 0}
        onChange={(e) => {
          const t = Number(e.target.value)
          strata?.setHeroMix({ [a.id]: 1 - t, [b.id]: t })
        }}
      />
    </label>
  )
}

export interface SpreadSliderProps extends PanelProps {
  min?: number
  max?: number
  step?: number
}

/** Layer spacing slider (`setSpread`). Starts from the instance's `spread`. */
export function SpreadSlider(props: SpreadSliderProps) {
  const strata = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  const [own, setOwn] = useState<{ strata: Strata | null; value: number } | null>(null)
  // 换了实例就从它那儿重新读一次
  const value = own && own.strata === strata ? own.value : (strata?.spread ?? 1)
  return (
    <label className={cx('kgs-slider', 'kgs-spread', props.className)} style={props.style}>
      <span>{t('ui.spread')}</span>
      <input
        className="kgs-range"
        type="range"
        min={props.min ?? 0.4}
        max={props.max ?? 1.8}
        step={props.step ?? 0.01}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          setOwn({ strata, value: v })
          strata?.setSpread(v)
        }}
      />
    </label>
  )
}

// ─── 镜头按钮 ────────────────────────────────────────────────────────────────

/** Overview (release focus, hero back home, overview shot) and stack (layers pressed together, seen from above) buttons. */
export function ViewButtons(props: PanelProps) {
  const strata = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  return (
    <div className={cx('kgs-views', props.className)} style={props.style} role="group" aria-label={t('ui.views')}>
      <button type="button" className="kgs-view-button" onClick={() => strata?.focusLayer(null)}>
        {t('ui.overview')}
      </button>
      <button type="button" className="kgs-view-button" onClick={() => strata?.shot('top')}>
        {t('ui.overlay')}
      </button>
    </div>
  )
}

// ─── 悬停提示 ────────────────────────────────────────────────────────────────

export interface NodeTipProps extends PanelProps {
  /** Give the hover info directly instead of listening to `hover` (server rendering, tests, your own hover handling). */
  info?: HoverInfo | null
  /** Offset from the pointer in pixels; default `[16, 14]`. */
  offset?: [number, number]
}

/** Hover tooltip: name, layer · group; for expandable nodes "N fields · double-click to expand" (the noun from the node type's `NodeStyle.childNoun`, otherwise "N inside"), for expanded ones "double-click to collapse". Positioned at `info.pointer`: put it in `<StrataCanvas>`'s children (same positioned container as the canvas). */
export function NodeTip(props: NodeTipProps) {
  const strata = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  useStrataEvent(props.info !== undefined ? null : strata, 'hover', setHover)
  const info = props.info !== undefined ? props.info : hover
  if (!info) return null
  const [dx, dy] = props.offset ?? [16, 14]
  const { where, fold } = tipLines(info, t)
  return (
    <div className={cx('kgs-tip', props.className)} style={{ left: info.pointer.x + dx, top: info.pointer.y + dy, ...props.style }} role="tooltip">
      <b>{info.label}</b>
      <span>{where}</span>
      {fold && <span>{fold}</span>}
    </div>
  )
}
