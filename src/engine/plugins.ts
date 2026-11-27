// 插件宿主：装插件、给每个插件一份 ctx、模式的接管和交还、叠加层，以及每帧的管线（① 基础样式 → ② 叠加层 → ③ 隐藏层淡出）。
// 插件只通过 ctx 碰核心；ctx 里要用 id 的地方在这里换成下标。

import { StrataError, type MessageKey } from '../locale.js'
import { composeFrame, spotlightOf } from '../pipeline.js'
import { ViewRegistry, type FrameInfo, type ModeHandle, type StrataChange, type StrataContext, type StrataMode, type StrataOverlay, type StrataPlugin } from '../plugin.js'
import { normalize } from '../resolve.js'
import type { Looks, StrataData } from '../types.js'
import { currentOf, emit, hiddenOf, indexOf, layerIndex, type Active, type Core } from './core.js'
import { layoutOf, normalizeOptions, rebuildModel } from './expansion.js'
import { carryOver, yieldHero } from './hero.js'
import { arrange, layerInfos } from './layers.js'
import { fitPoints, nodePoints, releaseCamera } from './shots.js'

/** 宿主要用到的引擎的动作（它们还要跟随、发事件，归引擎管） */
export interface HostActions {
  select(id: string | null): void
  followTo(layer: number, refit: 'overview' | 'none' | (() => void)): void
  text(key: MessageKey, vars?: Record<string, string | number>): string
  /** setData 最后一次给的数据，原样 */
  data(): StrataData | null
}

const hook = <T>(set: Set<T>, cb: T) => {
  set.add(cb)
  return () => void set.delete(cb)
}

export class PluginHost {
  private plugins = new Map<string, unknown>()
  private overlays: StrataOverlay[] = []
  private frameHooks = new Set<(frame: FrameInfo) => void>()
  private changeHooks = new Set<(change: StrataChange) => void>()
  private expandHooks = new Set<() => boolean | void>()
  private disposeHooks = new Set<() => void>()
  private frameInfo: FrameInfo = { time: 0, dt: 0 }
  readonly views: ViewRegistry

  constructor(
    private readonly c: Core,
    private readonly actions: HostActions,
  ) {
    this.views = new ViewRegistry(() => c.locale)
  }

  /** 装一个插件，返回它的接口。同名的插件只能装一个 */
  use<Api>(plugin: StrataPlugin<Api>): Api {
    // 销毁以后不抛：同名的交回原来那个；没装过的照样装（它拿到的 ctx 是 disposed 的，各个能力都不做事）
    if (this.c.disposed && this.plugins.has(plugin.name)) return this.plugins.get(plugin.name) as Api
    if (this.plugins.has(plugin.name)) throw new StrataError('plugin-installed', this.actions.text('error.plugin-installed', { name: plugin.name }))
    const api = plugin.install(this.contextFor(plugin.name))
    this.plugins.set(plugin.name, api)
    return api
  }

  notify(change: StrataChange) {
    for (const cb of this.changeHooks) cb(change)
  }

  /** 展开、收起时先问插件：有一个说“我来”，核心就不重建全景 */
  claimExpand(): boolean {
    return [...this.expandHooks].some((cb) => cb() === true)
  }

  /** 换了数据：接管的模式作废（告诉它被收回了），插件挂在旧数据上的东西也作废 */
  dropMode() {
    const was = this.c.active
    this.c.active = null
    was?.mode.released?.()
    this.notify('data')
  }

  /** 模式接管：换底子、层全部放开、主角的分量按层的 id 对过去 */
  takeOver(owner: string, mode: StrataMode): ModeHandle {
    const c = this.c
    // 销毁以后：不接管，回执一直是不在接管
    if (c.disposed) return { active: false, release: () => {} }
    const prev = c.active
    const entry: Active = { mode, owner }
    c.active = entry
    // 同一个插件换一个新的模式（比如展开以后重新比了一遍）不算被收回
    if (prev && prev.owner !== owner) prev.mode.released?.()
    c.modeHover = -1
    c.renderer.setBase(mode.base)
    // 接管时层全部展开：聚焦状态同步清掉（清掉了才发 focus），悬停也清掉
    const focused = c.state.focusLayer !== null
    c.state.focusLayer = null
    c.state.hover = -1
    if (focused) emit(c, 'focus', null)
    emit(c, 'hover', null)
    c.overlay = false
    if (c.hero.mix && c.model) {
      const ids = (m: typeof c.model) => m.data.layers.map((l) => l.id)
      c.hero = carryOver(c.hero, ids(c.model), ids(mode.model), mode.model.layout.anchor, hiddenOf(c))
    }
    c.hidden.resetPresence(mode.model.data.layers)
    this.notify('mode')
    arrange(c)
    emit(c, 'layers', layerInfos(c))
    return {
      get active() {
        return c.active === entry
      },
      release: (opts) => {
        if (c.active !== entry) return
        c.state.hover = -1
        emit(c, 'hover', null)
        c.active = null
        this.restore(!!opts?.rebuild)
      },
    }
  }

  /**
   * 回到核心的全景（不重新布局）。rebuild：按现在的展开状态重新生成全景，选中清掉。
   * 模式在画的时候展开、收起过（c.stale），不管是哪个模式交还的，都要重建
   */
  restore(rebuild: boolean) {
    const c = this.c
    if (c.disposed || !c.model) return
    if (rebuild || c.stale) {
      rebuildModel(c)
      c.state.selected = -1
    }
    if (c.active) return
    c.renderer.setBase(c.model.renderer)
    c.hidden.resetPresence(c.model.data.layers)
    c.hero = yieldHero(c.hero, hiddenOf(c))
    arrange(c)
    // 层的高度、大小换回全景的：镜头还在总览或者是模式框的，就跟着回到总览
    releaseCamera(c)
    emit(c, 'layers', layerInfos(c))
  }

  /** 一帧：先给插件的帧钩子，再走管线。返回这一帧的样子；没东西可画（或者钩子里销毁了引擎）是 null */
  frame(dt: number): Looks | null {
    const c = this.c
    const frame = this.frameInfo
    frame.time = c.time
    frame.dt = dt
    for (const cb of this.frameHooks) cb(frame)
    if (c.disposed) return null
    const active = c.active
    return composeFrame(
      // ① 接管的模式，或者核心的样式（带上叠加层要强调的串）
      () => {
        if (active) return active.mode.looks(frame)
        if (!c.styler) return null
        c.state.time = c.time
        c.state.spot = spotlightOf(this.overlays)
        return c.styler.resolve(c.state)
      },
      // ② 叠加层只叠在核心的全景上
      this.overlays,
      frame,
      // ③ 隐藏的层淡出（全景和接管的模式都走这里）；穿透线等隐藏的层淡下去了再显出来
      (looks) => {
        const m = currentOf(c)
        if (!m) return
        const nodes = (c.active?.mode.base ?? m.base).nodes
        c.state.bridgeIn = c.hidden.fade(looks, m.data.layers, (i) => nodes[i].layer, nodes.length, dt)
      },
      !active,
    )
  }

  /** 销毁：接管着的模式先收回（插件把自己的状态清掉、发 exit），再跑插件的销毁钩子 */
  dispose() {
    const was = this.c.active
    this.c.active = null
    was?.mode.released?.()
    for (const cb of this.disposeHooks) cb()
  }

  private contextFor(name: string): StrataContext {
    const c = this.c
    const a = this.actions
    return {
      get data() {
        return a.data()
      },
      get model() {
        return c.model
      },
      get current() {
        return currentOf(c)
      },
      get mode() {
        return c.active?.owner ?? null
      },
      renderer: c.renderer,
      get time() {
        return c.time
      },
      reducedMotion: c.reducedMotion,
      get locale() {
        return c.locale
      },
      get theme() {
        return c.theme
      },
      text: (key, vars) => a.text(key, vars),
      get disposed() {
        return c.disposed
      },
      get hidden() {
        return hiddenOf(c)
      },
      get expanded() {
        return c.expansion.ids
      },
      indexOf: (id) => indexOf(c, id),
      normalize: (input) => normalize(input, normalizeOptions(c)).data,
      layoutOf: (data) => layoutOf(c, data),
      takeOver: (mode) => this.takeOver(name, mode),
      rebuild: () => this.restore(true),
      overlay: (layer) => {
        this.overlays.push(layer)
        return () => {
          const k = this.overlays.indexOf(layer)
          if (k >= 0) this.overlays.splice(k, 1)
        }
      },
      onFrame: (cb) => hook(this.frameHooks, cb),
      onChange: (cb) => hook(this.changeHooks, cb),
      onExpand: (cb) => hook(this.expandHooks, cb),
      onDispose: (cb) => hook(this.disposeHooks, cb),
      registerView: (key, slot) => this.views.register(key, slot),
      on: (event, cb) => c.events.on(event, cb),
      followTo: (layer, refit = 'none') => {
        const i = layerIndex(c, layer)
        if (i >= 0) a.followTo(i, refit)
      },
      releaseFocus: () => {
        if (c.state.focusLayer === null) return
        c.state.focusLayer = null
        arrange(c)
        emit(c, 'focus', null)
      },
      select: (id) => a.select(id),
      fit: (nodes, opts) => {
        const m = currentOf(c)
        if (m) fitPoints(c, nodePoints(m, nodes, (id) => indexOf(c, id, m)), opts)
      },
      fitPoints: (points, opts) => fitPoints(c, points, opts),
      releaseCamera: (opts) => releaseCamera(c, opts?.duration),
    }
  }
}
