import { describe, expect, it } from 'vitest'
import { DIFF_AFTER, DIFF_BEFORE, DIFF_REPLACES, GROUPS, PANORAMA, PATHS, diffAfter, groups, layered, layeredPaths, panorama, paths, stress } from '../demo/src/data'
import { resolve, validate } from '../src/resolve'
import type { StrataData } from '../src/types'

/** 演示数据要干净：校验一条问题都不能有 */
function clean(d: StrataData) {
  expect(validate(d)).toEqual([])
}

const inLayer = (d: StrataData, layer: string) => d.nodes.filter((n) => n.layer === layer)
const ids = (d: StrataData, layer: string) => new Set(inLayer(d, layer).map((n) => n.id))
const layerOf = (d: StrataData) => new Map(d.nodes.map((n) => [n.id, n.layer]))
const has = (d: StrataData, s: string, t: string, type?: string) => d.relations.some((r) => r.source === s && r.target === t && (type === undefined || r.type === type))
/** 两端在同一层的关系 */
const within = (d: StrataData, layer: string) => {
  const at = layerOf(d)
  return d.relations.filter((r) => at.get(r.source) === layer && at.get(r.target) === layer)
}
/** 两端各在一层的关系 */
const between = (d: StrataData, a: string, b: string) => {
  const at = layerOf(d)
  return d.relations.filter((r) => (at.get(r.source) === a && at.get(r.target) === b) || (at.get(r.source) === b && at.get(r.target) === a))
}
function adjacency(d: StrataData) {
  const set = new Set<string>()
  for (const r of d.relations) {
    set.add(`${r.source}|${r.target}`)
    set.add(`${r.target}|${r.source}`)
  }
  return set
}

describe('全景数据', () => {
  it('契约第 2 版，校验没有问题', () => {
    expect(PANORAMA.version).toBe(2)
    expect(GROUPS).toHaveLength(8)
    clean(PANORAMA)
    expect(DIFF_BEFORE).toBe(PANORAMA)
  })

  it('两张图：本体层和物理层，都按图来摆', () => {
    expect(PANORAMA.layers.map((l) => l.id)).toEqual(['onto', 'table'])
    expect(inLayer(PANORAMA, 'onto')).toHaveLength(33)
    expect(within(PANORAMA, 'onto')).toHaveLength(48)
    expect(inLayer(PANORAMA, 'table').filter((n) => n.type === 'table')).toHaveLength(25)
    expect(within(PANORAMA, 'table').length).toBeGreaterThanOrEqual(30)
    // 画出来的是 33 个本体、25 张表：字段平时收在表里
    const { resolved } = resolve(PANORAMA)
    expect(resolved.layers.map((l) => l.nodes.length)).toEqual([33, 25])
  })

  it('数据只说是什么：节点带类型，不带形状', () => {
    expect(new Set(inLayer(PANORAMA, 'onto').map((n) => n.type))).toEqual(new Set(['entity', 'relation']))
    expect(new Set(inLayer(PANORAMA, 'table').map((n) => n.type))).toEqual(new Set(['table', 'field']))
    for (const n of PANORAMA.nodes) expect(Object.keys(n).filter((k) => k === 'shape' || k === 'mono')).toEqual([])
    // 画成什么样在解析时按类型配
    const { resolved } = resolve(PANORAMA)
    const onto = resolved.layers[0].nodes
    expect(onto.find((n) => n.id === 'c:order_line')!.shape).toBe('octa')
    expect(onto.find((n) => n.id === 'c:order')!.shape).toBeUndefined()
    expect(resolved.layers[1].nodes.every((n) => n.shape === 'tablet' && n.mono === true)).toBe(true)
  })

  it('映射：都是本体 → 表，带分量；一对多、多对一、没落地、没人认领都有', () => {
    // 写了字段的表，映射落在字段上；平时看到的是上卷以后的表级映射
    const maps = resolve(PANORAMA).resolved.links
    const perEnt = new Map<string, number>()
    const perTbl = new Map<string, number>()
    for (const k of maps) {
      expect(k.source.startsWith('c:') && k.target.startsWith('tbl:'), k.source).toBe(true)
      expect(k.type).toBe('maps-to')
      expect(k.label).toBe('落地')
      expect(k.weight).toBeGreaterThan(0)
      perEnt.set(k.source, (perEnt.get(k.source) ?? 0) + 1)
      perTbl.set(k.target, (perTbl.get(k.target) ?? 0) + 1)
    }
    expect(perEnt.get('c:address')).toBe(2)
    expect(perEnt.get('c:supply')).toBe(2)
    expect(perTbl.get('tbl:products')).toBe(3)
    expect([...ids(PANORAMA, 'onto')].filter((e) => !perEnt.has(e)).sort()).toEqual(['c:carrier', 'c:channel', 'c:invoice', 'c:membership_tier', 'c:promotion'])
    expect([...ids(PANORAMA, 'table')].filter((t) => t.startsWith('tbl:') && !perTbl.has(t)).sort()).toEqual(['tbl:dim_date', 'tbl:dim_region', 'tbl:ods_order_raw', 'tbl:order_tag_rel', 'tbl:tmp_order_dedup'])
  })

  it('字段：三张表带字段，映射是字段级的；上卷以后的分量 = 对上了几个字段', () => {
    const fields = inLayer(PANORAMA, 'table').filter((n) => n.type === 'field')
    expect(new Set(fields.map((f) => f.parent))).toEqual(new Set(['tbl:customers', 'tbl:products', 'tbl:orders']))
    expect(fields.filter((f) => f.parent === 'tbl:orders')).toHaveLength(16)
    const { resolved } = resolve(PANORAMA)
    const w = (s: string, t: string) => resolved.links.find((k) => k.source === s && k.target === t)?.weight
    expect(w('c:order', 'tbl:orders')).toBe(11)
    expect(w('c:address', 'tbl:orders')).toBe(3)
    expect(w('c:customer', 'tbl:customers')).toBe(10)
    // 没写字段的表，分量是直接写的
    expect(w('c:address', 'tbl:customer_addresses')).toBe(8)
    // 没对上任何本体的字段：展开表才看得到的缺口
    const mapped = new Set(between(PANORAMA, 'onto', 'table').map((r) => r.target))
    expect(fields.filter((f) => !mapped.has(f.id)).map((f) => f.label).sort()).toEqual(['created_at', 'etl_time', 'etl_time', 'src_channel', 'updated_at'])
  })

  it('分组：一个维度“领域”，颜色只是覆盖', () => {
    expect(PANORAMA.groupings).toHaveLength(1)
    expect(PANORAMA.groupings![0].id).toBe('domain')
    const { resolved } = resolve(PANORAMA)
    expect(resolved.groups.map((g) => g.id)).toEqual(GROUPS.map((g) => `domain/${g.id}`))
    expect(resolved.groups.every((g) => /^#[0-9a-f]{6}$/i.test(g.color))).toBe(true)
  })
})

describe('中英文两版', () => {
  const shape = (d: StrataData) => ({
    layers: d.layers.map((l) => l.id),
    nodes: d.nodes.map((n) => [n.id, n.layer, n.type, n.parent, n.groups?.domain]),
    relations: d.relations.map((r) => [r.source, r.target, r.type, r.weight]),
  })

  it('id、结构、分量一样，只有给人看的字不同', () => {
    for (const count of [2, 3, 4]) {
      const zh = layered(count, 'zh')
      const en = layered(count, 'en')
      clean(en)
      expect(shape(en)).toEqual(shape(zh))
    }
    const en = panorama('en')
    expect(en.title).toBe('Online store knowledge graph')
    expect(en.layers.map((l) => l.name)).toEqual(['Ontology', 'Tables'])
    expect(en.nodes.find((n) => n.id === 'c:customer')!.label).toBe('Customer')
    expect(PANORAMA.nodes.find((n) => n.id === 'c:customer')!.label).toBe('顾客')
    expect(groups('en').map((g) => g.id)).toEqual(GROUPS.map((g) => g.id))
    // 表名、字段名是代码里的名字，两版一样
    const tableLabels = (d: StrataData) => inLayer(d, 'table').map((n) => n.label)
    expect(tableLabels(en)).toEqual(tableLabels(PANORAMA))
  })

  it('英文版里没有中文', () => {
    const cjk = /[㐀-鿿]/
    const en = layered(4, 'en')
    const texts = [en.title, ...en.layers.map((l) => l.name), ...en.nodes.map((n) => n.label), ...en.relations.map((r) => r.label), ...groups('en').map((g) => g.name)]
    const after = diffAfter(en, 'en')
    texts.push(...after.nodes.map((n) => n.label), ...after.relations.map((r) => r.label))
    texts.push(...paths('en').map((p) => p.question), ...layeredPaths(4, 'en').map((p) => p.question), stress(50, 'en').title, ...stress(50, 'en').nodes.map((n) => n.label))
    for (const t of texts) expect(cjk.test(String(t)), String(t)).toBe(false)
  })

  it('两版的对比、路径一样', () => {
    expect(shape(diffAfter(panorama('en'), 'en'))).toEqual(shape(DIFF_AFTER))
    expect(paths('en').map((p) => p.nodes)).toEqual(PATHS.map((p) => p.nodes))
    expect(layeredPaths(4, 'en').map((p) => p.nodes)).toEqual(layeredPaths(4).map((p) => p.nodes))
  })
})

describe('对比数据', () => {
  const after = DIFF_AFTER
  it('校验没有问题，且没有改到全景', () => {
    clean(after)
    expect(ids(PANORAMA, 'onto').has('c:member')).toBe(true)
    expect(ids(PANORAMA, 'table').has('tbl:tmp_order_dedup')).toBe(true)
  })

  it('新增：本体和它落地的表', () => {
    expect(ids(after, 'onto').has('c:subscription')).toBe(true)
    expect(has(after, 'c:customer', 'c:subscription')).toBe(true)
    expect(has(after, 'c:subscription', 'c:sku')).toBe(true)
    expect(ids(after, 'table').has('tbl:subscriptions')).toBe(true)
    expect(has(after, 'tbl:subscriptions', 'tbl:customers', 'fk')).toBe(true)
    expect(has(after, 'c:subscription', 'tbl:subscriptions', 'maps-to')).toBe(true)
  })

  it('合并：节点没了，关系改到新节点上；谁吸收了谁单独说', () => {
    expect(ids(after, 'onto').has('c:member')).toBe(false)
    expect(after.relations.some((r) => r.source === 'c:member' || r.target === 'c:member')).toBe(false)
    expect(after.relations.some((r) => r.source === r.target)).toBe(false)
    expect(has(after, 'c:customer', 'c:membership_tier')).toBe(true)
    expect(DIFF_REPLACES).toEqual({ 'c:customer': ['c:member'] })
    // 节点上没有对比专用的字段
    expect(after.nodes.some((n) => 'replaces' in n)).toBe(false)
  })

  it('改名', () => {
    expect(after.nodes.find((n) => n.id === 'c:favorite')!.label).toBe('心愿单')
    expect(PANORAMA.nodes.find((n) => n.id === 'c:favorite')!.label).toBe('收藏')
  })

  it('补映射', () => {
    expect(has(PANORAMA, 'c:promotion', 'tbl:coupons')).toBe(false)
    expect(has(after, 'c:promotion', 'tbl:coupons', 'maps-to')).toBe(true)
  })

  it('删除：本体和表', () => {
    expect(ids(after, 'onto').has('c:invoice')).toBe(false)
    expect(after.relations.some((r) => r.source === 'c:invoice' || r.target === 'c:invoice')).toBe(false)
    expect(ids(after, 'table').has('tbl:tmp_order_dedup')).toBe(false)
    expect(after.relations.some((r) => r.source === 'tbl:tmp_order_dedup' || r.target === 'tbl:tmp_order_dedup')).toBe(false)
  })

  it('关系改向', () => {
    expect(has(after, 'c:review', 'c:order')).toBe(false)
    expect(has(after, 'c:review', 'c:order_line')).toBe(true)
  })

  it('字段级的改动：订单表多了一个字段，对上了优惠券', () => {
    expect(ids(after, 'table').has('fld:orders.coupon_id')).toBe(true)
    expect(has(after, 'c:coupon', 'fld:orders.coupon_id', 'maps-to')).toBe(true)
  })
})

describe('查询路径', () => {
  it('节点存在，相邻连接率不低于 70%', () => {
    const at = layerOf(PANORAMA)
    const adj = adjacency(PANORAMA)
    expect(PATHS).toHaveLength(4)
    for (const p of PATHS) {
      for (const id of p.nodes) expect(at.has(id), id).toBe(true)
      let hit = 0
      for (let i = 0; i + 1 < p.nodes.length; i++) if (adj.has(`${p.nodes[i]}|${p.nodes[i + 1]}`)) hit++
      expect(hit / (p.nodes.length - 1), p.id).toBeGreaterThanOrEqual(0.7)
    }
  })
})

describe('多层数据', () => {
  it('3 层：本体上面加指标；4 层：再加看板；都没有改到全景', () => {
    const three = layered(3)
    clean(three)
    expect(three.layers.map((l) => l.id)).toEqual(['metric', 'onto', 'table'])
    expect(inLayer(three, 'metric')).toHaveLength(10)
    const four = layered(4)
    clean(four)
    expect(four.layers.map((l) => l.id)).toEqual(['board', 'metric', 'onto', 'table'])
    expect(PANORAMA.layers.map((l) => l.id)).toEqual(['onto', 'table'])
    expect(layered(2).layers.map((l) => l.id)).toEqual(['onto', 'table'])
  })

  it('每个指标都落在本体上，每个看板都取了指标', () => {
    const four = layered(4)
    for (const m of ids(four, 'metric')) expect(between(four, 'metric', 'onto').some((r) => r.source === m), m).toBe(true)
    for (const b of ids(four, 'board')) expect(between(four, 'board', 'metric').some((r) => r.source === b), b).toBe(true)
  })

  it('diffAfter 在多层数据上也成立，指标层原样保留，没有改到原数据', () => {
    const base = layered(3)
    const after = diffAfter(base)
    clean(after)
    expect(after.layers.map((l) => l.id)).toEqual(['metric', 'onto', 'table'])
    expect(inLayer(after, 'metric')).toHaveLength(10)
    expect(ids(after, 'onto').has('c:subscription')).toBe(true)
    expect(ids(base, 'onto').has('c:subscription')).toBe(false)
    expect(after.relations.some((r) => r.source === 'c:member' || r.target === 'c:member')).toBe(false)
  })

  it('多层才有的路径：节点都在，相邻的都连着', () => {
    expect(layeredPaths(2)).toEqual([])
    for (const count of [3, 4]) {
      const d = layered(count)
      const at = layerOf(d)
      const adj = adjacency(d)
      const paths = layeredPaths(count)
      expect(paths.length).toBeGreaterThan(0)
      for (const p of paths) {
        for (const id of p.nodes) expect(at.has(id), id).toBe(true)
        for (let i = 0; i + 1 < p.nodes.length; i++) expect(adj.has(`${p.nodes[i]}|${p.nodes[i + 1]}`), `${p.nodes[i]} → ${p.nodes[i + 1]}`).toBe(true)
      }
    }
  })
})

describe('stress', () => {
  it('规模符合预期，校验没有问题，且确定', () => {
    const a = stress(3000)
    clean(a)
    expect(a.layers.map((l) => l.id)).toEqual(['graph', 'tables'])
    expect(inLayer(a, 'graph')).toHaveLength(3000)
    expect(within(a, 'graph').length).toBeGreaterThan(5500)
    expect(within(a, 'graph').length).toBeLessThanOrEqual(6000)
    expect(inLayer(a, 'tables')).toHaveLength(600)
    expect(within(a, 'tables').length).toBeGreaterThan(700)
    const mapped = new Set(between(a, 'graph', 'tables').map((r) => r.target))
    // 约一成的表没人认领
    expect(mapped.size).toBeGreaterThan(500)
    expect(mapped.size).toBeLessThan(580)
    expect(JSON.stringify(stress(3000))).toBe(JSON.stringify(a))
  })
})
