# 插件

[English](plugins.md)

这篇讲自带的两个插件（路径回放、两版对比），以及怎么按 `src/plugin.ts` 里的插件契约自己写一个。

核心 `Strata` 只管画一张多层的图，别的都是插件，用 `strata.use(plugin)` 装上。`use` 原样交回插件自己的接口，类型是全的：

```ts
const path = strata.use(pathPlugin()) // PathApi
```

同一个实例上，同名的插件只能装一个。插件在 `setData` 之前或之后装都可以。

## 路径回放：`kgstrata/path`

按顺序一步步点亮一串节点，标上序号，画出两步之间的路径段。典型的用法：一个问题先在本体上走，再落到表上，顺着外键走。

不用多装东西，这个入口不引入 kgdiff。

```ts
import { Strata } from 'kgstrata'
import { pathPlugin } from 'kgstrata/path'

const strata = new Strata(host)
const path = strata.use(pathPlugin())
strata.setData(data)

path.play(['onto:person', 'onto:investment', 'tbl:investment', 'tbl:company'])
path.on('step', ({ ids, reached }) => console.log(`${reached}/${ids.length}`))
```

### `PathApi`

| 成员 | 类型 | 含义 |
|---|---|---|
| `play(ids)` | `(ids: string[]) => void` | 按顺序走这些节点，每 0.8 秒一步（`STEP`）。收起的子节点算在画出来的祖先头上；连着两步落在同一个节点上合成一步；隐藏层里的步骤跳过，前后两步之间画虚线。会清掉选中、放开单层的聚焦、镜头框住整条路径。`setData` 之前调不起作用。 |
| `clear()` | `() => void` | 停下并忘掉这条路径。 |
| `ids` | `string[] \| null` | `play` 给的 id，没有是 `null`。 |
| `reached` | `number` | 点亮了几步。 |
| `live` | `PathProgress` | `{ ids, reached }`：实际走的步骤（跳过隐藏层、合并之后）和点亮了几步。 |
| `shot()` | `() => void` | 镜头框住整条路径。 |
| `on('step', cb)` | `() => void` | `live` 变了时调：又点亮了一步，或者隐藏层、展开节点以后实际走的步骤变了。 |

行为：

- 隐藏、显示一层，或者展开一个节点，会重新算步骤，不从头走。
- 点在空白处停下这一趟（`ids` 还在，`getView().path` 里也还有）。`setData`、有模式接管时清掉路径。
- 开着 `followHero` 时，路径走到哪一层，哪一层当主角，镜头重新框住整条路径。
- 系统开着“减少动态效果”时，直接显示走完的样子。

### 视图状态

插件在视图状态里登记了 `path`，也把它加进了 `StrataView` 的类型：

```ts
strata.getView().path        // string[] | null
strata.setView({ path: ['onto:person', 'tbl:person'] }) // 从头走一遍
strata.setView({ path: null })                            // 清掉
```

### 底层导出

`stepsOf`、`reachedAt`、`segmentProgress`、`rankOf`、`paintPath`、`STEP`、`DIGITS`（①②③……）和类型 `PathRun`、`PathPaintModel`、`PathProgress`、`PathEvents` 也导出了，给测试和写类似的叠加层用。它们不碰渲染器。

## 两版对比：`kgstrata/diff`

用 [kgdiff](https://github.com/iiwish/kgdiff) 比较两版数据，把语义上的变化（新增、删除、改名、合并、映射调整、关系改向）画在两版合起来的图上，可以逐段回放。

要另装：

```sh
npm install @kgdiff/core @kgdiff/scene @kgdiff/layout
```

kgdiff 带三个 WebAssembly 文件（共约 1.9 MB）。Vite 8 不用配置；Vite 6 和别的打包工具见 [getting-started.zh-CN.md](getting-started.zh-CN.md#webassembly-和-kgstratadiff)。

```ts
import { Strata } from 'kgstrata'
import { diffPlugin } from 'kgstrata/diff'

const strata = new Strata(host, { locale: 'zh-CN' })
const diff = strata.use(diffPlugin())
strata.setData(after)

const result = await diff.show(before, after)
if (result) {
  console.log(result.stats)                     // { added, removed, changed }
  for (const h of result.hunks) console.log(h.family, h.title, h.subtitle)
}

diff.setView({ layer: 'before' })   // 'union' | 'before' | 'after' | 'replay'
diff.play(true)                     // 按顺序回放所有变化
diff.selectHunk(2)                  // 选中一处变化，镜头框住它
diff.exit()                         // 回到全景
```

`diffPlugin(options?)` 接受 `{ locale?: Locale }`，是 kgdiff 写变化说明用的语言，缺省跟实例的 `locale`。

### `DiffApi`

| 成员 | 类型 | 含义 |
|---|---|---|
| `show(before, after, opts?)` | `Promise<StrataDiff \| null>` | 两版合起来布局一次，接管画面（一个[模式](#叠加层和模式)）。是异步的，只认最后一次调用：等 kgdiff 的时候又调了 `show`、`exit`、`setData` 或者 `dispose`，就返回 `null`。 |
| `exit()` | `() => void` | 回到全景（不重新布局），也作废还没回来的 `show`。 |
| `active` | `boolean` | 正在看对比。 |
| `current` | `StrataDiff \| null` | 正在看的那份对比。 |
| `view` | `Readonly<DiffView> \| null` | 回放的状态。用 `setView`、`play`、`selectHunk` 改。 |
| `playing` | `boolean` | 正在回放。 |
| `setView(patch)` | `(patch: Partial<DiffView>) => void` | 改回放的状态，比如 `{ layer: 'after' }`、`{ layer: 'replay', t: 1200 }`。和 `strata.setView` 不是一回事。 |
| `play(on)` | `(on: boolean) => void` | 开始回放（从头，或者从停下的地方），`false` 暂停。 |
| `selectHunk(i)` | `(i: number) => void` | 选中第 `i` 处变化（`-1` 清掉），镜头框住它。开着 `followHero` 时，它所在的层当主角。 |
| `shot(i)` | `(i: number) => void` | 镜头框住第 `i` 处变化。 |
| `on('enter' \| 'exit', cb)` | `() => void` | `enter` 带 `StrataDiff`（展开节点引起的重新比较也算），`exit` 带 `null`。 |

`show` 的选项：`{ replaces?: Record<string, string[]> }`，新节点的 id → 它吸收了哪些旧节点。不告诉它的话，合并看起来就是一删一增。

```ts
await diff.show(before, after, { replaces: { 'onto:party': ['onto:person', 'onto:company'] } })
```

对比时展开或收起节点，会按新的展开状态重新比一遍。收起时，表里加了一个字段表现为“这张表变了”（收着的子节点是它的一项属性）和“映射的分量变了”。

### 结果的类型

```ts
interface StrataDiff {
  scene: Scene                                 // kgdiff 的场景
  base: { nodes: BaseNode[]; edges: BaseEdge[] }  // 画出来的合集
  hunks: DiffHunk[]
  duration: number                             // 1 倍速回放的总时长，毫秒
  stats: { added: number; removed: number; changed: number } // 节点 + 边
}

interface DiffHunk {
  index: number
  id: string
  kind: string
  family: ChangeFamily     // 'added' | 'removed' | 'content' | 'structure' | 'identity'
  title: string            // 按语言的说明
  subtitle: string
  nodes: number[]          // base.nodes 的下标
  context: number[]
  center: [number, number]
  layer: number
  radius: number
  start: number            // 回放窗口，毫秒
  end: number
}

interface DiffView {
  layer: 'union' | 'before' | 'after' | 'replay'
  t: number                // 回放时间，毫秒
  selectedHunk: number
  hoveredNode: number
  selectedNode: number
  reducedMotion: boolean
  emphasis: number
}
```

`familyColors()` 返回每类变化的颜色（`{ base, text }`），和 kgdiff 画的一样，自己做面板时用。React 的 `DiffPanel` 就用它。

### 底层导出

`buildStrataDiff`、`createDiffLooks`、`toKgdiffGraph`、`quietOf`、`applyQuiet`，以及常量 `ATTR`（`strata.layer`、`strata.group`、`strata.folds`、`strata.weight`）和 `HIERARCHY_PREDICATE`（`strata:parent`），说明 kgstrata 的数据是怎么交给 kgdiff 的。见 [design.zh-CN.md](design.zh-CN.md) 的“交给 kgdiff 的是什么”。

## 自己写插件

插件是一个带 `name` 和 `install(ctx)` 的对象。`install` 拿到 `StrataContext`，返回你想让 `use()` 交回去的接口。

```ts
import type { StrataPlugin } from 'kgstrata'

export function myPlugin(): StrataPlugin<{ hello(): void }> {
  return {
    name: 'my-plugin',
    install(ctx) {
      return { hello: () => console.log(ctx.locale) }
    },
  }
}
```

### `StrataContext`

`ctx` 是核心给出去的全部能力，引擎的私有状态拿不到。用下标的地方，都是对“现在画的那张图”（`ctx.current`）说的。

**读**

| 成员 | 含义 |
|---|---|
| `model` | 全景的 `Model`，`setData` 之前是 `null`。有模式接管时它不变。 |
| `current` | 现在画的模型：有模式接管时是模式的，否则就是 `model`。 |
| `mode` | 正在接管的模式属于哪个插件，没有是 `null`。 |
| `renderer` | `StrataRenderer`。 |
| `time` | 引擎的时钟（秒）。 |
| `reducedMotion` | 创建时是否开着“减少动态效果”。 |
| `locale`、`theme` | 实例的语言和合并后的主题。插件自己的文字、颜色跟着它们。 |
| `disposed` | 引擎销毁了：异步回来的结果丢掉。 |
| `hidden` | 隐藏的层的下标，`ReadonlySet<number>`。 |
| `expanded` | 展开的节点 id，`ReadonlySet<string>`，原样（包括没有子节点的）。 |
| `indexOf(id)` | 节点在全景里的下标；收起的子节点算在画出来的祖先头上；没有是 `-1`。 |

**用核心的规则**

| 成员 | 含义 |
|---|---|
| `normalize(data)` | 按实例的 `nodeStyles`、色板、语言整理一份数据，问题丢掉。 |
| `layoutOf(resolved)` | 按实例的规则布局（盘面半径随节点数长，基准层按选项）。 |

**改**

| 成员 | 含义 |
|---|---|
| `takeOver(mode)` | 开始一个模式，返回 `ModeHandle`（`active`、`release({ rebuild? })`）。 |
| `rebuild()` | 按现在的展开状态重建全景，清掉选中。 |
| `followTo(layer, refit?)` | 开着 `followHero` 时，让第 `layer` 层（下标）当主角。`refit`：`'overview'` 重新取总览（用户动过镜头就不动），`'none'`（缺省）不动镜头，给函数就在主角真的换了时调它。 |
| `releaseFocus()` | 放开单层的聚焦，不动镜头。 |
| `select(id)` | 和 `strata.select` 一样。 |
| `fit(points, { elevation, margin })` | 镜头框住这些 `PlatePoint`（盘面坐标 `{ layer, x, z }`）。层还在缓动时按目标高度、目标缩放算。 |

**挂钩子**（除了 `registerView`，都返回撤掉它的函数）

| 成员 | 含义 |
|---|---|
| `overlay(layer)` | 加一个叠加层。 |
| `onFrame(cb)` | 每帧在样式之前调，带 `{ time, dt }`。 |
| `onChange(cb)` | `'data'` 换了数据；`'model'` 全景重建了（展开、收起）；`'hidden'` 隐藏的层变了；`'mode'` 有模式接管了。 |
| `onExpand(cb)` | 展开、收起时在核心重建之前调。返回 `true` 表示这次由你处理，核心就不重建。 |
| `onDispose(cb)` | `strata.dispose()` 时调。 |
| `registerView(key, { get, set })` | 在 `getView()` / `setView()` 里加一项。重名时抛 `view-core-key` 或 `view-key-taken`。 |
| `on(event, cb)` / `emit(event, v)` | 核心的事件（名字和 `strata.on` 一样）。 |

### 叠加层和模式

改变画面有两种做法，一个插件可以兼有。

- **叠加层**（`ctx.overlay({ spotlight?, paint? })`）：在全景上叠东西。`spotlight()` 返回一个 `Spotlight`（`{ rank }`，每个画出来的节点一项，`> 0` 点亮，`0` 压暗），或者 `null`。核心的样式据此压暗其余的，和聚焦、主次的压暗按顺序叠在一起。`paint(looks, frame)` 在样式算完以后调，可以往这一帧的 `Looks` 里写东西（名字、徽标、序号、`looks.extra.path`、涟漪）。路径回放就是叠加层。几个叠加层都给了 spotlight 时，后装的说了算。
- **模式**（`ctx.takeOver(mode)`）：接管画什么。`StrataMode` 自带 `model`、渲染器的 `base` 和 `looks(frame)`，可选 `hover(i)`、`select(i)`、`released()`。同一时刻只有一个模式；别的插件接管或者 `setData` 时，前一个模式收到 `released()`。两版对比就是模式。注意：造一个新的 `Model` 要用到还没导出的内部函数，所以眼下第三方的模式只能复用 `ctx.model`，每个 `NodeLook`、`EdgeLook` 都得自己填。

### 每帧的管线

每一帧的 `Looks` 走固定的管线，写入方各管各的：

1. **基础样式**：核心的样式（带上叠加层给的 spotlight），或者接管的模式的 `looks()`。
2. **叠加层**：按装的顺序调各自的 `paint`。有模式接管时跳过。
3. **核心的后处理**：隐藏的层淡出（节点、线、盘面）。模式也走这一步。

`onFrame` 的回调在第 1 步之前调。

### 例子：高亮某一类节点

一个叠加层插件：点亮某个 `type` 的所有节点，在它们的名字后面加一个徽标，并把状态存进视图状态。这份代码就是 [`examples/plugin/src/highlight-type.ts`](../examples/plugin/src/highlight-type.ts)，和示例一起做类型检查、构建。

```ts
import { Emitter, type Model, type StrataPlugin } from 'kgstrata'

/** What the plugin hands back from `strata.use(...)`. */
export interface HighlightTypeApi {
  /** Light up every node of this `type` (as written in the data). `null` turns it off. */
  set(type: string | null): void
  readonly type: string | null
  /** How many drawn nodes are lit. Fields folded inside a collapsed table are not drawn, so they do not count. */
  readonly count: number
  on(event: 'change', cb: (type: string | null) => void): () => void
}

/**
 * An overlay plugin: it never takes over the frame. Each frame it
 * 1. hands the core styler a spotlight (lit nodes stay bright, the rest dim), and
 * 2. paints a small badge next to each lit node's label.
 * It also stores its state in the view (`getView().highlight`).
 */
export function highlightTypePlugin(options: { badge?: string } = {}): StrataPlugin<HighlightTypeApi> {
  const badge = options.badge ?? '●'
  return {
    name: 'highlight-type',
    install(ctx) {
      const events = new Emitter<{ change: string | null }>()
      let type: string | null = null
      // Cache per model: the core rebuilds the model on setData and on expand/collapse.
      let cached: { model: Model; type: string | null; rank: Int32Array; count: number } | null = null

      const rankFor = (m: Model) => {
        if (cached && cached.model === m && cached.type === type) return cached
        // rank[i] > 0 marks node i as lit. Order does not matter here, so every match gets 1.
        const rank = new Int32Array(m.base.nodes.length)
        let count = 0
        m.specs.forEach((spec, i) => {
          if (type !== null && spec.type === type) {
            rank[i] = 1
            count++
          }
        })
        cached = { model: m, type, rank, count }
        return cached
      }

      ctx.overlay({
        // ① Asked before the core styles the frame. Return null to stay out of the way.
        spotlight: () => {
          const m = ctx.model
          if (type === null || !m || ctx.mode !== null) return null
          return { rank: rankFor(m).rank }
        },
        // ② Called after styling, only while no mode has taken over.
        paint: (looks) => {
          const m = ctx.model
          if (type === null || !m) return
          const { rank } = rankFor(m)
          for (let i = 0; i < rank.length; i++) if (rank[i] > 0) looks.nodes[i].badge = badge
        },
      })

      const set = (next: string | null) => {
        if (next === type) return
        type = next
        events.emit('change', type)
      }

      // Save and restore with getView() / setView().
      ctx.registerView<string | null>('highlight', { get: () => type, set })
      // New data: keep the type, the cache is keyed by model and refreshes by itself.
      ctx.onDispose(() => events.clear())

      return {
        set,
        get type() {
          return type
        },
        get count() {
          const m = ctx.model
          return m && type !== null ? rankFor(m).count : 0
        },
        on: (event, cb) => events.on(event, cb),
      }
    },
  }
}
```

用法：

```ts
import { Strata } from 'kgstrata'
import { highlightTypePlugin } from './highlight-type'

declare module 'kgstrata' {
  interface StrataView {
    highlight?: string | null
  }
}

const strata = new Strata(host)
const highlight = strata.use(highlightTypePlugin({ badge: '◆' }))
strata.setData(data)

highlight.set('relation')
strata.getView().highlight // 'relation'
```

### 登记视图状态

`ctx.registerView(key, { get, set })` 把 `key` 加进 `getView()`，`setView({ [key]: value })` 时交给你的 `set`（值不是 `undefined` 才调）。插件的项在核心的主角、聚焦、组之后，`selected` 之前应用。

要让这一项进 `StrataView` 的类型，做一次模块增强。应用里或者单独发布的插件包里，增强公开的模块 `kgstrata`，像上面那样。这一点在 TypeScript 7.0.2 下对构建出来的类型声明验证过（[插件示例](../examples/plugin)就是这么做的）。自带的路径插件增强的是内部模块，因为它和包一起编译。

### 检查清单

- 按拿到的那个模型建下标数组，`ctx.model` 变了就重建（`'data'`、`'model'` 变化时，或者像上面那样比较引用）。
- `spotlight`、`paint` 每帧都调，别在里面做重活，数组尽量复用。
- 颜色用 `ctx.theme`，文字用 `ctx.locale`。
- 异步的活儿，用结果之前先看 `ctx.disposed`（和你自己的请求计数）。
- 自己的监听在 `ctx.onDispose` 里清掉。
