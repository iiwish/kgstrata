// 底层入口 kgstrata/internals：写“接管模式”的插件要的东西——建模型、核心的样式、渲染器的类型、每帧管线的几个工具。
// 这里的东西**不受 semver 保护**：小版本（0.x 的 y 位、1.x 以后的次版本）都可能改，升级时看 CHANGELOG。
// 稳定的接口在 kgstrata（核心）、kgstrata/headless（不带渲染）。
// 不引入 kgdiff，也不引入 react（tests/modules.test.ts、scripts/check-pack.mjs 守着）。渲染器只引类型：实例由 ctx.renderer 给。
export { DEFAULT_SHAPE, buildModel, magnitudeOf, nodeColor, type Model } from './model.js'
export { Styler, type Spotlight, type StyleState } from './styler.js'
export { composeFrame, fadePresence, spotlightOf } from './pipeline.js'
export type { RendererBase, RendererOptions, StrataRenderer } from './renderer/index.js'
export type { PlatesInput, PlateInput } from './renderer/plates.js'
// 每帧画的样子和渲染器的底子：叠加层的 paint、模式的 looks 写的就是它们
export type { BaseEdge, BaseNode, EdgeEnd, EdgeKind, EdgeLook, ExtraEdges, LabelLook, Looks, NodeLook } from './types.js'
