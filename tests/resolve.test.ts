import { describe, expect, it } from 'vitest'
import { normalize, project, relationId, resolve, validate } from '../src/resolve'
import type { StrataData } from '../src/types'
import { layoutStrata } from '../src/layout'
import { toKgdiffGraph } from '../src/diff'

// 两层：本体（企业、自然人、投资）和表（两张表，各带字段）。字段是表的子节点
function sample(): StrataData {
  return {
    version: 2,
    title: '样例',
    layers: [
      { id: 'onto', name: '本体' },
      { id: 'table', name: '表', grouping: 'db' },
    ],
    groupings: [
      { id: 'domain', groups: [{ id: 'subject', name: '主体', color: '#112233' }, { id: 'equity', name: '股权' }] },
      { id: 'db', groups: [{ id: 'biz', name: '业务库' }] },
    ],
    nodes: [
      { id: 'ent', layer: 'onto', label: '企业', type: 'entity', groups: { domain: 'subject' } },
      { id: 'person', layer: 'onto', label: '自然人', type: 'entity', groups: { domain: 'subject' } },
      { id: 'invest', layer: 'onto', label: '投资', type: 'relation', groups: { domain: 'equity' } },
      { id: 't_ent', layer: 'table', label: 'ent_info', type: 'table', groups: { db: 'biz', domain: 'subject' } },
      { id: 't_ent.id', layer: 'table', label: 'id', type: 'field', parent: 't_ent' },
      { id: 't_ent.name', layer: 'table', label: 'name', type: 'field', parent: 't_ent' },
      { id: 't_inv', layer: 'table', label: 'ent_invest', type: 'table', groups: { db: 'biz' } },
      { id: 't_inv.ent_id', layer: 'table', label: 'ent_id', type: 'field', parent: 't_inv' },
      { id: 't_inv.amount', layer: 'table', label: 'amount', type: 'field', parent: 't_inv' },
    ],
    relations: [
      { source: 'person', target: 'invest' },
      { source: 'invest', target: 'ent' },
      // 字段级的映射：企业的两个属性落在 ent_info 的两个字段上
      { id: 'm1', source: 'ent', target: 't_ent.id', type: '落地' },
      { id: 'm2', source: 'ent', target: 't_ent.name', type: '落地' },
      { id: 'm3', source: 'invest', target: 't_inv.amount', type: '落地', weight: 2 },
      // 字段级的外键
      { id: 'fk', source: 't_inv.ent_id', target: 't_ent.id', type: '外键', attrs: { on: 'ent_id = id' } },
      // 同一张表的两个字段之间
      { id: 'same', source: 't_ent.id', target: 't_ent.name', type: '依赖' },
    ],
  }
}

describe('validate', () => {
  it('干净的数据没有问题', () => {
    expect(validate(sample())).toEqual([])
  })

  it('版本不对', () => {
    const d = { ...sample(), version: 1 } as unknown as StrataData
    expect(validate(d).map((i) => i.code)).toContain('version')
  })

  it('节点：重复的 id、不存在的层', () => {
    const d = sample()
    d.nodes.push({ id: 'ent', layer: 'table', label: '重名' }, { id: 'lost', layer: 'nope', label: '没有层' })
    const issues = validate(d)
    expect(issues.find((i) => i.code === 'duplicate-node')).toMatchObject({ level: 'error', id: 'ent' })
    expect(issues.find((i) => i.code === 'unknown-layer')).toMatchObject({ level: 'error', id: 'lost' })
  })

  it('parent：不存在、不在同一层、绕回自己', () => {
    const d = sample()
    d.nodes.push({ id: 'a', layer: 'onto', label: 'a', parent: 'ghost' }, { id: 'b', layer: 'onto', label: 'b', parent: 't_ent' }, { id: 'c', layer: 'onto', label: 'c', parent: 'd' }, { id: 'd', layer: 'onto', label: 'd', parent: 'c' })
    const codes = validate(d).map((i) => `${i.code}:${i.id}`)
    expect(codes).toContain('unknown-parent:a')
    expect(codes).toContain('parent-layer:b')
    expect(codes).toContain('parent-cycle:c')
    expect(codes).toContain('parent-cycle:d')
  })

  it('关系：指向不存在的节点、重复、两端相同、分量不对', () => {
    const d = sample()
    d.relations.push(
      { id: 'dangling', source: 'ent', target: 'ghost' },
      { id: 'm1', source: 'person', target: 't_ent' },
      { source: 'person', target: 'invest' },
      { id: 'self', source: 'ent', target: 'ent' },
      { id: 'neg', source: 'person', target: 't_inv', weight: -1 },
    )
    const issues = validate(d)
    expect(issues.find((i) => i.id === 'dangling')).toMatchObject({ level: 'error', code: 'dangling-relation' })
    expect(issues.find((i) => i.id === 'm1')).toMatchObject({ level: 'error', code: 'duplicate-relation' })
    // 没写 id 的两条一样的关系：提醒，不算错
    expect(issues.find((i) => i.id === 'person||invest')).toMatchObject({ level: 'warning', code: 'duplicate-relation' })
    expect(issues.find((i) => i.id === 'self')).toMatchObject({ level: 'warning', code: 'self-relation' })
    expect(issues.find((i) => i.id === 'neg')).toMatchObject({ level: 'warning', code: 'bad-weight' })
  })

  it('分组：层用了不存在的维度、节点的组不在维度里', () => {
    const d = sample()
    d.layers[0].grouping = 'nope'
    d.nodes.push({ id: 'x', layer: 'table', label: 'x', groups: { db: 'ghost' } })
    const issues = validate(d)
    expect(issues.find((i) => i.code === 'unknown-grouping')).toMatchObject({ level: 'warning', id: 'onto' })
    expect(issues.find((i) => i.code === 'unknown-group' && i.id === 'x')).toBeTruthy()
  })

  it('relationId：没写 id 就是“起点|类型|终点”', () => {
    expect(relationId({ source: 'a', target: 'b' })).toBe('a||b')
    expect(relationId({ source: 'a', target: 'b', type: '落地' })).toBe('a|落地|b')
    expect(relationId({ id: 'r1', source: 'a', target: 'b' })).toBe('r1')
  })
})

describe('resolve', () => {
  const { resolved, issues } = resolve(sample())
  const onto = resolved.layers[0]
  const table = resolved.layers[1]

  it('按层装好，没有问题', () => {
    expect(issues).toEqual([])
    expect(resolved.title).toBe('样例')
    expect(resolved.layers.map((l) => l.id)).toEqual(['onto', 'table'])
    expect(onto.nodes.map((n) => n.id)).toEqual(['ent', 'person', 'invest'])
  })

  it('子节点收进父节点：字段不单独出现，记在 folded 里', () => {
    expect(table.nodes.map((n) => n.id)).toEqual(['t_ent', 't_inv'])
    expect(table.nodes[0].folds).toEqual(['t_ent.id', 't_ent.name'])
    expect(onto.nodes[0].folds).toBeUndefined()
    expect(resolved.folded).toEqual({ 't_ent.id': 't_ent', 't_ent.name': 't_ent', 't_inv.ent_id': 't_inv', 't_inv.amount': 't_inv' })
  })

  it('字段级的映射上卷成表级的映射，分量相加，记着是由哪些关系来的', () => {
    const m = resolved.links.find((k) => k.source === 'ent' && k.target === 't_ent')!
    expect(m).toMatchObject({ id: 'ent|落地|t_ent', type: '落地', weight: 2, members: ['m1', 'm2'] })
    const inv = resolved.links.find((k) => k.source === 'invest')!
    expect(inv).toMatchObject({ target: 't_inv', weight: 2, members: ['m3'] })
    expect(resolved.links).toHaveLength(2)
  })

  it('字段级的外键上卷成表之间的边；同一张表里字段之间的关系平时不画', () => {
    expect(table.edges).toEqual([{ id: 't_inv|外键|t_ent', source: 't_inv', target: 't_ent', label: '外键', type: '外键', weight: 1, members: ['fk'] }])
  })

  it('同层的关系是那一层的边，没写 id 的自动生成', () => {
    expect(onto.edges!.map((e) => e.id)).toEqual(['person||invest', 'invest||ent'])
  })

  it('样子按类型配：内置的几种，可以盖掉', () => {
    expect(onto.nodes.find((n) => n.id === 'invest')!.shape).toBe('octa')
    expect(onto.nodes.find((n) => n.id === 'ent')!.shape).toBeUndefined()
    expect(table.nodes[0]).toMatchObject({ shape: 'tablet', mono: true })
    const custom = resolve(sample(), { nodeStyles: { entity: { shape: 'prism' }, table: { shape: 'page', mono: false } } }).resolved
    expect(custom.layers[0].nodes[0].shape).toBe('prism')
    expect(custom.layers[1].nodes[0]).toMatchObject({ shape: 'page', mono: false })
  })

  it('分组：每层用自己的维度，组的 id 带上维度；没写颜色的从色板里取', () => {
    expect(resolved.groups.map((g) => g.id)).toEqual(['domain/subject', 'domain/equity', 'db/biz'])
    expect(resolved.groups[0].color).toBe('#112233')
    expect(resolved.groups[1].color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(onto.grouping).toBe('domain')
    expect(table.grouping).toBe('db')
    expect(onto.nodes[0].group).toBe('domain/subject')
    // 表那层按库分：取的是 groups.db；groups.domain 是别的维度里的归属
    expect(table.nodes[0].group).toBe('db/biz')
    const palette = resolve(sample(), { palette: ['#aaaaaa', '#bbbbbb'] }).resolved
    expect(palette.groups.map((g) => g.color)).toEqual(['#112233', '#bbbbbb', '#aaaaaa'])
  })

  it('有问题的项丢掉，其余的照常；问题都在 issues 里', () => {
    const d = sample()
    d.nodes.push({ id: 'ent', layer: 'table', label: '重名' }, { id: 'lost', layer: 'nope', label: '没有层' })
    d.relations.push({ id: 'dangling', source: 'ent', target: 'ghost' })
    const r = resolve(d)
    expect(r.issues.map((i) => i.code).sort()).toEqual(['dangling-relation', 'duplicate-node', 'unknown-layer'])
    expect(r.resolved.layers[0].nodes.map((n) => n.id)).toEqual(['ent', 'person', 'invest'])
    expect(r.resolved.layers[1].nodes.map((n) => n.id)).toEqual(['t_ent', 't_inv'])
    expect(r.resolved.links).toHaveLength(2)
  })

  it('指定的主映射带过去', () => {
    const d = sample()
    d.relations.push({ id: 'p', source: 'person', target: 't_ent', type: '落地', primary: true })
    const k = resolve(d).resolved.links.find((x) => x.id === 'p')!
    expect(k.primary).toBe(true)
  })
})

describe('normalize / project：整理和上卷分开', () => {
  const { data } = normalize(sample())

  it('整理什么都不丢：字段、字段级的关系都在；关系的 id 和分量是全的', () => {
    expect(data.nodes).toHaveLength(9)
    expect(data.nodes.find((n) => n.id === 't_ent.id')).toMatchObject({ layer: 1, parent: 't_ent', type: 'field', shape: 'tablet' })
    expect(data.relations).toHaveLength(7)
    expect(data.relations.every((r) => typeof r.id === 'string' && r.weight > 0)).toBe(true)
    expect(data.relations.find((r) => r.id === 'fk')!.attrs).toEqual({ on: 'ent_id = id' })
  })

  it('不展开：和 resolve 一样', () => {
    expect(project(data)).toEqual(resolve(sample()).resolved)
  })

  it('展开一张表：它的字段画出来，带着 parent；上卷到它身上的关系回到字段上', () => {
    const r = project(data, ['t_ent'])
    const table = r.layers[1]
    expect(table.nodes.map((n) => n.id)).toEqual(['t_ent', 't_ent.id', 't_ent.name', 't_inv'])
    expect(table.nodes[1]).toMatchObject({ parent: 't_ent' })
    expect(table.nodes[0].folds).toBeUndefined()
    expect(r.folded).toEqual({ 't_inv.ent_id': 't_inv', 't_inv.amount': 't_inv' })
    // 企业的两条映射不再合并：各自落在自己的字段上，id 是原来的
    expect(r.links.filter((k) => k.source === 'ent').map((k) => `${k.id}→${k.target}`)).toEqual(['m1→t_ent.id', 'm2→t_ent.name'])
    // 外键一端还收着：从 t_inv 连到展开出来的字段
    expect(table.edges!.find((e) => e.type === '外键')).toMatchObject({ source: 't_inv', target: 't_ent.id', members: ['fk'] })
    // 同一张表两个字段之间的关系现在画得出来了，属性也带着
    expect(table.edges!.find((e) => e.id === 'same')).toMatchObject({ source: 't_ent.id', target: 't_ent.name' })
  })

  it('两端都展开：关系原样，带着属性', () => {
    const r = project(data, ['t_ent', 't_inv'])
    expect(r.layers[1].edges!.find((e) => e.id === 'fk')).toMatchObject({ source: 't_inv.ent_id', target: 't_ent.id', attrs: { on: 'ent_id = id' } })
    expect(r.folded).toEqual({})
  })

  it('父节点没画出来的，展开了也不画：要一层一层展开', () => {
    const d = sample()
    d.nodes.push({ id: 't_ent.id.pk', layer: 'table', label: 'pk', parent: 't_ent.id' })
    const n = normalize(d).data
    expect(project(n, ['t_ent.id']).folded!['t_ent.id.pk']).toBe('t_ent')
    expect(project(n, ['t_ent']).folded!['t_ent.id.pk']).toBe('t_ent.id')
    expect(project(n, ['t_ent', 't_ent.id']).layers[1].nodes.map((x) => x.id)).toContain('t_ent.id.pk')
  })
})

describe('原型上的名字也是合法的 id', () => {
  // 节点、层、类型、分组都用 Object.prototype 上有的名字：validate 说没问题，后面每一步也都不能出错、不能读到原型上去
  const NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']
  const make = (name: string): StrataData => ({
    version: 2,
    layers: [{ id: 'onto', name: '本体' }, { id: name, name }],
    groupings: [{ id: 'g', groups: [{ id: name, name, color: '#123456' }] }],
    nodes: [
      { id: name, layer: 'onto', label: name, type: name, groups: { g: name } },
      { id: 'x', layer: 'onto', label: 'x' },
      { id: 't', layer: name, label: 't', type: 'table' },
      // 收在 t 里的子节点也叫这些名字：折叠的索引按 id 记
      { id: `${name}.f`, layer: name, label: 'f', parent: 't' },
    ],
    relations: [
      { source: name, target: 'x' },
      { source: name, target: `${name}.f`, type: name },
    ],
  })

  for (const name of NAMES) {
    it(name, () => {
      const data = make(name)
      expect(validate(data)).toEqual([])
      const { resolved } = resolve(data)
      const onto = resolved.layers[0].nodes
      const node = onto.find((n) => n.id === name)!
      expect(node.group).toBe(`g/${name}`)
      // 类型叫 constructor 也不会取到 Object 这个函数上去：没有配样式就没有形状
      expect(node.shape).toBeUndefined()
      expect(resolved.layers[1].nodes.find((n) => n.id === 't')!.folds).toEqual([`${name}.f`])
      expect(Object.hasOwn(resolved.folded!, name)).toBe(false)
      expect(resolved.folded![`${name}.f`]).toBe('t')
      // 字段级的映射上卷到表上
      expect(resolved.links.map((k) => [k.source, k.target])).toEqual([[name, 't']])
      expect(() => layoutStrata(resolved)).not.toThrow()
      const g = toKgdiffGraph(resolved)
      expect(g.nodes.find((n) => n.id === name)!.replaces).toBeUndefined()
    })
  }
})
