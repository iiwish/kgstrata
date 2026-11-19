// 主次的动作：把 hero.ts 的状态机接到排版、取景和 hero 事件上。

import { emit, hiddenOf, layerIndex, layersOf, type Core } from './core.js'
import { adoptMix, heroInfoOf, shouldFollow, switchHero } from './hero.js'
import { arrange } from './layers.js'
import { camera } from './shots.js'
import type { HeroInfo } from './types.js'

/** 换完主角以后镜头怎么办：总览重新取景 / 不动 / 主角真的换了就调这个函数（插件自己重新取景） */
export type Refit = 'overview' | 'none' | (() => void)

/** 现在谁是主角（对外的样子） */
export const heroNow = (c: Core): HeroInfo =>
  heroInfoOf(
    c.hero,
    layersOf(c).map((l) => l.id),
    c.follow,
  )

/** 第 i 层独当主角。叠看着也算变了：层要放回去 */
export function switchTo(c: Core, i: number, refit: Refit) {
  if (c.hero.hero < 0 || i < 0) return
  const next = switchHero(c.hero, i)
  const changed = next.changed || c.overlay
  c.hero = next.state
  c.overlay = false
  arrange(c)
  if (refit === 'overview') {
    if (!c.disposed) camera(c, 'overview', 1.3)
  } else if (typeof refit === 'function' && changed) refit()
  if (changed) emit(c, 'hero', heroNow(c))
}

/** 跟随：主角换到这一层（只在开着跟随时）。用户动过镜头就只换大小，不抢镜头 */
export function followTo(c: Core, layer: number, refit: Refit) {
  if (!c.follow || !shouldFollow(c.hero, layer, hiddenOf(c))) return
  switchTo(c, layer, refit === 'overview' && !c.autoFrame ? 'none' : refit)
}

/** 指定主角（层的 id），它也成为主角的“家”。不认得的层、隐藏的层不换 */
export function heroTo(c: Core, layer: string) {
  if (c.hero.hero < 0) return
  const i = layerIndex(c, layer)
  if (i < 0 || c.hidden.has(layer)) return
  c.hero = { ...c.hero, home: i }
  switchTo(c, i, 'overview')
}

/** 连续的主次。用户没动过镜头时跟着重新取景；拖着连续变的时候用短的飞行，一路跟上 */
export function mixTo(c: Core, mix: Readonly<Record<string, number>>) {
  if (c.hero.hero < 0 || !c.hero.mix) return
  c.hero = adoptMix(
    c.hero,
    layersOf(c).map((l) => l.id),
    mix,
    hiddenOf(c),
  )
  c.overlay = false
  arrange(c)
  if (c.autoFrame) camera(c, 'overview', 0.35)
  emit(c, 'hero', heroNow(c))
}
