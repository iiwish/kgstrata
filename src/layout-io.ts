// 布局的存取：StrataLayout ↔ JSON（两张 Map 换成数组），以及注入的布局能不能用。
// 纯数据，不引入 three、d3：headless 里算好、存到服务端的布局，拿回来直接交给 StrataOptions.layout。

import { message, type Locale, type MessageOverrides } from './locale.js'
import type { DataIssue, LinkClass, PlacedNode, Resolved, StrataLayout, StrataLayoutJSON } from './types.js'

/** A layout as a value `JSON.stringify` can write. Map order is kept. */
export function layoutToJSON(layout: StrataLayout): StrataLayoutJSON {
  return {
    format: 1,
    nodes: [...layout.nodes.values()].map((n) => ({ ...n, blocks: [...n.blocks] })),
    radii: [...layout.radii],
    groups: layout.groups.map((g) => ({ ...g, centroid: [g.centroid[0], g.centroid[1]] })),
    anchor: layout.anchor,
    blocks: layout.blocks.map((b) => ({ ...b, anchors: [...b.anchors], aligned: [...b.aligned], center: [b.center[0], b.center[1]] })),
    linkClass: [...layout.linkClass.entries()],
  }
}

const LINK_CLASSES: readonly LinkClass[] = ['primary', 'inner', 'outer']
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Reads a layout back from JSON (`JSON.parse` of it, or `layoutToJSON`'s result). Throws `TypeError` on a wrong shape; whether every node is placed is checked by `setData` (see `checkLayout`). */
export function layoutFromJSON(json: unknown): StrataLayout {
  const j = json as Partial<StrataLayoutJSON> | null
  if (!j || typeof j !== 'object' || j.format !== 1) throw new TypeError('kgstrata: not a layout written by layoutToJSON (format 1)')
  if (!Array.isArray(j.nodes) || !Array.isArray(j.radii) || !Array.isArray(j.groups) || !Array.isArray(j.blocks) || !Array.isArray(j.linkClass) || !isNum(j.anchor))
    throw new TypeError('kgstrata: layout JSON is missing nodes, radii, groups, blocks, linkClass or anchor')
  const nodes = new Map<string, PlacedNode>()
  for (const n of j.nodes) {
    if (!n || typeof n.id !== 'string' || !isNum(n.layer) || !isNum(n.x) || !isNum(n.z) || !isNum(n.r)) throw new TypeError('kgstrata: layout JSON has a node without id, layer, x, z or r')
    nodes.set(n.id, { ...n, blocks: Array.isArray(n.blocks) ? [...n.blocks] : [] })
  }
  const linkClass = new Map<string, LinkClass>()
  for (const pair of j.linkClass) {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && LINK_CLASSES.includes(pair[1])) linkClass.set(pair[0], pair[1])
  }
  return {
    nodes,
    radii: j.radii.map(Number),
    groups: j.groups.map((g) => ({ ...g, centroid: [g.centroid[0], g.centroid[1]] })),
    anchor: j.anchor,
    blocks: j.blocks.map((b) => ({ ...b, anchors: [...b.anchors], aligned: [...b.aligned], center: [b.center[0], b.center[1]] })),
    linkClass,
  }
}

/** Whether an injected layout fits this graph: a plate radius per layer and a position on its own layer for every node. Returns `null` when it fits, otherwise a `warning` (`code: 'layout-incomplete'`). */
export function checkLayout(data: Resolved, layout: StrataLayout | null | undefined, locale?: Locale, overrides?: MessageOverrides): DataIssue | null {
  const missing: string[] = []
  const okShape = !!layout && layout.nodes instanceof Map && Array.isArray(layout.radii) && layout.radii.length === data.layers.length && layout.linkClass instanceof Map
  data.layers.forEach((l, li) => {
    for (const n of l.nodes) {
      const p = okShape ? layout!.nodes.get(n.id) : undefined
      if (!p || p.layer !== li || !isNum(p.x) || !isNum(p.z) || !isNum(p.r)) missing.push(n.id)
    }
  })
  if (okShape && missing.length === 0) return null
  return {
    level: 'warning',
    code: 'layout-incomplete',
    message: message(locale, 'issue.layout-incomplete', { count: missing.length, node: missing[0] ?? '-' }, overrides),
    ...(missing[0] !== undefined ? { id: missing[0] } : {}),
  }
}
