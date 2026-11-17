// 核心的几个面板：层列表、主角跟随、主次滑杆、层距、镜头按钮、悬停提示。
// 都只输出带 kgs- 前缀的结构，样子在可选的 styles.css 里；位置由用的人定。
// 实例从 props 拿（strata），不给就用最近的 <StrataCanvas> / <StrataProvider> 的。字跟着实例的 locale，也可以用 locale 盖掉。

import { useState, type CSSProperties } from 'react'
import type { HeroInfo, HoverInfo, LayerInfo, Strata } from '../engine.js'
import { message, type Locale } from '../locale.js'
import { useLocale, useStrataEvent, useStrataOr, useStrataState } from './context.js'
import { cx, heroPair, isDual, layerClickTarget, layerMarkOpacity, layerPressed } from './store.js'

/** 每个面板都认的几项 */
export interface PanelProps {
  /** 用哪个实例；不给用上下文里的 */
  strata?: Strata | null
  /** 界面文字的语言；不给跟实例的 locale */
  locale?: Locale
  className?: string
  style?: CSSProperties
}

/** 层 id → 数（Record 或 Map 都行） */
export type LayerCounts = Readonly<Record<string, number>> | ReadonlyMap<string, number>

const countOf = (c: LayerCounts | undefined, id: string): number | undefined => (c instanceof Map ? c.get(id) : (c as Record<string, number> | undefined)?.[id])

// ─── 层列表 ──────────────────────────────────────────────────────────────────

export interface LayerListProps extends PanelProps {
  /** 每层右边的数（比如节点数） */
  counts?: LayerCounts
  /** 每层的徽标（比如这一层有几处变化）。缺省只在层隐藏着时出：不能悄悄藏掉 */
  badges?: LayerCounts
  /** 徽标什么时候出：'hidden'（缺省）只在隐藏时，'always' 一直 */
  badgeWhen?: 'hidden' | 'always'
  /** 徽标的提示；缺省是“这一层有 N 处变化” */
  badgeTitle?: (n: number, layer: LayerInfo) => string
  /** 不看实例，直接给这几项（服务端渲染、测试） */
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

/**
 * 层列表：点一行，几张图并存时让它当主角，只有一张图时聚焦（再点一次放开）；眼睛按钮显示、隐藏这一层。
 */
export function LayerList(props: LayerListProps) {
  const strata = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  const liveLayers = useStrataState(strata, 'layers')
  const liveHero = useStrataState(strata, 'hero')
  const liveFocus = useStrataState(strata, 'focus')
  const layers = props.layers ?? liveLayers
  const hero = props.hero !== undefined ? props.hero : liveHero
  const focus = props.focus !== undefined ? props.focus : liveFocus
  const badgeTitle = props.badgeTitle ?? ((n: number) => message(locale, 'ui.layer-changes', { n }))
  return (
    <ol className={cx('kgs-layer-list', props.className)} style={props.style} aria-label={message(locale, 'ui.layers')}>
      {layers.map((l) => {
        const visible = l.visible
        const badge = countOf(props.badges, l.id) ?? 0
        const count = countOf(props.counts, l.id)
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
              aria-label={message(locale, visible ? 'ui.layer-hide' : 'ui.layer-show', { layer: l.name })}
              title={message(locale, visible ? 'ui.layer-hide-title' : 'ui.layer-show-title')}
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

/** 开关“主角跟着选中和路径走”。只有一张图（不分主次）时不出 */
export function FollowToggle(props: FollowToggleProps) {
  const strata = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  const live = useStrataState(strata, 'hero')
  const hero = props.hero !== undefined ? props.hero : live
  if (!isDual(hero)) return null
  return (
    <button
      type="button"
      className={cx('kgs-follow', props.className)}
      style={props.style}
      aria-pressed={hero.follow}
      title={message(locale, 'ui.follow-title')}
      onClick={() => strata?.setFollowHero(!hero.follow)}
    >
      <b className="kgs-switch" aria-hidden="true" />
      <span>{message(locale, 'ui.follow')}</span>
    </button>
  )
}

// ─── 滑杆 ────────────────────────────────────────────────────────────────────

export interface HeroMixSliderProps extends PanelProps {
  hero?: HeroInfo | null
  layers?: LayerInfo[]
}

/** 主次：正好两层、分主次时出一根滑杆，左头第一层当主角，右头第二层，中间两层一样大（setHeroMix） */
export function HeroMixSlider(props: HeroMixSliderProps) {
  const strata = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  const liveHero = useStrataState(strata, 'hero')
  const liveLayers = useStrataState(strata, 'layers')
  const hero = props.hero !== undefined ? props.hero : liveHero
  const pair = heroPair(hero, props.layers ?? liveLayers)
  if (!pair || !hero) return null
  const [a, b] = pair
  return (
    <label className={cx('kgs-slider', 'kgs-hero-mix', props.className)} style={props.style} title={message(locale, 'ui.hero-mix-title')}>
      <span>{message(locale, 'ui.hero-mix')}</span>
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

/** 层距的倍数（setSpread）。初值从实例的视图状态读 */
export function SpreadSlider(props: SpreadSliderProps) {
  const strata = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  const [own, setOwn] = useState<{ strata: Strata | null; value: number } | null>(null)
  // 换了实例就从它那儿重新读一次
  const value = own && own.strata === strata ? own.value : (strata?.getView().spread ?? 1)
  return (
    <label className={cx('kgs-slider', 'kgs-spread', props.className)} style={props.style}>
      <span>{message(locale, 'ui.spread')}</span>
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

/** 总览（放开聚焦、主角回家、镜头取总览）和叠看（几层压在一起从上往下看） */
export function ViewButtons(props: PanelProps) {
  const strata = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  return (
    <div className={cx('kgs-views', props.className)} style={props.style} role="group" aria-label={message(locale, 'ui.views')}>
      <button type="button" className="kgs-view-button" onClick={() => strata?.focusLayer(null)}>
        {message(locale, 'ui.overview')}
      </button>
      <button type="button" className="kgs-view-button" onClick={() => strata?.shot('top')}>
        {message(locale, 'ui.overlay')}
      </button>
    </div>
  )
}

// ─── 悬停提示 ────────────────────────────────────────────────────────────────

export interface NodeTipProps extends PanelProps {
  /** 不看实例的 hover 事件，直接给（服务端渲染、测试、自己管悬停） */
  info?: HoverInfo | null
  /** 离指针多远（像素），缺省 [16, 14] */
  offset?: [number, number]
}

/**
 * 悬停提示：名字、层 · 组；能展开的写“N 个字段 · 双击展开”，展开着的写“双击收起”。
 * 按指针的位置绝对定位：放在和画布同一个定位容器里。
 */
export function NodeTip(props: NodeTipProps) {
  const strata = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  useStrataEvent(props.info !== undefined ? null : strata, 'hover', setHover)
  const info = props.info !== undefined ? props.info : hover
  if (!info) return null
  const [dx, dy] = props.offset ?? [16, 14]
  return (
    <div className={cx('kgs-tip', props.className)} style={{ left: info.x + dx, top: info.y + dy, ...props.style }} role="tooltip">
      <b>{info.label}</b>
      <span>{[info.layer, info.group].filter(Boolean).join(' · ')}</span>
      {(info.folds > 0 || info.expanded) && <span>{info.expanded ? message(locale, 'ui.tip-collapse') : message(locale, 'ui.tip-expand', { n: info.folds })}</span>}
    </div>
  )
}
