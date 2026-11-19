// 视图状态：view 怎么拼出来，setView 按什么顺序恢复。顺序是有讲究的（见 applyView），
// 所以恢复写成对一个“目标”的一串调用：引擎是那个目标，测试里换成记账的假目标。

import type { ViewRegistry } from '../plugin.js'
import { layersOf, type Core } from './core.js'
import { heroInfoOf } from './hero.js'
import { arrange } from './layers.js'
import type { HeroInfo, LayerInfo, ShotName, ShotOptions, StrataView } from './types.js'

/** 选中的节点（id） */
export const selectedOf = (c: Core): string | null =>
  c.state.selected >= 0 && c.model ? (c.model.base.nodes[c.state.selected]?.id ?? null) : null
/** 强调的组（"grouping/group"） */
export const groupOf = (c: Core): string | null =>
  c.state.group >= 0 && c.model ? (c.model.data.groups[c.state.group]?.id ?? null) : null
/** 聚焦的层（id），只在一张图时有 */
export const focusOf = (c: Core): string | null =>
  c.state.focusLayer !== null && c.model ? (c.model.data.layers[c.state.focusLayer]?.id ?? null) : null

/** 现在的视图状态：核心的几项都用 id，插件登记的段（slots）并进来 */
export function readView(c: Core, slots: Record<string, unknown>): StrataView {
  const cam = c.renderer.rig.camera.position
  const tgt = c.renderer.rig.controls.target
  const core: StrataView = {
    heroMix: heroInfoOf(c.hero, layersOf(c).map((l) => l.id), c.follow).mix,
    follow: c.follow,
    hidden: c.hidden.list(layersOf(c)),
    expanded: c.expansion.expanded,
    selected: selectedOf(c),
    group: groupOf(c),
    focus: focusOf(c),
    spread: c.spread,
    camera: { position: [cam.x, cam.y, cam.z], target: [tgt.x, tgt.y, tgt.z] },
  }
  return Object.assign(core, slots)
}

/** 恢复视图时要用到的引擎的动作 */
export interface ViewTarget {
  /** 现在画的那张图的层（id） */
  layers(): readonly string[]
  /** 分不分主次（不止一张图） */
  hasHero(): boolean
  setFollow(on: boolean): void
  setSpread(s: number): void
  setExpanded(ids: string[]): void
  setLayerVisible(id: string, visible: boolean): void
  setHeroMix(mix: Record<string, number>): void
  /** 没给 heroMix 时也按现在的主次、层距重排一遍 */
  arrange(): void
  focusLayer(id: string | null): void
  highlightGroup(id: string | null): void
  /** 插件登记的那几段 */
  applySlots(view: Partial<StrataView>): void
  /** 恢复选中：照样发 select（source 'api'），但不跟随、不抢镜头 */
  restoreSelected(id: string | null): void
  /** 镜头直接跳到给的位置（用户“动过”镜头了） */
  flyTo(camera: StrataView['camera']): void
  /** 没给镜头：用户没动过镜头时重新取总览 */
  reframe(): void
  /** 收尾：发 hero、layers */
  done(): void
}

/**
 * 按这个顺序恢复：follow、spread、expanded、hidden（先显示再隐藏：不会中途把图全藏掉）、heroMix、focus（只在一张图时）、
 * group、插件的段（在选中之前：它们可能会清掉选中）、selected、camera
 */
export function applyView(view: Partial<StrataView>, t: ViewTarget) {
  const layers = t.layers()
  if (view.follow !== undefined) t.setFollow(view.follow)
  if (view.spread !== undefined) t.setSpread(view.spread)
  if (view.expanded !== undefined) t.setExpanded(view.expanded)
  if (view.hidden !== undefined) {
    const want = new Set(view.hidden)
    for (const id of layers) if (!want.has(id)) t.setLayerVisible(id, true)
    for (const id of layers) if (want.has(id)) t.setLayerVisible(id, false)
  }
  if (view.heroMix !== undefined) t.setHeroMix(view.heroMix)
  else t.arrange()
  if (view.focus !== undefined && !t.hasHero()) t.focusLayer(view.focus)
  if (view.group !== undefined) t.highlightGroup(view.group)
  t.applySlots(view)
  if (view.selected !== undefined) t.restoreSelected(view.selected)
  if (view.camera) t.flyTo(view.camera)
  else t.reframe()
  t.done()
}

/** 恢复视图要用到的 Strata 的公开方法 */
export interface ViewEngine {
  readonly hero: HeroInfo
  readonly layers: LayerInfo[]
  setExpanded(ids: Iterable<string>): void
  setLayerVisible(id: string, visible: boolean): unknown
  setHeroMix(mix: Record<string, number>): unknown
  focusLayer(id: string | null): void
  highlightGroup(id: string | null): void
  shot(name: ShotName, opts?: ShotOptions): void
}

/** 引擎当恢复的目标：restoreSelected 是引擎的“选中但不跟随” */
export function viewTargetOf(c: Core, e: ViewEngine, slots: ViewRegistry, restoreSelected: (id: string | null) => void): ViewTarget {
  return {
    layers: () => layersOf(c).map((l) => l.id),
    hasHero: () => c.hero.hero >= 0,
    setFollow: (on) => (c.follow = on),
    setSpread: (s) => (c.spread = s),
    setExpanded: (ids) => e.setExpanded(ids),
    setLayerVisible: (id, v) => void e.setLayerVisible(id, v),
    setHeroMix: (mix) => void e.setHeroMix(mix),
    arrange: () => arrange(c),
    focusLayer: (id) => e.focusLayer(id),
    highlightGroup: (id) => e.highlightGroup(id),
    applySlots: (view) => slots.apply(view as Record<string, unknown>),
    restoreSelected,
    flyTo: (cam) => {
      c.autoFrame = false
      c.pluginFramed = false
      c.renderer.rig.fly({ pos: cam.position, target: cam.target }, 0)
    },
    reframe: () => void (c.autoFrame && e.shot('overview', { duration: 0 })),
    done: () => {
      c.events.emit('hero', e.hero)
      c.events.emit('layers', e.layers)
    },
  }
}
