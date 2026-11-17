// 给人看的字：数据校验的问题描述、报错、交给 kgdiff 的显示用标签、React 面板的界面文字。机器读的东西（问题的 code、错误的 code、谓词）不在这里。
// 纯数据和一个小函数，不引入 three：不带渲染的入口（validate）也用它。

/** 界面语言。缺省 'en' */
export type Locale = 'en' | 'zh-CN'

export const DEFAULT_LOCALE: Locale = 'en'

/** 英文是基准：键都从这里来，别的语言要一条不少 */
const EN = {
  // ── validate：DataIssue.message ──
  'issue.version': 'Contract version should be 2, got {got}',
  'issue.duplicate-grouping': 'Grouping {grouping} is duplicated; the later one is ignored',
  'issue.duplicate-group': 'Group {group} in grouping {grouping} is duplicated',
  'issue.duplicate-layer': 'Layer {layer} is duplicated',
  'issue.unknown-grouping': 'Layer {layer} uses grouping {grouping}, which does not exist',
  'issue.duplicate-node': 'Node {node} is duplicated (node ids must be unique across all layers)',
  'issue.unknown-layer': 'Node {node} is in layer {layer}, which does not exist',
  'issue.unknown-group': 'Node {node} refers to group {group} in grouping {grouping}, which does not exist',
  'issue.bad-node-weight': 'Weight of node {node} should be between 0 and 1',
  'issue.unknown-parent': 'Parent {parent} of node {node} does not exist',
  'issue.parent-layer': 'Node {node} and its parent {parent} are not in the same layer',
  'issue.parent-cycle': 'The parent chain of node {node} loops back to itself',
  'issue.dangling-relation': 'Relation {relation} points to a node that does not exist ({node})',
  'issue.duplicate-relation': 'Relation {relation} is duplicated',
  'issue.duplicate-relation-implicit': 'Two identical relations {relation}: give each an explicit id when the same pair of nodes has several relations of the same type',
  'issue.self-relation': 'Relation {relation} connects a node to itself and will not be drawn',
  'issue.bad-relation-weight': 'Weight of relation {relation} should be a positive number; treated as 1',
  // ── 报错 ──
  'error.plugin-installed': 'Plugin {name} is already installed',
  'error.view-core-key': 'View key {key} belongs to the core; plugins cannot register it',
  'error.view-key-taken': 'View key {key} is already registered by another plugin',
  'error.webgl-unavailable': 'WebGL is not available in this browser or environment, so the 3D view cannot be created',
  // ── 交给 kgdiff 的显示用标签（谓词本身不变） ──
  'label.related': 'related to',
  'label.part-of': 'part of',
  // ── React 面板（kgstrata/react*）的界面文字 ──
  'ui.layers': 'Layers',
  'ui.layer-hide': 'Hide {layer}',
  'ui.layer-show': 'Show {layer}',
  'ui.layer-hide-title': 'Hide this layer',
  'ui.layer-show-title': 'Show this layer',
  'ui.layer-changes': '{n} changes in this layer',
  'ui.follow': 'Hero follows',
  'ui.follow-title': 'The hero switches to whichever layer you select a node in, or the path reaches',
  'ui.hero-mix': 'Hero',
  'ui.hero-mix-title': 'Drag for a continuous transition between the two layers (setHeroMix)',
  'ui.spread': 'Spacing',
  'ui.views': 'Camera',
  'ui.overview': 'Overview',
  'ui.overlay': 'Stack',
  'ui.tip-expand': '{n} fields · double-click to expand',
  'ui.tip-collapse': 'Double-click to collapse',
  'ui.paths': 'Questions',
  'ui.step-skipped': 'This step is in a hidden layer and was skipped',
  'ui.diff-family.added': 'Added',
  'ui.diff-family.removed': 'Removed',
  'ui.diff-family.content': 'Changed',
  'ui.diff-family.structure': 'Moved',
  'ui.diff-family.identity': 'Merged',
  'ui.diff-layers': 'Version',
  'ui.diff-union': 'Both',
  'ui.diff-before': 'Before',
  'ui.diff-after': 'After',
  'ui.diff-play': 'Replay',
  'ui.diff-pause': 'Pause',
  'ui.diff-timeline': 'Replay position',
  'ui.diff-hunks': 'Changes',
} as const

export type MessageKey = keyof typeof EN

const ZH_CN: Record<MessageKey, string> = {
  'issue.version': '契约版本应为 2，收到的是 {got}',
  'issue.duplicate-grouping': '分组维度 {grouping} 重复了，后面的不算',
  'issue.duplicate-group': '分组维度 {grouping} 里的组 {group} 重复了',
  'issue.duplicate-layer': '层 {layer} 重复了',
  'issue.unknown-grouping': '层 {layer} 用的分组维度 {grouping} 不存在',
  'issue.duplicate-node': '节点 {node} 重复了（节点的 id 要全局唯一，跨层也不能重）',
  'issue.unknown-layer': '节点 {node} 所在的层 {layer} 不存在',
  'issue.unknown-group': '节点 {node} 在维度 {grouping} 里的组 {group} 不存在',
  'issue.bad-node-weight': '节点 {node} 的 weight 应在 0 到 1 之间',
  'issue.unknown-parent': '节点 {node} 的 parent {parent} 不存在',
  'issue.parent-layer': '节点 {node} 和它的 parent {parent} 不在同一层',
  'issue.parent-cycle': '节点 {node} 的 parent 链绕回了自己',
  'issue.dangling-relation': '关系 {relation} 指向不存在的节点（{node}）',
  'issue.duplicate-relation': '关系 {relation} 重复了',
  'issue.duplicate-relation-implicit': '有两条一样的关系 {relation}：同一对节点之间有几条同类型的关系时要自己写 id',
  'issue.self-relation': '关系 {relation} 两端是同一个节点，不会画出来',
  'issue.bad-relation-weight': '关系 {relation} 的 weight 应是正数，按 1 算',
  'error.plugin-installed': '插件 {name} 已经装过了',
  'error.view-core-key': '视图状态的 {key} 是核心的，插件不能登记',
  'error.view-key-taken': '视图状态的 {key} 已经有插件登记了',
  'error.webgl-unavailable': '这个浏览器（或环境）拿不到 WebGL，画不了 3D 图',
  'label.related': '关联',
  'label.part-of': '包含于',
  'ui.layers': '层',
  'ui.layer-hide': '隐藏{layer}',
  'ui.layer-show': '显示{layer}',
  'ui.layer-hide-title': '隐藏这一层',
  'ui.layer-show-title': '显示这一层',
  'ui.layer-changes': '这一层有 {n} 处变化',
  'ui.follow': '主角跟随',
  'ui.follow-title': '选中哪一层的节点、路径走到哪一层，主角就换到哪一层',
  'ui.hero-mix': '主次',
  'ui.hero-mix-title': '拖动看两层之间的连续过渡；接口是 setHeroMix',
  'ui.spread': '层距',
  'ui.views': '镜头',
  'ui.overview': '总览',
  'ui.overlay': '叠看',
  'ui.tip-expand': '{n} 个字段 · 双击展开',
  'ui.tip-collapse': '双击收起',
  'ui.paths': '问题',
  'ui.step-skipped': '这一步在隐藏的层里，跳过了',
  'ui.diff-family.added': '新增',
  'ui.diff-family.removed': '删除',
  'ui.diff-family.content': '修改',
  'ui.diff-family.structure': '调整',
  'ui.diff-family.identity': '合并',
  'ui.diff-layers': '版本',
  'ui.diff-union': '叠加',
  'ui.diff-before': '之前',
  'ui.diff-after': '之后',
  'ui.diff-play': '回放',
  'ui.diff-pause': '暂停',
  'ui.diff-timeline': '回放进度',
  'ui.diff-hunks': '变化列表',
}

export const MESSAGES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en: EN, 'zh-CN': ZH_CN }

/** 认得的语言原样返回，别的（undefined、拼错的）退回缺省的 'en' */
export function localeOf(locale: string | undefined): Locale {
  return locale !== undefined && locale in MESSAGES ? (locale as Locale) : DEFAULT_LOCALE
}

/** 取一条消息，把 {名字} 换成 vars 里的值；vars 里没有的原样留着 */
export function message(locale: Locale | undefined, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const text = MESSAGES[localeOf(locale)][key]
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))
}

/** 带机器可读 code 的错误：调用方按 code 分支，message 按语言给人看 */
export class StrataError extends Error {
  constructor(
    readonly code: string,
    msg: string,
  ) {
    super(msg)
    this.name = 'StrataError'
  }
}
