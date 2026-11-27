// 三国、特洛伊两份演示数据共用的构建：从上到下 事件 / 阵营 / 人物 三层。
// 阵营之间是联盟、敌对、取代；人物之间是君臣、亲属、夫妻、交情、对手；人物效力于哪一方是两层之间的映射，一个人可以先后效力好几方（多对多）。
// 人物层里家族收着成员（曹氏收着曹操、曹丕、曹植），平时收起，成员的关系上卷到家族上，展开才看到每个人。
// 事件层：每个事件牵涉哪几方，事件之间是前因后果。中英文两版：id 一样，只有给人看的字不同。

import type { GroupSpec, MessageOverrides, NodeSpec, NodeStyle, RelationSpec, StrataData } from 'kgstrata'
import type { DemoLang, DemoPath } from './data'

export type Text = readonly [zh: string, en: string]
export const say = (t: Text, lang: DemoLang) => (lang === 'zh' ? t[0] : t[1])

/** 关系类型：机器读的 id 两版一样，显示的字在 label 上 */
export const REL = {
  ally: ['联盟', 'allied with'],
  rival: ['敌对', 'at war with'],
  replace: ['取代', 'replaced'],
  serves: ['效力', 'serves'],
  lord: ['君臣', 'served by'],
  kin: ['亲属', 'family of'],
  marriage: ['夫妻', 'married to'],
  friend: ['交情', 'friends with'],
  sworn: ['结义', 'sworn brothers'],
  foe: ['对手', 'fought'],
  slew: ['斩杀', 'killed'],
  patron: ['庇护', 'protects'],
  captive: ['俘获', 'captured'],
  involves: ['牵涉', 'involves'],
  leads: ['引出', 'led to'],
} as const satisfies Record<string, Text>
export type RelType = keyof typeof REL
const rel = (type: RelType, lang: DemoLang) => ({ type, label: say(REL[type], lang) })

/** 映射审计拿这些人物关系当下层的“连接”，看阵营之间的关系在人物里接不接得上。
 *  君臣不算：它几乎都在同一方里面，算进来只会多出一串“没有阵营关系对应”的同阵营关系 */
export const PERSON_LINKS: RelType[] = ['kin', 'marriage', 'friend', 'sworn', 'foe', 'slew', 'patron', 'captive']

/** 节点类型 → 画成什么样。家族能展开出成员，事件画成书页 */
export const NODE_STYLES: Record<string, NodeStyle> = {
  family: { shape: 'tablet', childNoun: { 'zh-CN': '人', en: 'members' } },
  side: { shape: 'octa' },
  event: { shape: 'page' },
}

export interface SagaSpec {
  title: Text
  /** 三层的名字：事件 / 阵营 / 人物 */
  layers: { event: Text; side: Text; person: Text }
  groupingName: Text
  groups: { id: string; name: Text; color: string }[]
  /** [id, 名字, 组] */
  sides: [string, Text, string][]
  sideLinks: [string, string, RelType][]
  /** [id, 名字]；家族的组跟着第一个成员 */
  families: [string, Text][]
  /** [id, 名字, 效力于哪几方（第一个是主要的，空的是哪方都不算）, 家族] */
  people: [string, Text, string[], string?][]
  personLinks: [string, string, RelType][]
  /** [id, 名字, 牵涉哪几方] */
  events: [string, Text, string[]][]
  eventLinks: [string, string][]
}

export const sid = (id: string) => `s:${id}`
export const pid = (id: string) => `p:${id}`
export const fid = (id: string) => `f:${id}`
export const eid = (id: string) => `e:${id}`

export interface Saga {
  groups(lang?: DemoLang): GroupSpec[]
  panorama(lang?: DemoLang): StrataData
  layered(count: number, lang?: DemoLang): StrataData
  diffAfter(base: StrataData, lang?: DemoLang): StrataData
  DIFF_REPLACES: Record<string, string[]>
  paths(lang?: DemoLang): DemoPath[]
  layeredPaths(count: number, lang?: DemoLang): DemoPath[]
  NODE_STYLES: Record<string, NodeStyle>
  AUDIT: { upper: string; lower: string; joinTypes: string[] }
  messages(lang: DemoLang): MessageOverrides
}

export interface SagaParts {
  spec: SagaSpec
  /** 第二版：在一份数据上做一组改动 */
  edit: (d: StrataData, lang: DemoLang, h: EditHelpers) => void
  replaces?: Record<string, string[]>
  paths: { id: string; question: Text; nodes: string[] }[]
  layeredPath: { id: string; question: Text; nodes: string[] }
  /** 映射审计面板里的说法 */
  audit: { zh: MessageOverrides; en: MessageOverrides }
}

export interface EditHelpers {
  rel: typeof rel
  dropNode: (id: string) => void
  dropRelation: (source: string, target: string, type?: string) => void
  person: (id: string, name: Text, group: string | undefined, parent?: string) => NodeSpec
}

export function makeSaga(parts: SagaParts): Saga {
  const S = parts.spec
  const sideGroup = new Map(S.sides.map(([id, , g]) => [id, g]))
  const groupOfPerson = (sides: string[]) => (sides.length ? sideGroup.get(sides[0]) : undefined)
  const firstMember = new Map<string, string[]>()
  for (const [, , sides, fam] of S.people) if (fam && !firstMember.has(fam)) firstMember.set(fam, sides)
  const grp = (g: string | undefined) => (g !== undefined ? { camp: g } : undefined)

  const groups = (lang: DemoLang = 'zh'): GroupSpec[] => S.groups.map((g) => ({ id: g.id, name: say(g.name, lang), color: g.color }))

  function panorama(lang: DemoLang = 'zh'): StrataData {
    const nodes: NodeSpec[] = [
      ...S.sides.map(([id, name, g]): NodeSpec => ({ id: sid(id), layer: 'side', label: say(name, lang), type: 'side', groups: grp(g) })),
      ...S.families.map(([id, name]): NodeSpec => ({ id: fid(id), layer: 'person', label: say(name, lang), type: 'family', groups: grp(groupOfPerson(firstMember.get(id) ?? [])) })),
      ...S.people.map(([id, name, sides, fam]): NodeSpec => ({ id: pid(id), layer: 'person', label: say(name, lang), groups: grp(groupOfPerson(sides)), ...(fam ? { parent: fid(fam) } : {}) })),
    ]
    const relations: RelationSpec[] = [
      ...S.sideLinks.map(([a, b, t]): RelationSpec => ({ source: sid(a), target: sid(b), ...rel(t, lang) })),
      ...S.personLinks.map(([a, b, t]): RelationSpec => ({ source: pid(a), target: pid(b), ...rel(t, lang) })),
      ...S.people.flatMap(([id, , sides]) => sides.map((s, k): RelationSpec => ({ source: pid(id), target: sid(s), ...rel('serves', lang), weight: k === 0 ? 2 : 1 }))),
    ]
    return {
      version: 2,
      title: say(S.title, lang),
      layers: [
        { id: 'side', name: say(S.layers.side, lang) },
        { id: 'person', name: say(S.layers.person, lang) },
      ],
      groupings: [{ id: 'camp', name: say(S.groupingName, lang), groups: groups(lang) }],
      nodes,
      relations,
    }
  }

  /** 3 层（或更多）：在阵营上面加事件层。从上到下：事件 / 阵营 / 人物 */
  function layered(count: number, lang: DemoLang = 'zh'): StrataData {
    const d = panorama(lang)
    if (count < 3) return d
    d.layers.unshift({ id: 'event', name: say(S.layers.event, lang) })
    for (const [id, name, sides] of S.events) {
      d.nodes.push({ id: eid(id), layer: 'event', label: say(name, lang), type: 'event', groups: grp(sideGroup.get(sides[0])) })
      sides.forEach((s, k) => d.relations.push({ source: eid(id), target: sid(s), ...rel('involves', lang), weight: k === 0 ? 2 : 1 }))
    }
    for (const [a, b] of S.eventLinks) d.relations.push({ source: eid(a), target: eid(b), ...rel('leads', lang) })
    return d
  }

  function diffAfter(base: StrataData, lang: DemoLang = 'zh'): StrataData {
    const d: StrataData = structuredClone(base)
    const dropNode = (id: string) => {
      d.nodes = d.nodes.filter((n) => n.id !== id && n.parent !== id)
      const alive = new Set(d.nodes.map((n) => n.id))
      d.relations = d.relations.filter((r) => alive.has(r.source) && alive.has(r.target))
    }
    const dropRelation = (s: string, t: string, type?: string) => {
      d.relations = d.relations.filter((r) => !(r.source === s && r.target === t && (type === undefined || r.type === type)))
    }
    const person = (id: string, name: Text, g: string | undefined, parent?: string): NodeSpec => {
      const n: NodeSpec = { id: pid(id), layer: 'person', label: say(name, lang), groups: grp(g), ...(parent ? { parent } : {}) }
      d.nodes.push(n)
      return n
    }
    parts.edit(d, lang, { rel, dropNode, dropRelation, person })
    // 只在多层数据里才有的事件：base 里没有事件层就不加
    const ids = new Set(d.nodes.map((n) => n.id))
    d.relations = d.relations.filter((r) => ids.has(r.source) && ids.has(r.target))
    const seen = new Set<string>()
    d.relations = d.relations.filter((r) => {
      const k = `${r.source}|${r.type ?? ''}|${r.target}`
      if (r.source === r.target || seen.has(k)) return false
      seen.add(k)
      return true
    })
    return d
  }

  return {
    groups,
    panorama,
    layered,
    diffAfter,
    DIFF_REPLACES: parts.replaces ?? {},
    paths: (lang: DemoLang = 'zh') => parts.paths.map((p) => ({ id: p.id, question: say(p.question, lang), nodes: [...p.nodes] })),
    layeredPaths: (count: number, lang: DemoLang = 'zh') =>
      count < 3 ? [] : [{ id: parts.layeredPath.id, question: say(parts.layeredPath.question, lang), nodes: [...parts.layeredPath.nodes] }],
    NODE_STYLES,
    AUDIT: { upper: 'side', lower: 'person', joinTypes: PERSON_LINKS },
    messages: (lang: DemoLang) => (lang === 'zh' ? parts.audit.zh : parts.audit.en),
  }
}
