# 主题和语言

[English](theming-and-i18n.md)

这篇讲 `locale` 和 `theme` 两个选项，列出 `createTheme` 能覆盖的每一项，以及怎么加一种语言。

两样都按实例配：一页上的两个视图可以用不同的语言和主题，互不影响。

## 语言：`locale`

```ts
new Strata(host, { locale: 'zh-CN' }) // 'en'（缺省）| 'zh-CN' | 任何登记过的语言
```

`locale` 管给人看的字：

- `setData` 返回的 `DataIssue.message`（`validate` / `normalize` 传了 `{ locale }` 时也一样）；
- `StrataError.message`；
- `kgstrata/diff` 里 kgdiff 写的变化说明（插件跟着实例，除非给了 `diffPlugin({ locale })`），以及 kgstrata 交给 kgdiff 的显示名：没写类型的关系（“关联”）和包含关系（“包含于”）；
- React 面板的界面文字（跟着实例，除非给了 `locale` prop）。

给程序读的东西不随它变：问题码、错误码、关系的类型、kgdiff 的谓词。程序里按 `code` 判断，不要按 `message`。

之后用 `strata.setLocale(locale)` 换。会发 `locale` 事件，React 面板跟着重画，之后的问题、报错用新语言，看变化插件按新语言重新比一遍（它有自己的 `locale` 时除外）。已经返回过的问题不会改。

### 覆盖个别文案：`messages`

```ts
new Strata(host, { locale: 'zh-CN', messages: { 'ui.layers': '平面', 'ui.tip-expand': '{n} 列 · 双击展开' } })
strata.setLocale('en', { 'ui.layers': 'Planes' }) // 换语言，连覆盖一起换
strata.text('ui.layers')                         // 'Planes'
```

覆盖只对这个实例，不管它现在是什么语言，先于语言表。`setLocale(locale)` 不给第二个参数时保留原来的覆盖。面板的 `locale` prop 和实例不一样时不用它。

不带渲染时：

```ts
import { validate, normalize, message, MESSAGES, localeOf } from 'kgstrata/headless'

validate(data, { locale: 'zh-CN' })
normalize(data, { locale: 'zh-CN' })
message('zh-CN', 'issue.duplicate-node', { node: 'onto:company' })
localeOf(navigator.language) // 认得的原样返回；认不得的一律 'en'
```

`MESSAGES['en' | 'zh-CN'][key]` 是两张内置的表；`messagesOf(locale)` 给出任何语言的完整表，登记的语言按回退链补齐。键按前缀分组：`issue.*`（校验）、`error.*`（抛出的错误）、`label.*`（交给 kgdiff 的名字）、`ui.*`（React 面板）、`warn.*`（开发时的提醒）。占位符写作 `{名字}`；`message()` 替换给了值的，没给的原样留着。

### 加一种语言

`Locale` 是 `string`，内置 `'en'`、`'zh-CN'`。别的语言在用之前登记：

```ts
import { registerLocale } from 'kgstrata' // 或者 'kgstrata/headless'

registerLocale('ja', { 'ui.layers': 'レイヤー', 'ui.overview': '全体' })          // 缺的键回退到 'en'
registerLocale('zh-TW', { 'ui.layers': '圖層' }, { fallback: 'zh-CN' })            // 也可以回退到别的语言
new Strata(host, { locale: 'ja' })
```

- 表可以只写一部分。缺的键顺着回退链取（`fallbackChain('zh-TW')` 是 `['zh-TW', 'zh-CN']`），缺省回退到 `'en'`。回退的语言自己也可以是登记的。
- 登记是全局的，同名的再登记会整个替换。`'en'`、`'zh-CN'` 不能再登记（抛 `StrataError('locale-builtin')`）；要改个别文案用 `messages`。
- `hasLocale(name)`、`localeOf(name)`、`messagesOf(name)` 也认登记的语言。
- **两版对比**：变化说明是 kgdiff 自己写的，它只认 `'en'`、`'zh-CN'`（`@kgdiff/core` 0.12）。别的语言，看变化插件交给 kgdiff 的是回退链上第一个内置语言（`builtinLocaleOf`），多半是 `'en'`。kgstrata 交给 kgdiff 的显示名（`label.related`、`label.part-of`）仍按登记的语言。

要给库本身加一种内置语言，见 [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-language)。

## 主题：`theme`

```ts
new Strata(host, {
  theme: {
    accent: '#ffd27a',
    label: { primary: '#ffffff' },
    palette: ['#58c6ff', '#46d8a8', '#a590ff'],
  },
})
```

这个选项是一个 `DeepPartial<Theme>`，盖在夜景主题 `DARK` 上：

- 对象逐项合并；
- 数组（`palette`、`magnitude`、`haloAlpha`、`haloSize`）整个替换；
- 结果是一个新对象；`DARK` 是冻住的，不会变。

`createTheme(overrides)` 做同样的合并，返回完整的 `Theme`。`strata.theme` 是实例合并后的主题。

合并之外只有一条规则：`overrides` 里有 `background`、没有 `backdrop` 时，背景渐变按 `background` 推出来（`backdropOf(background)`：中间略亮、四周略暗），不留 `DARK` 的深蓝。所以换个背景色一行就够：`strata.setTheme({ background: '#ffffff' })`。要自己定渐变就给 `backdrop`。

### 换主题：`setTheme`

```ts
strata.setTheme({ background: '#10131c' }) // 背景渐变跟着变
strata.setTheme({ backdrop: { center: '#1b2440', mid: '#0d1222', edge: '#05070d' }, accent: '#ffd27a' })
strata.setTheme({}) // 回到 DARK
```

`setTheme(overrides)` 和选项一样把 `overrides` 盖在 `DARK` 上（不是盖在现在的主题上）。重建清屏色、背景渐变、盘面（点阵、领域底色、层名、领域名）、标签图集、节点和线的颜色；没写 `color` 的组按新 `palette` 重取颜色。不重新布局，选中、隐藏的层、展开的节点、镜头都不动。插件的 `onChange` 收到 `'theme'`，发 `theme` 事件；看变化插件按新的 `diffScheme` 重新比一遍。

React 面板用 CSS 变量。`<StrataCanvas>` 把能从主题推出来的那些（`--kgs-bg`、`--kgs-overlay`、`--kgs-text*`、`--kgs-accent*`、`--kgs-border*`、`--kgs-hover`、`--kgs-pressed`、`--kgs-track`）写在自己的容器上，而且只写和 `DARK` 推出来的不一样的那几个，所以 `setTheme` 以后它里面的面板跟着变（见 [react.zh-CN.md](react.zh-CN.md#样式)）。

现在只有夜景主题。浅色主题还没做，但下面每一项都能覆盖。

### 全部项

| 项 | `DARK` 的值 | 用在 |
|---|---|---|
| `background` | `#070a13` | 画布的清屏色，也是背景渐变的底子。只给它不给 `backdrop` 时渐变按它推出来。面板：`--kgs-bg`、`--kgs-overlay` |
| `backdrop.center` / `.mid` / `.edge` | `#0e1526` / `#080b15` / `#030408` | 背景的径向渐变，从中间到四周（看得见的背景是它） |
| `palette` | 10 种颜色，开头是 `#58c6ff`、`#46d8a8`、`#a590ff` | 没写 `color` 的组按顺序取 |
| `fog.near` / `fog.far` | `12` / `125` | 雾从哪儿开始、到哪儿最浓：**镜头看着的那一点后面**多远（世界单位）。每帧按它摆，雾跟着镜头的远近走 |
| `plate.neutral` | `#5c6680` | 对比两版时盘面退成的灰 |
| `plate.caption` | `#8f9bbd` | 平铺在盘边的层名 |
| `label.primary` | `#f2f4f9` | 最重要的节点、被点亮的节点的名字 |
| `label.secondary` | `#d5dbe8` | 次要节点、展开出来的子节点的名字 |
| `label.halo` | `#04060a` | 字后面的描边 |
| `accent` | `#9fe6ff` | 选中、路径的步骤和路径段 |
| `magnitude` | `[1.0, 1.0, 0.98, 0.95, 0.92, 0.88]` | 星等 0..5 的亮度（0 最重要）。保持 ≤ 1：泛光留给被点亮的东西 |
| `haloAlpha` | `[0.17, 0.15, 0.13, 0.11, 0.1, 0.09]` | 每个星等的小柔光浓度 |
| `haloSize` | `[3.0, 3.0, 2.9, 2.8, 2.7, 2.6]` | 每个星等的光晕大小（节点半径的倍数） |
| `tone.primary` / `tone.aligned` | `#7888f0` / `#7888f0` | 基准层 / 对齐过来的层的点阵颜色 |
| `starWhite` | `0.06` | 节点的组色里兑多少白 |
| `line` | `#8b96b4` | 线往它上面靠的中性色 |
| `lineTint` | `0.92` | 层内的弧线保留多少两端节点的颜色（其余是 `line`） |
| `ungrouped` | `#aab6d6` | 没有组的节点的颜色 |
| `diffScheme` | `'dark'` | 交给 kgdiff 的配色方案（`'dark' \| 'light'`），决定变化的颜色 |
| `font` | PingFang SC、Hiragino Sans GB、Microsoft YaHei、Noto Sans CJK SC、系统 UI 字体 | 名字的字体 |
| `mono` | JetBrains Mono、SF Mono、ui-monospace、Menlo、Consolas | `mono` 类型的节点（表、字段）的字体 |

注意：

- React 面板的颜色是 CSS 变量。在 `<StrataCanvas>` 里，上面列的那几个由主题设；徽标和层前的小条（`--kgs-badge-*`、`--kgs-mark`）只在 CSS 里。见 [react.zh-CN.md](react.zh-CN.md#样式)。
- `kgstrata/diff` 的 `familyColors(theme)`（`<DiffPanel>` 用它）跟着 `theme.diffScheme`。
- 0.2 删掉了没人读的 `root`、`label.muted`、`plate.dot`；只在第一帧之前起作用的 `fogNear` / `fogFar` 换成了 `fog.near` / `fog.far`。
- 数据里组的颜色（`GroupSpec.color`）优先于色板。

## 不带渲染时

`DARK`、`createTheme`、`backdropOf`、`DeepPartial`、`Theme`、`Locale`、`BuiltinLocale`、`MessageKey`、`Messages`、`MessageOverrides`、`MESSAGES`、`DEFAULT_LOCALE`、`localeOf`、`hasLocale`、`registerLocale`、`fallbackChain`、`builtinLocaleOf`、`messagesOf`、`pickText`、`message`、`StrataError` 都从 `kgstrata/headless` 导出（`kgstrata` 也转出了）。它们是纯数据和函数，不引入 three.js。
