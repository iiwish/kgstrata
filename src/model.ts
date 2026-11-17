import { mixHex } from './color.js'
import { DARK, type Theme } from './theme.js'
import type { BaseEdge, BaseNode, LinkClass, NodeShape, PlacedNode, Resolved, ResolvedNode, StrataLayout } from './types.js'
import type { RendererBase } from './renderer/index.js'

export const DEFAULT_SHAPE: NodeShape = 'bead'

/**
 * 星等 0..5（0 最亮）。星空里极少数星很亮、绝大多数很暗：按名次分，前几个是 0 等，
 * 前十来个 1 等，再往后按分位落到 2、3、4 等。展开出来的子节点是 4 等：它们是细节，不抢父节点的戏。
 */
export function magnitudeOf(p: PlacedNode, count: number): number {
  if (p.depth > 0) return 4
  const imp = p.importance
  if (imp >= Math.max(0.9, 1 - 3.5 / count)) return 0
  if (imp >= Math.max(0.8, 1 - 10 / count)) return 1
  if (imp >= Math.max(0.4, 1 - 60 / count)) return 2
  return imp >= 0.15 ? 3 : 4
}

/** 数据 + 布局整理成渲染器和样式要用的索引 */
export interface Model {
  data: Resolved
  layout: StrataLayout
  base: { nodes: BaseNode[]; edges: BaseEdge[] }
  specs: ResolvedNode[]
  index: Map<string, number>
  /** 每个节点的邻居（所有边，含跨层） */
  adj: number[][]
  /** 每个节点关联的边 */
  incident: number[][]
  /** "s,t" → 边下标（两个方向都登记） */
  edgeAt: Map<string, number>
  /** 关系的类型（落地、外键……）；没写类型的是空串 */
  edgeTag: string[]
  /** 跨层的边是哪一种映射线；不是映射（或不是跨层）为 null */
  edgeClass: (LinkClass | null)[]
  groupColors: string[]
  /** 每个节点所在的全部对应块（夹在中间的层会同时在上下两个块里） */
  blocksOf: number[][]
  renderer: RendererBase
  /** 这张图用的主题：样式、路径、节点的本色都按它 */
  theme: Theme
}

export function buildModel(data: Resolved, layout: StrataLayout, theme: Theme = DARK): Model {
  const nodes: BaseNode[] = []
  const specs: ResolvedNode[] = []
  const index = new Map<string, number>()
  data.layers.forEach((layer, li) => {
    // 名次只在顶层节点里排：展开几张表不该让别的节点掉档
    const count = layer.nodes.filter((n) => n.parent === undefined).length
    for (const n of layer.nodes) {
      const p = layout.nodes.get(n.id)
      if (!p) continue
      index.set(n.id, nodes.length)
      nodes.push({ id: n.id, layer: li, shape: n.shape ?? DEFAULT_SHAPE, r: p.r, group: p.group, mono: !!n.mono, mag: magnitudeOf(p, count) })
      specs.push(n)
    }
  })
  const edges: BaseEdge[] = []
  const edgeTag: string[] = []
  const edgeClass: (LinkClass | null)[] = []
  const add = (s: string, t: string, kind: BaseEdge['kind'], tag: string, cls: LinkClass | null = null) => {
    const a = index.get(s)
    const b = index.get(t)
    if (a === undefined || b === undefined || a === b) return
    edges.push({ s: a, t: b, kind })
    edgeTag.push(tag)
    edgeClass.push(cls)
  }
  data.layers.forEach((layer) => {
    for (const n of layer.nodes) if (n.parent !== undefined) add(n.parent, n.id, 'contain', '')
    for (const e of layer.edges ?? []) add(e.source, e.target, 'intra', e.type ?? '')
  })
  for (const l of data.links) add(l.source, l.target, 'cross', l.type ?? '', layout.linkClass.get(l.id) ?? null)
  const adj: number[][] = nodes.map(() => [])
  const incident: number[][] = nodes.map(() => [])
  const edgeAt = new Map<string, number>()
  edges.forEach((e, i) => {
    adj[e.s].push(e.t)
    adj[e.t].push(e.s)
    incident[e.s].push(i)
    incident[e.t].push(i)
    edgeAt.set(`${e.s},${e.t}`, i)
    if (!edgeAt.has(`${e.t},${e.s}`)) edgeAt.set(`${e.t},${e.s}`, i)
  })
  const groupColors = data.groups.map((g) => g.color)
  const primary = Math.max(layout.primary, 0)
  const renderer: RendererBase = {
    nodes,
    edges,
    layers: data.layers.length,
    primary,
    plates: {
      primary,
      groups: data.groups.map((g, gi) => ({ color: g.color, name: g.name, angle: layout.groups[gi]?.angle ?? 0 })),
      plates: data.layers.map((layer, li) => {
        const members = nodes.filter((n) => n.layer === li)
        return {
          index: li,
          radius: layout.radii[li] ?? 12,
          name: layer.name,
          count: members.length,
          // 主图层偏冷，对齐过来的图偏暖
          tone: li !== primary ? theme.tone.aligned : theme.tone.primary,
          nodes: members.map((n) => {
            const p = layout.nodes.get(n.id)!
            return { x: p.x, z: p.z, group: n.group, weight: p.importance }
          }),
        }
      }),
    },
  }
  const blocksOf = nodes.map((n) => layout.nodes.get(n.id)?.blocks ?? [])
  return { data, layout, base: { nodes, edges }, specs, index, adj, incident, edgeAt, edgeTag, edgeClass, groupColors, blocksOf, renderer, theme }
}

/** 节点的本色：饱和的领域色，只往白里兑一点。没有领域的用中性的浅蓝灰 */
export function nodeColor(m: Model, i: number): string {
  const n = m.base.nodes[i]
  const gc = n.group >= 0 ? m.groupColors[n.group] : m.theme.ungrouped
  return mixHex(gc, '#ffffff', m.theme.starWhite)
}
