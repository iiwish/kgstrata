import { describe, expect, it } from 'vitest'
import { layoutStrata } from '../src/layout'
import { buildModel, type Model } from '../src/model'
import { normalize, project } from '../src/resolve'
import { Styler, type StyleState } from '../src/styler'
import type { LabelOptions, StrataData } from '../src/types'

// 名字什么时候出：缺省规则（小层全出、大层收起长尾、配角层留前几个），和 LabelOptions 的各级覆盖

/** 两层：上面一个只有三个节点的目录层，下面 n 个本体。本体的重要度用 weight 写死，o0 最重要 */
function data(n: number): StrataData {
  const nodes: StrataData['nodes'] = []
  const relations: StrataData['relations'] = []
  for (let k = 0; k < n; k++) nodes.push({ id: `o${k}`, layer: 'onto', label: `本体${k}`, type: k % 5 === 0 ? 'hub' : 'entity', weight: 1 - k / (n - 1) })
  for (let k = 1; k < n; k++) relations.push({ source: `o${k - 1}`, target: `o${k}`, type: 'rel' })
  for (let k = 0; k < 3; k++) {
    nodes.push({ id: `c${k}`, layer: 'cat', label: `目录${k}` })
    relations.push({ source: `c${k}`, target: `o${k}`, type: 'covers' })
  }
  relations.push({ source: 'c0', target: 'c1', type: 'rel' })
  return {
    version: 2,
    layers: [
      { id: 'cat', name: '目录' },
      { id: 'onto', name: '本体' },
    ],
    nodes,
    relations,
  }
}

function model(n: number): Model {
  const r = project(normalize(data(n)).data)
  return buildModel(r, layoutStrata(r, { radius: 26, anchor: 'onto' }))
}

const state = (over: Partial<StyleState> = {}): StyleState => ({ hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: 0, ...over })
/** 本体当主角、目录是紧挨着的配角 */
const hero = { levels: [0.5, 1], sides: [1, 0] }
/** 目录当主角、本体是配角 */
const side = { levels: [1, 0.5], sides: [0, 1] }

function alphas(m: Model, labels: LabelOptions = {}, s: Partial<StyleState> = {}) {
  const L = new Styler(m, labels).resolve(state(s))
  return (id: string) => L.nodes[m.index.get(id)!].label!.alpha
}
const shown = (m: Model, a: (id: string) => number, prefix: string) => m.base.nodes.filter((n) => n.id.startsWith(prefix) && a(n.id) > 0).length

describe('缺省的规则', () => {
  it('小层的名字全出（不再按排名收掉后四成）', () => {
    const m = model(22)
    const a = alphas(m, {}, { stage: hero })
    expect(shown(m, a, 'o')).toBe(22)
  })

  it('大层出前 40 个，长尾平时不出；悬停时邻居的名字出', () => {
    const m = model(50)
    const a = alphas(m)
    expect(shown(m, a, 'o')).toBe(40)
    expect(a('o0')).toBe(1)
    expect(a('o49')).toBe(0)
    const pointed = alphas(m, {}, { hover: m.index.get('o48')! })
    expect(pointed('o49')).toBe(1)
  })

  it('很大的层：星等前三档的都出，多于 40 个', () => {
    const m = model(200)
    const a = alphas(m)
    expect(shown(m, a, 'o')).toBeGreaterThan(40)
    expect(shown(m, a, 'o')).toBeLessThan(200)
  })

  it('配角层按规模收：三个节点的目录层名字都留着，大的配角层只留前几个', () => {
    const m = model(50)
    const asSide = alphas(m, {}, { stage: hero })
    for (const id of ['c0', 'c1', 'c2']) expect(asSide(id), id).toBeGreaterThan(0)
    const big = alphas(m, {}, { stage: side })
    const n = shown(m, big, 'o')
    expect(n).toBeGreaterThanOrEqual(8)
    expect(n).toBeLessThan(12)
  })

  it('聚焦一层时它的名字全出', () => {
    const m = model(50)
    const a = alphas(m, {}, { focusLayer: 1 })
    expect(shown(m, a, 'o')).toBe(50)
  })
})

describe('LabelOptions', () => {
  it("mode: 'always' 全出，配角层也出（淡一点）；'hover' 平时一个都不出", () => {
    const m = model(50)
    const all = alphas(m, { mode: 'always' }, { stage: side })
    expect(shown(m, all, 'o')).toBe(50)
    expect(all('o49')).toBeCloseTo(0.7)
    const none = alphas(m, { mode: 'hover' })
    expect(shown(m, none, 'o') + shown(m, none, 'c')).toBe(0)
    // 聚焦一层不让 hover 的名字出来；指着它才出
    expect(shown(m, alphas(m, { mode: 'hover' }, { focusLayer: 1 }), 'o')).toBe(0)
    expect(alphas(m, { mode: 'hover' }, { hover: m.index.get('o7')! })('o7')).toBe(1)
  })

  it('按层、按类型、按节点覆盖，越具体越优先', () => {
    const m = model(50)
    const a = alphas(m, { layers: { onto: 'hover' }, types: { hub: 'always' }, nodes: { o45: 'hover', o44: 'always' } })
    // 层：本体都不出；类型 hub（每五个一个）一直出；节点上写的盖过类型
    expect(a('o1')).toBe(0)
    expect(a('o10')).toBe(1)
    expect(a('o45')).toBe(0)
    expect(a('o44')).toBe(1)
    // 别的层照缺省
    expect(a('c0')).toBe(1)
  })

  it('一直出的名字在避让里优先', () => {
    const m = model(50)
    const L = new Styler(m, { nodes: { o49: 'always' } }).resolve(state())
    const L0 = new Styler(m).resolve(state())
    const i = m.index.get('o49')!
    expect(L.nodes[i].label!.priority).toBeCloseTo(L0.nodes[i].label!.priority + 1)
  })

  it('不认得的值按缺省', () => {
    const m = model(50)
    const a = alphas(m, { mode: 'nope' as never, nodes: { o49: 'show' as never } })
    expect(shown(m, a, 'o')).toBe(40)
  })
})
