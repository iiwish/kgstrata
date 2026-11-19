// 核心入口：画一张多层的 3D 图。路径回放、看变化是插件，各有自己的入口（./path、./diff），用 strata.use() 装上。
// 这里的引入闭包里没有 kgdiff，也没有路径回放和看变化的代码（tests/modules.test.ts 守着）。
// 这里只放稳定的接口；写接管模式要的模型、样式、渲染器在 kgstrata/internals（不受 semver 保护）。
export {
  Strata,
  type HeroInfo,
  type HoverInfo,
  type Inset,
  type LayerInfo,
  type LayoutProvider,
  type NodeInfo,
  type PointerPosition,
  type SelectInfo,
  type SelectSource,
  type ShotName,
  type ShotOptions,
  type StrataOptions,
  type StrataView,
} from './engine/index.js'
export {
  Emitter,
  type FitOptions,
  type FrameInfo,
  type ModeHandle,
  type PlatePoint,
  type StrataChange,
  type StrataContext,
  type StrataEvents,
  type StrataMode,
  type StrataOverlay,
  type StrataPlugin,
  type ViewSlot,
} from './plugin.js'
export type { Spotlight } from './styler.js'
export * from './headless.js'
