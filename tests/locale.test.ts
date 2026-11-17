import { describe, expect, it } from 'vitest'
import { toKgdiffGraph } from '../src/diff'
import { DEFAULT_LOCALE, MESSAGES, StrataError, localeOf, message } from '../src/locale'
import { ViewRegistry } from '../src/plugin'
import { normalize, project, validate } from '../src/resolve'
import type { StrataData } from '../src/types'

// 给人看的字按语言出，机器读的 code 不随语言变

/** 每一种问题都占一条的数据 */
function broken(): StrataData {
  return {
    version: 1 as 2,
    layers: [
      { id: 'onto', name: '本体', grouping: 'nope' },
      { id: 'onto', name: '重复的层' },
      { id: 'table', name: '表' },
    ],
    groupings: [
      { id: 'domain', groups: [{ id: 'g', name: 'G' }, { id: 'g', name: 'G2' }] },
      { id: 'domain', groups: [] },
    ],
    nodes: [
      { id: 'a', layer: 'onto', label: 'a', groups: { domain: 'ghost' }, weight: 2 },
      { id: 'a', layer: 'onto', label: '重名' },
      { id: 'lost', layer: 'nowhere', label: 'lost' },
      { id: 'b', layer: 'onto', label: 'b', parent: 'ghost' },
      { id: 'c', layer: 'table', label: 'c', parent: 'a' },
      { id: 'd', layer: 'onto', label: 'd', parent: 'e' },
      { id: 'e', layer: 'onto', label: 'e', parent: 'd' },
    ],
    relations: [
      { id: 'dangling', source: 'a', target: 'ghost' },
      { id: 'r', source: 'a', target: 'b' },
      { id: 'r', source: 'b', target: 'a' },
      { source: 'a', target: 'c' },
      { source: 'a', target: 'c' },
      { id: 'self', source: 'a', target: 'a' },
      { id: 'neg', source: 'a', target: 'b', weight: -1 },
    ],
  }
}

describe('消息表', () => {
  it('缺省是英文；认不得的语言也退回英文', () => {
    expect(DEFAULT_LOCALE).toBe('en')
    expect(localeOf(undefined)).toBe('en')
    expect(localeOf('fr')).toBe('en')
    expect(localeOf('zh-CN')).toBe('zh-CN')
  })

  it('两种语言的键一条不少', () => {
    expect(Object.keys(MESSAGES['zh-CN']).sort()).toEqual(Object.keys(MESSAGES.en).sort())
    for (const loc of ['en', 'zh-CN'] as const) for (const v of Object.values(MESSAGES[loc])) expect(v.length).toBeGreaterThan(0)
  })

  it('插值：{名字} 换成值，没给的原样留着', () => {
    expect(message('en', 'issue.duplicate-layer', { layer: 'onto' })).toBe('Layer onto is duplicated')
    expect(message('zh-CN', 'issue.duplicate-layer', { layer: 'onto' })).toBe('层 onto 重复了')
    expect(message('en', 'issue.duplicate-layer')).toBe('Layer {layer} is duplicated')
    // 值里带花括号也不会被再换一遍
    expect(message('en', 'issue.duplicate-layer', { layer: '{layer}' })).toBe('Layer {layer} is duplicated')
  })
})

describe('validate 的问题描述', () => {
  it('缺省是英文，zh-CN 是中文；code、level、id 两种语言一模一样', () => {
    const en = validate(broken())
    const zh = validate(broken(), { locale: 'zh-CN' })
    expect(en.length).toBeGreaterThan(10)
    expect(en.map(({ message: _m, ...rest }) => rest)).toEqual(zh.map(({ message: _m, ...rest }) => rest))
    const codes = new Set(en.map((i) => i.code))
    for (const c of ['version', 'duplicate-grouping', 'duplicate-group', 'duplicate-layer', 'unknown-grouping', 'duplicate-node', 'unknown-layer', 'unknown-group', 'bad-weight', 'unknown-parent', 'parent-layer', 'parent-cycle', 'dangling-relation', 'duplicate-relation', 'self-relation']) {
      expect(codes, c).toContain(c)
    }
    for (const i of en) {
      expect(i.message).not.toMatch(/\p{Script=Han}/u)
      expect(i.message).not.toMatch(/\{\w+\}/)
    }
    for (const i of zh) {
      expect(i.message).toMatch(/\p{Script=Han}/u)
      expect(i.message).not.toMatch(/\{\w+\}/)
    }
  })

  it('几条英文的原文', () => {
    const en = validate(broken())
    expect(en.find((i) => i.code === 'version')?.message).toBe('Contract version should be 2, got 1')
    expect(en.find((i) => i.code === 'dangling-relation')?.message).toBe('Relation dangling points to a node that does not exist (ghost)')
    expect(en.find((i) => i.code === 'bad-weight' && i.id === 'a')?.message).toBe('Weight of node a should be between 0 and 1')
    expect(en.find((i) => i.code === 'bad-weight' && i.id === 'neg')?.message).toBe('Weight of relation neg should be a positive number; treated as 1')
    expect(en.find((i) => i.code === 'duplicate-relation' && i.level === 'warning')?.message).toMatch(/^Two identical relations a\|\|c/)
  })

  it('几条中文的原文', () => {
    const zh = validate(broken(), { locale: 'zh-CN' })
    expect(zh.find((i) => i.code === 'version')?.message).toBe('契约版本应为 2，收到的是 1')
    expect(zh.find((i) => i.code === 'parent-cycle' && i.id === 'd')?.message).toBe('节点 d 的 parent 链绕回了自己')
    expect(zh.find((i) => i.code === 'unknown-group')?.message).toBe('节点 a 在维度 domain 里的组 ghost 不存在')
  })

  it('normalize 的选项里给语言，issues 跟着它', () => {
    expect(normalize(broken()).issues[0].message).toBe('Contract version should be 2, got 1')
    expect(normalize(broken(), { locale: 'zh-CN' }).issues[0].message).toBe('契约版本应为 2，收到的是 1')
  })
})

describe('报错', () => {
  it('StrataError 带 code，消息按语言', () => {
    const en = new ViewRegistry()
    expect(() => en.register('hero', { get: () => 0, set: () => {} })).toThrow('View key hero belongs to the core')
    const zh = new ViewRegistry('zh-CN')
    zh.register('path', { get: () => 0, set: () => {} })
    try {
      zh.register('path', { get: () => 0, set: () => {} })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(StrataError)
      expect((e as StrataError).code).toBe('view-key-taken')
      expect((e as StrataError).message).toBe('视图状态的 path 已经有插件登记了')
    }
  })
})

describe('交给 kgdiff 的显示用标签', () => {
  const data = project(
    normalize({
      version: 2,
      layers: [{ id: 'l', name: 'L' }],
      nodes: [
        { id: 'p', layer: 'l', label: 'p' },
        { id: 'c', layer: 'l', label: 'c', parent: 'p' },
        { id: 'x', layer: 'l', label: 'x' },
      ],
      relations: [{ source: 'p', target: 'x' }],
    }).data,
    ['p'],
  )

  it('没写类型的关系、包含关系按语言出字；谓词不变', () => {
    const en = toKgdiffGraph(data)
    const zh = toKgdiffGraph(data, {}, 'zh-CN')
    expect(en.edges.map((e) => [e.predicate, e.label])).toEqual([
      ['strata:parent', 'part of'],
      ['strata:related', 'related to'],
    ])
    expect(zh.edges.map((e) => [e.predicate, e.label])).toEqual([
      ['strata:parent', '包含于'],
      ['strata:related', '关联'],
    ])
  })
})
