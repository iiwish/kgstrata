// 输入 → 要画的图，分三步：
// validate 查（有问题的项不会悄悄消失，都记在 issues 里）；
// normalize 整理（补缺省、丢掉出错的项，别的什么都不丢）；
// project 按“展开了哪些节点”收起、上卷，按层装好。

import { DEFAULT_LOCALE, message, type Locale, type MessageKey } from './locale.js'
import { DARK } from './theme.js'
import type {
  DataIssue,
  NodeStyle,
  NormalNode,
  NormalRelation,
  Normalized,
  RelationSpec,
  Resolved,
  ResolvedEdge,
  ResolvedGroup,
  ResolvedLayer,
  ResolvedLink,
  ResolvedNode,
  StrataData,
} from './types.js'

/** 内置的几种节点类型的样子；nodeStyles 选项里同名的会盖掉它 */
export const DEFAULT_NODE_STYLES: Record<string, NodeStyle> = {
  relation: { shape: 'octa' },
  table: { shape: 'tablet', mono: true },
  field: { shape: 'tablet', mono: true },
  metric: { shape: 'prism' },
  document: { shape: 'page' },
}

export interface ResolveOptions {
  /** 节点类型 → 画成什么样 */
  nodeStyles?: Record<string, NodeStyle>
  /** 没写颜色的组从这里按顺序取；缺省是夜景主题（DARK）的色板 */
  palette?: readonly string[]
  /** 问题描述（DataIssue.message）用的语言，缺省 'en'。code 不随语言变 */
  locale?: Locale
}

export interface ValidateOptions {
  /** 问题描述（DataIssue.message）用的语言，缺省 'en'。code 不随语言变 */
  locale?: Locale
}

const groupKey = (grouping: string, group: string) => `${grouping}/${group}`

/** 关系没写 id 时按“起点|类型|终点”生成 */
export function relationId(r: RelationSpec): string {
  return r.id ?? `${r.source}|${r.type ?? ''}|${r.target}`
}

/**
 * 查一遍数据，把问题列出来。error 是这一项用不了（会被丢掉），warning 是能用但多半写错了。
 * 不抛异常：让调用的人决定怎么办。
 */
export function validate(data: StrataData, opts: ValidateOptions = {}): DataIssue[] {
  const locale = opts.locale ?? DEFAULT_LOCALE
  const issues: DataIssue[] = []
  // 消息键缺省就是 issue.<code>；同一个 code 有几种说法的（bad-weight、duplicate-relation）单独给键
  type Vars = Record<string, string | number>
  const text = (code: string, vars: Vars, key?: MessageKey) => message(locale, key ?? (`issue.${code}` as MessageKey), vars)
  const err = (code: string, vars: Vars, id?: string, key?: MessageKey) => issues.push({ level: 'error', code, message: text(code, vars, key), id })
  const warn = (code: string, vars: Vars, id?: string, key?: MessageKey) => issues.push({ level: 'warning', code, message: text(code, vars, key), id })
  if ((data as { version?: unknown }).version !== 2) err('version', { got: String((data as { version?: unknown }).version) })

  const groupings = new Map<string, Set<string>>()
  for (const g of data.groupings ?? []) {
    if (groupings.has(g.id)) {
      warn('duplicate-grouping', { grouping: g.id }, g.id)
      continue
    }
    const ids = new Set<string>()
    for (const x of g.groups) {
      if (ids.has(x.id)) warn('duplicate-group', { grouping: g.id, group: x.id }, x.id)
      ids.add(x.id)
    }
    groupings.set(g.id, ids)
  }

  const layers = new Set<string>()
  for (const l of data.layers) {
    if (layers.has(l.id)) {
      err('duplicate-layer', { layer: l.id }, l.id)
      continue
    }
    if (l.grouping !== undefined && !groupings.has(l.grouping)) warn('unknown-grouping', { layer: l.id, grouping: l.grouping }, l.id)
    layers.add(l.id)
  }

  const nodes = new Map<string, { layer: string; parent?: string }>()
  for (const n of data.nodes) {
    if (nodes.has(n.id)) {
      err('duplicate-node', { node: n.id }, n.id)
      continue
    }
    if (!layers.has(n.layer)) {
      err('unknown-layer', { node: n.id, layer: n.layer }, n.id)
      continue
    }
    nodes.set(n.id, { layer: n.layer, parent: n.parent })
    for (const [dim, gid] of Object.entries(n.groups ?? {})) {
      if (!groupings.get(dim)?.has(gid)) warn('unknown-group', { node: n.id, grouping: dim, group: gid }, n.id)
    }
    if (typeof n.weight === 'number' && !(n.weight >= 0 && n.weight <= 1)) warn('bad-weight', { node: n.id }, n.id, 'issue.bad-node-weight')
  }
  for (const [id, n] of nodes) {
    if (n.parent === undefined) continue
    const p = nodes.get(n.parent)
    if (!p) err('unknown-parent', { node: id, parent: n.parent }, id)
    else if (p.layer !== n.layer) err('parent-layer', { node: id, parent: n.parent }, id)
    else {
      // 顺着 parent 往上走，走回自己就是成环了
      const seen = new Set([id])
      let cur: string | undefined = n.parent
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur)
        cur = nodes.get(cur)?.parent
      }
      if (cur === id) err('parent-cycle', { node: id }, id)
    }
  }

  const rels = new Set<string>()
  for (const r of data.relations) {
    const id = relationId(r)
    if (!nodes.has(r.source) || !nodes.has(r.target)) {
      err('dangling-relation', { relation: id, node: !nodes.has(r.source) ? r.source : r.target }, id)
      continue
    }
    if (rels.has(id)) {
      if (r.id !== undefined) err('duplicate-relation', { relation: id }, id)
      else warn('duplicate-relation', { relation: id }, id, 'issue.duplicate-relation-implicit')
      continue
    }
    rels.add(id)
    if (r.source === r.target) warn('self-relation', { relation: id }, id)
    if (r.weight !== undefined && !(Number.isFinite(r.weight) && r.weight > 0)) warn('bad-weight', { relation: id }, id, 'issue.bad-relation-weight')
  }
  return issues
}

/**
 * 整理：出错的项丢掉（都在 issues 里），缺省补上，别的什么都不丢——收在父节点里的子节点、连到它们身上的关系都在。
 * - 层的分组维度缺省是第一个；
 * - 关系的 id 没写就生成，分量不合法的按 1 算；
 * - parent 不存在、不同层、成环的当作没有 parent。
 */
export function normalize(data: StrataData, opts: ResolveOptions = {}): { data: Normalized; issues: DataIssue[] } {
  const issues = validate(data, { locale: opts.locale })
  const bad = new Set(issues.filter((i) => i.level === 'error' && i.id !== undefined).map((i) => `${i.code}:${i.id}`))
  const styles = { ...DEFAULT_NODE_STYLES, ...opts.nodeStyles }
  const palette = opts.palette ?? DARK.palette

  // ── 分组 ──
  const groups: ResolvedGroup[] = []
  const groupIds = new Set<string>()
  const groupingIds = new Set<string>()
  for (const g of data.groupings ?? []) {
    if (groupingIds.has(g.id)) continue
    groupingIds.add(g.id)
    for (const x of g.groups) {
      const id = groupKey(g.id, x.id)
      if (groupIds.has(id)) continue
      groupIds.add(id)
      groups.push({ id, name: x.name, color: x.color ?? palette[groups.length % palette.length], grouping: g.id })
    }
  }
  const firstGrouping = data.groupings?.[0]?.id

  // ── 层 ──
  const layers: Normalized['layers'] = []
  const layerAt = new Map<string, number>()
  for (const l of data.layers) {
    if (layerAt.has(l.id)) continue
    layerAt.set(l.id, layers.length)
    const grouping = l.grouping !== undefined && groupingIds.has(l.grouping) ? l.grouping : firstGrouping
    layers.push(grouping !== undefined ? { id: l.id, name: l.name, grouping } : { id: l.id, name: l.name })
  }

  // ── 节点 ──
  const nodes: NormalNode[] = []
  const seen = new Set<string>()
  for (const n of data.nodes) {
    if (seen.has(n.id)) continue
    const li = layerAt.get(n.layer)
    if (li === undefined) continue
    seen.add(n.id)
    const grouping = layers[li].grouping
    // 用户给的字符串当键时只认自己的属性：id 叫 constructor、toString、__proto__ 也是合法的，不能读到原型上去
    const gid = grouping !== undefined && n.groups !== undefined && Object.hasOwn(n.groups, grouping) ? n.groups[grouping] : undefined
    const key = grouping !== undefined && gid !== undefined ? groupKey(grouping, gid) : undefined
    const style = n.type !== undefined && Object.hasOwn(styles, n.type) ? styles[n.type] : undefined
    const node: NormalNode = { id: n.id, layer: li, label: n.label }
    if (key !== undefined && groupIds.has(key)) node.group = key
    if (n.type !== undefined) node.type = n.type
    if (style?.shape !== undefined) node.shape = style.shape
    if (style?.mono !== undefined) node.mono = style.mono
    if (n.parent !== undefined && !bad.has(`unknown-parent:${n.id}`) && !bad.has(`parent-layer:${n.id}`) && !bad.has(`parent-cycle:${n.id}`)) node.parent = n.parent
    if (typeof n.weight === 'number' && Number.isFinite(n.weight)) node.weight = n.weight
    if (n.attrs) node.attrs = n.attrs
    nodes.push(node)
  }

  // ── 关系 ──
  const relations: NormalRelation[] = []
  const seenRel = new Set<string>()
  for (const r of data.relations) {
    const id = relationId(r)
    if (!seen.has(r.source) || !seen.has(r.target) || seenRel.has(id)) continue
    seenRel.add(id)
    const rel: NormalRelation = { id, source: r.source, target: r.target, weight: r.weight !== undefined && Number.isFinite(r.weight) && r.weight > 0 ? r.weight : 1 }
    if (r.type !== undefined) rel.type = r.type
    if (r.label !== undefined) rel.label = r.label
    if (r.primary) rel.primary = true
    if (r.attrs) rel.attrs = r.attrs
    relations.push(rel)
  }

  const out: Normalized = { groups, layers, nodes, relations }
  if (data.title !== undefined) out.title = data.title
  return { data: out, issues }
}

/**
 * 生成要画的那张图。expanded：展开了哪些节点（id）。
 * - 一个节点画不画出来：顶层的都画；子节点要它的父节点画出来、而且展开了。
 * - 没画出来的节点算在最近的画出来的祖先头上；连到它身上的关系上卷到那个祖先，
 *   同一对节点之间同类型的合成一条、分量相加；两端收进了同一个节点的不画。
 * - 两端同层的关系是那一层的边，两端不同层的是映射。
 */
export function project(data: Normalized, expanded: Iterable<string> = []): Resolved {
  const open = expanded instanceof Set ? (expanded as Set<string>) : new Set(expanded)
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  // 每个节点算在谁头上（画出来的节点算在自己头上）
  const shown = new Map<string, string>()
  const topOf = (id: string): string => {
    const hit = shown.get(id)
    if (hit !== undefined) return hit
    const n = byId.get(id)!
    let out = id
    if (n.parent !== undefined) {
      const p = topOf(n.parent)
      // 父节点自己画出来了、而且展开了：它画出来；否则跟着父节点算
      out = p === n.parent && open.has(n.parent) ? id : p
    }
    shown.set(id, out)
    return out
  }
  const layers: ResolvedLayer[] = data.layers.map((l) => ({ ...l, nodes: [], edges: [] }))
  // 没有原型的对象：节点 id 叫 constructor、__proto__ 时也只是普通的键
  const folded: Record<string, string> = Object.create(null)
  const nodeOf = new Map<string, ResolvedNode>()
  for (const n of data.nodes) {
    const top = topOf(n.id)
    if (top !== n.id) {
      folded[n.id] = top
      continue
    }
    const { layer, parent, ...rest } = n
    const node: ResolvedNode = rest
    if (parent !== undefined) node.parent = parent
    layers[layer].nodes.push(node)
    nodeOf.set(n.id, node)
  }
  for (const n of data.nodes) {
    const top = folded[n.id]
    if (top === undefined) continue
    const host = nodeOf.get(top)!
    ;(host.folds ??= []).push(n.id)
  }

  const links: ResolvedLink[] = []
  /** 上卷后合在一起的：起点 + 类型 + 终点 → 那一条 */
  const rolled = new Map<string, ResolvedEdge | ResolvedLink>()
  for (const r of data.relations) {
    const s = topOf(r.source)
    const t = topOf(r.target)
    // 两端收进了同一个节点（同一张表的两个字段之间）：平时画不出来
    if (s === t) continue
    const ls = byId.get(s)!.layer
    const lt = byId.get(t)!.layer
    const lifted = s !== r.source || t !== r.target
    const key = `${s}|${r.type ?? ''}|${t}`
    if (lifted) {
      const hit = rolled.get(key)
      if (hit) {
        hit.weight = (hit.weight ?? 1) + r.weight
        hit.members!.push(r.id)
        if (r.primary && ls !== lt) (hit as ResolvedLink).primary = true
        continue
      }
    }
    const item: ResolvedEdge & ResolvedLink = { id: lifted ? key : r.id, source: s, target: t, weight: r.weight }
    if (r.type !== undefined) item.type = r.type
    if (lifted) item.members = [r.id]
    else if (r.attrs) item.attrs = r.attrs
    if (ls === lt) {
      if (r.label ?? r.type) item.label = r.label ?? r.type
      layers[ls].edges!.push(item)
    } else {
      if (r.label !== undefined) item.label = r.label
      if (r.primary) item.primary = true
      links.push(item)
    }
    if (lifted) rolled.set(key, item)
  }

  const resolved: Resolved = { groups: data.groups, layers, links, folded }
  if (data.title !== undefined) resolved.title = data.title
  return resolved
}

/** 一步到位：整理，再按“全部收起”生成要画的图 */
export function resolve(data: StrataData, opts: ResolveOptions = {}): { resolved: Resolved; issues: DataIssue[] } {
  const n = normalize(data, opts)
  return { resolved: project(n.data), issues: n.issues }
}
