// 隐藏层，和每层摆在哪：隐藏的层按 id 记（换数据、进出模式时还认得），在不在场从 1 缓到 0；
// 主次的比例只拿可见的层去算，隐藏的层停在上下两个可见层中间淡出；穿透线在排版时按全景算一次。

import { bridgesOf, type Bridge } from '../bridge.js'
import { fadePresence } from '../pipeline.js'
import { stageOf, type Stage } from '../stage.js'
import type { BaseEdge, BaseNode, Looks } from '../types.js'
import { currentOf, hiddenOf, layersOf, type Core } from './core.js'
import type { LayerInfo } from './types.js'

type LayerRef = { readonly id: string }

export class HiddenLayers {
  readonly ids: Set<string>
  /** 每层在不在场 0..1（现在画的那张图的层）：隐藏时从 1 缓到 0 */
  presence: number[] = []

  constructor(initial: Iterable<string> = []) {
    this.ids = new Set(initial)
  }

  has(id: string) {
    return this.ids.has(id)
  }

  /** 这些层里隐藏的（下标） */
  indexes(layers: readonly LayerRef[]): Set<number> {
    const out = new Set<number>()
    layers.forEach((l, i) => this.ids.has(l.id) && out.add(i))
    return out
  }

  /** 这些层里隐藏的（id，按层的顺序）：数据里已经没有的层不算 */
  list(layers: readonly LayerRef[]): string[] {
    return [...this.ids].filter((id) => layers.some((l) => l.id === id))
  }

  /** 不能把图全藏了：全藏了就放出 keep 那一层 */
  keepOne(layers: readonly LayerRef[], keep: number) {
    if (layers.length > 0 && layers.every((l) => this.ids.has(l.id))) this.ids.delete(layers[Math.max(0, keep)].id)
  }

  /**
   * 显示或隐藏一层。unknown：没有这层；same：本来就是这样；last：它是最后一张可见的图，不能藏；changed：换了
   */
  set(layers: readonly LayerRef[], id: string, visible: boolean): 'unknown' | 'same' | 'last' | 'changed' {
    const i = layers.findIndex((l) => l.id === id)
    if (i < 0) return 'unknown'
    if (visible === !this.ids.has(id)) return 'same'
    if (!visible) {
      if (!layers.some((l, k) => k !== i && !this.ids.has(l.id))) return 'last'
      this.ids.add(id)
    } else this.ids.delete(id)
    return 'changed'
  }

  /** 在不在场直接按现在的隐藏状态摆好（换数据、进出模式时，不缓动） */
  resetPresence(layers: readonly LayerRef[]) {
    this.presence = layers.map((l) => (this.ids.has(l.id) ? 0 : 1))
  }

  /** ③ 隐藏的层：节点、关系、盘面一起淡出。返回穿透线该显出来多少（等隐藏的层淡下去了再显） */
  fade(looks: Looks, layers: readonly LayerRef[], layerOf: (i: number) => number, nodeCount: number, dt: number): number {
    if (this.presence.length !== layers.length) this.resetPresence(layers)
    const goals = layers.map((l) => (this.ids.has(l.id) ? 0 : 1))
    return fadePresence(looks, this.presence, goals, layerOf, nodeCount, dt)
  }
}

/**
 * 分主次时每层多大、多亮、隔多远：隐藏的层不占位置，只拿可见的层去 stageOf；
 * 隐藏的层淡出的时候停在上下两个可见层中间，大小跟小的那个
 */
export function stageFor(radii: readonly number[], hidden: ReadonlySet<number>, mix: readonly number[], secondaryScale: number, spread: number): Stage {
  const vis = radii.map((_, i) => i).filter((i) => !hidden.has(i))
  const sub = stageOf({ radii: vis.map((i) => radii[i]), mix: vis.map((i) => mix[i] ?? 0), secondaryScale, spread })
  const stage: Stage = { scales: radii.map(() => 1), levels: radii.map(() => 0), sides: radii.map(() => 1), heights: radii.map(() => 0), tightness: sub.tightness }
  vis.forEach((li, k) => {
    stage.scales[li] = sub.scales[k]
    stage.levels[li] = sub.levels[k]
    stage.sides[li] = sub.sides[k]
    stage.heights[li] = sub.heights[k]
  })
  for (const li of hidden) {
    const above = vis.filter((i) => i < li).pop()
    const below = vis.find((i) => i > li)
    const near = [above, below].filter((i): i is number => i !== undefined)
    if (near.length === 0) continue
    stage.heights[li] = near.reduce((a, i) => a + stage.heights[i], 0) / near.length
    stage.scales[li] = Math.min(...near.map((i) => stage.scales[i]))
  }
  return stage
}

/** 穿透：被隐藏的层隔开的节点之间的关系（只接跨层的线） */
export function bridgesFor(base: { nodes: readonly BaseNode[]; edges: readonly BaseEdge[] }, hidden: ReadonlySet<number>): Bridge[] {
  const cross = base.edges.filter((e) => e.kind === 'cross').map((e): [number, number] => [e.s, e.t])
  return bridgesOf(
    base.nodes.map((n) => n.layer),
    cross,
    hidden,
  )
}

/** 把层距、主次交给渲染器。叠看时所有层一样大、压在一起；不分主次时按聚焦的层 */
export function arrange(c: Core) {
  const m = currentOf(c)
  const mix = c.hero.mix
  if (c.overlay || !mix || !m) {
    c.state.stage = null
    c.state.bridges = c.overlay ? c.state.bridges : []
    c.renderer.setLayout(c.overlay ? null : c.state.focusLayer, c.overlay ? 0.03 : c.spread, null)
    return
  }
  const hidden = hiddenOf(c)
  const stage = stageFor(
    m.renderer.plates.plates.map((p) => p.radius),
    hidden,
    mix,
    c.secondaryScale,
    c.spread,
  )
  c.state.stage = stage
  c.renderer.setLayout(null, c.spread, stage)
  // 有模式接管时不画穿透线（那里的线归模式管）
  if (!c.active && c.model) c.state.bridges = bridgesFor(c.model.base, hidden)
}

/** 每一层现在显示还是隐藏，有几个顶层节点 */
export function layerInfos(c: Core): LayerInfo[] {
  return layersOf(c).map((l) => ({ id: l.id, name: l.name, visible: !c.hidden.has(l.id), count: l.nodes.reduce((n, x) => (x.parent === undefined ? n + 1 : n), 0) }))
}
