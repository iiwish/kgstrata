# Theming and languages

[简体中文](theming-and-i18n.zh-CN.md)

This page explains the `locale` and `theme` options, lists every theme field that `createTheme` can override, and describes how to add a language.

Both are set per instance. Two views on one page can use different languages and themes without affecting each other.

## Language: `locale`

```ts
new Strata(host, { locale: 'zh-CN' }) // 'en' (default) | 'zh-CN' | any registered language
```

`locale` controls text meant for people:

- `DataIssue.message` from `setData` (and from `validate` / `normalize` when you pass `{ locale }`);
- `StrataError.message`;
- the change descriptions kgdiff writes in `kgstrata/diff` (the plugin follows the instance unless you pass `diffPlugin({ locale })`), and the display names kgstrata gives kgdiff for untyped relations ("related to") and containment ("part of");
- text in the React panels (they follow the instance unless you pass a `locale` prop).

It does not change anything meant for programs: issue codes, error codes, relation types, kgdiff predicates. Branch on `code`, never on `message`.

Switch it later with `strata.setLocale(locale)`. The `locale` event fires, React panels re-render, the next issues and errors use the new language, and the diff plugin re-compares in it (unless it has its own `locale`). Issues already returned are not rewritten.

### Overriding single texts: `messages`

```ts
new Strata(host, { locale: 'en', messages: { 'ui.layers': 'Planes', 'ui.tip-expand': '{n} columns · double-click' } })
strata.setLocale('zh-CN', { 'ui.layers': '平面' }) // a new language, and new overrides
strata.text('ui.layers')                          // '平面'
```

Overrides apply to that instance only, whatever its language, before the language table. `setLocale(locale)` without a second argument keeps them. Panels showing a different `locale` prop than the instance do not use them.

Without rendering:

```ts
import { validate, normalize, message, MESSAGES, localeOf } from 'kgstrata/headless'

validate(data, { locale: 'zh-CN' })
normalize(data, { locale: 'zh-CN' })
message('zh-CN', 'issue.duplicate-node', { node: 'onto:company' })
localeOf(navigator.language) // a known language as is; anything unknown → 'en'
```

`MESSAGES['en' | 'zh-CN'][key]` are the built-in tables; `messagesOf(locale)` gives the full table of any language, registered ones filled in along their fallback chain. Keys are grouped by prefix: `issue.*` (validation), `error.*` (thrown errors), `label.*` (names handed to kgdiff), `ui.*` (React panels), `warn.*` (development warnings). Placeholders are written `{name}`; `message()` replaces the ones it is given and leaves the rest.

### Adding a language

`Locale` is a `string`; `'en'` and `'zh-CN'` are built in. Register another one at runtime, before you use it:

```ts
import { registerLocale } from 'kgstrata' // or 'kgstrata/headless'

registerLocale('ja', { 'ui.layers': 'レイヤー', 'ui.overview': '全体' })          // missing keys fall back to 'en'
registerLocale('zh-TW', { 'ui.layers': '圖層' }, { fallback: 'zh-CN' })            // or to another language
new Strata(host, { locale: 'ja' })
```

- The table may be partial. Missing keys are taken along the fallback chain (`fallbackChain('zh-TW')` is `['zh-TW', 'zh-CN']`); the default fallback is `'en'`. A fallback can itself be a registered language.
- Registration is global and replaces an earlier registration of the same name. `'en'` and `'zh-CN'` cannot be registered again (`StrataError('locale-builtin')`); use `messages` to change single texts.
- `hasLocale(name)`, `localeOf(name)`, `messagesOf(name)` see registered languages too.
- **Version comparison:** kgdiff writes the change descriptions itself and only knows `'en'` and `'zh-CN'` (`@kgdiff/core` 0.12). For any other language the diff plugin hands kgdiff the first built-in language on the fallback chain (`builtinLocaleOf`), usually `'en'`. The display names kgstrata gives kgdiff (`label.related`, `label.part-of`) do use the registered language.

To add a built-in language to the library itself, see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-language).

## Theme: `theme`

```ts
new Strata(host, {
  theme: {
    accent: '#ffd27a',
    label: { primary: '#ffffff' },
    palette: ['#58c6ff', '#46d8a8', '#a590ff'],
  },
})
```

The option is a `DeepPartial<Theme>` applied on top of the dark theme `DARK`:

- objects merge field by field;
- arrays (`palette`, `magnitude`, `haloAlpha`, `haloSize`) replace the whole array;
- the result is a fresh object; `DARK` is frozen and never changes.

`createTheme(overrides)` does the same merge and returns a full `Theme`. `strata.theme` is the resolved theme of an instance.

One rule on top of the merge: if `overrides` has `background` but no `backdrop`, the backdrop gradient is derived from `background` (`backdropOf(background)`: the centre a little lighter, the edge a little darker), instead of keeping `DARK`'s dark blue. So a new background colour is one line: `strata.setTheme({ background: '#ffffff' })`. Give `backdrop` yourself to control the gradient.

### Changing the theme: `setTheme`

```ts
strata.setTheme({ background: '#10131c' }) // the backdrop follows
strata.setTheme({ backdrop: { center: '#1b2440', mid: '#0d1222', edge: '#05070d' }, accent: '#ffd27a' })
strata.setTheme({}) // back to DARK
```

`setTheme(overrides)` applies `overrides` on top of `DARK`, exactly like the option (not on top of the current theme). It rebuilds the clear colour, the backdrop gradient, the plates (dot grid, group wash, layer captions, group names), the label atlas and the node and line colours; group colours without `color` are re-taken from the new `palette`. It does not re-layout, and selection, hidden layers, expanded nodes and the camera stay. Plugins get `onChange('theme')` and the `theme` event fires; the diff plugin re-compares with the new `diffScheme`.

The React panels use CSS variables. `<StrataCanvas>` writes the ones that follow from the theme (`--kgs-bg`, `--kgs-overlay`, `--kgs-text*`, `--kgs-accent*`, `--kgs-border*`, `--kgs-hover`, `--kgs-pressed`, `--kgs-track`) on its container, and only those that differ from what `DARK` gives, so after `setTheme` the panels inside it follow (see [react.md](react.md#styles)).

There is only a dark theme today. A light theme is not built yet, but every field below can be overridden.

### Every field

| Field | `DARK` value | Used for |
|---|---|---|
| `background` | `#070a13` | Clear colour of the canvas and the base of the backdrop gradient. Given without `backdrop`, the gradient is derived from it. Panels: `--kgs-bg`, `--kgs-overlay` |
| `backdrop.center` / `.mid` / `.edge` | `#0e1526` / `#080b15` / `#030408` | Radial background gradient, centre to edge (the visible background) |
| `palette` | 10 colours, starting `#58c6ff`, `#46d8a8`, `#a590ff` | Groups without `color`, in order |
| `fog.near` / `fog.far` | `12` / `125` | Where fog starts and where it is thickest, in world units **behind the point the camera looks at**. Applied every frame, so the fog follows zooming |
| `plate.neutral` | `#5c6680` | Grey the plates turn to while comparing versions |
| `plate.caption` | `#8f9bbd` | Layer names drawn on the plate rim |
| `label.primary` | `#f2f4f9` | Labels of the most important nodes and of highlighted nodes |
| `label.secondary` | `#d5dbe8` | Labels of less important nodes and of expanded children |
| `label.halo` | `#04060a` | Outline behind label text |
| `accent` | `#9fe6ff` | Selection, path steps and segments |
| `magnitude` | `[1.0, 1.0, 0.98, 0.95, 0.92, 0.88]` | Node brightness per magnitude 0..5 (0 = most important). Keep ≤ 1: bloom is reserved for highlighted things |
| `haloAlpha` | `[0.17, 0.15, 0.13, 0.11, 0.1, 0.09]` | Soft halo opacity per magnitude |
| `haloSize` | `[3.0, 3.0, 2.9, 2.8, 2.7, 2.6]` | Halo size (× node radius) per magnitude |
| `tone.primary` / `tone.aligned` | `#7888f0` / `#7888f0` | Dot grid colour on the anchor layer / on aligned layers |
| `starWhite` | `0.06` | How much white is mixed into a node's group colour |
| `line` | `#8b96b4` | Neutral colour that lines lean towards |
| `lineTint` | `0.92` | How much of the end nodes' colours in-layer arcs keep (rest is `line`) |
| `ungrouped` | `#aab6d6` | Colour of nodes without a group |
| `diffScheme` | `'dark'` | Colour scheme passed to kgdiff (`'dark' \| 'light'`) for the change colours |
| `font` | PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system UI fonts | Label font stack |
| `mono` | JetBrains Mono, SF Mono, ui-monospace, Menlo, Consolas | Font for `mono` node types (tables, fields) |

Notes:

- The React panels are styled with CSS variables. Inside `<StrataCanvas>` the theme sets the ones listed above; badge and marker colours (`--kgs-badge-*`, `--kgs-mark`) are CSS only. See [react.md](react.md#styles).
- `familyColors(theme)` in `kgstrata/diff` (used by `<DiffPanel>`) follows `theme.diffScheme`.
- 0.2 removed `root`, `label.muted` and `plate.dot`, which nothing read, and replaced `fogNear` / `fogFar` (which only mattered before the first frame) by `fog.near` / `fog.far`.
- Group colours in the data (`GroupSpec.color`) override the palette for that group.

## Without rendering

`DARK`, `createTheme`, `backdropOf`, `DeepPartial`, `Theme`, `Locale`, `BuiltinLocale`, `MessageKey`, `Messages`, `MessageOverrides`, `MESSAGES`, `DEFAULT_LOCALE`, `localeOf`, `hasLocale`, `registerLocale`, `fallbackChain`, `builtinLocaleOf`, `messagesOf`, `pickText`, `message` and `StrataError` are all exported from `kgstrata/headless` (and re-exported from `kgstrata`). They are plain data and functions and do not import three.js.
