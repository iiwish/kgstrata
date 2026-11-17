# Theming and languages

[简体中文](theming-and-i18n.zh-CN.md)

This page explains the `locale` and `theme` options, lists every theme field that `createTheme` can override, and describes how to add a language.

Both are set per instance. Two views on one page can use different languages and themes without affecting each other.

## Language: `locale`

```ts
new Strata(host, { locale: 'zh-CN' }) // 'en' (default) | 'zh-CN'
```

`locale` controls text meant for people:

- `DataIssue.message` from `setData` (and from `validate` / `normalize` when you pass `{ locale }`);
- `StrataError.message`;
- the change descriptions kgdiff writes in `kgstrata/diff` (the plugin follows the instance unless you pass `diffPlugin({ locale })`), and the display names kgstrata gives kgdiff for untyped relations ("related to") and containment ("part of");
- text in the React panels (they follow the instance unless you pass a `locale` prop).

It does not change anything meant for programs: issue codes, error codes, relation types, kgdiff predicates. Branch on `code`, never on `message`.

The language is fixed for the lifetime of an instance. To switch, create a new instance (in React, change the `key` of `<StrataCanvas>`).

Without rendering:

```ts
import { validate, normalize, message, MESSAGES, localeOf } from 'kgstrata/headless'

validate(data, { locale: 'zh-CN' })
normalize(data, { locale: 'zh-CN' })
message('zh-CN', 'issue.duplicate-node', { node: 'onto:company' })
localeOf(navigator.language) // 'en' | 'zh-CN'; anything unknown → 'en'
```

`MESSAGES[locale][key]` is the full table. Keys are grouped by prefix: `issue.*` (validation), `error.*` (thrown errors), `label.*` (names handed to kgdiff), `ui.*` (React panels). Placeholders are written `{name}`; `message()` replaces the ones it is given and leaves the rest.

### Adding a language

Languages are compiled in; there is no runtime registration. Adding one is a change to `src/locale.ts`:

1. Add the code to the `Locale` union, e.g. `export type Locale = 'en' | 'zh-CN' | 'ja'`.
2. Add a table typed `Record<MessageKey, string>`. TypeScript then refuses to compile until every key in the English table has a translation. Keep every `{placeholder}`.
3. Add it to `MESSAGES`.
4. Add a case to `tests/locale.test.ts` (every key present, placeholders preserved).
5. Version comparison: kgdiff writes the change descriptions itself and its `Locale` type is currently `'en' | 'zh-CN'` (`@kgdiff/core` 0.12). A new language needs support in kgdiff too, or `diffPlugin({ locale })` must be given a language kgdiff knows.

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-language).

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

`createTheme(overrides)` does the same merge and returns a full `Theme`. `strata.theme` is the resolved theme of an instance. The theme is read once at creation.

There is only a dark theme today. A light theme is not built yet, but every field below can be overridden.

### Every field

| Field | `DARK` value | Used for |
|---|---|---|
| `background` | `#070a13` | Clear colour of the canvas |
| `backdrop.center` / `.mid` / `.edge` | `#0e1526` / `#080b15` / `#030408` | Radial background gradient, centre to edge |
| `palette` | 10 colours, starting `#58c6ff`, `#46d8a8`, `#a590ff` | Groups without `color`, in order |
| `fogNear`, `fogFar` | `70`, `190` | Fog distance (world units): far things fade into the background |
| `plate.dot` | `#c3cdf0` | Not read by the renderer at the moment |
| `plate.neutral` | `#5c6680` | Grey the plates turn to while comparing versions |
| `plate.caption` | `#8f9bbd` | Layer names drawn on the plate rim |
| `label.primary` | `#f2f4f9` | Labels of the most important nodes and of highlighted nodes |
| `label.secondary` | `#d5dbe8` | Labels of less important nodes and of expanded children |
| `label.muted` | `#a5aec0` | Not read by the renderer at the moment |
| `label.halo` | `#04060a` | Outline behind label text |
| `accent` | `#9fe6ff` | Selection, path steps and segments |
| `root` | `#e7eaf0` | Not read by the renderer at the moment |
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

- The React panels are styled with CSS variables, not with the theme. Change both when you change colours; see [react.md](react.md#styles).
- `familyColors()` in `kgstrata/diff` (used by `<DiffPanel>`) always returns the dark-scheme colours, regardless of `theme.diffScheme`.
- Group colours in the data (`GroupSpec.color`) override the palette for that group.

## Without rendering

`DARK`, `createTheme`, `DeepPartial`, `Theme`, `Locale`, `MessageKey`, `MESSAGES`, `DEFAULT_LOCALE`, `localeOf`, `message` and `StrataError` are all exported from `kgstrata/headless` (and re-exported from `kgstrata`). They are plain data and functions and do not import three.js.
