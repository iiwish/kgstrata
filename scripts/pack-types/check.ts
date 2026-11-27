// 按包名引入构建产物的类型（TypeScript 的自引用会走 package.json 的 exports，落到 dist/*.d.ts）
import { Strata, type HoverInfo, type LabelOptions, type SelectInfo, type StrataContext, type StrataView } from 'kgstrata'
import { layoutFromJSON, layoutStrata, layoutToJSON, registerLocale, type DataIssue, type NodeStyle, type Normalized, type PlacedNode, type Resolved, type ResolvedNode, type StrataData, type StrataLayout, type StrataLayoutJSON } from 'kgstrata/headless'
import { buildModel, Styler, type BaseEdge, type BaseNode, type EdgeEnd, type EdgeKind, type EdgeLook, type ExtraEdges, type LabelLook, type Looks, type Model, type NodeLook, type StyleState } from 'kgstrata/internals'
import { pathPlugin, type PathApi } from 'kgstrata/path'
import { diffPlugin, type DiffApi, type DiffView } from 'kgstrata/diff'
import { auditColors, auditPlugin, type AuditApi, type AuditTarget, type MappingAudit } from 'kgstrata/audit'

// path 插件用 declare module '../engine' 给 StrataView 补的 path 字段，在产物里仍然成立
export const path: StrataView['path'] = ['ent:a', 'tbl:b']
// diff 插件补的 diff 字段也一样
export const diffView: StrataView['diff'] = { layer: 'union', t: 0, selectedHunk: null } satisfies DiffView
// audit 插件补的 audit 字段也一样
export const auditView: StrataView['audit'] = { selected: { kind: 'join', id: 'tbl:a|fk|tbl:b' } satisfies AuditTarget }
// 插件拿得到 setData 给的数据
export const ctxData = (ctx: StrataContext): StrataData | null => ctx.data
export const audits = (a: AuditApi): [MappingAudit | null, number | undefined, string] => [a.show({ maxHops: 2, joinTypes: ['fk'] }), a.current?.maxHops, auditColors('light').gap]
// 核心入口不再转出底层的东西
// @ts-expect-error Model 只在 kgstrata/internals
export type NoModel = import('kgstrata').Model
export type Internals = [typeof buildModel, typeof Styler, Model, StyleState]
// 渲染器每帧画的样子、渲染器的底子只在 kgstrata/internals；核心和 headless 只留契约和函数签名里的类型
// @ts-expect-error Looks 只在 kgstrata/internals
export type NoLooks = import('kgstrata').Looks
// @ts-expect-error NodeLook 只在 kgstrata/internals
export type NoNodeLook = import('kgstrata/headless').NodeLook
// @ts-expect-error BaseNode 只在 kgstrata/internals
export type NoBaseNode = import('kgstrata/headless').BaseNode
// @ts-expect-error EdgeLook 只在 kgstrata/internals
export type NoEdgeLook = import('kgstrata').EdgeLook
export type RenderTypes = [Looks, NodeLook, EdgeLook, BaseNode, BaseEdge, LabelLook, ExtraEdges, EdgeEnd, EdgeKind]
export type ContractTypes = [Resolved, Normalized, PlacedNode, StrataLayout, StrataLayoutJSON, ResolvedNode, NodeStyle, DataIssue, import('kgstrata').Resolved]
// 标签规则从核心入口拿得到，选项和 setLabels 收的是同一个类型
export const labels: LabelOptions = { mode: 'auto', layers: { catalog: 'always' }, types: { field: 'hover' }, nodes: { 'ent:a': 'always' }, max: 80 }
export const setLabels = (s: Strata) => s.setLabels(s.labels)
export const select = (e: SelectInfo) => e.node?.layerName ?? e.source
export const io = [layoutToJSON, layoutFromJSON, registerLocale] as const
// StrataView 不是 any：不存在的字段要报错
// @ts-expect-error 没有这个字段
export const nope: StrataView['nope'] = 1

export type Checks = [typeof Strata, typeof layoutStrata, StrataData, PathApi, DiffApi]
export const auditOnly = [auditPlugin()] as const
export const plugins = [pathPlugin(), diffPlugin({ locale: 'en', wasm: { compute: new URL('https://example.com/compute.wasm'), layout: '/layout.wasm' } })] as const

// 0.2 的命名：shot 的选项、follow、hero、四边的 inset、指针位置都在 pointer 里、路径的 progress
export const naming = (s: Strata, h: HoverInfo, p: PathApi, d: DiffApi) => {
  s.shot('layer', { layer: 'table', duration: 0 })
  s.setInset({ right: 320, top: 48 })
  const follow: boolean = s.setFollow(!s.follow).follow
  p.shot({ duration: 0 })
  d.shot('h1', { duration: 0 })
  return [follow, s.hero.mix, s.view.heroMix, h.pointer.x, p.progress.reached, s.inset.left, s.spread] as const
}
// 状态都是和它同名的 getter；展开的事件和 getter 同名
export const getters = (s: Strata) => {
  const off = s.on('expanded', (ids: string[]) => ids.length)
  const v: StrataView = s.view
  const read: [string | null, string | null, string | null, string[]] = [s.selected, s.focus, s.group, s.expanded]
  return [off, v, read] as const
}
// @ts-expect-error getView() 改成了 getter view
export const oldGetView = (s: Strata) => s.getView()
// @ts-expect-error 事件 expand 改名为 expanded
export const oldExpand = (s: Strata) => s.on('expand', () => {})
// @ts-expect-error 0.1 的 shot(name, layer, duration) 不认了
export const oldShot = (s: Strata) => s.shot('layer', 'table')
// @ts-expect-error 插件不能伪造核心事件
export const noEmit = (ctx: StrataContext) => ctx.emit('hover', null)

// React 入口：按包名解析，组件的 props 类型是全的；插件的接口按 plugins 的顺序交给 onReady
import { createElement } from 'react'
import 'kgstrata/react/styles.css'
import { LayerList, StrataCanvas, useStrataState, type LayerListProps, type StrataCanvasProps, type StrataState } from 'kgstrata/react'
import { PathList, type PathItem } from 'kgstrata/react/path'
import { DiffPanel, changesByLayer } from 'kgstrata/react/diff'
import { AuditPanel, auditItems, type AuditItem } from 'kgstrata/react/audit'
// 渲染器不是公开成员了
// @ts-expect-error renderer 是私有的
export const noRenderer = (s: Strata) => s.renderer

declare const data: StrataData
export const canvas = createElement(StrataCanvas<typeof plugins>, {
  data,
  plugins,
  onReady: (s: Strata, [p, d]: [PathApi, DiffApi]) => {
    p.play([])
    void d.active
    void s.layers
  },
  onExpanded: (ids: string[]) => void ids,
  children: createElement(LayerList, { counts: { onto: 1 } }),
})
// @ts-expect-error onExpand 改名为 onExpanded
export const oldOnExpand: StrataCanvasProps = { data, onExpand: () => {} }
// @ts-expect-error 没有这个 prop
export const badProp: LayerListProps = { nope: 1 }
export const paths: PathItem[] = [{ id: 'p', question: 'q', nodes: [] }]
export type ReactChecks = [StrataCanvasProps, StrataState['hero'], typeof useStrataState, typeof PathList, typeof DiffPanel, typeof changesByLayer, typeof AuditPanel, typeof auditItems, AuditItem]
