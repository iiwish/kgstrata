# 主题和语言

[English](theming-and-i18n.md)

这篇讲 `locale` 和 `theme` 两个选项，列出 `createTheme` 能覆盖的每一项，以及怎么加一种语言。

两样都按实例配：一页上的两个视图可以用不同的语言和主题，互不影响。

## 语言：`locale`

```ts
new Strata(host, { locale: 'zh-CN' }) // 'en'（缺省）| 'zh-CN'
```

`locale` 管给人看的字：

- `setData` 返回的 `DataIssue.message`（`validate` / `normalize` 传了 `{ locale }` 时也一样）；
- `StrataError.message`；
- `kgstrata/diff` 里 kgdiff 写的变化说明（插件跟着实例，除非给了 `diffPlugin({ locale })`），以及 kgstrata 交给 kgdiff 的显示名：没写类型的关系（“关联”）和包含关系（“包含于”）；
- React 面板的界面文字（跟着实例，除非给了 `locale` prop）。

给程序读的东西不随它变：问题码、错误码、关系的类型、kgdiff 的谓词。程序里按 `code` 判断，不要按 `message`。

语言在实例的整个生命周期里固定。要切换就新建一个实例（React 里换 `<StrataCanvas>` 的 `key`）。

不带渲染时：

```ts
import { validate, normalize, message, MESSAGES, localeOf } from 'kgstrata/headless'

validate(data, { locale: 'zh-CN' })
normalize(data, { locale: 'zh-CN' })
message('zh-CN', 'issue.duplicate-node', { node: 'onto:company' })
localeOf(navigator.language) // 'en' | 'zh-CN'；认不得的一律 'en'
```

`MESSAGES[locale][key]` 是完整的消息表。键按前缀分组：`issue.*`（校验）、`error.*`（抛出的错误）、`label.*`（交给 kgdiff 的名字）、`ui.*`（React 面板）。占位符写作 `{名字}`；`message()` 替换给了值的，没给的原样留着。

### 加一种语言

语言是编译进去的，没有运行时注册。加一种语言要改 `src/locale.ts`：

1. 把语言代码加进 `Locale` 联合类型，比如 `export type Locale = 'en' | 'zh-CN' | 'ja'`。
2. 加一张类型为 `Record<MessageKey, string>` 的表。英文表里的键少翻一条，TypeScript 就编不过。每个 `{占位符}` 都要保留。
3. 把它加进 `MESSAGES`。
4. 在 `tests/locale.test.ts` 里补上（键一条不少、占位符保留）。
5. 两版对比：变化说明是 kgdiff 自己写的，它的 `Locale` 现在是 `'en' | 'zh-CN'`（`@kgdiff/core` 0.12）。新语言要 kgdiff 那边也支持，或者给 `diffPlugin({ locale })` 一个 kgdiff 认得的语言。

另见 [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-language)。

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

`createTheme(overrides)` 做同样的合并，返回完整的 `Theme`。`strata.theme` 是实例合并后的主题。主题只在创建时读一次。

现在只有夜景主题。浅色主题还没做，但下面每一项都能覆盖。

### 全部项

| 项 | `DARK` 的值 | 用在 |
|---|---|---|
| `background` | `#070a13` | 画布的清屏色 |
| `backdrop.center` / `.mid` / `.edge` | `#0e1526` / `#080b15` / `#030408` | 背景的径向渐变，从中间到四周 |
| `palette` | 10 种颜色，开头是 `#58c6ff`、`#46d8a8`、`#a590ff` | 没写 `color` 的组按顺序取 |
| `fogNear`、`fogFar` | `70`、`190` | 雾的远近（世界单位）：远处的东西融进背景 |
| `plate.dot` | `#c3cdf0` | 渲染器目前没有读它 |
| `plate.neutral` | `#5c6680` | 对比两版时盘面退成的灰 |
| `plate.caption` | `#8f9bbd` | 平铺在盘边的层名 |
| `label.primary` | `#f2f4f9` | 最重要的节点、被点亮的节点的名字 |
| `label.secondary` | `#d5dbe8` | 次要节点、展开出来的子节点的名字 |
| `label.muted` | `#a5aec0` | 渲染器目前没有读它 |
| `label.halo` | `#04060a` | 字后面的描边 |
| `accent` | `#9fe6ff` | 选中、路径的步骤和路径段 |
| `root` | `#e7eaf0` | 渲染器目前没有读它 |
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

- React 面板的颜色用的是 CSS 变量，不是主题。改颜色时两边都要改，见 [react.zh-CN.md](react.zh-CN.md#样式)。
- `kgstrata/diff` 的 `familyColors()`（`<DiffPanel>` 用它）总是返回夜景方案的颜色，不看 `theme.diffScheme`。
- 数据里组的颜色（`GroupSpec.color`）优先于色板。

## 不带渲染时

`DARK`、`createTheme`、`DeepPartial`、`Theme`、`Locale`、`MessageKey`、`MESSAGES`、`DEFAULT_LOCALE`、`localeOf`、`message`、`StrataError` 都从 `kgstrata/headless` 导出（`kgstrata` 也转出了）。它们是纯数据和函数，不引入 three.js。
