import { describe, expect, it } from 'vitest'
import { ATTR, HIERARCHY_PREDICATE, buildStrataDiff, createDiffLooks, toKgdiffGraph, type DiffFrameState, type StrataDiff } from '../src/diff'
import { applyQuiet, quietOf } from '../src/diff'
import { normalize, project } from '../src/resolve'
import type { Looks, PlacedNode, Resolved, ResolvedEdge, ResolvedLayer, ResolvedLink, StrataData, StrataLayout } from '../src/types'

// 手写样例不写关系的 id：finish 按“起点|类型|终点”补上
type Draft = Omit<Resolved, 'layers' | 'links'> & {
  layers: (Omit<ResolvedLayer, 'edges'> & { edges?: Omit<ResolvedEdge, 'id'>[] })[]
  links: Omit<ResolvedLink, 'id'>[]
}
function finish(d: Draft): Resolved {
  return {
    ...d,
    layers: d.layers.map((l) => ({ ...l, edges: (l.edges ?? []).map((e) => ({ id: `${e.source}|${e.label ?? ''}|${e.target}`, ...e })) })),
    links: d.links.map((k) => ({ id: `${k.source}|${k.type ?? ''}|${k.target}`, ...k })),
  }
}

const groups = [
  { id: 'fin', name: '财务', color: '#60a5fa' },
  { id: 'sales', name: '销售', color: '#f472b6' },
]

// 前一版：目录（节点之间是包含关系，都展开着）+ 本体图
const beforeDraft: Draft = {
  groups,
  layers: [
    {
      id: 'catalog', name: '目录',
      nodes: [
        { id: 'c-root', label: '全部' },
        { id: 'c-fin', label: '财务', parent: 'c-root', group: 'fin' },
        { id: 'c-sales', label: '销售', parent: 'c-root', group: 'sales' },
      ],
    },
    {
      id: 'onto', name: '本体',
      nodes: [
        { id: 'customer', label: '客户', group: 'sales' },
        { id: 'party', label: '客户主体', group: 'sales' },
        { id: 'order', label: '订单', group: 'sales' },
        { id: 'invoice', label: '发票', group: 'fin' },
        { id: 'refund', label: '退货', group: 'sales' },
        { id: 'product', label: '产品', group: 'sales' },
      ],
      edges: [
        { source: 'order', target: 'customer', label: '下单' },
        { source: 'party', target: 'order', label: '持有' },
        { source: 'invoice', target: 'order', label: '对应' },
        { source: 'product', target: 'order', label: '包含' },
        { source: 'refund', target: 'order', label: '退回' },
      ],
    },
  ],
  links: [
    { source: 'customer', target: 'c-sales', type: '归属' },
    { source: 'party', target: 'c-sales', type: '归属' },
    { source: 'order', target: 'c-sales', type: '归属' },
    { source: 'invoice', target: 'c-fin', type: '归属' },
    { source: 'refund', target: 'c-sales', type: '归属' },
    { source: 'product', target: 'c-sales', type: '归属' },
  ],
}

// 后一版：客户吸收客户主体、订单改名、退货删除、合同新增、发票换目录、包含边改向
const afterDraft: Draft = {
  groups,
  layers: [
    beforeDraft.layers[0],
    {
      id: 'onto', name: '本体',
      nodes: [
        { id: 'customer', label: '客户', group: 'sales' },
        { id: 'order', label: '销售订单', group: 'sales' },
        { id: 'invoice', label: '发票', group: 'fin' },
        { id: 'product', label: '产品', group: 'sales' },
        { id: 'contract', label: '合同', group: 'sales', mono: true },
      ],
      edges: [
        { source: 'order', target: 'customer', label: '下单' },
        { source: 'invoice', target: 'order', label: '对应' },
        { source: 'order', target: 'product', label: '包含' },
        { source: 'contract', target: 'customer', label: '签署' },
      ],
    },
  ],
  links: [
    { source: 'customer', target: 'c-sales', type: '归属' },
    { source: 'order', target: 'c-sales', type: '归属' },
    { source: 'invoice', target: 'c-sales', type: '归属' },
    { source: 'product', target: 'c-sales', type: '归属' },
    { source: 'contract', target: 'c-fin', type: '归属' },
  ],
}

const before = finish(beforeDraft)
const after = finish(afterDraft)

// 手造的合集布局：0 层目录，1 层本体
function placed(id: string, layer: number, x: number, z: number, group: number, depth = 0): PlacedNode {
  return { id, layer, x, z, r: layer === 0 ? 0.8 : 1.1, group, depth, degree: 2, importance: 0.5, blocks: [] }
}
const layout: StrataLayout = {
  nodes: new Map(
    [
      placed('c-root', 0, 0, 0, -1, 0),
      placed('c-fin', 0, -8, 4, 0, 1),
      placed('c-sales', 0, 8, 4, 1, 1),
      placed('customer', 1, 10, 0, 1),
      placed('party', 1, 16, 8, 1),
      placed('order', 1, 4, -6, 1),
      placed('invoice', 1, -10, -4, 0),
      placed('refund', 1, 6, 12, 1),
      placed('product', 1, 0, 10, 1),
      placed('contract', 1, -4, 8, 1),
    ].map((p) => [p.id, p]),
  ),
  radii: [14, 26],
  groups: [],
  anchor: 1,
  blocks: [],
  linkClass: new Map(),
}

const view = (p: Partial<DiffFrameState>): DiffFrameState => ({
  layer: 'union', t: 0, selectedHunk: null, hoveredNode: -1, selectedNode: -1, reducedMotion: false, emphasis: 1, ...p,
})

function noNaN(l: Looks) {
  for (const n of l.nodes) for (const v of [n.x, n.z, n.lift, n.scale, n.intensity, n.alpha, n.pulse]) expect(Number.isFinite(v)).toBe(true)
  for (const e of [...l.edges, ...l.extra.marks]) {
    if (!e.visible) continue
    for (const v of [e.a.x, e.a.z, e.a.lift, e.b.x, e.b.z, e.b.lift, e.arc, e.alpha, e.width, e.progress, e.phase]) expect(Number.isFinite(v)).toBe(true)
  }
  for (const r of l.ripples) expect(Number.isFinite(r.p)).toBe(true)
}

describe('buildStrataDiff / createDiffLooks', async () => {
  // 合并不写在节点上，单独告诉它：客户吸收了 party
  const d: StrataDiff = await buildStrataDiff(before, after, layout, { replaces: { customer: ['party'] } })
  const idx = (id: string) => d.base.nodes.findIndex((n) => n.id === id)
  const contract = idx('contract'), party = idx('party'), refund = idx('refund')
  const looks = createDiffLooks(d)

  it('认出各类变化', () => {
    const kinds = new Set(d.hunks.map((h) => h.kind))
    for (const k of ['add', 'remove', 'modify', 'merge']) expect(kinds).toContain(k)
    // 改向的边：单独成 relations，或并进挪位置的 modify
    expect(kinds.has('relations') || d.hunks.some((h) => h.family === 'structure')).toBe(true)
    for (const h of d.hunks) {
      expect(h.end).toBeGreaterThanOrEqual(h.start)
      expect(h.nodes.length).toBeGreaterThan(0)
      expect(Number.isFinite(h.radius)).toBe(true)
    }
    expect(d.duration).toBeGreaterThan(0)
  })

  it('base 与 scene 对齐', () => {
    expect(d.base.nodes.length).toBe(d.scene.nodes.length)
    expect(d.base.edges.length).toBe(d.scene.edges.length)
    expect(d.base.nodes[contract]).toMatchObject({ layer: 1, shape: 'bead', mono: true, group: 1 })
    expect(d.base.nodes[idx('c-fin')].shape).toBe('bead')
    const kinds = new Set(d.base.edges.map((e) => e.kind))
    expect(kinds).toEqual(new Set(['contain', 'cross', 'intra']))
  })

  it('union 视图', () => {
    const l = looks.resolve(view({ layer: 'union' }))
    expect(l.nodes.length).toBe(d.base.nodes.length)
    expect(l.edges.length).toBeGreaterThanOrEqual(d.base.edges.length)
    expect(l.nodes[contract].color.toUpperCase()).toBe('#34D399')
    expect(l.nodes[refund].ghost).toBe(true)
    expect(l.nodes[refund].lift).toBe(0)
    expect(l.layers).toEqual([1, 1])
    noNaN(l)
  })

  it('回放：开头、合并途中、结尾', () => {
    const start = looks.resolve(view({ layer: 'replay', t: 0 }))
    const c0 = start.nodes[contract]
    expect(!c0.visible || c0.scale < 0.05).toBe(true)
    expect(c0.lift).toBeLessThan(0)

    // 扫一遍时间轴：合并来源某一刻在空中，全程无 NaN
    const out = looks.resolve(view({ layer: 'replay', t: 0 }))
    let maxLift = 0
    let sank = false
    for (let t = 0; t <= d.duration; t += 16) {
      const l = looks.resolve(view({ layer: 'replay', t }), out)
      expect(l).toBe(out)
      expect(l.nodes.length).toBe(d.base.nodes.length)
      noNaN(l)
      maxLift = Math.max(maxLift, l.nodes[party].lift)
      if (l.nodes[refund].lift < 0) sank = true
    }
    expect(maxLift).toBeGreaterThan(0)
    expect(sank).toBe(true)

    const end = looks.resolve(view({ layer: 'replay', t: d.duration }), out)
    expect(end.nodes[party].visible).toBe(false)
    expect(end.nodes[contract].visible).toBe(true)
    expect(Math.abs(end.nodes[contract].scale - 1)).toBeLessThan(0.02)
    expect(end.nodes[contract].lift).toBeCloseTo(0, 3)
  })

  it('合并箭头的两端跟着两端节点的层和抬升', () => {
    const customer = idx('customer')
    let seen = false
    for (let t = 0; t <= d.duration; t += 16) {
      const l = looks.resolve(view({ layer: 'replay', t }))
      for (const m of l.extra.marks) {
        if (!m.visible) continue
        expect([0, 1]).toContain(m.a.layer)
        expect([0, 1]).toContain(m.b.layer)
        if (l.nodes[party].lift > 0 && m.a.lift === l.nodes[party].lift) {
          expect(m.a.layer).toBe(d.base.nodes[party].layer)
          expect(m.b.lift).toBe(l.nodes[customer].lift)
          seen = true
        }
      }
    }
    expect(seen).toBe(true)
  })

  it('选中 hunk 时压暗无关的层', () => {
    const merge = d.hunks.find((h) => h.kind === 'merge')!
    const l = looks.resolve(view({ layer: 'union', selectedHunk: merge.id }))
    const touched = new Set([...merge.nodes, ...merge.context].map((id) => d.base.nodes[idx(id)].layer))
    for (let i = 0; i < l.layers.length; i++) expect(l.layers[i]).toBe(touched.has(i) ? 1 : 0.55)
    expect(l.nodes[party].intensity).toBeCloseTo(1.35 * 1.15)
  })

  it('减弱动效时不抬升', () => {
    for (let t = 0; t <= d.duration; t += 50) {
      const l = looks.resolve(view({ layer: 'replay', t, reducedMotion: true }))
      for (const n of l.nodes) expect(n.lift).toBe(0)
    }
  })

  it('背景安静：没变的节点不出名字（指着的照出），没变的边压暗、跨层的几乎看不见', () => {
    const q = quietOf(d, layout)
    const raw = structuredClone(looks.resolve(view({ layer: 'union', hoveredNode: refund })))
    const quiet = looks.resolve(view({ layer: 'union', hoveredNode: refund }))
    applyQuiet(quiet, q, refund)
    for (let i = 0; i < d.base.nodes.length; i++) {
      if (!raw.nodes[i].label) continue
      const hushed = q.labels[i] === 1 && i !== refund
      expect(quiet.nodes[i].label!.alpha).toBe(hushed ? 0 : raw.nodes[i].label!.alpha)
      if (d.scene.nodes[i].family !== 'neutral') expect(q.labels[i]).toBe(0)
    }
    for (let i = 0; i < d.base.edges.length; i++) {
      const k = d.scene.edges[i].family !== 'neutral' ? 1 : d.base.edges[i].kind === 'cross' ? 0.16 : 0.5
      expect(quiet.edges[i].alpha).toBeCloseTo(raw.edges[i].alpha * k)
    }
  })
})

// 交给 kgdiff 的图：节点自己的类型、层和组、收着的字段；关系的 id、分量、属性
describe('toKgdiffGraph：传给 kgdiff 的东西是全的', () => {
  const data = (fields: string[], weight: number): StrataData => ({
    version: 2,
    layers: [{ id: 'onto', name: '本体' }, { id: 'table', name: '表' }],
    groupings: [{ id: 'domain', groups: [{ id: 'g', name: '组' }] }],
    nodes: [
      { id: 'ent', layer: 'onto', label: '企业', type: 'entity', groups: { domain: 'g' }, attrs: { owner: '张三' } },
      { id: 't', layer: 'table', label: 'ent_info', type: 'table' },
      ...fields.map((f) => ({ id: `t.${f}`, layer: 'table', label: f, type: 'field', parent: 't' })),
    ],
    relations: [
      { id: 'm', source: 'ent', target: 't', type: '落地', weight, attrs: { cond: 'status = 1' } },
      ...fields.map((f) => ({ source: 'ent', target: `t.${f}`, type: '字段落地' })),
    ],
  })
  const norm = (d: StrataData) => normalize(d).data

  it('节点：type 是它自己的类型；层、组、收着的子节点是 strata 前缀的属性', () => {
    const g = toKgdiffGraph(project(norm(data(['a', 'b'], 2))))
    expect(g.nodes.find((n) => n.id === 'ent')).toMatchObject({ type: 'entity', attrs: { owner: '张三', [ATTR.layer]: 'onto', [ATTR.group]: 'domain/g' } })
    expect(g.nodes.find((n) => n.id === 't')).toMatchObject({ type: 'table', attrs: { [ATTR.layer]: 'table', [ATTR.folds]: ['t.a', 't.b'] } })
  })

  it('关系：带 id、分量和属性；上卷来的映射分量是加起来的', () => {
    const g = toKgdiffGraph(project(norm(data(['a', 'b'], 2))))
    expect(g.edges.find((e) => e.id === 'm')).toMatchObject({ predicate: '落地', attrs: { cond: 'status = 1', [ATTR.weight]: 2 } })
    expect(g.edges.find((e) => e.id === 'ent|字段落地|t')).toMatchObject({ source: 'ent', target: 't', attrs: { [ATTR.weight]: 2 } })
  })

  it('展开的子节点：一条 strata:parent 的层级边，不会和用户的关系类型撞名', () => {
    const g = toKgdiffGraph(project(norm(data(['a'], 1)), ['t']))
    expect(g.edges.find((e) => e.predicate === HIERARCHY_PREDICATE)).toMatchObject({ source: 't.a', target: 't' })
    expect(HIERARCHY_PREDICATE.startsWith('strata:')).toBe(true)
  })

  it('收起时也看得到字段级的变化：加了一个字段，表和上卷的映射都报成改了', async () => {
    const a = project(norm(data(['a'], 1)))
    const b = project(norm(data(['a', 'b'], 1)))
    const lay: StrataLayout = { nodes: new Map([placed('ent', 0, 0, 0, 0), placed('t', 1, 0, 0, -1)].map((p) => [p.id, p])), radii: [10, 10], groups: [], anchor: 0, blocks: [], linkClass: new Map() }
    const d = await buildStrataDiff(a, b, lay)
    const t = d.scene.nodes.find((n) => n.id === 't')!
    expect(t.status).not.toBe('unchanged')
    const rolled = d.scene.edges.find((e) => e.id.includes('字段落地'))!
    expect(rolled.status).not.toBe('unchanged')
    // 分量没变的那条直接映射不算变化
    expect(d.scene.edges.find((e) => e.id === 'm' || e.id.endsWith('|落地|t'))!.status).toBe('unchanged')
  })

  it('映射的分量变了算变化', async () => {
    const a = project(norm(data([], 1)))
    const b = project(norm(data([], 5)))
    const lay: StrataLayout = { nodes: new Map([placed('ent', 0, 0, 0, 0), placed('t', 1, 0, 0, -1)].map((p) => [p.id, p])), radii: [10, 10], groups: [], anchor: 0, blocks: [], linkClass: new Map() }
    const d = await buildStrataDiff(a, b, lay)
    expect(d.scene.edges).toHaveLength(1)
    expect(d.scene.edges[0].status).not.toBe('unchanged')
    expect(d.stats.changed).toBe(1)
  })
})
