import { describe, expect, it } from 'vitest'
import { auditMappings, type MappingAudit } from '../src/headless'
import { StrataError } from '../src/locale'
import type { RelationSpec, StrataData } from '../src/types'
import { panorama, layered } from '../demo/src/data'

// 映射的审计：每条规则一个小例子，最后拿演示的网上商城对一遍

const fk = (a: string, b: string): RelationSpec => ({ source: a, target: b, type: 'fk' })
const map = (a: string, b: string, weight = 1): RelationSpec => ({ source: a, target: b, type: 'maps-to', weight })
const rel = (a: string, b: string): RelationSpec => ({ source: a, target: b })

/** 两层：本体 o:*，表 t:*；字段 f:* 收在表里 */
function data(nodes: [string, string?][], relations: RelationSpec[]): StrataData {
  return {
    version: 2,
    layers: [{ id: 'onto', name: 'Ontology' }, { id: 'table', name: 'Tables' }],
    nodes: nodes.map(([id, parent]) => ({ id, label: id, layer: id.startsWith('o:') ? 'onto' : 'table', ...(parent ? { parent } : {}) })),
    relations,
  }
}
const relOf = (a: MappingAudit, s: string, t: string) => a.relations.find((r) => r.source === s && r.target === t)!
const joinOf = (a: MappingAudit, s: string, t: string) => a.joins.find((j) => j.source === s && j.target === t)!
const route = (a: MappingAudit, s: string, t: string) => relOf(a, s, t).paths.map((p) => p.nodes.join('>'))

describe('auditMappings', () => {
  it('同一张表 0 跳；一条外键 1 跳；经一张有映射的表 2 跳；外键不管方向', () => {
    const a = auditMappings(
      data(
        [['o:cart'], ['o:item'], ['o:customer'], ['o:order'], ['o:review'], ['o:line'], ['t:carts'], ['t:customers'], ['t:orders'], ['t:reviews'], ['t:lines']],
        [
          rel('o:cart', 'o:item'), rel('o:customer', 'o:order'), rel('o:review', 'o:order'), rel('o:order', 'o:line'),
          map('o:cart', 't:carts', 3), map('o:item', 't:carts', 4), map('o:customer', 't:customers'), map('o:order', 't:orders'),
          map('o:review', 't:reviews'), map('o:line', 't:lines'),
          fk('t:orders', 't:customers'), fk('t:reviews', 't:lines'), fk('t:lines', 't:orders'),
        ],
      ),
    )
    expect(a).toMatchObject({ upper: 'onto', lower: 'table' })
    expect(relOf(a, 'o:cart', 'o:item')).toMatchObject({ status: 'joined', paths: [{ hops: 0, nodes: ['t:carts'], joins: [], weight: 7 }] })
    expect(relOf(a, 'o:customer', 'o:order').paths).toEqual([{ hops: 1, nodes: ['t:customers', 't:orders'], joins: ['t:orders|fk|t:customers'], weight: 2 }])
    expect(route(a, 'o:review', 'o:order')).toEqual(['t:reviews>t:lines>t:orders'])
  })

  it('走不通、没映射；最多跳数可调，0 只认同一张表', () => {
    const d = data(
      [['o:a'], ['o:b'], ['o:c'], ['o:x'], ['t:a'], ['t:m'], ['t:b'], ['t:c']],
      [rel('o:a', 'o:b'), rel('o:a', 'o:c'), rel('o:a', 'o:x'), map('o:a', 't:a'), map('o:b', 't:b'), map('o:c', 't:c'), map('o:a', 't:m'), map('o:b', 't:m'), fk('t:a', 't:m'), fk('t:m', 't:b')],
    )
    const a = auditMappings(d)
    expect(relOf(a, 'o:a', 'o:c')).toMatchObject({ status: 'unreachable', paths: [], sourceNodes: ['t:a', 't:m'], targetNodes: ['t:c'] })
    expect(relOf(a, 'o:a', 'o:x')).toMatchObject({ status: 'unmapped', paths: [], targetNodes: [] })
    // o:a 和 o:b 都映射到 t:m：0 跳，更长的不算
    expect(route(a, 'o:a', 'o:b')).toEqual(['t:m'])
    expect(auditMappings(d, { maxHops: 0 }).relations.map((r) => r.status)).toEqual(['joined', 'unreachable', 'unmapped'])
  })

  it('只给跳数最少的那一档，并列的按两端映射的分量排，最多 maxPaths 条', () => {
    const d = data(
      [['o:a'], ['o:b'], ['t:a'], ['t:b'], ['t:p'], ['t:q'], ['t:r']],
      [
        rel('o:a', 'o:b'), map('o:a', 't:a'), map('o:b', 't:b'), map('o:a', 't:p'), map('o:a', 't:q', 5), map('o:a', 't:r', 2),
        // 2 跳的有三条（经 p、q、r），1 跳的没有；另有一条 3 跳的
        fk('t:a', 't:p'), fk('t:p', 't:b'), fk('t:a', 't:q'), fk('t:q', 't:b'), fk('t:a', 't:r'), fk('t:r', 't:b'),
      ],
    )
    // 起点按“最后一个起点”算：t:q、t:r、t:p 自己就是 o:a 的映射，所以是 1 跳
    expect(route(auditMappings(d), 'o:a', 'o:b')).toEqual(['t:q>t:b', 't:r>t:b', 't:p>t:b'])
    expect(route(auditMappings(d, { maxPaths: 1 }), 'o:a', 'o:b')).toEqual(['t:q>t:b'])
  })

  it('不拿更长的路径凑数，也不从一个终点再往前走', () => {
    const d = data(
      [['o:a'], ['o:b'], ['t:a'], ['t:b'], ['t:b2'], ['t:m']],
      [rel('o:a', 'o:b'), map('o:a', 't:a'), map('o:b', 't:b'), map('o:b', 't:b2'), map('o:a', 't:m'), fk('t:a', 't:b'), fk('t:b', 't:b2'), fk('t:a', 't:m'), fk('t:m', 't:b2')],
    )
    // 1 跳：a>b、m>b2（m 也是 o:a 的映射）；没有 a>b>b2、a>m>b2
    expect(route(auditMappings(d), 'o:a', 'o:b')).toEqual(['t:a>t:b', 't:m>t:b2'])
  })

  it('没映射的表（维表）默认不当桥；throughUnmapped 放开', () => {
    const d = data(
      [['o:a'], ['o:b'], ['t:a'], ['t:b'], ['t:dim']],
      [rel('o:a', 'o:b'), map('o:a', 't:a'), map('o:b', 't:b'), fk('t:a', 't:dim'), fk('t:b', 't:dim')],
    )
    const a = auditMappings(d)
    expect(relOf(a, 'o:a', 'o:b').status).toBe('unreachable')
    expect(a.joins.map((j) => j.coverage)).toEqual(['unused', 'unused'])
    expect(a.unmappedLower).toEqual(['t:dim'])
    const open = auditMappings(d, { throughUnmapped: true })
    expect(route(open, 'o:a', 'o:b')).toEqual(['t:a>t:dim>t:b'])
    expect(open.joins.map((j) => j.coverage)).toEqual(['via-path', 'via-path'])
  })

  it('连接的覆盖分三档：直接对应 / 只被路径用到 / 没用到', () => {
    const a = auditMappings(
      data(
        [['o:review'], ['o:order'], ['o:line'], ['o:tag'], ['t:reviews'], ['t:lines'], ['t:orders'], ['t:tags']],
        [
          rel('o:review', 'o:order'), rel('o:line', 'o:order'),
          map('o:review', 't:reviews'), map('o:order', 't:orders'), map('o:line', 't:lines'), map('o:tag', 't:tags'),
          fk('t:reviews', 't:lines'), fk('t:lines', 't:orders'), fk('t:tags', 't:orders'),
        ],
      ),
    )
    // lines→orders：订单明细—订单有直接关系
    expect(joinOf(a, 't:lines', 't:orders')).toMatchObject({ coverage: 'direct', direct: ['o:line||o:order'], usedBy: ['o:line||o:order', 'o:review||o:order'] })
    // reviews→lines：评价—订单明细没有直接关系，但评价—订单的路径经过它
    expect(joinOf(a, 't:reviews', 't:lines')).toMatchObject({ coverage: 'via-path', direct: [], usedBy: ['o:review||o:order'] })
    // tags→orders：标签和订单在本体里没有关系，也没有路径经过它
    expect(joinOf(a, 't:tags', 't:orders')).toMatchObject({ coverage: 'unused', direct: [], usedBy: [] })
  })

  it('字段级的映射和外键上卷到表；连接的类型可配置', () => {
    const d = data(
      [['o:person'], ['o:company'], ['t:person'], ['t:person.id', 't:person'], ['t:share'], ['t:share.pid', 't:share']],
      [
        rel('o:person', 'o:company'),
        map('o:person', 't:person.id'), map('o:company', 't:share.pid'),
        { source: 't:share.pid', target: 't:person.id', type: 'references' },
      ],
    )
    expect(relOf(auditMappings(d), 'o:person', 'o:company').status).toBe('unreachable')
    const a = auditMappings(d, { joinTypes: ['references'] })
    expect(route(a, 'o:person', 'o:company')).toEqual(['t:person>t:share'])
    expect(a.joins).toMatchObject([{ id: 't:share|references|t:person', coverage: 'direct' }])
    expect(a.unmappedLower).toEqual([])
  })

  it('没映射的节点：上层的、下层的', () => {
    const a = auditMappings(data([['o:a'], ['o:lonely'], ['t:a'], ['t:raw']], [map('o:a', 't:a')]))
    expect(a.unmappedUpper).toEqual(['o:lonely'])
    expect(a.unmappedLower).toEqual(['t:raw'])
    expect(a.relations).toEqual([])
  })

  it('哪两层：默认相邻两层里映射最多的一对；也可以指定；层不对抛 audit-layers', () => {
    const four = layered(4, 'en')
    const a = auditMappings(four)
    expect([a.upper, a.lower]).toEqual(['onto', 'table'])
    expect(auditMappings(four, { upper: 'metric' })).toMatchObject({ upper: 'metric', lower: 'onto' })
    expect(auditMappings(four, { lower: 'onto' })).toMatchObject({ upper: 'metric', lower: 'onto' })
    for (const opts of [{ upper: 'nope' }, { upper: 'onto', lower: 'onto' }, { upper: 'table' }]) {
      expect(() => auditMappings(four, opts)).toThrow(StrataError)
    }
    const one: StrataData = { version: 2, layers: [{ id: 'x', name: 'x' }], nodes: [], relations: [] }
    expect(() => auditMappings(one, { locale: 'zh-CN' })).toThrow(/审计不了/)
  })

  it('演示的网上商城：和定规则时举的例子对得上', () => {
    const a = auditMappings(panorama('en'))
    const find = (s: string, t: string) => relOf(a, `c:${s}`, `c:${t}`)
    const tables = (s: string, t: string) => route(a, `c:${s}`, `c:${t}`).map((p) => p.replace(/tbl:/g, ''))
    // 购物车—加购 0 跳；顾客—订单 1 跳；评价—订单 2 跳（经订单明细，也经顾客：两条并列）
    expect(tables('cart', 'cart_item')).toEqual(['carts'])
    expect(tables('customer', 'order')).toEqual(['customers>orders'])
    expect(tables('review', 'order').sort()).toEqual(['reviews>customers>orders', 'reviews>order_items>orders'])
    // 店铺—订单：1 跳就到，不拿经过 dim_region 的 3 跳凑数
    expect(tables('seller', 'order')).toEqual(['sellers>orders'])
    // 走不通的
    expect(find('customer', 'coupon_claim').status).toBe('unreachable')
    expect(find('coupon', 'order').status).toBe('unreachable')
    // 没映射的本体、没有本体的表
    for (const c of ['invoice', 'promotion', 'channel']) expect(a.unmappedUpper).toContain(`c:${c}`)
    for (const t of ['dim_region', 'dim_date', 'ods_order_raw']) expect(a.unmappedLower).toContain(`tbl:${t}`)
    // 外键：reviews→order_items 只被路径用到；维表的外键没用到
    expect(joinOf(a, 'tbl:reviews', 'tbl:order_items')).toMatchObject({ coverage: 'via-path', usedBy: ['c:review||c:order'] })
    for (const j of a.joins.filter((j) => j.target === 'tbl:dim_region' || j.target === 'tbl:dim_date')) expect(j.coverage).toBe('unused')
    // 结果是纯 JSON：可以原样存下来
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })
})
