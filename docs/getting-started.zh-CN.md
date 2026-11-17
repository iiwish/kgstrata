# 上手

[English](getting-started.md)

这篇从一个空页面讲到画出两层的 3D 图，再讲容器尺寸、销毁，以及最容易碰到的几个问题。

## 安装

```sh
npm install kgstrata three
# 或者：pnpm add kgstrata three
```

`three` 是 peer 依赖，范围是 `>=0.170.0 <0.200.0`，只实测过 `0.187`。`d3-force` 是普通依赖，会自动装上。

核心、`kgstrata/path`、`kgstrata/headless`、`kgstrata/react` 只要这两个包，里面都不加载 WebAssembly。一个最小页面（[原生示例](../examples/vanilla)）连 three.js 打包约 686 kB，gzip 后约 180 kB。

按需再装：

| 想用 | 另装 |
|---|---|
| React 组件（`kgstrata/react`、`kgstrata/react/path`） | `react`、`react-dom`（18 或 19；只实测过 19） |
| 两版对比（`kgstrata/diff`、`kgstrata/react/diff`） | `@kgdiff/core`、`@kgdiff/scene`、`@kgdiff/layout`（`^0.12.1`） |
| three 的 TypeScript 类型 | `@types/three`（范围和 `three` 一样） |

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
- 单击选中，点空白处取消；
- 双击有子节点的节点（带字段的表）展开或收起。

## 容器尺寸

- 画布取宿主元素的尺寸（`clientWidth` × `clientHeight`）。宿主没有高度，画布就只有 1 像素高。用固定高度、`inset: 0`、flex 或 grid 都行。
- 引擎每一帧都看一次宿主的尺寸，尺寸变了不用调任何方法。镜头还停在总览（用户没动过）时，宽高比一变就重新取景。
- 右侧有面板挡着时，`strata.setInset(px)` 让画面在没被挡住的那块里居中。
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

只有 `kgstrata/diff` 和 `kgstrata/react/diff` 会带上 kgdiff，它要加载三个 `.wasm` 文件（未压缩共约 1.9 MB）。这些文件用 `new URL(..., import.meta.url)` 定位，打包工具不能挪动它们：

| 打包工具 | 情况 |
|---|---|
| Vite 8 | 开发和构建都不用配置。 |
| Vite 6 | 构建不用配置；开发服务器要把这几个包从依赖预构建里排除（见下）。 |
| webpack、esbuild、Rollup | 没测过。 |

```ts
// vite.config.ts（Vite 6 的开发服务器）
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: { exclude: ['@kgdiff/core', '@kgdiff/layout', '@kgdiff/scene', '@kgdiff/compute'] },
})
```

不引入 `kgstrata/diff` 就不用管这些：别的入口里没有 WebAssembly，连 kgdiff 的类型都不引入。

### 包太大的警告

Vite 对超过 500 kB 的块会警告，大头是 three.js。嫌吵可以调大 `build.chunkSizeWarningLimit`，或者用动态 `import()` 延后加载视图。

## 接下来

- [data.zh-CN.md](data.zh-CN.md)：数据契约和校验
- [api.zh-CN.md](api.zh-CN.md)：全部选项、方法和事件
- [react.zh-CN.md](react.zh-CN.md)：`<StrataCanvas>` 和面板
- [plugins.zh-CN.md](plugins.zh-CN.md)：路径回放、两版对比、自己写插件
