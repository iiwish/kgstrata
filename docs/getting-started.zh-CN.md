# 上手

[English](getting-started.md)

这篇从一个空页面讲到画出两层的 3D 图，再讲容器尺寸、销毁，以及最容易碰到的几个问题。

## 安装

```sh
npm install kgstrata three
# 或者：pnpm add kgstrata three
```

`three` 是 peer 依赖，范围是 `>=0.154.0 <0.200.0`：0.154 到 0.187 实际跑过（0.153 着色器报错）。`d3-force` 是普通依赖，会自动装上。

核心、`kgstrata/path`、`kgstrata/audit`、`kgstrata/headless`、`kgstrata/react`（连同 `react/path`、`react/audit`）只要这两个包，里面都不加载 WebAssembly。一个最小页面（[原生示例](../examples/vanilla)）连 three.js 打包约 686 kB，gzip 后约 180 kB。

按需再装：

| 想用 | 另装 |
|---|---|
| React 组件（`kgstrata/react`、`kgstrata/react/path`） | `react`、`react-dom`（18 或 19；实测过 18.3 和 19） |
| 两版对比（`kgstrata/diff`、`kgstrata/react/diff`） | `@kgdiff/core`、`@kgdiff/scene`、`@kgdiff/compute`（`^0.12.3`） |
| three 的 TypeScript 类型 | `@types/three`（范围和 `three` 一样） |

类型声明在 `skipLibCheck: false` 下查过：TypeScript 5.2、5.6、7.0 × `@types/three` 0.160、0.170、0.187，`moduleResolution` 分 `bundler` 和 `nodenext`（仓库里的 `pnpm check:types-compat`）。比 5.2 更老的 TypeScript 没试过。

## 最小页面

引擎要一个有实际宽高的元素，它在里面放一个 `<canvas>` 铺满。

```html
<div id="graph" style="position: fixed; inset: 0"></div>
<script type="module" src="./main.ts"></script>
```

```ts
// main.ts
import { Strata, type StrataData } from 'kgstrata'

const data: StrataData = {
  version: 2,
  layers: [
    { id: 'onto', name: '本体' },
    { id: 'table', name: '物理表' },
  ],
  nodes: [
    { id: 'onto:company', layer: 'onto', label: '企业' },
    { id: 'onto:person', layer: 'onto', label: '自然人' },
    { id: 'tbl:company', layer: 'table', label: 'company', type: 'table' },
    { id: 'tbl:person', layer: 'table', label: 'person', type: 'table' },
  ],
  relations: [
    { source: 'onto:person', target: 'onto:company', type: '任职' },
    { source: 'tbl:person', target: 'tbl:company', type: 'fk' },
    { source: 'onto:company', target: 'tbl:company', type: '落地' },
    { source: 'onto:person', target: 'tbl:person', type: '落地' },
  ],
}

const strata = new Strata(document.getElementById('graph')!, { hero: 'onto', locale: 'zh-CN' })
const issues = strata.setData(data) // 数据没问题时是 []
```

两端在同一层的关系留在那一层里；两端在不同层的是映射，画在两个平面之间。完整的契约见 [data.zh-CN.md](data.zh-CN.md)。

鼠标能做的：

- 拖动旋转，滚轮缩放；
- 悬停一个节点，点亮它的邻居和同一个对应块里的节点；
- 单击选中，点空白处取消（`select` 事件带 `source: 'pointer'`；`strata.select(id)` 走同一条路，带 `source: 'api'`）；
- 双击有子节点的节点（带字段的表）展开或收起。

## 容器尺寸

- 画布取宿主元素的尺寸（`clientWidth` × `clientHeight`）。宿主没有高度，画布就只有 1 像素高。用固定高度、`inset: 0`、flex 或 grid 都行。
- 引擎每一帧都看一次宿主的尺寸，尺寸变了不用调任何方法。镜头还停在总览（用户没动过）时，宽高比一变就重新取景。
- React 的 `<StrataCanvas>` 是一个有定位的容器，缺省 `width: 100%; height: 100%; min-height: 320px`，父元素没有高度时也有高度；面板放在它里面，`position: absolute` 就行。
- 有面板挡着画面时，`strata.setInset({ right: 320 })`（`top`、`right`、`bottom`、`left` 随便给几边，CSS 像素）让画面在没被挡住的那块里居中。
- 设备像素比最多按 2 算。

## 销毁

视图不用了就调 `dispose()`：停掉动画循环、释放 GPU 资源、摘掉画布、丢掉 WebGL 上下文。浏览器同时能开的上下文有限，反复创建的视图（切路由、热更新、React 严格模式）一定要销毁。

```ts
strata.dispose()
// 可以调几次。销毁以后再调别的方法都安静地什么也不做。
```

配合 Vite 的热更新：

```ts
import.meta.hot?.dispose(() => strata.dispose())
```

`kgstrata/react` 的 `<StrataCanvas>` 卸载时会自己销毁。

## 打包工具

核心的几个入口（`kgstrata`、`/path`、`/headless`、`/react`……）是普通的 ESM，下面这些打包工具都不用配置。看变化的入口带着 kgdiff，它用 `new URL('…', import.meta.url)` 找自己的三个 `.wasm` 文件，各打包工具的差别就在这里。表里是用打好的 kgstrata 0.3.0 包和 kgdiff 0.12.3 实测的结果，每种构建都在浏览器里跑过（Vite 6、8 也跑了开发服务器，Next.js 也跑了服务端渲染）。在仓库里用 `pnpm check:bundlers --serve` 可以重跑构建和浏览器里的验收：

| 打包工具 | 核心 | `kgstrata/diff` |
|---|---|---|
| Vite 8 | 不用配置 | 不用配置 |
| Vite 6 | 不用配置 | 构建不用配置；开发服务器要 `optimizeDeps.exclude`（见下） |
| webpack 5 | 不用配置 | 不用配置（有一条无害的警告，见下） |
| Next.js 16（Turbopack 和 `--webpack`） | 不用配置；服务端渲染不崩 | 不用配置 |
| Rollup | 不用配置 | 加 `importMetaAssets()`（见下） |
| esbuild | 不用配置 | `--loader:.wasm=file` 加 `wasm` 选项（见下） |
| Parcel 2 | 要开 `packageExports`（见下） | 要开 `packageExports` |

Safari 和 Firefox 没有测过。

**Vite 6**，开发服务器里用 `kgstrata/diff`：

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: { exclude: ['@kgdiff/core', '@kgdiff/layout', '@kgdiff/scene', '@kgdiff/compute'] },
})
```

**webpack 5** 用 `kgstrata/diff` 时会打一条 `Critical dependency: the request of a dependency is an expression`，来自 `@kgdiff/compute/dist/loader.js`（只在 Node 里走到的一处 `import()`，浏览器走不到）。无害；要消掉它：

```js
// webpack.config.js
export default {
  // …
  ignoreWarnings: [{ module: /@kgdiff[\\/]compute/, message: /Critical dependency/ }],
}
```

**Rollup** 不复制 `new URL(…, import.meta.url)` 引用的文件。加上 [`@web/rollup-plugin-import-meta-assets`](https://www.npmjs.com/package/@web/rollup-plugin-import-meta-assets)：

```js
// rollup.config.js
import { importMetaAssets } from '@web/rollup-plugin-import-meta-assets'

export default {
  // …
  plugins: [/* node-resolve 等 */ importMetaAssets()],
}
```

**esbuild** 也不处理 `new URL(…, import.meta.url)`：缺省时页面去要 `/wasm/compute.wasm`，得到 404。用 `file` 加载器加载 `.wasm`，把地址交给看变化插件：

```ts
// main.ts
import { Strata } from 'kgstrata'
import { diffPlugin } from 'kgstrata/diff'
import compute from '@kgdiff/compute/compute.wasm'
import layout from '@kgdiff/compute/layout.wasm'
import formats from '@kgdiff/compute/formats.wasm'

const strata = new Strata(document.getElementById('app')!)
const diff = strata.use(diffPlugin({ wasm: { compute, layout, formats } }))
strata.setData(after)
await diff.show(before, after)
```

```ts
// wasm.d.ts，给 TypeScript 用
declare module '*.wasm' {
  const url: string
  export default url
}
```

```sh
esbuild main.ts --bundle --format=esm --outdir=dist --loader:.wasm=file
```

esbuild 把三个文件复制到 `dist/`（`compute-<hash>.wasm`……），引入得到的是它们相对页面的路径，所以 `index.html` 要放在 `dist/` 下面；加 `--public-path` 就是绝对地址。要装 `@kgdiff/compute`（见 [plugins.zh-CN.md](plugins.zh-CN.md#两版对比kgstratadiff)）。

**Parcel 2** 缺省不读 `exports`，任何子入口（`kgstrata/react`、`kgstrata/diff`……）都解析不了。在你的 `package.json` 里打开：

```json
{
  "@parcel/resolver-default": { "packageExports": true }
}
```

## 常见问题

### 拿不到 WebGL

浏览器创建不了 WebGL 上下文（被禁用、显卡在黑名单里、上下文数到了上限）时，`new Strata()` 抛 `StrataError`，`code` 是 `'webgl-unavailable'`。这时页面上什么都没挂，原来的错误在 `error.cause` 上。

```ts
import { Strata, StrataError } from 'kgstrata'

try {
  const strata = new Strata(host, { locale: 'zh-CN' })
  strata.setData(data)
} catch (error) {
  if (error instanceof StrataError && error.code === 'webgl-unavailable') {
    host.textContent = error.message // 按 locale 选项的语言
  } else {
    throw error
  }
}
```

`<StrataCanvas>` 会接住这个错误，改为渲染 `fallback`。

用到一半上下文丢了（显卡驱动重置），引擎停下循环、发 `contextlost`；浏览器还回来时重新上传需要的东西、接着画，发 `contextrestored`。

### `setData` 返回了问题

`setData` 先查一遍数据：有问题的项（重复的 id、指向不存在的节点的关系、成环的 parent）丢掉，其余的照常画，问题列表作为返回值。每个问题都有固定的 `code`，见[问题码表](data.zh-CN.md#校验)。

### WebAssembly 和 `kgstrata/diff`

只有 `kgstrata/diff` 和 `kgstrata/react/diff` 会带上 kgdiff，它要加载三个 `.wasm` 文件（未压缩共约 1.9 MB）。各个打包工具怎么处理见[打包工具](#打包工具)。不引入 `kgstrata/diff` 就不用管这些：别的入口里没有 WebAssembly，连 kgdiff 的类型都不引入。

### 包太大的警告

Vite 对超过 500 kB 的块会警告，大头是 three.js。嫌吵可以调大 `build.chunkSizeWarningLimit`，或者用动态 `import()` 延后加载视图。

## 接下来

- [data.zh-CN.md](data.zh-CN.md)：数据契约和校验
- [api.zh-CN.md](api.zh-CN.md)：全部选项、方法和事件
- [react.zh-CN.md](react.zh-CN.md)：`<StrataCanvas>` 和面板
- [plugins.zh-CN.md](plugins.zh-CN.md)：路径回放、两版对比、自己写插件
