// 映射的审计：上层（本体）的每条关系在下层（物理表）走不走得通，下层的每条连接（外键）有没有上层的关系对应。
// 纯计算，不引入 three、kgdiff：headless 的一部分，Node、Worker 里都能跑。
//
// 规则（0.3 和用户定的）：
// - 全部收起来算：字段级的映射、外键先上卷到表（project 的结果），按表算。
// - 上层关系 A–B 走得通 = A 映射到的某张表和 B 映射到的某张表之间有一条由连接组成的路径；同一张表是 0 跳；
//   最多 maxHops 跳（默认 3）。连接不管方向。
// - 一条关系只给跳数最少的那一档，并列的最多 maxPaths 条（默认 3）：按两端映射的分量之和从大到小，再按表的 id 排，结果确定。
//   不拿更长的路径凑数：最短的有了，更长的多半是绕路（经过维表、经过别的业务对象）。
// - 路径中间的节点必须有上层映射（throughUnmapped 默认 false）：维表这类没建模的表不当桥，不然它会把缺口藏住。
// - 连接的覆盖分三档：direct（两端表映射到的上层节点之间有直接关系）/ via-path（只被某条关系给出的路径用到）/ unused。
// - 另报两类缺口：上层没映射到下层的节点、下层没有上层映射的节点。

import { DEFAULT_LOCALE, message, StrataError, type Locale } from '../locale.js'
import { normalize, project } from '../resolve.js'
import type { ResolvedEdge, StrataData } from '../types.js'

export interface AuditOptions {
  /** The upper layer's id (the ontology). Default: of the two adjacent layers with the most mappings between them, the upper one. */
  upper?: string
  /** The lower layer's id (the tables). Default: the layer below `upper`. */
  lower?: string
  /** Relation types in the lower layer that join two nodes (foreign keys). Default `['fk']`. */
  joinTypes?: readonly string[]
  /** Longest join path that still counts, in joins. Default 3; `0` only accepts both ends on the same node. */
  maxHops?: number
  /** Paths kept per upper relation: only those with the fewest joins, at most this many of them. Default 3. */
  maxPaths?: number
  /** Let paths pass through lower nodes that nothing in the upper layer maps onto (dimension tables and the like). Default `false`: such nodes would join unrelated tables and hide gaps. */
  throughUnmapped?: boolean
  /** Language of the error message for unknown layers. Default `'en'`. */
  locale?: Locale
}

/** One way to walk an upper relation in the lower layer. */
export interface JoinPath {
  /** Number of joins; 0 when both ends map onto the same lower node. */
  hops: number
  /** Lower nodes from the relation's `source` side to its `target` side (`hops + 1` of them). */
  nodes: string[]
  /** The joins walked, in order (`hops` of them): ids of lower-layer relations as `project(normalize(data))` has them (rolled up to the tables). */
  joins: string[]
  /** Mapping weight of the first node from `source` plus that of the last node from `target`. */
  weight: number
}

/** An upper-layer relation and how it is walked in the lower layer. */
export interface RelationAudit {
  /** The relation's id (rolled up when its ends were folded). */
  id: string
  source: string
  target: string
  type?: string
  /** `joined`: at least one path within `maxHops`; `unreachable`: both ends are mapped but no path is short enough; `unmapped`: an end has no mapping. */
  status: 'joined' | 'unreachable' | 'unmapped'
  /** The paths with the fewest joins (heaviest mappings first), at most `maxPaths`. Empty unless `joined`. */
  paths: JoinPath[]
  /** Lower nodes each end maps onto. */
  sourceNodes: string[]
  targetNodes: string[]
}

/** A join in the lower layer and whether the upper layer accounts for it. */
export interface JoinAudit {
  id: string
  source: string
  target: string
  type?: string
  /** `direct`: nodes mapped onto its two ends are related in the upper layer; `via-path`: only used by a reported path; `unused`: neither. */
  coverage: 'direct' | 'via-path' | 'unused'
  /** Upper relations whose ends map onto its two ends (`direct`). */
  direct: string[]
  /** Upper relations whose reported paths walk it. */
  usedBy: string[]
}

/** The result of `auditMappings`. */
export interface MappingAudit {
  upper: string
  lower: string
  /** The longest join path that counted (`AuditOptions.maxHops`). */
  maxHops: number
  /** Every relation of the upper layer (containment is not a relation). */
  relations: RelationAudit[]
  /** Every join of the lower layer (relations of a `joinTypes` type). */
  joins: JoinAudit[]
  /** Upper nodes mapped onto no lower node. */
  unmappedUpper: string[]
  /** Lower nodes no upper node maps onto. */
  unmappedLower: string[]
}

// 一层里的邻接：节点 → [邻居, 连接]
type Adjacency = Map<string, { to: string; edge: ResolvedEdge }[]>

/**
 * Audits the mappings between two layers: whether each upper relation can be walked through joins of the
 * lower layer, whether each join is accounted for by the upper layer, and which nodes have no mapping.
 * Works on everything collapsed (field-level mappings and joins count for their tables). Throws
 * `StrataError('audit-layers')` when the layers are unknown, the same, or there are fewer than two.
 */
export function auditMappings(data: StrataData, opts: AuditOptions = {}): MappingAudit {
  const locale = opts.locale ?? DEFAULT_LOCALE
  const joinTypes = new Set(opts.joinTypes ?? ['fk'])
  const maxHops = Math.max(0, Math.floor(opts.maxHops ?? 3))
  const maxPaths = Math.max(1, Math.floor(opts.maxPaths ?? 3))
  const throughUnmapped = opts.throughUnmapped ?? false
  const resolved = project(normalize(data).data, [])
  const ids = resolved.layers.map((l) => l.id)
  const layerOf = new Map<string, number>()
  resolved.layers.forEach((l, i) => l.nodes.forEach((n) => layerOf.set(n.id, i)))

  // 哪两层：给了就用；没给就挑相邻两层里映射最多的一对
  let u = opts.upper !== undefined ? ids.indexOf(opts.upper) : -1
  let d = opts.lower !== undefined ? ids.indexOf(opts.lower) : -1
  if (opts.upper === undefined && opts.lower === undefined) {
    let best = -1
    for (let i = 0; i + 1 < ids.length; i++) {
      const n = resolved.links.filter((k) => pairOf(layerOf, k.source, k.target, i, i + 1)).length
      if (n > best) [best, u, d] = [n, i, i + 1]
    }
  } else if (opts.lower === undefined && u >= 0) d = u + 1 < ids.length ? u + 1 : -1
  else if (opts.upper === undefined && d >= 0) u = d - 1
  if (u < 0 || d < 0 || u === d || d >= ids.length) {
    throw new StrataError('audit-layers', message(locale, 'error.audit-layers', { upper: opts.upper ?? '', lower: opts.lower ?? '' }))
  }

  // 映射：上层节点 → 下层节点和分量；下层节点 → 上层节点
  const down = new Map<string, Map<string, number>>()
  const up = new Map<string, Set<string>>()
  for (const k of resolved.links) {
    if (!pairOf(layerOf, k.source, k.target, u, d)) continue
    const [a, b] = layerOf.get(k.source) === u ? [k.source, k.target] : [k.target, k.source]
    const m = down.get(a) ?? new Map<string, number>()
    m.set(b, (m.get(b) ?? 0) + (k.weight ?? 1))
    down.set(a, m)
    const s = up.get(b) ?? new Set<string>()
    s.add(a)
    up.set(b, s)
  }

  // 下层的连接图（不分方向）
  const joinEdges = (resolved.layers[d].edges ?? []).filter((e) => e.type !== undefined && joinTypes.has(e.type))
  const adj: Adjacency = new Map()
  for (const e of joinEdges) {
    if (e.source === e.target) continue
    ;(adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push({ to: e.target, edge: e })
    ;(adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push({ to: e.source, edge: e })
  }

  const upperEdges = resolved.layers[u].edges ?? []
  const relations: RelationAudit[] = upperEdges.map((r) => {
    const from = down.get(r.source) ?? new Map<string, number>()
    const to = down.get(r.target) ?? new Map<string, number>()
    const audit: RelationAudit = {
      id: r.id,
      source: r.source,
      target: r.target,
      status: 'unmapped',
      paths: [],
      sourceNodes: [...from.keys()].sort(),
      targetNodes: [...to.keys()].sort(),
    }
    if (r.type !== undefined) audit.type = r.type
    if (!from.size || !to.size) return audit
    audit.paths = shortestPaths(adj, from, to, maxHops, maxPaths, throughUnmapped ? () => true : (n) => up.has(n))
    audit.status = audit.paths.length ? 'joined' : 'unreachable'
    return audit
  })

  // 连接的覆盖：两端表映射到的上层节点之间有没有直接关系；有没有被给出的路径用到
  const related = new Map<string, string[]>()
  for (const r of upperEdges) {
    for (const key of [`${r.source}\n${r.target}`, `${r.target}\n${r.source}`]) (related.get(key) ?? related.set(key, []).get(key)!).push(r.id)
  }
  const usedBy = new Map<string, Set<string>>()
  for (const r of relations) for (const p of r.paths) for (const j of p.joins) (usedBy.get(j) ?? usedBy.set(j, new Set()).get(j)!).add(r.id)
  const joins: JoinAudit[] = joinEdges.map((e) => {
    const direct = new Set<string>()
    for (const a of up.get(e.source) ?? []) for (const b of up.get(e.target) ?? []) for (const id of related.get(`${a}\n${b}`) ?? []) direct.add(id)
    const used = [...(usedBy.get(e.id) ?? [])].sort()
    const audit: JoinAudit = {
      id: e.id,
      source: e.source,
      target: e.target,
      coverage: direct.size ? 'direct' : used.length ? 'via-path' : 'unused',
      direct: [...direct].sort(),
      usedBy: used,
    }
    if (e.type !== undefined) audit.type = e.type
    return audit
  })

  return {
    upper: ids[u],
    lower: ids[d],
    maxHops,
    relations,
    joins,
    unmappedUpper: resolved.layers[u].nodes.filter((n) => !down.has(n.id)).map((n) => n.id),
    unmappedLower: resolved.layers[d].nodes.filter((n) => !up.has(n.id)).map((n) => n.id),
  }
}

/** 一条关系的两端是不是正好在这两层（不管哪端在上） */
function pairOf(layerOf: Map<string, number>, a: string, b: string, u: number, d: number): boolean {
  const la = layerOf.get(a)
  const lb = layerOf.get(b)
  return (la === u && lb === d) || (la === d && lb === u)
}

// 一层里最多列这么多条同样跳数的路径再排序：外键很密时不至于一下展开成几万条
const PER_LEVEL = 2000

/**
 * 从 from 的任一节点到 to 的任一节点、不超过 maxHops 跳的简单路径里，跳数最少的那一档，按分量取前 maxPaths 条。
 * bridge：中间的节点能不能走。先从 to 那边做一次广搜（只走能当桥的节点）得到每个节点离终点的距离，
 * 深搜时剪掉怎么走都超的分支；按跳数一层层找，找到的第一层就是答案。
 */
function shortestPaths(
  adj: Adjacency,
  from: Map<string, number>,
  to: Map<string, number>,
  maxHops: number,
  maxPaths: number,
  bridge: (n: string) => boolean,
): JoinPath[] {
  const dist = new Map<string, number>()
  let frontier = [...to.keys()]
  for (const n of frontier) dist.set(n, 0)
  for (let h = 1; h <= maxHops && frontier.length; h++) {
    const next: string[] = []
    for (const n of frontier) {
      // 从终点往回走：除了终点自己，经过的节点都得能当桥（起点也算：到这里就停，广搜再往外扩也没用）
      if (dist.get(n)! > 0 && !bridge(n)) continue
      for (const { to: m } of adj.get(n) ?? []) {
        if (dist.has(m)) continue
        dist.set(m, h)
        next.push(m)
      }
    }
    frontier = next
  }

  const out: JoinPath[] = []
  const starts = [...from.keys()].sort()
  for (let hops = 0; hops <= maxHops && !out.length; hops++) {
    const level: JoinPath[] = []
    const nodes: string[] = []
    const joins: string[] = []
    const onPath = new Set<string>()
    const walk = (n: string) => {
      if (level.length >= PER_LEVEL) return
      const left = hops - joins.length
      if ((dist.get(n) ?? Infinity) > left) return
      // 只要“从最后一个起点出发、到第一个终点为止”的路径：中途经过另一个起点或者已经到了终点的，有更短的那条
      if (joins.length > 0 && from.has(n)) return
      if (left > 0 && to.has(n)) return
      if (joins.length > 0 && left > 0 && !bridge(n)) return
      nodes.push(n)
      onPath.add(n)
      if (left === 0) {
        if (to.has(n)) level.push({ hops, nodes: [...nodes], joins: [...joins], weight: from.get(nodes[0])! + to.get(n)! })
      } else {
        for (const { to: m, edge } of adj.get(n) ?? []) {
          if (onPath.has(m)) continue
          joins.push(edge.id)
          walk(m)
          joins.pop()
        }
      }
      nodes.pop()
      onPath.delete(n)
    }
    for (const s of starts) walk(s)
    level.sort((a, b) => b.weight - a.weight || cmp(a.nodes.join('\n'), b.nodes.join('\n')) || cmp(a.joins.join('\n'), b.joins.join('\n')))
    out.push(...level.slice(0, maxPaths))
  }
  return out
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
