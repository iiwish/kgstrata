// 不带渲染的入口：校验、整理、布局、多层的比例、穿透关系和契约的类型。
// 不引入 three，也不引入 kgdiff：可以在 Node、Worker 里预先算好布局，或者只拿来查数据。
export { normalize, project, resolve, validate, relationId, DEFAULT_NODE_STYLES, type ResolveOptions, type ValidateOptions } from './resolve.js'
// 语言和主题都是纯数据：不带渲染也能用（validate 的问题描述、normalize 的色板）
export { DEFAULT_LOCALE, MESSAGES, StrataError, localeOf, message, type Locale, type MessageKey } from './locale.js'
export { DARK, createTheme, type DeepPartial, type Theme } from './theme.js'
export { layoutStrata, placeChildren, unionData } from './layout.js'
export { stageOf, scaleAt, levelAt, type Stage, type StageInput } from './stage.js'
export { bridgesOf, type Bridge } from './bridge.js'
export type * from './types.js'
