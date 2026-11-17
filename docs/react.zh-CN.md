# React

[English](react.md)

这篇讲 `kgstrata/react`：`<StrataCanvas>` 组件、hooks、每个面板和它的 props、样式表和 CSS 变量，以及服务端渲染。

```sh
npm install kgstrata three react react-dom
```

peer 依赖接受 React 18 和 19，只实测过 19。

| 入口 | 里面有什么 | 带不带 kgdiff |
|---|---|---|
| `kgstrata/react` | `<StrataCanvas>`、provider、hooks、核心的面板 | 不带 |
| `kgstrata/react/path` | `<PathList>` | 不带 |
| `kgstrata/react/diff` | `<DiffPanel>`、`changesByLayer` | 带（经由 `kgstrata/diff`） |
| `kgstrata/react/styles.css` | 可选的面板样式 | — |

## `<StrataCanvas>`

挂载时创建一个 `Strata`，`data` 变了就 `setData`，卸载时销毁。

```tsx
import { LayerList, NodeTip, StrataCanvas } from 'kgstrata/react'
import 'kgstrata/react/styles.css'

export function Graph({ data }: { data: StrataData }) {
  return (
    <div style={{ position: 'relative', height: 600 }}>
      <StrataCanvas data={data} options={{ hero: 'onto', locale: 'zh-CN' }} style={{ position: 'absolute', inset: 0 }}>
        <aside className="kgs-panel" style={{ position: 'absolute', left: 16, top: 16, width: 200, padding: 8 }}>
          <LayerList />
        </aside>
        <NodeTip />
      </StrataCanvas>
    </div>
  )
}
```

结构：组件先渲染一个 `<div class="kgs-canvas">`（画布的宿主，`className` / `style` 作用在它上面），然后把 `children` 渲染成它的**兄弟节点**，不是放在它里面。所以要给画布那个 div 尺寸；children 用绝对定位时（面板、`NodeTip`），把两者一起放进一个有定位的外层容器。

### Props

| Prop | 类型 | 含义 |
|---|---|---|
| `data` | `StrataData \| null \| undefined` | 引用变了才交给 `setData`。只建一次或者用 `useMemo`；每次渲染都新造一个对象，就每次渲染都重新布局。 |
| `options` | `StrataOptions` | 只在创建时读一次。要换就换组件的 `key`。 |
| `plugins` | `readonly StrataPlugin[]` | 创建后、第一次 `setData` 之前按顺序装上。也只读一次。 |
| `onReady` | `(strata, apis) => void \| (() => void)` | 创建好以后调。`apis` 是各插件的接口，顺序和 `plugins` 一样。可以返回一个清理函数，销毁前调。 |
| `onIssues` | `(issues: DataIssue[]) => void` | 每次 `setData` 之后调，没有问题也调（给空数组）。 |
| `onError` | `(error: unknown) => void` | 创建失败（没有 WebGL 时是 `StrataError`，`code: 'webgl-unavailable'`）。 |
| `fallback` | `ReactNode \| ((error) => ReactNode)` | 创建失败时代替画布渲染的东西。缺省是一行按语言的说明，类名 `.kgs-fallback`。 |
| `className`、`style` | | 作用在画布的宿主 div 上。 |
| `children` | `ReactNode` | 渲染在画布后面、provider 里面，所以能用 `useStrata()` / `usePlugin()`。 |
| `create` | `(host, options) => Strata` | 自定义怎么造引擎，缺省 `new Strata(host, options)`。测试里有用。 |
| `ref` | `Ref<Strata \| null>` | 实例（创建好之前是 `null`）。 |
| `onHover`、`onSelect` | `(info: HoverInfo \| null) => void` | 核心事件 `hover`、`select`。 |
| `onFocus` | `(layer: string \| null) => void` | `focus` |
| `onHero` | `(hero: HeroInfo) => void` | `hero` |
| `onLayers` | `(layers: LayerInfo[]) => void` | `layers` |
| `onExpand` | `(ids: string[]) => void` | `expand` |
| `onContextLost`、`onContextRestored` | `() => void` | `contextlost`、`contextrestored` |

事件回调和 `onIssues` 每次都现取，换了新函数不会重新订阅。`tick` 没有对应的 prop，用 `useStrataEvent(strata, 'tick', cb)`。

React 严格模式下，开发时会挂载两次：组件创建、销毁、再创建。`onReady` 也会调两次，所以它可以返回清理函数。

### 带类型的插件接口

```tsx
import { StrataCanvas } from 'kgstrata/react'
import { pathPlugin, type PathApi } from 'kgstrata/path'

// 数组要稳定（放在模块顶层，或者 useMemo）
const PLUGINS = [pathPlugin()] as const

<StrataCanvas
  data={data}
  plugins={PLUGINS}
  onReady={(strata, [path]: [PathApi]) => {
    path.play(['onto:person', 'tbl:person'])
  }}
/>
```

## Hooks

| Hook | 返回 | 含义 |
|---|---|---|
| `useStrata()` | `Strata \| null` | 最近的 `<StrataCanvas>` / `<StrataProvider>` 的实例。还没创建好、或者拿不到 WebGL 时是 `null`。 |
| `usePlugin<Api>(name)` | `Api \| null` | 按名字取装上的插件的接口（`'path'`、`'diff'`、你自己的）。 |
| `useStrataEvent(strata, event, cb)` | `void` | 订阅一个核心事件。`cb` 每次渲染可以是新函数。`strata` 是 `null` 时什么也不做。 |
| `useStrataState(strata, key)` | 见下 | 把引擎的一项状态变成 React 状态（`useSyncExternalStore`）。内容真的变了才重画。 |
| `useStrataOr(strata)` | `Strata \| null` | 给了就用给的，`strata` 是 `undefined` 时用上下文里的。写面板用。 |
| `useLocale(strata, locale?)` | `Locale` | 给了 `locale` 用它，否则用实例的，再否则 `'en'`。 |

`useStrataState` 的 key：

| Key | 类型 | 来源 | 没有实例时 |
|---|---|---|---|
| `'layers'` | `LayerInfo[]` | `strata.layers`、`layers` 事件 | `[]` |
| `'hero'` | `HeroInfo \| null` | `strata.heroInfo`、`hero` 事件 | `null` |
| `'expanded'` | `string[]` | `strata.expanded`、`expand` 事件 | `[]` |
| `'focus'` | `string \| null` | `focus` 事件 | `null` |

自己 `new Strata`、不用 `<StrataCanvas>` 时，用 `<StrataProvider strata plugins?>` 把实例交给 hooks 和面板。

## 面板

面板只输出带 `kgs-` 前缀的结构，自己不定位，放在哪儿由你定。每个面板都认 `PanelProps`：

| Prop | 含义 |
|---|---|
| `strata` | 用哪个实例，缺省取上下文里的。 |
| `locale` | 界面文字的语言，缺省跟实例的 `locale`。 |
| `className`、`style` | 作用在根元素上。 |

### `<LayerList>`

每层一行。点一行：几层并存时让它当主角，只有一层时聚焦它（再点一次放开）。眼睛按钮显示、隐藏这一层。

| Prop | 类型 | 含义 |
|---|---|---|
| `counts` | `Record<string, number> \| Map<string, number>` | 每行右边的数（比如节点数），按层的 id。 |
| `badges` | 同上 | 每层的徽标（比如有几处变化）。 |
| `badgeWhen` | `'hidden' \| 'always'` | 缺省 `'hidden'`：只在层隐藏着时显示，变化不能悄悄藏掉。 |
| `badgeTitle` | `(n, layer) => string` | 徽标的提示，缺省“这一层有 n 处变化”。 |
| `layers`、`hero`、`focus` | | 不看实例，直接给状态（服务端渲染、测试）。 |

### `<FollowToggle>`

`setFollowHero` 的开关。只有一层时不渲染。Prop：`hero?`（直接给状态）。

### `<HeroMixSlider>`

正好两层时的 `setHeroMix` 滑杆：左头第一层当主角，右头第二层，中间两层一样大。不是正好两层时不渲染。Props：`hero?`、`layers?`。

### `<SpreadSlider>`

`setSpread` 的滑杆。Props：`min`（0.4）、`max`（1.8）、`step`（0.01）。初值从 `getView().spread` 读。

### `<ViewButtons>`

两个按钮：**总览**（`focusLayer(null)`：放开聚焦、主角回家、取总览）和**叠看**（`shot('top')`）。

### `<NodeTip>`

跟着 `hover` 事件的提示：名字、层 · 组，以及“N 个字段 · 双击展开” / “双击收起”。按指针位置绝对定位，所以要和画布放在同一个有定位的容器里。

| Prop | 类型 | 含义 |
|---|---|---|
| `info` | `HoverInfo \| null` | 自己给悬停状态。 |
| `offset` | `[number, number]` | 离指针多远（px），缺省 `[16, 14]`。 |

### `<PathList>`（`kgstrata/react/path`）

一列问题：点一个就走它的路径，下面列出每一步，走到的点亮，在隐藏层里跳过的划掉。

```tsx
import { PathList, type PathItem } from 'kgstrata/react/path'

const paths: PathItem[] = [
  { id: 'who-invests', question: '谁投资了这家企业？', nodes: ['onto:company', 'onto:investment', 'onto:person', 'tbl:investment'] },
]

<StrataCanvas data={data} plugins={[pathPlugin()]}>
  <PathList paths={paths} />
</StrataCanvas>
```

| Prop | 类型 | 含义 |
|---|---|---|
| `paths` | `readonly PathItem[]` | `{ id, question, nodes }`。 |
| `path` | `PathApi \| null` | 插件的接口，缺省用 `<StrataCanvas plugins>` 里装的 `'path'`。 |
| `nodeInfo` | `(id) => { label, layer }` | 每一步显示的名字和层，缺省从 `strata.data` 里查（`nodeInfoFrom`）。 |
| `active` / `onActiveChange` | `string \| null` / `(id) => void` | 受控的选中。 |
| `live` | `PathProgress` | 直接给进度（服务端渲染、测试）。 |

### `<DiffPanel>`（`kgstrata/react/diff`）

每类变化的计数、叠加 / 之前 / 之后、回放按钮和进度条、变化列表（点一处，镜头框住它）。没在看对比时不渲染。

```tsx
import { diffPlugin } from 'kgstrata/diff'
import { DiffPanel } from 'kgstrata/react/diff'

const PLUGINS = [diffPlugin()] as const

<StrataCanvas data={after} plugins={PLUGINS} onReady={(_, [diff]) => void diff.show(before, after)}>
  <aside className="kgs-panel"><DiffPanel /></aside>
</StrataCanvas>
```

| Prop | 类型 | 含义 |
|---|---|---|
| `diff` | `DiffApi \| null` | 插件的接口，缺省用上下文里的 `'diff'`。 |
| `colors` | `Partial<Record<ChangeFamily, { base, text }>>` | 覆盖每类变化的颜色，缺省 `familyColors()`。 |
| `pollEvery` | `number` | 进度条多久（秒）跟一次回放，缺省 0.1。 |
| `current` | `StrataDiff \| null` | 直接给对比结果（服务端渲染、测试）。 |

`changesByLayer(diff, strata.layers)` 按层的 id 数变化；交给 `<LayerList badges>`，隐藏的层就会显示它藏着几处变化。

## 样式

`import 'kgstrata/react/styles.css'` 是可选的，不引入时面板就是没有样式的结构。样式表不管位置。`.kgs-panel` 是一块毛玻璃底子，可以套在面板外面。`.kgs-canvas` 没有样式，尺寸自己定。

颜色都是 `:root` 上的 CSS 变量，在 `:root` 或任意外层容器上改：

| 变量 | 缺省 | 用在 |
|---|---|---|
| `--kgs-bg` | `#04060a` | 强调色播放按钮上的字 |
| `--kgs-overlay` | `rgba(14, 18, 26, 0.72)` | 面板、提示的底色 |
| `--kgs-border` | `rgba(255, 255, 255, 0.07)` | 边框 |
| `--kgs-border-strong` | `rgba(255, 255, 255, 0.13)` | 悬停时的边框、提示的边框 |
| `--kgs-text` | `#e7ebf3` | 主要文字 |
| `--kgs-text-2` | `#a6afbf` | 次要文字 |
| `--kgs-text-3` | `#7a8495` | 弱化的文字 |
| `--kgs-accent` | `#9fe6ff` | 焦点框、滑块、步骤序号 |
| `--kgs-accent-rgb` | `159, 230, 255` | 同一个颜色的 RGB 分量，做半透明填充用 |
| `--kgs-hover` | `rgba(255, 255, 255, 0.04)` | 行悬停 |
| `--kgs-pressed` | `rgba(255, 255, 255, 0.07)` | 按下的按钮 |
| `--kgs-track` | `rgba(255, 255, 255, 0.14)` | 滑杆轨道、开关 |
| `--kgs-badge-bg` | `rgba(255, 190, 110, 0.18)` | 层徽标的底色 |
| `--kgs-badge-text` | `#ffcf8a` | 层徽标的字 |
| `--kgs-mark` | `linear-gradient(90deg, #9fb4ff, #9fe6ff)` | 层前面的小条 |

系统开着“减少动态效果”时，过渡动画都关掉。

## 服务端渲染

- 在服务端引入 `kgstrata/react` 是安全的：引入时不碰浏览器的全局对象。three.js 会被引入，但不会启动。
- 服务端上 `<StrataCanvas>` 只渲染空的宿主 div 和 children；引擎在 effect 里创建，所以不会在服务端跑。面板按空状态渲染（`useStrataState` 返回上表里的空值）。
- 客户端在 hydrate 之后才出现画布，实例建好以后面板才有内容。
- 用 Next.js 之类的框架时，如果不想在服务端引入 three.js，就让这个组件只在客户端渲染（比如用关掉 SSR 的动态引入）。

验证过：Node 24 + React 19 下，`renderToString(<StrataCanvas data={null}><LayerList /></StrataCanvas>)` 返回 `<div class="kgs-canvas"></div><ol class="kgs-layer-list" aria-label="Layers"></ol>`。

## 不用 `<StrataCanvas>`

`kgstrata/react` 还导出了它用到的、不碰 DOM 的部件：`mountStrata`（创建、装插件、给数据，失败时清理）、`bindEvents`、`createStateStore`、`EMPTY_STATE`、`canvasFallback`，以及它们的类型（`MountResult`、`PluginApis`、`StateStore`、`StrataEventProps`、`StrataFactory`、`StrataSource`、`StrataState`、`StrataStateKey`）。
