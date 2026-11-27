# API 参考

[English](api.md)

这篇列出 `Strata` 的全部公开成员、选项、视图状态、事件和镜头，以 `src/engine/`（`index.ts`、`types.ts`）、`src/plugin.ts` 为准。插件见 [plugins.zh-CN.md](plugins.zh-CN.md)，React 见 [react.zh-CN.md](react.zh-CN.md)，数据的形状见 [data.zh-CN.md](data.zh-CN.md)。

```ts
import { Strata, StrataError, type StrataOptions, type StrataView } from 'kgstrata'
```

## `new Strata(host, options?)`

```ts
constructor(host: HTMLElement, options?: StrataOptions)
```

在 `host` 里建 WebGL 画布，启动动画循环。`setData` 之前什么都不画。

拿不到 WebGL 上下文时抛 `StrataError`，`code: 'webgl-unavailable'`。这时页面上什么都没挂，原来的错误在 `cause` 上。

`options` 只读一次。`locale`、`messages`、`theme`、`labels` 有 setter（`setLocale`、`setTheme`、`setLabels`）。没有 setter 的选项（`nodeStyles`、`anchor`、`layout`、`secondaryScale`）要改，就销毁实例重建一个。

## `StrataOptions`

| 选项 | 类型 | 缺省 | 含义 |
|---|---|---|---|
| `hero` | `string` | 基准层 | 哪一层当主角（层的 id）：原大、原亮；其余缩小、变暗。给了 `heroMix` 就不看它。不写就是基准层（`anchor`，它也没写就是映射最多的那层）。 |
| `heroMix` | `Record<string, number>` | — | 每层当主角的分量 0..1（层的 id → 分量）。1 原大，0 是配角，没写到的层按 0 算。分量最大的那层是主角。 |
| `follow` | `boolean` | `false` | 主角跟着你在问的东西走：选中哪层的节点，哪层当主角；插件也可以让它跟（路径走到哪层、选中哪处变化）。创建后用 `setFollow` 换。 |
| `secondaryScale` | `number` | `0.56` | 紧挨主角的那层相对主角的大小，夹在 0.2..1。更远的层每远一层再乘 0.72，不小于 0.24。 |
| `anchor` | `string` | 映射最多的那层 | 布局的基准层（层的 id）：它自己按力导摆，别的层向它对齐。和 [headless.zh-CN.md](headless.zh-CN.md) 里的 `LayoutOptions.anchor`、`StrataLayout.anchor` 是同一个东西。 |
| `layout` | `LayoutProvider` | — | 注入算好的布局，见[注入布局](#注入布局)。 |
| `hidden` | `string[]` | `[]` | 一开始就隐藏的层。 |
| `expanded` | `string[]` | `[]` | 一开始就展开的节点（子节点画出来）。 |
| `labels` | `LabelOptions` | 处处 `auto` | 哪些名字出：一个缺省的模式，按层、按节点类型、按节点的覆盖，和一屏的上限。之后用 `setLabels` 换。见[名字](#名字)。 |
| `nodeStyles` | `Record<string, NodeStyle>` | 内置的几种 | 节点的 `type` → `{ shape?, mono?, childNoun? }`，盖在 `DEFAULT_NODE_STYLES` 上。见 [data.zh-CN.md](data.zh-CN.md#节点nodespec)。 |
| `locale` | `Locale`（`string`） | `'en'` | 问题描述、报错、面板和插件文字的语言。内置 `'en'`、`'zh-CN'`，别的先 `registerLocale`。code 不变。之后用 `setLocale` 换。 |
| `messages` | `Partial<Record<MessageKey, string>>` | — | 按实例覆盖个别文案，不管现在是什么语言。见 [theming-and-i18n.zh-CN.md](theming-and-i18n.zh-CN.md)。 |
| `theme` | `DeepPartial<Theme>` | `DARK` | 盖在夜景主题上的覆盖项，只对这个实例。之后用 `setTheme` 换。见 [theming-and-i18n.zh-CN.md](theming-and-i18n.zh-CN.md)。 |

“主角”只在至少两层时才有。只有一层时没有主角，`setHero`、`setHeroMix` 不起作用（照样返回现在的 `HeroInfo`，`id` 是 `null`）。

### 名字

```ts
type LabelMode = 'auto' | 'always' | 'hover'
interface LabelOptions {
  mode?: LabelMode                    // 缺省 'auto'
  layers?: Record<string, LabelMode>  // 层的 id → 模式
  types?: Record<string, LabelMode>   // 节点的 type → 模式
  nodes?: Record<string, LabelMode>   // 节点的 id → 模式
  max?: number                        // 一屏最多几个名字，缺省 160
}
```

各个模式平时出哪些名字（指着一个节点时，它和邻居的名字总是出）：

| 模式 | 主角层 | 配角层 |
|---|---|---|
| `auto` | 每层按重要度排前 40 到 60 个的名字（这层的六成，至少 40 个，至多 60 个左右）；不超过 40 个节点的层名字全出。只有一层时聚焦它，它的名字全出。 | 排前 8 个的和枢纽留着，淡一点，其余的淡出。离主角两层以上：都不出。 |
| `always` | 总是出。 | 总是出，淡一点。 |
| `hover` | 只在指着它或它的邻居时出（聚焦的层也一样）。 | 同左。 |

越具体的越优先：`nodes`，再 `types`，再 `layers`，最后 `mode`。不认得的值当没写。重要度是 `NodeSpec.weight`，没写就按同层里的连接数排名。屏幕上会压住的名字仍然互相避让，重要的先占位（`always` 的最先），最多画 `max` 个。展开出来的子节点（字段）按同样的规则；`auto` 下父节点展开着名字就出。自己画名字的插件模式（看变化、审计）照它们自己的规则。

```ts
new Strata(host, {
  labels: {
    layers: { catalog: 'always' },     // 小小的目录层：名字全出，当配角时也出
    types: { field: 'hover' },         // 字段名只在悬停时出
    nodes: { 'onto:company': 'always' },
  },
})
strata.setLabels({ mode: 'always', max: 300 })
```

## 属性

| 成员 | 类型 | 含义 |
|---|---|---|
| `locale` | `Locale`（getter） | 这个实例现在的语言。 |
| `messages` | `Partial<Record<MessageKey, string>>`（getter） | 按实例覆盖的文案。 |
| `theme` | `Theme`（getter） | 合并后的主题（`createTheme(options.theme)`，或者最后一次 `setTheme` 的）。 |
| `labels` | `LabelOptions`（getter） | 名字的规则（`options.labels`，或者最后一次 `setLabels` 的）。给的是拷贝。 |
| `reducedMotion` | `boolean`（只读） | 创建时系统是否开着“减少动态效果”。开着时不自转，路径回放直接显示全程。 |
| `data` | `StrataData \| null`（getter） | 最后一次交给 `setData` 的对象，原样。 |
| `mode` | `string \| null`（getter） | 正在接管画面的模式属于哪个插件（对比时是 `'diff'`），没有是 `null`。 |
| `layers` | `LayerInfo[]`（getter） | 每一层，显示还是隐藏，有几个顶层节点。 |
| `hero` | `HeroInfo`（getter） | 现在的主角、是否跟随、各层分量（和 `hero` 事件带的一样）。别和选项 `hero`（起始主角的层 id）弄混。 |
| `follow` | `boolean`（getter） | 主角是不是跟着选中走（`setFollow`）。 |
| `spread` | `number`（getter） | 层距的倍数（`setSpread`）。 |
| `inset` | `{ top, right, bottom, left }`（getter） | 面板挡住的四边，CSS 像素（`setInset`）。给的是拷贝。 |
| `expanded` | `string[]`（getter） | 展开着、而且确实有子节点的节点（和 `expanded` 事件带的一样）。 |
| `selected` | `string \| null`（getter） | 选中的节点的 id（`select`）。 |
| `focus` | `string \| null`（getter） | 聚焦的层的 id（`focusLayer`；和 `focus` 事件带的一样）。只在一层时有；几层并存时是 `null`。 |
| `group` | `string \| null`（getter） | 强调的组，`"维度/组"`（`highlightGroup`）。 |
| `view` | `StrataView`（getter） | 恢复当前视图所需的全部信息，都用 id；每次给一份新的。见 [`StrataView`](#strataview)。 |

```ts
interface LayerInfo {
  id: string
  name: string
  visible: boolean
  count: number                  // 顶层节点数（收着的、展开出来的子节点都不算）
}
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
| `setData(data: StrataData)` | `DataIssue[]` | 校验、丢掉有问题的项、布局、画出来。返回查出来的问题（没问题是空数组）。选中、聚焦、插件的模式都清掉；隐藏的层、展开的节点按 id 保留。发 `hero`、`layers`、`expanded`。整份数据用不了（契约版本不对：不带 id 的 error，见 `isFatal`）时什么都不换：画面和 `strata.data` 都是原来的，只返回问题。注入的布局用不了时多一条 `layout-incomplete`（warning）。 |

### 插件

| 方法 | 返回 | 含义 |
|---|---|---|
| `use<Api>(plugin: StrataPlugin<Api>)` | `Api` | 装一个插件，返回它的接口。同名的装第二次抛 `StrataError('plugin-installed')`。销毁以后再装同名的，交回原来的接口，不抛。 |

### 主角和层

| 方法 | 返回 | 含义 |
|---|---|---|
| `setHero(layer: string)` | `HeroInfo` | 让这一层当主角（分量 1，其余 0），它也成为主角的“家”。隐藏的、不存在的层不理；只有一层时不起作用。镜头重新取景。返回调用之后的主次：`id` 不是 `layer` 就是没换成。 |
| `setHeroMix(mix: Record<string, number>)` | `HeroInfo` | 连续的版本：给每层一个分量 0..1（越界的夹回来），没写到的层**和隐藏的层**按 0。最后全是 0（比如分量只给了隐藏的层）就当没给，现在的主角保持 1。返回调用之后的主次，其中 `mix` 是实际生效的分量。 |
| `setFollow(on: boolean)` | `HeroInfo` | 开关“主角跟着选中走”。发 `hero`；返回调用之后的主次。 |
| `setLayerVisible(layer: string, visible: boolean)` | `LayerInfo \| null` | 显示或隐藏一层。返回这一层调用之后的 `LayerInfo`，层不存在时是 `null`。最后一张可见的图藏不了：这时结果里 `visible` 还是 `true`。隐藏的层淡出；被它隔开的两层之间画虚线的**穿透线**；主角被隐藏时让给最近的可见层。发 `layers`（主角换了还发 `hero`）。 |
| `focusLayer(layer: string \| null)` | `void` | 只有一层时：聚焦它（镜头框住它；`strata.focus` 和 `focus` 事件都是它的 id），`null` 放开。几层并存时“看哪一层”就是主角，所以它等于 `setHero(layer)`，`null` 回到主角的“家”：不聚焦，不发 `focus`（发的是 `hero`）。见 [design.zh-CN.md](design.zh-CN.md#点一层)。 |
| `setSpread(s: number)` | `void` | 层距的倍数（缺省 1）。用 `spread` 读回来。 |

### 节点和组

| 方法 | 返回 | 含义 |
|---|---|---|
| `select(id: string \| null)` | `void` | 按 id 选中节点（`null` 清掉，不认得的 id 也是清掉）。收起的子节点选中它画出来的祖先。和点一下走同一条路：发 `select` 事件（`source: 'api'`），开着 `follow` 时主角换到它那一层（用户没动过镜头才重新取景）。 |
| `expand(id: string, on = true)` | `void` | 展开一个节点（`false` 收起）。 |
| `setExpanded(ids: Iterable<string>)` | `void` | 设定展开的节点全集，别的都收起。顶层节点的位置不变。发 `expanded` 和 `hover(null)`。 |
| `highlightGroup(id: string \| null)` | `void` | 强调一个组：写 `"维度/组"`，或者只写组 id。`null` 清掉。 |

### 镜头

| 方法 | 返回 | 含义 |
|---|---|---|
| `shot(name: ShotName, opts?: ShotOptions)` | `void` | 移动镜头，见[镜头](#镜头)。`opts.layer` 是层的 id，`'layer'` 用它。`opts.duration` 单位是秒（缺省 1.3），`0` 直接跳过去。 |
| `setInset(inset: Inset)` | `void` | 四边被面板挡住的宽度（CSS 像素）：`{ top?, right?, bottom?, left? }`，没写的边是 0（`setInset({})` 清掉）。镜头让画面在剩下的区域里居中。一个方向上挡掉六成以上就不管那个方向。 |

```ts
interface ShotOptions { layer?: string; duration?: number }
interface Inset { top?: number; right?: number; bottom?: number; left?: number }
```

### 语言、主题和名字

| 方法 | 返回 | 含义 |
|---|---|---|
| `setLocale(locale: Locale, messages?)` | `void` | 换语言；给了 `messages` 连文案覆盖一起换。之后的问题描述、报错、悬停提示的名词、React 面板跟着换。发 `locale`。看变化插件没指定语言时按新语言重新比一遍。已经返回过的问题不会改。 |
| `text(key: MessageKey, vars?)` | `string` | 按实例的语言和覆盖取一条字。 |
| `setTheme(overrides: DeepPartial<Theme>)` | `void` | 换主题。`overrides` 和选项一样盖在 `DARK` 上（`setTheme({})` 就回到 `DARK`）。重建清屏色、背景、盘面、标签图集、节点和线的颜色（组的颜色按新色板重取）。布局、选中、隐藏的层、展开的节点、镜头都不动。插件的 `onChange` 收到 `'theme'`；发 `theme`。 |
| `setLabels(labels: LabelOptions)` | `void` | 换名字的规则（`setLabels({})` 回到处处 `auto`）。下一帧生效；布局、选中、镜头都不动。见[名字](#名字)。 |

### 视图状态

| 方法 | 返回 | 含义 |
|---|---|---|
| `setView(view: Partial<StrataView>)` | `void` | 恢复视图。每一项都可以不给；数据里已经没有的层、节点跳过。发 `hero`、`layers`。 |

### 事件和销毁

| 方法 | 返回 | 含义 |
|---|---|---|
| `on(event, cb)` | `() => void` | 订阅核心事件，返回取消订阅的函数。 |
| `dispose()` | `void` | 停掉循环、释放 GPU 资源、摘掉画布、丢掉 WebGL 上下文、调插件的销毁钩子、清掉监听。可以调几次；之后别的方法都不做事。 |

## `StrataView`

```ts
interface StrataView {
  heroMix: Record<string, number> // 层的 id → 当主角的分量（和 StrataOptions.heroMix、setHeroMix 一样）
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
const view = strata.view
localStorage.setItem('view', JSON.stringify(view))
// 之后
strata.setView(JSON.parse(localStorage.getItem('view')!))
// 也可以只给一部分
strata.setView({ hidden: ['onto'], selected: 'tbl:company' })
```

`setView` 按这个顺序应用：`follow`、`spread`、`expanded`、`hidden`、`heroMix`、`focus`、`group`、插件的那几项、`selected`、`camera`。没给 `camera`、而用户也没动过镜头时，重新取总览。

恢复 `selected` 照样发 `select`（`source: 'api'`），但**不**跟随、不动镜头：这是恢复状态，不是用户在问某个节点。

路径插件会加一项 `path`，看变化插件会加一项 `diff`，审计插件会加一项 `audit`（见 [plugins.zh-CN.md](plugins.zh-CN.md)）。插件的项不能和上面核心的项重名。

## 事件

用 `strata.on(name, cb)` 订阅，回调拿到第二列的值。

| 事件 | 带的值 | 什么时候发 |
|---|---|---|
| `hover` | `HoverInfo \| null` | 指针进入、在节点上移动、离开（`null`）。展开/收起以后、模式接管时也会发 `null`。悬停只由指针触发，所以没有 `source`。 |
| `select` | `SelectInfo` | 选中变了：单击（按下抬起之间没拖动，`source: 'pointer'`），或者 `select()`、`ctx.select()`、`setView({ selected })`（`source: 'api'`）。选中清掉时（点在空白处、再点一次选中的节点、`select(null)`）`node` 是 `null`。指针选中的，`pointer.hit` 分得清这两种点法：指针下的节点，点在空白处是 `null`。 |
| `tick` | `number` | 每画一帧，带引擎的时钟（秒）。 |
| `focus` | `string \| null` | 聚焦的层变了（只在一层时）：`focusLayer()`、`setView({ focus })`、俯视镜头（聚焦这一层；几层时叠看前先清掉聚焦）、聚焦着的时候模式接管（`null`）。带的总是新的 `strata.focus`。 |
| `hero` | `HeroInfo` | 主角、分量或跟随开关变了；`setData`、`setView` 之后。 |
| `layers` | `LayerInfo[]` | 显示/隐藏变了；`setData`、`setView` 之后；模式接管和交还时。 |
| `expanded` | `string[]` | 展开的节点变了（带的是新的 `strata.expanded`）；`setData` 之后。 |
| `contextlost` | `null` | WebGL 上下文丢了，循环停下。 |
| `contextrestored` | `null` | 上下文还回来了，资源重新上传，循环接着跑。 |
| `locale` | `Locale` | 调了 `setLocale()`。 |
| `theme` | `Theme` | 调了 `setTheme()`；带的是新的完整主题。 |

```ts
interface NodeInfo {
  id: string                 // 节点的 id
  label: string              // 画出来的名字（对比时可能是新名字）
  layer: string              // 层的 id
  layerName: string          // 层的名字
  group: string | null       // 组的 id，“维度/组”
  groupName: string | null   // 组的名字
  folds: number              // 收着几个子节点；大于 0 就能展开
  childNoun: string | null   // 子节点叫什么（NodeStyle.childNoun，按现在的语言挑好）
  expanded: boolean
}
interface HoverInfo extends NodeInfo {
  pointer: { x: number; y: number }  // 指针位置，相对画布的 CSS 像素
}
interface SelectInfo {
  node: NodeInfo | null      // 选中的节点；null = 选中清掉了
  source: 'pointer' | 'api'
  pointer: { x: number; y: number; hit: string | null } | null  // 'api' 时是 null；hit：指针下的节点，null 是空白处
}
```

插件的事件在插件自己的接口上（`path.on('step')`、`diff.on('enter' | 'exit')`、`audit.on('enter' | 'exit' | 'select')`）。

## 镜头

```ts
type ShotName = 'overview' | 'top' | 'layer'
```

| 调用 | 效果 |
|---|---|
| `shot('overview')` | 框住所有可见的层。有主角时主角铺满画面，配角露在它的上方或下方。 |
| `shot('top')` | 几层并存时是**叠看**：层距收到几乎为零，从正上方看，重合的关系就是一致的。换别的镜头、`setHeroMix`、`setSpread` 或换主角时退出叠看。只有一层时是这一层的俯视地图。 |
| `shot('layer', { layer: id })` | 框住一层，给层的 id。不认得的 id 什么都不做。 |

框住一条路径、一处变化归插件管（`path.shot(opts?)`、`diff.shot(hunkId, opts?)`，选项都是 `{ duration? }`）。

## 错误

`StrataError extends Error`，多一个固定的 `code`；`message` 跟着实例的 `locale`。

| `code` | 谁抛 |
|---|---|
| `webgl-unavailable` | `new Strata()` |
| `plugin-installed` | `use()` 装了同名的插件 |
| `view-core-key` | 插件的 `ctx.registerView()` 用了核心的项（`heroMix`、`follow`……） |
| `view-key-taken` | 插件的 `ctx.registerView()` 用了别的插件登记过的项 |
| `locale-builtin` | `registerLocale('en' \| 'zh-CN', …)` |
| `audit-layers` | `auditMappings()` 给的层不存在或者两个一样，或者数据不到两层（`kgstrata/headless`；文案跟着 `opts.locale`） |

数据的问题不抛，由 `setData` / `validate` 作为 `DataIssue` 返回（见 [data.zh-CN.md](data.zh-CN.md#校验)）。

## 注入布局

```ts
type LayoutProvider = (data: Resolved, defaults: LayoutOptions) => StrataLayout | null | undefined
```

引擎每次要布局一张图时先问 `options.layout`：`setData` 时全部收起的全景，看变化插件里两版的合集（`ctx.layoutOf`）。返回一份 `StrataLayout` 就用它；返回 `null` / `undefined` 就由引擎自己算。`defaults` 是引擎自己算时交给 `layoutStrata` 的选项（盘面半径、`anchor`），`layoutStrata(data, defaults)` 就能得到和内置一样的结果。

返回的布局要把 `data` 的每个节点放在它自己那一层，每层一个半径（`checkLayout`）。否则 `setData` 多返回一条 `layout-incomplete`（warning，`id` 是第一个缺的节点），布局改为引擎自己算。展开的子节点总是用 `placeChildren` 添在给的布局上，顶层节点的位置不动。

```ts
import { layoutFromJSON } from 'kgstrata/headless'

const cached = layoutFromJSON(await (await fetch('/layout.json')).json()) // 服务端用 layoutToJSON 存的
const strata = new Strata(host, { layout: () => cached })
strata.setData(data)
```

## `kgstrata` 的其他导出

除了 `Strata`，核心入口还导出插件契约（`Emitter`、`StrataPlugin`、`StrataContext`、`StrataOverlay`、`StrataMode`、`ModeHandle`、`FrameInfo`、`PlatePoint`、`StrataChange`、`StrataEvents`、`ViewSlot`、`Spotlight`），类型 `HeroInfo`、`HoverInfo`、`NodeInfo`、`SelectInfo`、`SelectSource`、`LayerInfo`、`LayoutProvider`、`ShotName`、`ShotOptions`、`Inset`、`PointerPosition`、`StrataOptions`、`StrataView`、`FitOptions`、`LabelOptions`、`LabelMode`，以及 [`kgstrata/headless`](headless.zh-CN.md) 的全部。

模型、样式、渲染器、每帧画的样子（`Looks`、`NodeLook`、`EdgeLook`、`BaseNode`……）不从这里导出：它们在 `kgstrata/internals`，给接管画面的插件用，**不受 semver 保护**（见 [plugins.zh-CN.md](plugins.zh-CN.md#kgstratainternals)）。
