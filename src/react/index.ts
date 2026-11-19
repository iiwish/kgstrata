// React 入口 kgstrata/react：<StrataCanvas> 管一个实例的创建、换数据、销毁，几个 hook 拿实例和它的状态，
// 再加上核心的几个面板（层列表、主角跟随、主次、层距、镜头、悬停提示）。面板都可以不用。
// 运行时只依赖 react 和核心入口；引入闭包里没有 kgdiff，也没有路径回放和看变化的代码（tests/modules.test.ts 守着）。
// 路径和变化的面板在各自的子入口：kgstrata/react/path、kgstrata/react/diff。样式是可选的 kgstrata/react/styles.css。

export { CANVAS_CSS, CANVAS_HOST_STYLE, StrataCanvas, canvasFallback, type StrataCanvasProps } from './canvas.js'
export { StrataProvider, useLocale, usePlugin, useStrata, useStrataEvent, useStrataOr, useStrataState, useText, type StrataProviderProps } from './context.js'
export {
  FollowToggle,
  HeroMixSlider,
  LayerList,
  NodeTip,
  SpreadSlider,
  ViewButtons,
  type FollowToggleProps,
  type HeroMixSliderProps,
  type LayerCounts,
  type LayerListProps,
  type NodeTipProps,
  type PanelProps,
  type SpreadSliderProps,
} from './panels.js'
// 不碰 DOM 的底层：自己写组件、或者不用 <StrataCanvas> 时用
export {
  EMPTY_STATE,
  bindEvents,
  createStateStore,
  layerCount,
  mountStrata,
  textFor,
  themeRule,
  themeVars,
  tipLines,
  type MountResult,
  type PluginApis,
  type StateStore,
  type StrataEventProps,
  type StrataFactory,
  type StrataSource,
  type StrataState,
  type StrataStateKey,
  type TextFn,
} from './store.js'
