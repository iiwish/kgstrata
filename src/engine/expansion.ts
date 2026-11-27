// 数据到模型，和节点的展开：整理过的数据（什么都不丢）、全部收起时的那张图和它的布局都缓存着；
// 展开只在收起时的布局上添子节点（顶层节点不动），按现在展开的节点重新生成要画的图、重建模型。

import { layoutStrata, placeChildren } from '../layout.js'
import { checkLayout } from '../layout-io.js'
import { buildModel } from '../model.js'
import { project } from '../resolve.js'
import { Styler } from '../styler.js'
import type { DataIssue, LayoutOptions, Normalized, Resolved, StrataLayout } from '../types.js'
import type { Core } from './core.js'

/** 盘面的半径随节点数长（按最大的那层算）：几十个节点 26，几千个节点按面积放大，节点不至于叠成一团 */
export function radiusFor(data: Resolved) {
  const most = Math.max(0, ...data.layers.map((l) => l.nodes.length))
  return 26 * Math.max(1, Math.sqrt(most / 110))
}

export class Expansion {
  /** 展开的节点（id，原样：包括数据里没有子节点的） */
  ids: Set<string>
  /** 整理过的数据：什么都不丢的那一份。展开、收起都从它重新生成要画的图 */
  normal: Normalized | null = null
  /** 全部收起时的那张图，和它的布局：展开只在这份布局上添子节点 */
  collapsed: Resolved | null = null
  baseLayout: StrataLayout | null = null

  constructor(initial: Iterable<string> = []) {
    this.ids = new Set(initial)
  }

  /** 换了数据：收起时的图重新生成，布局重新算 */
  load(normal: Normalized, layout: (collapsed: Resolved) => StrataLayout) {
    this.normal = normal
    this.collapsed = project(normal)
    this.baseLayout = layout(this.collapsed)
  }

  /** 结构没变、只是重新整理了一遍（换主题时组的颜色变了）：布局照用 */
  renormalize(normal: Normalized) {
    this.normal = normal
    this.collapsed = project(normal)
  }

  /** 现在展开着的节点（数据里有子节点的才算） */
  get expanded(): string[] {
    const parents = new Set<string>()
    for (const n of this.normal?.nodes ?? []) if (n.parent !== undefined) parents.add(n.parent)
    return [...this.ids].filter((id) => parents.has(id))
  }

  /** 换一组展开的节点；和现在的一样就返回 false */
  set(ids: Iterable<string>): boolean {
    const next = new Set(ids)
    if (next.size === this.ids.size && [...next].every((id) => this.ids.has(id))) return false
    this.ids = next
    return true
  }

  /** 展开或收起一个节点之后的那一组 */
  toggled(id: string, on: boolean): Set<string> {
    const next = new Set(this.ids)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }

  /** 按现在展开的节点生成要画的图和它的布局；还没有数据是 null */
  graph(): { data: Resolved; layout: StrataLayout } | null {
    if (!this.normal || !this.collapsed || !this.baseLayout) return null
    const open = this.expanded
    if (open.length === 0) return { data: this.collapsed, layout: this.baseLayout }
    const data = project(this.normal, open)
    return { data, layout: placeChildren(this.baseLayout, data) }
  }
}

/** 按现在展开的节点重建全景的模型和样式 */
export function rebuildModel(c: Core) {
  const g = c.expansion.graph()
  if (!g) return
  c.model = buildModel(g.data, g.layout, c.theme)
  c.styler = new Styler(c.model, c.labels)
  c.stale = false
}

/** 整理数据用的选项：节点的样子、色板（主题的）、问题描述的语言 */
export const normalizeOptions = (c: Core) => ({ nodeStyles: c.options.nodeStyles, palette: c.theme.palette, locale: c.locale })

/**
 * 布局一份要画的图：盘面的半径随节点数长，基准层按选项。有注入的布局先问它；它给的用不了时
 * 往 issues 里记一条 'layout-incomplete'，改为自己算
 */
export function layoutOf(c: Core, data: Resolved, issues?: DataIssue[]): StrataLayout {
  const defaults: LayoutOptions = { radius: radiusFor(data), anchor: c.options.anchor }
  const given = c.options.layout?.(data, defaults)
  if (given) {
    const issue = checkLayout(data, given, c.locale, c.messages)
    if (!issue) return given
    issues?.push(issue)
  }
  return layoutStrata(data, defaults)
}
