import { describe, expect, it } from 'vitest'
import * as threekingdoms from '../demo/src/threekingdoms'
import * as troy from '../demo/src/troy'
import { auditMappings } from '../src/headless'
import { validate } from '../src/resolve'
import type { StrataData } from '../src/types'

// 效果页默认的演示数据：中文界面三国，英文界面特洛伊战争。宣传片的旁白按这里的审计结果、路径和第二版的改动来讲，改数据要对一遍

const ids = (d: StrataData) => new Set(d.nodes.map((n) => n.id))
const has = (d: StrataData, s: string, t: string, type: string) => d.relations.some((r) => r.source === s && r.target === t && r.type === type)

describe.each([
  ['三国', threekingdoms],
  ['特洛伊', troy],
] as const)('%s', (_, m) => {
  it('两层、三层，中英两版，加上第二版，校验都没有问题；id 两版一样', () => {
    for (const lang of ['zh', 'en'] as const) {
      expect(validate(m.panorama(lang))).toEqual([])
      expect(validate(m.layered(3, lang))).toEqual([])
      expect(validate(m.diffAfter(m.layered(3, lang), lang))).toEqual([])
      expect(validate(m.diffAfter(m.panorama(lang), lang))).toEqual([])
    }
    expect([...ids(m.layered(3, 'en'))]).toEqual([...ids(m.layered(3, 'zh'))])
    expect(m.layered(3).layers.map((l) => l.id)).toEqual(['event', 'side', 'person'])
  })

  it('家族收着成员', () => {
    const d = m.panorama('zh')
    const fams = d.nodes.filter((n) => n.type === 'family')
    expect(fams.length).toBeGreaterThanOrEqual(3)
    for (const f of fams) expect(d.nodes.filter((n) => n.parent === f.id).length).toBeGreaterThanOrEqual(2)
  })

  it('有人效力好几方（多对多）', () => {
    const d = m.panorama('zh')
    const sidesOf = new Map<string, number>()
    for (const r of d.relations) if (r.type === 'serves') sidesOf.set(r.source, (sidesOf.get(r.source) ?? 0) + 1)
    expect([...sidesOf.values()].some((n) => n >= 2)).toBe(true)
  })

  it('路径的每一步都在数据里，相邻两步之间有关系', () => {
    for (const lang of ['zh', 'en'] as const) {
      const d = m.layered(3, lang)
      const linked = new Set(d.relations.flatMap((r) => [`${r.source}|${r.target}`, `${r.target}|${r.source}`]))
      for (const p of [...m.layeredPaths(3, lang), ...m.paths(lang)]) {
        for (const id of p.nodes) expect(ids(d).has(id), `${p.id}: ${id}`).toBe(true)
        // 收在家族里的成员不走：回放时它算家族，会被跳过
        for (const id of p.nodes) expect(d.nodes.find((n) => n.id === id)?.parent, `${p.id}: ${id} 收在家族里`).toBeUndefined()
        for (let k = 1; k < p.nodes.length; k++) expect(linked.has(`${p.nodes[k - 1]}|${p.nodes[k]}`), `${p.id}: ${p.nodes[k - 1]} → ${p.nodes[k]}`).toBe(true)
      }
    }
  })
})

describe('三国：映射审计和第二版（演义）', () => {
  it('黄巾军在人物里没有人，两条和它有关的势力关系接不上；华佗哪一方都不算', () => {
    const a = auditMappings(threekingdoms.panorama('zh'), threekingdoms.AUDIT)!
    expect([a.upper, a.lower]).toEqual(['side', 'person'])
    expect(a.relations.filter((r) => r.status !== 'joined').map((r) => `${r.source}→${r.target}:${r.status}`).sort()).toEqual([
      's:han→s:yellow:unmapped',
      's:wei→s:yellow:unmapped',
    ])
    expect(a.unmappedUpper).toEqual(['s:yellow'])
    expect(a.unmappedLower).toEqual(['p:huatuo'])
  })

  it('演义：加了貂蝉、周仓、桃园结义，斩华雄的人从孙坚改成关羽，多了三英战吕布', () => {
    const d = threekingdoms.diffAfter(threekingdoms.layered(3, 'zh'), 'zh')
    for (const id of ['p:diaochan', 'p:zhoucang', 'e:hulao']) expect(ids(d).has(id)).toBe(true)
    expect(has(d, 'p:liubei', 'p:guanyu', 'sworn')).toBe(true)
    expect(has(d, 'p:guanyu', 'p:huaxiong', 'slew')).toBe(true)
    expect(has(d, 'p:sunjian', 'p:huaxiong', 'slew')).toBe(false)
  })
})

describe('特洛伊：映射审计和第二版（2004 年的电影）', () => {
  it('迈锡尼和皮洛斯是盟友，人物里接不上；色雷斯没有人；厄里斯哪一方都不算', () => {
    const a = auditMappings(troy.panorama('en'), troy.AUDIT)!
    expect(a.relations.filter((r) => r.status !== 'joined').map((r) => `${r.source}→${r.target}:${r.status}`).sort()).toEqual([
      's:mycenae→s:pylos:unreachable',
      's:troy→s:thrace:unmapped',
    ])
    expect(a.unmappedUpper).toEqual(['s:thrace'])
    expect(a.unmappedLower).toEqual(['p:eris'])
  })

  it('电影：众神没了，墨涅拉俄斯、埃阿斯死在赫克托耳手里，阿伽门农死在布里塞伊斯手里，帕特洛克罗斯成了表弟', () => {
    const d = troy.diffAfter(troy.layered(3, 'en'), 'en')
    for (const id of ['p:zeus', 'p:athena', 'p:aphrodite', 's:olympus', 'e:judgement']) expect(ids(d).has(id)).toBe(false)
    expect(ids(d).has('p:thetis')).toBe(true)
    expect(has(d, 'p:hector', 'p:menelaus', 'slew')).toBe(true)
    expect(has(d, 'p:briseis', 'p:agamemnon', 'slew')).toBe(true)
    expect(has(d, 'p:achilles', 'p:patroclus', 'kin')).toBe(true)
    expect(has(d, 'p:achilles', 'p:patroclus', 'friend')).toBe(false)
  })
})
