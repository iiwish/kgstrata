// 主次的状态机：谁是主角、每层当主角的分量、主角的“家”。纯计算，不碰渲染、不发事件：
// 输入是层的列表（只要个数和 id）、隐藏的层（下标）和一个动作，输出新的状态。引擎拿结果去排版、取景、发 hero 事件。

import type { HeroInfo } from './types.js'

export interface HeroState {
  /** 主角：分量最大的那一层（-1 = 只有一张图，不分主次） */
  readonly hero: number
  /** 每层当主角的分量 0..1；只有一张图时是 null */
  readonly mix: readonly number[] | null
  /** 主角的“家”：点总览、没有东西可跟时回到这一层 */
  readonly home: number
}

/** 不分主次（没数据，或者只有一张图） */
export const NO_HERO: HeroState = Object.freeze({ hero: -1, mix: null, home: -1 })

/** 第 i 层分量 1、其余的层分量 0 */
export function oneHot(n: number, i: number): number[] {
  return Array.from({ length: n }, (_, k) => (k === i ? 1 : 0))
}

/** 离 from 最近的那个（一样近取前面的） */
const nearest = (list: readonly number[], from: number) => list.reduce((a, b) => (Math.abs(b - from) < Math.abs(a - from) ? b : a))

/** 换了数据：选项里指定的那一层（不写就是布局的基准层）当主角；一张图不分主次 */
export function heroOnLoad(count: number, wanted: number, anchor: number): HeroState {
  if (count < 2) return NO_HERO
  const hero = wanted >= 0 ? wanted : anchor
  return { hero, home: hero, mix: oneHot(count, hero) }
}

/**
 * 隐藏的层不能当主角：分量清零；主角被藏了就让给最近的可见层（家被藏了，家也搬到最近的可见层）。
 * 分量全清没了（只给了隐藏的层分量）也回到一层独当主角
 */
export function yieldHero(s: HeroState, hidden: ReadonlySet<number>): HeroState {
  if (!s.mix || s.hero < 0) return s
  const mix = s.mix.map((v, i) => (hidden.has(i) ? 0 : v))
  const visible = mix.map((_, i) => i).filter((i) => !hidden.has(i))
  if (visible.length === 0) return { ...s, mix }
  const home = hidden.has(s.home) ? nearest(visible, s.home) : s.home
  if (!hidden.has(s.hero) && mix.some((v) => v > 0)) return { hero: s.hero, mix, home }
  const hero = hidden.has(s.hero) ? nearest(visible, s.hero) : s.hero
  return { hero, home, mix: oneHot(mix.length, hero) }
}

/**
 * 把“层的 id → 分量”收进来：没写到的、隐藏的层按 0，越界的夹到 0..1。主角改成分量最大的那层（一样大时不换）。
 * 分量全是 0 等于没给：主角那层独当主角
 */
export function adoptMix(s: HeroState, ids: readonly string[], mix: Readonly<Record<string, number>>, hidden: ReadonlySet<number>): HeroState {
  if (!s.mix || s.hero < 0) return s
  const next = ids.map((id, i) => {
    if (hidden.has(i)) return 0
    const v = Object.hasOwn(mix, id) ? mix[id] : undefined
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
  })
  let best = s.hero
  for (let i = 0; i < next.length; i++) if (next[i] > (next[best] ?? -1) + 1e-6) best = i
  if (!next.some((v) => v > 0)) return { ...s, hero: best, mix: oneHot(next.length, best) }
  return { ...s, hero: best, mix: next }
}

/** 第 i 层独当主角。changed：主角或者分量真的变了 */
export function switchHero(s: HeroState, i: number): { state: HeroState; changed: boolean } {
  if (s.hero < 0 || i < 0) return { state: s, changed: false }
  const mix = oneHot(s.mix?.length ?? 0, i)
  const changed = i !== s.hero || !s.mix || mix.some((v, k) => v !== s.mix![k])
  return { state: { ...s, hero: i, mix }, changed }
}

/** 跟随要不要换到这一层：已经是它独当主角（分量混着的也要换）、它被隐藏了都不换 */
export function shouldFollow(s: HeroState, layer: number, hidden: ReadonlySet<number>): boolean {
  if (s.hero < 0 || (layer === s.hero && (s.mix?.[layer] ?? 1) >= 1)) return false
  return !hidden.has(layer)
}

/**
 * 模式接管：它的层不一定和全景的一样多。分量按层的 id 对过去；一层都对不上就回到模式的基准层。
 * hidden 是模式那张图里隐藏的层
 */
export function carryOver(s: HeroState, from: readonly string[], to: readonly string[], anchor: number, hidden: ReadonlySet<number>): HeroState {
  if (!s.mix) return s
  const old = new Map(from.map((id, i) => [id, s.mix![i] ?? 0]))
  const next = to.map((id) => old.get(id) ?? 0)
  const carried: HeroState = next.some((v) => v > 0)
    ? { ...s, mix: next, hero: next.indexOf(Math.max(...next)) }
    : { ...s, hero: Math.max(0, anchor), mix: oneHot(to.length, Math.max(0, anchor)) }
  return yieldHero(carried, hidden)
}

/** 对外的样子：层的 id → 分量（没有原型的对象：层的 id 叫 constructor、__proto__ 也不会读到原型上） */
export function heroInfoOf(s: HeroState, ids: readonly string[], follow: boolean): HeroInfo {
  const mix: Record<string, number> = Object.create(null)
  if (s.mix) ids.forEach((id, i) => (mix[id] = s.mix![i] ?? 0))
  return { id: s.hero >= 0 ? (ids[s.hero] ?? null) : null, follow, mix }
}
