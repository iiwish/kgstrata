// 按包名引入构建产物的类型（TypeScript 的自引用会走 package.json 的 exports，落到 dist/*.d.ts）
import { Strata, type StrataView } from 'kgstrata'
import { layoutStrata, type StrataData } from 'kgstrata/headless'
import { pathPlugin, type PathApi } from 'kgstrata/path'
import { diffPlugin, type DiffApi } from 'kgstrata/diff'

// path 插件用 declare module '../engine' 给 StrataView 补的 path 字段，在产物里仍然成立
export const path: StrataView['path'] = ['ent:a', 'tbl:b']
// StrataView 不是 any：不存在的字段要报错
// @ts-expect-error 没有这个字段
export const nope: StrataView['nope'] = 1

export type Checks = [typeof Strata, typeof layoutStrata, StrataData, PathApi, DiffApi]
export const plugins = [pathPlugin(), diffPlugin({ locale: 'en' })] as const

// React 入口：按包名解析，组件的 props 类型是全的；插件的接口按 plugins 的顺序交给 onReady
import { createElement } from 'react'
import 'kgstrata/react/styles.css'
import { LayerList, StrataCanvas, useStrataState, type LayerListProps, type StrataCanvasProps, type StrataState } from 'kgstrata/react'
import { PathList, type PathItem } from 'kgstrata/react/path'
import { DiffPanel, changesByLayer } from 'kgstrata/react/diff'

declare const data: StrataData
export const canvas = createElement(StrataCanvas<typeof plugins>, {
  data,
  plugins,
  onReady: (s: Strata, [p, d]: [PathApi, DiffApi]) => {
    p.play([])
    void d.active
    void s.layers
  },
  children: createElement(LayerList, { counts: { onto: 1 } }),
})
// @ts-expect-error 没有这个 prop
export const badProp: LayerListProps = { nope: 1 }
export const paths: PathItem[] = [{ id: 'p', question: 'q', nodes: [] }]
export type ReactChecks = [StrataCanvasProps, StrataState['hero'], typeof useStrataState, typeof PathList, typeof DiffPanel, typeof changesByLayer]
