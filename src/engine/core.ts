// 引擎内部各块共用的那一份状态。只在 src/engine/ 里流转：Strata 的公开方法、插件的 ctx 都是包在它外面的一层，
// 使用者和插件都拿不到它。各块（主次、隐藏层、展开、取景、指针、视图状态、插件宿主）读写的是它的不同的几项。

import type { Locale, MessageOverrides } from '../locale.js'
import type { Model } from '../model.js'
import type { Emitter, StrataEvents, StrataMode } from '../plugin.js'
import type { StrataRenderer } from '../renderer/index.js'
import type { Styler, StyleState } from '../styler.js'
import type { Theme } from '../theme.js'
import type { Looks } from '../types.js'
import type { Expansion } from './expansion.js'
import type { HeroState } from './hero.js'
import type { HiddenLayers } from './layers.js'
import type { StrataOptions } from './types.js'

/** 正在接管的模式，和它是哪个插件的 */
export interface Active {
  mode: StrataMode
  owner: string
}

export interface Core {
  readonly renderer: StrataRenderer
  readonly events: Emitter<StrataEvents>
  readonly options: StrataOptions
  readonly hidden: HiddenLayers
  readonly expansion: Expansion
  readonly reducedMotion: boolean
  /** 核心的样式状态：悬停、选中、聚焦、主次的比例、穿透线……每帧交给 styler */
  state: StyleState
  /** 全景的模型；setData 之前是 null。有模式接管时它不变 */
  model: Model | null
  styler: Styler | null
  /** 正在接管的模式；null = 核心自己画全景 */
  active: Active | null
  /** 接管的模式里指着的节点（模式自己的下标） */
  modeHover: number
  hero: HeroState
  /** 主角是不是跟着你在问的东西走 */
  follow: boolean
  secondaryScale: number
  spread: number
  /** 正在叠看：层距收到了几乎为零 */
  overlay: boolean
  /** 还停在总览、用户没动过镜头：画布尺寸变了、层变了就重新取景 */
  autoFrame: boolean
  /** 镜头是插件框的（ctx.fit / fitPoints），之后用户没动过：插件交还镜头、模式交还时回到总览 */
  pluginFramed: boolean
  time: number
  /** 上一帧画的样子：指针拾取按它 */
  looks: Looks | null
  disposed: boolean
  locale: Locale
  messages: MessageOverrides
  theme: Theme
}

/** 现在画的模型：有模式接管时是模式的 */
export const currentOf = (c: Core): Model | null => c.active?.mode.model ?? c.model

/** 现在画的那张图的层 */
export const layersOf = (c: Core) => currentOf(c)?.data.layers ?? []

/** 现在画的那张图里隐藏的层（下标） */
export const hiddenOf = (c: Core): Set<number> => c.hidden.indexes(layersOf(c))

/** 层的 id 在现在画的那张图里的下标；没有是 -1 */
export const layerIndex = (c: Core, id: string | null | undefined): number => (id == null ? -1 : layersOf(c).findIndex((l) => l.id === id))

/** 节点现在在全景里的下标；收在父节点里的算在父节点头上。没有就是 -1 */
export function indexOf(c: Core, id: string | null | undefined, m: Model | null = c.model): number {
  if (!id || !m) return -1
  return m.index.get(id) ?? m.index.get(m.data.folded?.[id] ?? '') ?? -1
}

export function emit<K extends keyof StrataEvents>(c: Core, event: K, v: StrataEvents[K]) {
  c.events.emit(event, v)
}
