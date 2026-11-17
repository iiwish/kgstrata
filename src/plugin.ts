// 插件契约：核心 Strata 只管画一张多层的图；路径回放、看变化这些都是插件，用 strata.use(plugin) 装上。
//
// 插件分两种做法，可以兼有：
// - 叠加层（StrataOverlay）：在核心自己的样子上再叠一点东西。路径回放就是这种：交给样式一串要强调的节点，
//   再往 Looks 里写自己的线、序号、涟漪。
// - 模式（StrataMode）：接管这一帧画什么——换一张底子、自己产出 Looks。看变化就是这种。同一时刻最多一个模式接管，
//   交还以后回到核心的全景。
//
// 每一帧的 Looks 走固定的管线，写入方各管各的：
//   ① 基础样式：核心的 styler（带上叠加层给的强调串），或者接管的模式
//   ② 叠加层：按装的顺序 paint
//   ③ 核心的统一后处理：隐藏层的淡出（presence），全景和接管的模式都走这里
//
// 这个文件只放类型和两个小工具（事件、视图状态的登记），不引入渲染器，可以单独测。

import type { HoverInfo, HeroInfo, LayerInfo, StrataView } from './engine.js'
import { DEFAULT_LOCALE, message, StrataError, type Locale } from './locale.js'
import type { Model } from './model.js'
import type { RendererBase, StrataRenderer } from './renderer/index.js'
import type { Spotlight } from './styler.js'
import type { Theme } from './theme.js'
import type { Looks, Normalized, Resolved, StrataData, StrataLayout } from './types.js'

/** 插件：install 拿到核心给的能力，返回它自己的接口（strata.use 原样交回去，类型是全的） */
export interface StrataPlugin<Api> {
  /** 名字：同一个引擎上同名的插件只能装一个；模式、视图状态都记在这个名字下 */
  readonly name: string
  install(ctx: StrataContext): Api
}

/** 每一帧的时间 */
export interface FrameInfo {
  /** 引擎的时钟（秒），从引擎创建起累计 */
  time: number
  /** 这一帧走了多少秒（封顶 0.05） */
  dt: number
}

/** 叠加层：没有模式接管时，在核心的样子上叠东西 */
export interface StrataOverlay {
  /** ① 之前问一次：这一帧要强调的一串节点（交给核心的样式去压暗其余的）。没有就 null。几个叠加层都给时，后装的说了算 */
  spotlight?(): Spotlight | null
  /** ② 样式算完以后往上叠：改强调的节点的序号、名字，写 Looks.extra 里自己那一份 */
  paint?(looks: Looks, frame: FrameInfo): void
}

/** 模式：接管这一帧画什么 */
export interface StrataMode {
  /** 这张图的模型：层的列表、主次、悬停信息、镜头都按它 */
  readonly model: Model
  /** 交给渲染器的底子。节点和边可以和 model 的不一样（看变化时是两版的合集），下标和 looks 里的对齐 */
  readonly base: RendererBase
  /** ① 这一帧的样子 */
  looks(frame: FrameInfo): Looks
  /** 指针指着第 i 个节点（-1 = 没有） */
  hover?(i: number): void
  /** 点中第 i 个节点（-1 = 点在空白处） */
  select?(i: number): void
  /** 被核心收回了：换了数据，或者别的插件的模式接管。插件自己调 release 时不会收到 */
  released?(): void
}

/** takeOver 的回执 */
export interface ModeHandle {
  /** 还是不是它在接管 */
  readonly active: boolean
  /**
   * 交还给核心的全景。rebuild：全景按现在的展开状态重新生成（接管期间展开、收起过节点时要），选中清掉。
   * 已经不在接管了就什么也不做。
   */
  release(opts?: { rebuild?: boolean }): void
}

/** 核心的状态变了，通知插件：data 换了数据；model 全景的模型重建了（展开、收起）；hidden 隐藏的层变了；mode 有模式接管了 */
export type StrataChange = 'data' | 'model' | 'hidden' | 'mode'

/** 盘面上的一个点：第几层、盘面坐标。核心按层现在的高度和缩放换成世界坐标 */
export interface PlatePoint {
  layer: number
  x: number
  z: number
}

/** 视图状态里插件自己的那一段 */
export interface ViewSlot<V> {
  get(): V
  /** setView 里给了这一项（不是 undefined）才调 */
  set(value: V): void
}

/** 核心的公开事件 */
export interface StrataEvents {
  hover: HoverInfo | null
  select: HoverInfo | null
  /** 引擎的时钟（秒） */
  tick: number
  focus: string | null
  hero: HeroInfo
  layers: LayerInfo[]
  expand: string[]
  /** WebGL 上下文丢了：每帧的循环停下，等浏览器还回来（见 contextrestored） */
  contextlost: null
  /** 上下文还回来了：GPU 上的东西按现在的状态重新上传，循环接着跑 */
  contextrestored: null
}

/**
 * 核心给插件的能力。只有这些：核心的私有状态不往外给。
 * 层、节点用下标的地方，都是对“现在画的那张图”（current）说的。
 */
export interface StrataContext {
  /** 全景的模型；setData 之前是 null。有模式接管时它不变 */
  readonly model: Model | null
  /** 现在画的模型：有模式接管时是模式的，否则就是 model */
  readonly current: Model | null
  /** 现在接管的模式是哪个插件的（名字）；没有是 null */
  readonly mode: string | null
  readonly renderer: StrataRenderer
  /** 引擎的时钟（秒） */
  readonly time: number
  readonly reducedMotion: boolean
  /** 核心的语言（StrataOptions.locale，缺省 'en'）：插件给人看的字跟着它 */
  readonly locale: Locale
  /** 这个实例的主题（StrataOptions.theme 盖在 DARK 上的结果）：插件自己的模型、颜色按它 */
  readonly theme: Theme
  /** 引擎销毁了：异步回来的结果丢掉 */
  readonly disposed: boolean
  /** 隐藏的层（current 的层下标） */
  readonly hidden: ReadonlySet<number>
  /** 展开的节点（id，原样：包括数据里没有子节点的） */
  readonly expanded: ReadonlySet<string>
  /** 节点在全景里的下标；收在父节点里的算在父节点头上。没有是 -1 */
  indexOf(id: string): number
  /** 按引擎的选项（nodeStyles）整理一份数据，查出来的问题丢掉 */
  normalize(input: StrataData): Normalized
  /** 按引擎的规则布局：盘面的半径随节点数长，基准层按 anchor 选项 */
  layoutOf(data: Resolved): StrataLayout
  /** 接管：换上模式的底子，Looks 由它出。主角的分量按层的 id 对过去，隐藏的层照旧 */
  takeOver(mode: StrataMode): ModeHandle
  /** 全景按现在的展开状态重新生成，选中清掉；没有模式接管时顺带换上新的底子、重排 */
  rebuild(): void
  /** 加一个叠加层。返回撤掉它的函数 */
  overlay(layer: StrataOverlay): () => void
  /** 每帧在 ① 之前调 */
  onFrame(cb: (frame: FrameInfo) => void): () => void
  onChange(cb: (change: StrataChange) => void): () => void
  /** 展开、收起节点时先问插件：返回 true 表示这次由插件处理（比如看变化时重新比一遍），核心就不重建全景 */
  onExpand(cb: () => boolean | void): () => void
  onDispose(cb: () => void): () => void
  /** 在视图状态里登记一段（getView / setView 一并存取）。key 不能和核心的项、别的插件的重名 */
  registerView<V>(key: string, slot: ViewSlot<V>): void
  on<K extends keyof StrataEvents>(event: K, cb: (v: StrataEvents[K]) => void): () => void
  emit<K extends keyof StrataEvents>(event: K, v: StrataEvents[K]): void
  /**
   * 跟随：主角换到这一层（只在开着 followHero 时）。refit：换完以后镜头怎么办——
   * 'overview' 重新取总览（用户动过镜头就不动），'none' 不动，给函数就在主角真的换了时调它（插件自己重新取景）
   */
  followTo(layer: number, refit?: 'overview' | 'none' | (() => void)): void
  /** 只有一张图时聚焦了一层：放开（不动镜头） */
  releaseFocus(): void
  /** 选中一个节点（id），null 清掉 */
  select(id: string | null): void
  /** 镜头框住盘面上的这些点。层还在缓动时按目标高度、目标缩放算；叠看时先把层距放回去 */
  fit(points: PlatePoint[], opts: { elevation: number; margin: number }): void
}

// ─── 小工具 ──────────────────────────────────────────────────────────────────

/** 类型安全的事件：E 是“事件名 → 带的东西” */
export class Emitter<E> {
  private listeners = new Map<keyof E, Set<(v: never) => void>>()

  on<K extends keyof E>(event: K, cb: (v: E[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb as (v: never) => void)
    this.listeners.set(event, set)
    return () => void set.delete(cb as (v: never) => void)
  }

  emit<K extends keyof E>(event: K, v: E[K]) {
    this.listeners.get(event)?.forEach((cb) => (cb as (v: E[K]) => void)(v))
  }

  clear() {
    this.listeners.clear()
  }
}

/** 核心自己的视图状态的项：插件不能占 */
export const CORE_VIEW_KEYS: readonly (keyof StrataView)[] = ['hero', 'follow', 'hidden', 'expanded', 'selected', 'group', 'focus', 'spread', 'camera']

/** 插件登记的视图状态：getView 时一并读出来，setView 时按 key 分给各自的插件 */
export class ViewRegistry {
  private slots = new Map<string, ViewSlot<unknown>>()

  /** locale：登记冲突时报错用的语言 */
  constructor(private readonly locale: Locale = DEFAULT_LOCALE) {}

  register<V>(key: string, slot: ViewSlot<V>) {
    if ((CORE_VIEW_KEYS as readonly string[]).includes(key)) throw new StrataError('view-core-key', message(this.locale, 'error.view-core-key', { key }))
    if (this.slots.has(key)) throw new StrataError('view-key-taken', message(this.locale, 'error.view-key-taken', { key }))
    this.slots.set(key, slot as ViewSlot<unknown>)
  }

  /** 各插件现在的那一段 */
  read(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, slot] of this.slots) out[key] = slot.get()
    return out
  }

  /** 给了的项（不是 undefined）交给登记它的插件；没人登记的项不管 */
  apply(view: Record<string, unknown>) {
    for (const [key, slot] of this.slots) if (view[key] !== undefined) slot.set(view[key])
  }
}
