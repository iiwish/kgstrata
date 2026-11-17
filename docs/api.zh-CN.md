# API 参考

[English](api.md)

这篇列出 `Strata` 的全部公开成员、选项、视图状态、事件和镜头，以 `src/engine.ts`、`src/plugin.ts` 为准。插件见 [plugins.zh-CN.md](plugins.zh-CN.md)，React 见 [react.zh-CN.md](react.zh-CN.md)，数据的形状见 [data.zh-CN.md](data.zh-CN.md)。

```ts
import { Strata, StrataError, type StrataOptions, type StrataView } from 'kgstrata'
```

## `new Strata(host, options?)`

```ts
constructor(host: HTMLElement, options?: StrataOptions)
```

在 `host` 里建 WebGL 画布，启动动画循环。`setData` 之前什么都不画。

拿不到 WebGL 上下文时抛 `StrataError`，`code: 'webgl-unavailable'`。这时页面上什么都没挂，原来的错误在 `cause` 上。

`options` 只读一次。没有对应 setter 的选项（`locale`、`theme`、`nodeStyles`、`anchor`、`secondaryScale`）要改，就销毁实例重建一个。

## `StrataOptions`

| 选项 | 类型 | 缺省 | 含义 |
|---|---|---|---|
| `hero` | `string` | 布局的基准层 | 哪一层当主角（层的 id）：原大、原亮；其余缩小、变暗。给了 `heroMix` 就不看它。 |
| `heroMix` | `Record<string, number>` | — | 每层当主角的分量 0..1（层的 id → 分量）。1 原大，0 是配角，没写到的层按 0 算。分量最大的那层是主角。 |
| `followHero` | `boolean` | `false` | 主角跟着你在问的东西走：选中哪层的节点，哪层当主角；插件也可以让它跟（路径走到哪层、选中哪处变化）。 |
| `secondaryScale` | `number` | `0.56` | 紧挨主角的那层相对主角的大小，夹在 0.2..1。更远的层每远一层再乘 0.72，不小于 0.24。 |
| `anchor` | `string` | 映射最多的那层 | 布局的基准层（层的 id）：它自己按力导摆，别的层向它对齐。 |
| `hidden` | `string[]` | `[]` | 一开始就隐藏的层。 |
| `expanded` | `string[]` | `[]` | 一开始就展开的节点（子节点画出来）。 |
| `nodeStyles` | `Record<string, NodeStyle>` | 内置的几种 | 节点的 `type` → `{ shape?, mono? }`，盖在 `DEFAULT_NODE_STYLES` 上。见 [data.zh-CN.md](data.zh-CN.md#节点nodespec)。 |
| `locale` | `'en' \| 'zh-CN'` | `'en'` | 问题描述、报错、插件文字的语言。code 不变。 |
| `theme` | `DeepPartial<Theme>` | `DARK` | 盖在夜景主题上的覆盖项，只对这个实例。见 [theming-and-i18n.zh-CN.md](theming-and-i18n.zh-CN.md)。 |

“主角”只在至少两层时才有。只有一层时没有主角，`setHero`、`setHeroMix` 不起作用。

## 属性

| 成员 | 类型 | 含义 |
|---|---|---|
| `renderer` | `StrataRenderer`（只读） | three.js 的渲染器。`renderer.gl` 是 `WebGLRenderer`，`renderer.rig.camera` / `renderer.rig.controls` 是镜头和轨道控制。高级用法，还不是稳定接口。 |
| `locale` | `Locale`（只读） | 这个实例的语言。 |
| `theme` | `Theme`（只读） | 合并后的主题（`createTheme(options.theme)`）。 |
| `reducedMotion` | `boolean`（只读） | 创建时系统是否开着“减少动态效果”。开着时不自转，路径回放直接显示全程。 |
| `data` | `StrataData \| null`（getter） | 最后一次交给 `setData` 的对象，原样。 |
| `mode` | `string \| null`（getter） | 正在接管画面的模式属于哪个插件（对比时是 `'diff'`），没有是 `null`。 |
| `layers` | `LayerInfo[]`（getter） | 每一层，以及显示还是隐藏。 |
| `heroInfo` | `HeroInfo`（getter） | 现在的主角、是否跟随、各层分量。 |
| `expanded` | `string[]`（getter） | 展开着、而且确实有子节点的节点。 |

```ts
interface LayerInfo { id: string; name: string; visible: boolean }
interface HeroInfo {
  id: string | null              // 分量最大的那层；只有一层时是 null
  follow: boolean
  mix: Record<string, number>    // 层的 id → 分量 0..1
}
```

## 方法

### 数据

| 方法 | 返回 | 含义 |
|---|---|---|
| `setData(data: StrataData)` | `DataIssue[]` | 校验、丢掉有问题的项、布局、画出来。返回查出来的问题（没问题是空数组）。选中、聚焦、插件的模式都清掉；隐藏的层、展开的节点按 id 保留。发 `hero`、`layers`、`expand`。 |

### 插件

| 方法 | 返回 | 含义 |
|---|---|---|
| `use<Api>(plugin: StrataPlugin<Api>)` | `Api` | 装一个插件，返回它的接口。同名的装第二次抛 `StrataError('plugin-installed')`。销毁以后再装同名的，交回原来的接口，不抛。 |

### 主角和层

| 方法 | 返回 | 含义 |
|---|---|---|
| `setHero(layer: string)` | `void` | 让这一层当主角（分量 1，其余 0），它也成为主角的“家”。隐藏的、不存在的层不理；只有一层时不起作用。镜头重新取景。 |
| `setHeroMix(mix: Record<string, number>)` | `void` | 连续的版本：给每层一个分量 0..1，没写到的按 0。全是 0（或者分量只给了隐藏的层）时，现在的主角保持 1。 |
| `setFollowHero(on: boolean)` | `void` | 开关“主角跟着选中走”。发 `hero`。 |
| `setLayerVisible(layer: string, visible: boolean)` | `boolean` | 显示或隐藏一层。层不存在、或者它是最后一张可见的图时返回 `false`。隐藏的层淡出；被它隔开的两层之间画虚线的**穿透线**；主角被隐藏时让给最近的可见层。发 `layers`（主角换了还发 `hero`）。 |
| `focusLayer(layer: string \| null)` | `void` | 几层并存时：让 `layer` 当主角，`null` 回到主角的“家”。只有一层时：聚焦这一层、其余收起，`null` 放开。发 `focus`。 |
| `setSpread(s: number)` | `void` | 层距的倍数（缺省 1）。 |

### 节点和组

| 方法 | 返回 | 含义 |
|---|---|---|
| `select(id: string \| null)` | `void` | 按 id 选中节点（`null` 清掉）。收起的子节点选中它画出来的祖先。**不发** `select` 事件，也不触发主角跟随；这两样只来自鼠标点击。 |
| `expand(id: string, on = true)` | `void` | 展开一个节点（`false` 收起）。 |
| `setExpanded(ids: Iterable<string>)` | `void` | 设定展开的节点全集，别的都收起。顶层节点的位置不变。发 `expand` 和 `hover(null)`。 |
| `highlightGroup(id: string \| null)` | `void` | 强调一个组：写 `"维度/组"`，或者只写组 id。`null` 清掉。 |

### 镜头

| 方法 | 返回 | 含义 |
|---|---|---|
| `shot(name: ShotName, arg?: number, duration = 1.3)` | `void` | 移动镜头，见[镜头](#镜头)。`duration` 单位是秒，`0` 直接跳过去。 |
| `setInset(px: number)` | `void` | 右侧被面板挡住的宽度（CSS 像素），画面在剩下的地方居中。 |

### 视图状态

| 方法 | 返回 | 含义 |
|---|---|---|
| `getView()` | `StrataView` | 恢复当前视图所需的全部信息，都用 id。 |
| `setView(view: Partial<StrataView>)` | `void` | 恢复视图。每一项都可以不给；数据里已经没有的层、节点跳过。发 `hero`、`layers`。 |

### 事件和销毁

| 方法 | 返回 | 含义 |
|---|---|---|
| `on(event, cb)` | `() => void` | 订阅核心事件，返回取消订阅的函数。 |
| `dispose()` | `void` | 停掉循环、释放 GPU 资源、摘掉画布、丢掉 WebGL 上下文、调插件的销毁钩子、清掉监听。可以调几次；之后别的方法都不做事。 |

## `StrataView`

```ts
interface StrataView {
  hero: Record<string, number>   // 层的 id → 当主角的分量
  follow: boolean
  hidden: string[]               // 隐藏的层
  expanded: string[]             // 展开的节点
  selected: string | null        // 选中的节点
  group: string | null           // 强调的组，"维度/组"
  focus: string | null           // 聚焦的层（只在一层的情况下）
  spread: number
  camera: { position: [number, number, number]; target: [number, number, number] }
  // 再加上每个登记了视图状态的插件各一项，比如 `path?: string[] | null`
}
```

它是纯 JSON，可以存下来、放进地址里、换个地方恢复：

```ts
const view = strata.getView()
localStorage.setItem('view', JSON.stringify(view))
// 之后
strata.setView(JSON.parse(localStorage.getItem('view')!))
// 也可以只给一部分
strata.setView({ hidden: ['onto'], selected: 'tbl:company' })
```

`setView` 按这个顺序应用：`follow`、`spread`、`expanded`、`hidden`、`hero`、`focus`、`group`、插件的那几项、`selected`、`camera`。没给 `camera`、而用户也没动过镜头时，重新取总览。

路径插件会加一项 `path`（见 [plugins.zh-CN.md](plugins.zh-CN.md#路径回放kgstratapath)）。插件的项不能和上面核心的项重名。

## 事件

用 `strata.on(name, cb)` 订阅，回调拿到第二列的值。

| 事件 | 带的值 | 什么时候发 |
|---|---|---|
| `hover` | `HoverInfo \| null` | 指针进入、在节点上移动、离开（`null`）。展开/收起以后、模式接管时也会发 `null`。 |
| `select` | `HoverInfo \| null` | 单击（按下抬起之间没拖动）。点在空白处是 `null`。`select()` 方法不发。 |
| `tick` | `number` | 每画一帧，带引擎的时钟（秒）。 |
| `focus` | `string \| null` | 调了 `focusLayer()`（层的 id 或 `null`）、“叠看”清掉聚焦、模式接管（`null`）。 |
| `hero` | `HeroInfo` | 主角、分量或跟随开关变了；`setData`、`setView` 之后。 |
| `layers` | `LayerInfo[]` | 显示/隐藏变了；`setData`、`setView` 之后；模式接管和交还时。 |
| `expand` | `string[]` | 展开的节点变了；`setData` 之后。 |
| `contextlost` | `null` | WebGL 上下文丢了，循环停下。 |
| `contextrestored` | `null` | 上下文还回来了，资源重新上传，循环接着跑。 |

```ts
interface HoverInfo {
  id: string          // 节点的 id
  label: string       // 画出来的名字（对比时可能是新名字）
  layer: string       // 层的 *名字*
  group: string | null// 组的 *名字*
  folds: number       // 收着几个子节点；大于 0 就能展开
  expanded: boolean
  x: number           // 指针位置，相对画布的 CSS 像素
  y: number
}
```

插件的事件在插件自己的接口上（`path.on('step')`、`diff.on('enter' | 'exit')`）。

## 镜头

```ts
type ShotName = 'overview' | 'top' | 'layer'
```

| 调用 | 效果 |
|---|---|
| `shot('overview')` | 框住所有可见的层。有主角时主角铺满画面，配角露在它的上方或下方。 |
| `shot('top')` | 几层并存时是**叠看**：层距收到几乎为零，从正上方看，重合的关系就是一致的。换别的镜头、`setHeroMix`、`setSpread` 或换主角时退出叠看。只有一层时是这一层的俯视地图。 |
| `shot('layer', index)` | 框住一层。`index` 是这层在 `strata.layers` 里的位置（0 是最上面），不是 id。 |

框住一条路径、一处变化归插件管（`path.shot()`、`diff.shot(i)`）。

## 错误

`StrataError extends Error`，多一个固定的 `code`；`message` 跟着实例的 `locale`。

| `code` | 谁抛 |
|---|---|
| `webgl-unavailable` | `new Strata()` |
| `plugin-installed` | `use()` 装了同名的插件 |
| `view-core-key` | 插件的 `ctx.registerView()` 用了核心的项（`hero`、`follow`……） |
| `view-key-taken` | 插件的 `ctx.registerView()` 用了别的插件登记过的项 |

数据的问题不抛，由 `setData` / `validate` 作为 `DataIssue` 返回（见 [data.zh-CN.md](data.zh-CN.md#校验)）。

## `kgstrata` 的其他导出

除了 `Strata`，核心入口还导出插件契约（`Emitter`、`StrataPlugin`、`StrataContext`、`StrataOverlay`、`StrataMode`、`ModeHandle`、`FrameInfo`、`PlatePoint`、`StrataChange`、`StrataEvents`、`ViewSlot`、`Spotlight`、`Model`、`RendererBase`、`RendererOptions`、`StrataRenderer`），类型 `HeroInfo`、`HoverInfo`、`LayerInfo`、`ShotName`、`StrataOptions`、`StrataView`，以及 [`kgstrata/headless`](headless.zh-CN.md) 的全部。
