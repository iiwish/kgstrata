// 不带渲染的入口：校验、整理、布局、多层的比例、穿透关系和契约的类型。
// 不引入 three，也不引入 kgdiff：可以在 Node、Worker 里预先算好布局，或者只拿来查数据。
export { normalize, project, resolve, validate, relationId, isFatal, DEFAULT_NODE_STYLES, type ResolveOptions, type ValidateOptions } from './resolve.js'
// 语言和主题都是纯数据：不带渲染也能用（validate 的问题描述、normalize 的色板）
export {
  DEFAULT_LOCALE,
  MESSAGES,
  StrataError,
  builtinLocaleOf,
  fallbackChain,
  hasLocale,
  localeOf,
  message,
  messagesOf,
  pickText,
  registerLocale,
  type BuiltinLocale,
  type Locale,
  type MessageKey,
  type MessageOverrides,
  type Messages,
} from './locale.js'
export { DARK, backdropOf, createTheme, type DeepPartial, type Theme } from './theme.js'
export { layoutStrata, placeChildren, unionData } from './layout.js'
// 布局的存取：算好的布局存成 JSON、拿回来交给 StrataOptions.layout
export { checkLayout, layoutFromJSON, layoutToJSON } from './layout-io.js'
export { stageOf, scaleAt, levelAt, type Stage, type StageInput } from './stage.js'
export { bridgesOf, type Bridge } from './bridge.js'
// 契约的类型：输入数据，和 headless 函数签名里出现的整理、布局结果。渲染器每帧画的样子（Looks 那一族）、
// 渲染器的底子（BaseNode、BaseEdge）只给写渲染和接管模式的人，在 kgstrata/internals
export type {
  AttrValue,
  Attrs,
  BlockType,
  DataIssue,
  GroupSpec,
  GroupTerritory,
  GroupingSpec,
  LayerSpec,
  LayoutOptions,
  LinkClass,
  MappingBlock,
  NodeShape,
  NodeSpec,
  NodeStyle,
  NormalNode,
  NormalRelation,
  Normalized,
  PlacedNode,
  RelationSpec,
  Resolved,
  ResolvedEdge,
  ResolvedGroup,
  ResolvedLayer,
  ResolvedLink,
  ResolvedNode,
  StrataData,
  StrataLayout,
  StrataLayoutJSON,
} from './types.js'
