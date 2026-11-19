import { describe, expect, it } from 'vitest'
import { layoutStrata, placeChildren, unionData } from '../src/layout'
import { checkLayout, layoutFromJSON, layoutToJSON } from '../src/layout-io'
// 布局吃的是解析后的数据（内部结构）：这里的样例直接手写成那个样子
import type { Resolved, ResolvedEdge, ResolvedLink, ResolvedNode, StrataLayout } from '../src/types'

// 手写样例用的：关系的 id 在内部结构里是必填的，这里按“起点|类型|终点”生成
const E = (source: string, target: string, label?: string): ResolvedEdge => ({ id: `${source}|${label ?? ''}|${target}`, source, target, ...(label !== undefined ? { label } : {}) })
const K = (source: string, target: string, type?: string, weight?: number): ResolvedLink => ({
  id: `${source}|${type ?? ''}|${target}`,
  source,
  target,
  ...(type !== undefined ? { type } : {}),
  ...(weight !== undefined ? { weight } : {}),
})

// 自造的小数据：3 个领域；上层本体，下层表
function sample(): Resolved {
  const groups = [
    { id: 'sales', name: '销售', color: '#e0885c' },
    { id: 'fin', name: '财务', color: '#5ca8e0' },
    { id: 'hr', name: '人事', color: '#7fd08a' },
  ]
  const onto: ResolvedNode[] = []
  const edges: ResolvedEdge[] = []
  for (const g of groups) {
    for (let i = 0; i < 11; i++) onto.push({ id: `${g.id}.o${i}`, label: `${g.name}${i}`, group: g.id })
    // 每个领域一个枢纽 o0，其余挂成星形加几条链
    for (let i = 1; i < 11; i++) edges.push(E(`${g.id}.o0`, `${g.id}.o${i}`))
    for (let i = 1; i < 10; i += 3) edges.push(E(`${g.id}.o${i}`, `${g.id}.o${i + 1}`))
  }
  edges.push(E('sales.o0', 'fin.o0', '结算'))
  edges.push(E('fin.o0', 'hr.o0', '薪资'))
  edges.push(E('sales.o3', 'hr.o5'))
  // 没写领域的节点：跟着邻居走
  onto.push({ id: 'loose', label: '游离' })
  edges.push(E('loose', 'fin.o2'))

  const links: ResolvedLink[] = []

  const tables: ResolvedNode[] = []
  for (const g of groups) {
    for (let i = 0; i < 4; i++) {
      tables.push({ id: `t.${g.id}${i}`, label: `t_${g.id}_${i}`, mono: true })
      links.push(K(`${g.id}.o${i % 2}`, `t.${g.id}${i}`, '映射'))
    }
  }
  tables.push({ id: 't.orphan', label: 't_orphan', mono: true })

  return {
    title: '样例',
    groups,
    layers: [
      { id: 'onto', name: '本体', nodes: onto, edges },
      { id: 'tables', name: '表', nodes: tables, edges: [] },
    ],
    links,
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const layerNodes = (lay: StrataLayout, li: number) => [...lay.nodes.values()].filter((n) => n.layer === li)

describe('layoutStrata', () => {
  const data = sample()
  const R = 26
  const lay = layoutStrata(data)

  it('确定性：两次结果完全相同', () => {
    const again = layoutStrata(sample())
    expect([...again.nodes.entries()]).toEqual([...lay.nodes.entries()])
    expect(again.radii).toEqual(lay.radii)
    expect(again.groups).toEqual(lay.groups)
  })

  it('所有节点都有位置，没有 NaN', () => {
    const total = data.layers.reduce((s, l) => s + l.nodes.length, 0)
    expect(lay.nodes.size).toBe(total)
    for (const n of lay.nodes.values()) {
      for (const v of [n.x, n.z, n.r, n.importance, n.degree]) expect(Number.isFinite(v)).toBe(true)
      expect(n.importance).toBeGreaterThanOrEqual(0)
      expect(n.importance).toBeLessThanOrEqual(1)
    }
    expect(lay.anchor).toBe(0)
    expect(lay.radii).toHaveLength(2)
    for (const r of lay.radii) expect(Number.isFinite(r) && r >= 8).toBe(true)
  })

  it('主图层：节点中心最大半径 = R', () => {
    const maxR = Math.max(...layerNodes(lay, 0).map((n) => Math.hypot(n.x, n.z)))
    expect(maxR).toBeCloseTo(R, 6)
  })

  it('主图层：≥85% 节点在自己领域的扇区内（扇区放宽 10%）', () => {
    const own = layerNodes(lay, 0).filter((n) => n.group >= 0)
    const inside = own.filter((n) => {
      const g = lay.groups[n.group]
      return Math.abs(wrap(Math.atan2(n.z, n.x) - g.angle)) <= (g.span / 2) * 1.1
    })
    expect(inside.length / own.length).toBeGreaterThanOrEqual(0.85)
  })

  it('主图层：没有节点离盘心小于 0.15R', () => {
    for (const n of layerNodes(lay, 0)) expect(Math.hypot(n.x, n.z)).toBeGreaterThanOrEqual(0.15 * R)
  })

  it('主图层：枢纽比同领域叶子的平均半径更靠盘心', () => {
    for (const g of ['sales', 'fin', 'hr']) {
      const hub = lay.nodes.get(`${g}.o0`)!
      const leaves = layerNodes(lay, 0).filter((n) => n.id.startsWith(g + '.') && n.degree <= 2)
      const avg = leaves.reduce((s, n) => s + Math.hypot(n.x, n.z), 0) / leaves.length
      expect(Math.hypot(hub.x, hub.z)).toBeLessThan(avg)
    }
  })

  it('扇区从 -π/2 起逆时针排，张角合计 2π', () => {
    expect(lay.groups.map((g) => g.id)).toEqual(['sales', 'fin', 'hr'])
    expect(wrap(lay.groups[0].angle - lay.groups[0].span / 2)).toBeCloseTo(-Math.PI / 2, 9)
    expect(lay.groups.reduce((s, g) => s + g.span, 0)).toBeCloseTo(Math.PI * 2, 9)
    expect(wrap(lay.groups[1].angle - lay.groups[0].angle)).toBeGreaterThan(0)
  })

  it('对齐过来的表互不重叠', () => {
    const items = layerNodes(lay, 1)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.r + b.r)
      }
    }
  })

  it('半径、度数、group、depth', () => {
    const hub = lay.nodes.get('sales.o0')!
    // 10 条星形边 + 1 条跨领域 + 2 条映射
    expect(hub.degree).toBe(13)
    expect(hub.r).toBeCloseTo(0.28 + 0.05 * 10, 9)
    expect(hub.group).toBe(0)
    expect(hub.depth).toBe(0)
    expect(lay.nodes.get('loose')!.group).toBe(-1)
    expect(lay.nodes.get('t.orphan')!.r).toBe(0.28)
  })

  it('importance：并列取平均，weight 覆盖', () => {
    const d = sample()
    d.layers[1].nodes[0].weight = 3
    const l2 = layoutStrata(d)
    expect(l2.nodes.get('t.sales0')!.importance).toBe(1)
    const tables = layerNodes(lay, 1)
    const byDeg = new Map<number, Set<number>>()
    for (const n of tables) (byDeg.get(n.degree) ?? byDeg.set(n.degree, new Set()).get(n.degree)!).add(n.importance)
    for (const s of byDeg.values()) expect(s.size).toBe(1)
  })

  it('radius 选项', () => {
    const l2 = layoutStrata(sample(), { radius: 40 })
    const maxR = Math.max(...layerNodes(l2, 0).map((n) => Math.hypot(n.x, n.z)))
    expect(maxR).toBeCloseTo(40, 6)
  })
})

// 两张图加一个映射：上层本体，下层表。覆盖一对一、一对多、多对一、多对多、跨块的次映射、没有映射的两种孤点
function twoGraphs(): Resolved {
  const onto: ResolvedNode[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Z'].map((id) => ({ id, label: id, group: 'g' }))
  const edges: ResolvedEdge[] = [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'A'], ['Z', 'A'], ['A', 'E'], ['B', 'G']].map(([source, target]) => E(source, target))
  const tables: ResolvedNode[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'].map((id) => ({ id, label: id, mono: true }))
  const fks: ResolvedEdge[] = [['T2', 'T1'], ['T4', 'T1'], ['T9', 'T1'], ['T5', 'T6']].map(([source, target]) => E(source, target))
  const link = (source: string, target: string, weight: number): ResolvedLink => K(source, target, '落地', weight)
  return {
    groups: [{ id: 'g', name: '组', color: '#5ca8e0' }],
    layers: [
      { id: 'onto', name: '本体', nodes: onto, edges },
      { id: 'tables', name: '表', nodes: tables, edges: fks },
    ],
    links: [
      link('A', 'T1', 5), // 一对一
      link('B', 'T2', 4), link('B', 'T3', 2), // 一对多
      link('C', 'T4', 3), link('D', 'T4', 3), // 多对一
      link('E', 'T5', 5), link('E', 'T6', 1), link('F', 'T5', 1), link('F', 'T6', 5), // 两个一对一，中间两条次映射
      link('G', 'T7', 5), link('H', 'T7', 4), link('H', 'T8', 1), link('G', 'T8', 1), // 多对多
    ],
  }
}

describe('layoutStrata：两张图对齐', () => {
  const data = twoGraphs()
  const R = 26
  const lay = layoutStrata(data)
  const at = (id: string) => lay.nodes.get(id)!
  const dist = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).z - at(b).z)
  const blockOf = (id: string) => lay.blocks[at(id).blocks[0]]
  const cls = (s: string, t: string) => lay.linkClass.get(data.links.find((k) => k.source === s && k.target === t)!.id)

  it('确定性，没有 NaN', () => {
    const again = layoutStrata(twoGraphs())
    expect([...again.nodes.entries()]).toEqual([...lay.nodes.entries()])
    expect(again.blocks).toEqual(lay.blocks)
    expect([...again.linkClass]).toEqual([...lay.linkClass])
    for (const n of lay.nodes.values()) for (const v of [n.x, n.z]) expect(Number.isFinite(v)).toBe(true)
    expect(lay.anchor).toBe(0)
  })

  it('对应块的基数', () => {
    expect(blockOf('A').type).toBe('one-one')
    expect(blockOf('B').type).toBe('one-many')
    expect(blockOf('C').type).toBe('many-one')
    expect(blockOf('G').type).toBe('many-many')
    expect(blockOf('E').type).toBe('one-one')
    expect(blockOf('F').type).toBe('one-one')
    expect(blockOf('B')).toMatchObject({ anchors: ['B'], aligned: ['T2', 'T3'], anchorLayer: 0, alignedLayer: 1 })
    expect(blockOf('G')).toMatchObject({ anchors: ['G', 'H'], aligned: ['T7', 'T8'] })
    // 同一个块里的节点记着同一个下标；没有映射的不在任何块里
    expect(at('T4').blocks).toEqual(at('C').blocks)
    expect(at('D').blocks).toEqual(at('C').blocks)
    expect(at('E').blocks).not.toEqual(at('F').blocks)
    expect(at('Z').blocks).toEqual([])
    expect(at('T9').blocks).toEqual([])
    expect(lay.blocks).toHaveLength(6)
    lay.blocks.forEach((b, i) => expect(b.index).toBe(i))
  })

  it('映射线分三种：主映射、块内、跨块', () => {
    expect(cls('A', 'T1')).toBe('primary')
    expect(cls('B', 'T2')).toBe('primary')
    // T3 没被任何本体挑中，自己挑了 B
    expect(cls('B', 'T3')).toBe('primary')
    expect(cls('E', 'T5')).toBe('primary')
    expect(cls('F', 'T6')).toBe('primary')
    expect(cls('E', 'T6')).toBe('outer')
    expect(cls('F', 'T5')).toBe('outer')
    expect(cls('G', 'T7')).toBe('primary')
    expect(cls('H', 'T7')).toBe('primary')
    // T8 没被挑中，两条映射分量一样、对方连得一样多，按 id 挑了 G
    expect(cls('G', 'T8')).toBe('primary')
    expect(cls('H', 'T8')).toBe('inner')
  })

  it('一对一：表正正落在本体下方', () => {
    for (const [c, t] of [['A', 'T1'], ['E', 'T5'], ['F', 'T6']]) expect(dist(c, t)).toBeLessThan(1e-9)
  })

  it('一对多：几张表围着本体下方那个点散开', () => {
    expect(dist('B', 'T2')).toBeGreaterThan(0.5)
    expect(dist('B', 'T2')).toBeLessThan(4)
    expect(dist('B', 'T3')).toBeLessThan(4)
    expect(dist('T2', 'T3')).toBeGreaterThanOrEqual(at('T2').r + at('T3').r + 1.4 - 1e-6)
  })

  it('多对一：表落在几个本体的重心附近', () => {
    const cx = (at('C').x + at('D').x) / 2
    const cz = (at('C').z + at('D').z) / 2
    expect(Math.hypot(at('T4').x - cx, at('T4').z - cz)).toBeLessThan(3)
    expect(blockOf('C').center[0]).toBeCloseTo(cx, 9)
    expect(blockOf('C').center[1]).toBeCloseTo(cz, 9)
  })

  it('表之间互不重叠', () => {
    const ts = [...lay.nodes.values()].filter((n) => n.layer === 1)
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        // 钉住的一对一之间不做分离，其余的至少隔开一个身位
        expect(Math.hypot(ts[i].x - ts[j].x, ts[i].z - ts[j].z)).toBeGreaterThan(ts[i].r + ts[j].r)
      }
    }
  })

  it('没有映射的表排到外圈；没有映射的本体留在原地', () => {
    expect(Math.hypot(at('T9').x, at('T9').z)).toBeGreaterThanOrEqual(R * 1.06 - 1e-6)
    expect(Math.hypot(at('Z').x, at('Z').z)).toBeLessThanOrEqual(R + 1e-6)
  })

  it('分量缺省为 1；没有映射时没有块', () => {
    const d = twoGraphs()
    d.links = [K('A', 'T1')]
    const l2 = layoutStrata(d)
    expect(l2.blocks).toHaveLength(1)
    expect([...l2.linkClass]).toEqual([['A||T1', 'primary']])
    d.links = []
    const l3 = layoutStrata(d)
    expect(l3.blocks).toHaveLength(0)
    expect([...l3.nodes.values()].every((n) => n.blocks.length === 0)).toBe(true)
  })
})

describe('unionData', () => {
  const a: Resolved = {
    title: 'A',
    groups: [
      { id: 'g1', name: '一', color: '#111111' },
      { id: 'g0', name: '旧', color: '#000000' },
    ],
    layers: [
      { id: 'L1', name: '一', nodes: [{ id: 'x', label: 'x-a' }, { id: 'gone', label: 'gone' }, { id: 'y', label: 'y' }], edges: [E('x', 'y', 'r'), E('x', 'gone')] },
      { id: 'Lold', name: '旧层', nodes: [{ id: 'o', label: 'o' }] },
      { id: 'L2', name: '二', nodes: [{ id: 'moved', label: 'm-a' }] },
    ],
    links: [K('x', 'moved', 'k'), K('y', 'o')],
  }
  const b: Resolved = {
    groups: [
      { id: 'g2', name: '新', color: '#222222' },
      { id: 'g1', name: '一改', color: '#333333' },
    ],
    layers: [
      { id: 'L2', name: '二', nodes: [{ id: 'z', label: 'z' }] },
      { id: 'L1', name: '一改', nodes: [{ id: 'x', label: 'x-b' }, { id: 'y', label: 'y' }, { id: 'moved', label: 'm-b' }], edges: [E('x', 'y', 'r'), E('x', 'y', 's')] },
    ],
    links: [K('x', 'moved', 'k'), K('x', 'moved', 'j')],
  }
  const u = unionData(a, b)

  it('层按 id 合并，顺序以 b 为准，a 独有的层插回原位', () => {
    expect(u.layers.map((l) => l.id)).toEqual(['L2', 'L1', 'Lold'])
    expect(u.layers[1].name).toBe('一改')
  })

  it('节点按 id 合并、同 id 取 b 的，a 独有的插回原位；换层的节点不重复', () => {
    const L1 = u.layers.find((l) => l.id === 'L1')!
    expect(L1.nodes.map((n) => n.id)).toEqual(['x', 'gone', 'y', 'moved'])
    expect(L1.nodes[0].label).toBe('x-b')
    const L2 = u.layers.find((l) => l.id === 'L2')!
    expect(L2.nodes.map((n) => n.id)).toEqual(['z'])
    const all = u.layers.flatMap((l) => l.nodes.map((n) => n.id))
    expect(new Set(all).size).toBe(all.length)
  })

  it('边和映射都按 id 去重', () => {
    const L1 = u.layers.find((l) => l.id === 'L1')!
    expect(L1.edges!.map((e) => `${e.source}|${e.target}|${e.label ?? ''}`)).toEqual(['x|y|r', 'x|gone|', 'x|y|s'])
    expect(u.links.map((k) => `${k.source}|${k.target}|${k.type ?? ''}`)).toEqual(['x|moved|k', 'y|o|', 'x|moved|j'])
  })

  it('groups 按 id 合并，同 id 取 b 的', () => {
    expect(u.groups.map((g) => g.id)).toEqual(['g2', 'g1', 'g0'])
    expect(u.groups[1].name).toBe('一改')
    expect(u.title).toBe('A')
  })

  it('合集可以布局', () => {
    const lay = layoutStrata(unionData(sample(), sample()))
    expect(lay.nodes.size).toBe(layoutStrata(sample()).nodes.size)
  })
})

// 三张图：指标 / 本体 / 表。指标只对上一部分本体，表对上大部分本体
function threeGraphs(): Resolved {
  const d = twoGraphs()
  const metrics: ResolvedNode[] = ['M1', 'M2', 'M3'].map((id) => ({ id, label: id }))
  d.layers.unshift({ id: 'metric', name: '指标', nodes: metrics, edges: [E('M1', 'M2')] })
  d.links.push(K('M1', 'A', undefined, 2), K('M2', 'B', undefined, 2), K('M2', 'C'), K('M3', 'G'))
  return d
}

describe('layoutStrata：三张图', () => {
  const data = threeGraphs()
  const R = 26
  const lay = layoutStrata(data)
  const at = (id: string) => lay.nodes.get(id)!

  it('基准挑和别的图映射最多的那张：夹在中间的本体，而不是排在最前的指标', () => {
    expect(data.layers.map((l) => l.id)).toEqual(['metric', 'onto', 'tables'])
    expect(lay.anchor).toBe(1)
    // 本体层自己按力导摆：没有被排到外圈去
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Z']) expect(Math.hypot(at(id).x, at(id).z)).toBeLessThanOrEqual(R + 1e-6)
  })

  it('两张图时一样多，取靠前的那张', () => {
    expect(layoutStrata(twoGraphs()).anchor).toBe(0)
  })

  it('anchor 选项可以指定基准；写了不存在的层就按缺省挑', () => {
    const l2 = layoutStrata(threeGraphs(), { anchor: 'tables' })
    expect(l2.anchor).toBe(2)
    for (const id of ['T1', 'T2', 'T9']) expect(Math.hypot(l2.nodes.get(id)!.x, l2.nodes.get(id)!.z)).toBeLessThanOrEqual(R + 1e-6)
    expect(layoutStrata(threeGraphs(), { anchor: 'nope' }).anchor).toBe(1)
  })

  it('指标和表都对齐到本体：一对一的正正落在上方 / 下方', () => {
    expect(Math.hypot(at('M1').x - at('A').x, at('M1').z - at('A').z)).toBeLessThan(1e-9)
    expect(Math.hypot(at('T1').x - at('A').x, at('T1').z - at('A').z)).toBeLessThan(1e-9)
  })

  it('夹在中间的节点同时在上、下两个对应块里', () => {
    expect(at('A').blocks).toHaveLength(2)
    const layers = at('A').blocks.map((b) => lay.blocks[b].alignedLayer).sort()
    expect(layers).toEqual([0, 2])
    expect(at('M1').blocks).toHaveLength(1)
    expect(at('T1').blocks).toHaveLength(1)
    expect(at('Z').blocks).toEqual([])
    // 每个块记着自己对齐的是哪一层
    expect(lay.blocks[at('M1').blocks[0]]).toMatchObject({ anchorLayer: 1, alignedLayer: 0 })
    expect(lay.blocks[at('T1').blocks[0]]).toMatchObject({ anchorLayer: 1, alignedLayer: 2 })
  })

  it('确定性', () => {
    const again = layoutStrata(threeGraphs())
    expect([...again.nodes.entries()]).toEqual([...lay.nodes.entries()])
    expect(again.blocks).toEqual(lay.blocks)
  })

  it('和别的图一条映射都没有的图：自己按力导摆，不会全挤到外圈', () => {
    const d = twoGraphs()
    d.links = []
    const l2 = layoutStrata(d)
    const tables = [...l2.nodes.values()].filter((n) => n.layer === 1)
    expect(tables.every((n) => Math.hypot(n.x, n.z) <= R + 1e-6)).toBe(true)
    expect(tables.every((n) => Number.isFinite(n.x) && Number.isFinite(n.z))).toBe(true)
  })
})

describe('layoutStrata：指定主映射、分组维度', () => {
  it('primary 标了的映射优先于分量', () => {
    const d = twoGraphs()
    // E 本来挑分量大的 T5；标了 T6 是主映射以后改挑 T6
    d.links.find((k) => k.source === 'E' && k.target === 'T6')!.primary = true
    const lay = layoutStrata(d)
    expect(lay.linkClass.get('E|落地|T6')).toBe('primary')
    expect(lay.blocks[lay.nodes.get('E')!.blocks[0]].aligned).toContain('T6')
  })

  it('linkClass 按映射的 id 记', () => {
    const d = twoGraphs()
    d.links.forEach((k, i) => (k.id = `map-${i}`))
    const lay = layoutStrata(d)
    expect(lay.linkClass.get('map-0')).toBe('primary')
    expect(lay.linkClass.size).toBe(d.links.length)
  })

  it('扇区只分给主图层那个分组维度里的组', () => {
    const d = twoGraphs()
    d.groups = [
      { id: 'domain/g', name: '组', color: '#5ca8e0', grouping: 'domain' },
      { id: 'db/x', name: '库 X', color: '#e0885c', grouping: 'db' },
      { id: 'db/y', name: '库 Y', color: '#7fd08a', grouping: 'db' },
    ]
    d.layers[0].grouping = 'domain'
    d.layers[1].grouping = 'db'
    for (const n of d.layers[0].nodes) n.group = 'domain/g'
    d.layers[1].nodes.forEach((n, i) => (n.group = i % 2 ? 'db/x' : 'db/y'))
    const lay = layoutStrata(d)
    // 本体只有一个领域：它占满一整圈；库那两个组不占扇区
    expect(lay.groups[0].span).toBeCloseTo(Math.PI * 2, 9)
    expect(lay.groups[1].span).toBe(0)
    expect(lay.groups[2].span).toBe(0)
    // 表照样带着自己的组
    expect(lay.nodes.get('T1')!.group).toBeGreaterThanOrEqual(1)
  })
})

// 展开：T1 展开出三个字段，A 的映射落到字段上
describe('placeChildren：展开出来的子节点', () => {
  const collapsed = twoGraphs()
  const base = layoutStrata(collapsed)
  const open = twoGraphs()
  open.layers[1].nodes.push({ id: 'T1.a', label: 'a', parent: 'T1' }, { id: 'T1.b', label: 'b', parent: 'T1' }, { id: 'T1.c', label: 'c', parent: 'T1' })
  // 收起时 A → T1 是一条上卷来的映射（id 是“起点|类型|终点”）；展开以后变成落在字段上的两条
  open.links = open.links.filter((k) => k.id !== 'A|落地|T1')
  open.links.push(K('A', 'T1.a', '落地', 3), K('A', 'T1.b', '落地', 2))
  const lay = placeChildren(base, open)

  it('顶层节点一点不动', () => {
    for (const [id, p] of base.nodes) expect(lay.nodes.get(id)).toEqual(p)
    expect(lay.blocks).toBe(base.blocks)
  })

  it('子节点围着父节点一圈：等距、不重叠、深度 1，跟着父节点的层、组和对应块', () => {
    const t1 = lay.nodes.get('T1')!
    const kids = ['T1.a', 'T1.b', 'T1.c'].map((id) => lay.nodes.get(id)!)
    const d = kids.map((k) => Math.hypot(k.x - t1.x, k.z - t1.z))
    for (const v of d) expect(v).toBeCloseTo(d[0], 9)
    expect(d[0]).toBeGreaterThan(t1.r + kids[0].r)
    for (const k of kids) {
      expect(k).toMatchObject({ layer: 1, depth: 1, group: t1.group, blocks: t1.blocks })
      expect(k.r).toBeLessThan(t1.r)
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(kids[i].x - kids[j].x, kids[i].z - kids[j].z)).toBeGreaterThan(kids[i].r + kids[j].r)
  })

  it('连到子节点上的映射，归类跟着收起时上卷的那条', () => {
    expect(base.linkClass.get('A|落地|T1')).toBe('primary')
    expect(lay.linkClass.get('A|落地|T1.a')).toBe('primary')
    expect(lay.linkClass.get('A|落地|T1.b')).toBe('primary')
  })

  it('直接拿带子节点的图去布局也行：先摆顶层，再摆子节点', () => {
    const direct = layoutStrata(open)
    expect(direct.nodes.get('T1.a')!.depth).toBe(1)
    expect(direct.nodes.size).toBe(base.nodes.size + 3)
  })
})

describe('布局的存取和注入', () => {
  it('layoutToJSON / layoutFromJSON：JSON 来回一趟原样', () => {
    const lay = layoutStrata(twoGraphs())
    const json = JSON.parse(JSON.stringify(layoutToJSON(lay)))
    expect(json.format).toBe(1)
    expect(Array.isArray(json.linkClass)).toBe(true)
    const back = layoutFromJSON(json)
    expect(back.anchor).toBe(lay.anchor)
    expect([...back.nodes]).toEqual([...lay.nodes])
    expect([...back.linkClass]).toEqual([...lay.linkClass])
    expect(back.radii).toEqual(lay.radii)
    expect(back.blocks).toEqual(lay.blocks)
    expect(back.groups).toEqual(lay.groups)
  })

  it('layoutFromJSON：形状不对就抛', () => {
    expect(() => layoutFromJSON(null)).toThrow(TypeError)
    expect(() => layoutFromJSON({ format: 2 })).toThrow(TypeError)
    expect(() => layoutFromJSON({ ...layoutToJSON(layoutStrata(twoGraphs())), nodes: [{ id: 'x' }] })).toThrow(TypeError)
  })

  it('checkLayout：缺节点、层数对不上、节点不在自己那一层都算用不了', () => {
    const data = twoGraphs()
    const lay = layoutStrata(data)
    expect(checkLayout(data, lay)).toBe(null)
    const nodes = new Map(lay.nodes)
    const gone = [...nodes.keys()][0]
    nodes.delete(gone)
    expect(checkLayout(data, { ...lay, nodes })).toMatchObject({ level: 'warning', code: 'layout-incomplete', id: gone })
    expect(checkLayout(data, { ...lay, radii: [10] })?.code).toBe('layout-incomplete')
    const moved = new Map(lay.nodes)
    moved.set(gone, { ...lay.nodes.get(gone)!, layer: 9 })
    expect(checkLayout(data, { ...lay, nodes: moved })?.id).toBe(gone)
    expect(checkLayout(data, null)?.code).toBe('layout-incomplete')
    expect(checkLayout(data, { ...lay, nodes }, 'zh-CN')?.message).toMatch(/注入的布局缺了 1 个节点/)
  })
})
