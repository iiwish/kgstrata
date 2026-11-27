# React

[简体中文](react.zh-CN.md)

This page covers `kgstrata/react`: the `<StrataCanvas>` component, the hooks, every panel and its props, the stylesheet and its CSS variables, and server-side rendering.

```sh
npm install kgstrata three react react-dom
```

React 18 and 19 are accepted as peers; 18.3 and 19 have been tested.

| Entry | Contains | Pulls in kgdiff |
|---|---|---|
| `kgstrata/react` | `<StrataCanvas>`, provider, hooks, core panels | no |
| `kgstrata/react/path` | `<PathList>` | no |
| `kgstrata/react/diff` | `<DiffPanel>`, `changesByLayer` | yes (via `kgstrata/diff`) |
| `kgstrata/react/styles.css` | optional panel styles | — |

## `<StrataCanvas>`

Creates a `Strata` on mount, calls `setData` when `data` changes, disposes on unmount.

```tsx
import { LayerList, NodeTip, StrataCanvas } from 'kgstrata/react'
import 'kgstrata/react/styles.css'

export function Graph({ data }: { data: StrataData }) {
  return (
    <StrataCanvas data={data} options={{ hero: 'onto' }} style={{ height: 600 }}>
      <aside className="kgs-panel" style={{ position: 'absolute', left: 16, top: 16, width: 200, padding: 8 }}>
        <LayerList />
      </aside>
      <NodeTip />
    </StrataCanvas>
  )
}
```

Layout: the component renders one container, `<div class="kgs-canvas">`, which is a positioning context. Inside it come the canvas host `<div class="kgs-canvas-host">` (absolutely positioned to fill the container) and then the `children`, drawn over the canvas. Panels and `NodeTip` simply use `position: absolute`.

The container comes with default rules, `position: relative; width: 100%; height: 100%; min-height: 320px`, written as `:where(.kgs-canvas){…}` in a `<style>` the component renders itself (`CANVAS_CSS`). They work without `styles.css`, and with zero specificity anything you write (`className`, `style`, your stylesheet) wins: `style={{ height: 600 }}` for a fixed height, `minHeight: 0` to drop the minimum. In development the component warns once in the console (in the instance's language) if the host ends up with zero height.

### Props

| Prop | Type | Meaning |
|---|---|---|
| `data` | `StrataData \| null \| undefined` | Passed to `setData` when the reference changes. Build it once or `useMemo` it; a new object on every render means a new layout on every render. |
| `options` | `StrataOptions` | Read once, at creation. To change it, change the component's `key`. |
| `plugins` | `readonly StrataPlugin[]` | Installed in order after creation, before the first `setData`. Read once. |
| `onReady` | `(strata, apis) => void \| (() => void)` | Called after creation. `apis` are the plugin APIs, in the order of `plugins`. May return a cleanup function, called before disposal. |
| `onIssues` | `(issues: DataIssue[]) => void` | Called after every `setData`, also with `[]`. |
| `onError` | `(error: unknown) => void` | Creation failed (`StrataError` with `code: 'webgl-unavailable'` when there is no WebGL). |
| `fallback` | `ReactNode \| ((error) => ReactNode)` | Rendered instead of the canvas when creation failed. Default: one line of localized text in `.kgs-fallback`. |
| `className`, `style` | | Applied to the container (`.kgs-canvas`). |
| `children` | `ReactNode` | Rendered inside the container after the canvas host (over the canvas), inside the provider, so `useStrata()` / `usePlugin()` work. |
| `create` | `(host, options) => Strata` | Custom factory; default `new Strata(host, options)`. Useful in tests. |
| `ref` | `Ref<Strata \| null>` | The instance (`null` until created). |
| `onHover` | `(info: HoverInfo \| null) => void` | Core event `hover`. |
| `onSelect` | `(info: SelectInfo) => void` | Core event `select` (`{ node, source, pointer }`; also fires for `select()` and `setView`, with `source: 'api'`). |
| `onFocus` | `(layer: string \| null) => void` | `focus` |
| `onHero` | `(hero: HeroInfo) => void` | `hero` |
| `onLayers` | `(layers: LayerInfo[]) => void` | `layers` |
| `onExpanded` | `(ids: string[]) => void` | `expanded` |
| `onContextLost`, `onContextRestored` | `() => void` | `contextlost`, `contextrestored` |
| `onLocale` | `(locale: Locale) => void` | `locale` |
| `onTheme` | `(theme: Theme) => void` | `theme` |

Event callbacks and `onIssues` are read fresh each time, so passing new functions does not resubscribe. There is no prop for `tick`; use `useStrataEvent(strata, 'tick', cb)`.

In React strict mode, development mounts twice: the component creates, disposes and creates again. `onReady` runs twice too, which is why it can return a cleanup.

### Plugins with typed APIs

```tsx
import { StrataCanvas } from 'kgstrata/react'
import { pathPlugin, type PathApi } from 'kgstrata/path'

// Keep the array stable (module level or useMemo).
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

| Hook | Returns | Meaning |
|---|---|---|
| `useStrata()` | `Strata \| null` | Instance from the nearest `<StrataCanvas>` / `<StrataProvider>`. `null` until created or when WebGL failed. |
| `usePlugin<Api>(name)` | `Api \| null` | API of an installed plugin by name (`'path'`, `'diff'`, yours). |
| `useStrataEvent(strata, event, cb)` | `void` | Subscribes to a core event. `cb` may change every render. No-op while `strata` is `null`. |
| `useStrataState(strata, key)` | see below | Engine state as React state, via `useSyncExternalStore`. Re-renders only when the content changes. |
| `useStrataOr(strata)` | `Strata \| null` | The given instance, or the context's when `strata` is `undefined`. For writing panels. |
| `useLocale(strata, locale?)` | `Locale` | `locale` if given, else the instance's (re-renders after `setLocale`), else `'en'`. |
| `useText(strata, locale?)` | `(key, vars?) => string` | Text function for panels: the instance's language with its `messages` overrides; with a different `locale`, that language without overrides. Re-renders after `setLocale`. |

`useStrataState` keys:

| Key | Type | Source | Value without an instance |
|---|---|---|---|
| `'layers'` | `LayerInfo[]` | `strata.layers`, `layers` event | `[]` |
| `'hero'` | `HeroInfo \| null` | `strata.hero`, `hero` event | `null` |
| `'expanded'` | `string[]` | `strata.expanded`, `expanded` event | `[]` |
| `'focus'` | `string \| null` | `strata.focus`, `focus` event (one layer only; `null` with several layers) | `null` |
| `'locale'` | `{ locale, messages }` | `strata.locale`, `strata.messages`, `locale` event | `{ locale: 'en', messages: {} }` |
| `'theme'` | `Theme \| null` | `strata.theme`, `theme` event | `null` |

`<StrataProvider strata plugins?>` passes an instance to the hooks and panels when you create `Strata` yourself instead of using `<StrataCanvas>`.

## Panels

Panels render plain markup with `kgs-` class names. They have no position of their own; place them yourself. Every panel accepts `PanelProps`:

| Prop | Meaning |
|---|---|
| `strata` | Instance to use. Default: from context. |
| `locale` | Text language. Default: the instance's `locale`. |
| `className`, `style` | On the root element. |

### `<LayerList>`

One row per layer. Clicking a row makes that layer the hero (several layers) or focuses it (one layer; click again to release). The eye button shows or hides the layer.

| Prop | Type | Meaning |
|---|---|---|
| `counts` | `Record<string, number> \| Map<string, number> \| false` | Number shown on the right of each row, by layer id. Default: the layer's top-level node count (`LayerInfo.count`; fields folded in tables are not counted). `false` shows no numbers. |
| `badges` | same | Badge per layer (e.g. number of changes). |
| `badgeWhen` | `'hidden' \| 'always'` | Default `'hidden'`: the badge only shows on hidden layers, so changes cannot be hidden silently. |
| `badgeTitle` | `(n, layer) => string` | Badge tooltip. Default: "n changes in this layer". |
| `layers`, `hero`, `focus` | | Supply state directly instead of reading the instance (SSR, tests). |

### `<FollowToggle>`

Switch for `setFollow`. Renders nothing with a single layer. Prop: `hero?` (supply state directly).

### `<HeroMixSlider>`

A slider for `setHeroMix` between exactly two layers: left end = first layer is hero, right end = second, middle = equal size. Renders nothing unless there are exactly two layers. Props: `hero?`, `layers?`.

### `<SpreadSlider>`

Slider for `setSpread`. Props: `min` (0.4), `max` (1.8), `step` (0.01). The initial value is read from `strata.spread`.

### `<ViewButtons>`

Two buttons: **Overview** (`focusLayer(null)`: with one layer releases focus, with several the hero goes back home; overview shot) and **Stack** (`shot('top')`).

### `<NodeTip>`

Tooltip that follows the `hover` event: name, layer name · group name, and "N fields · double-click to expand" / "Double-click to collapse". The noun comes from the node type's `NodeStyle.childNoun` (the built-in `table` style says fields); without one it reads "N inside · double-click to expand". Absolutely positioned at the pointer (`info.pointer`): put it in `<StrataCanvas>`'s children. `tipLines(info, t)` gives the same lines for a tooltip of your own.

| Prop | Type | Meaning |
|---|---|---|
| `info` | `HoverInfo \| null` | Supply the hover state yourself. |
| `offset` | `[number, number]` | Distance from the pointer in px. Default `[16, 14]`. |

### `<PathList>` (`kgstrata/react/path`)

A list of questions; clicking one plays its path and lists the steps, lit as the path reaches them, struck through when skipped in a hidden layer.

```tsx
import { PathList, type PathItem } from 'kgstrata/react/path'

const paths: PathItem[] = [
  { id: 'who-invests', question: 'Who invests in this company?', nodes: ['onto:company', 'onto:investment', 'onto:person', 'tbl:investment'] },
]

<StrataCanvas data={data} plugins={[pathPlugin()]}>
  <PathList paths={paths} />
</StrataCanvas>
```

| Prop | Type | Meaning |
|---|---|---|
| `paths` | `readonly PathItem[]` | `{ id, question, nodes }`. |
| `path` | `PathApi \| null` | Plugin API. Default: the `'path'` plugin from `<StrataCanvas plugins>`. |
| `nodeInfo` | `(id) => { label, layer }` | Name and layer shown for each step. Default: looked up in `strata.data` (`nodeInfoFrom`). |
| `active` / `onActiveChange` | `string \| null` / `(id) => void` | Controlled selection. |
| `progress` | `PathProgress` | Supply progress directly (SSR, tests). |

### `<DiffPanel>` (`kgstrata/react/diff`)

Change counts per family, Both / Before / After buttons, replay button and timeline, and the list of changes (click to frame one). Renders nothing until a comparison is on screen.

```tsx
import { diffPlugin } from 'kgstrata/diff'
import { DiffPanel } from 'kgstrata/react/diff'

const PLUGINS = [diffPlugin()] as const

<StrataCanvas data={after} plugins={PLUGINS} onReady={(_, [diff]) => void diff.show(before, after)}>
  <aside className="kgs-panel"><DiffPanel /></aside>
</StrataCanvas>
```

| Prop | Type | Meaning |
|---|---|---|
| `diff` | `DiffApi \| null` | Plugin API. Default: the `'diff'` plugin from context. |
| `colors` | `Partial<Record<ChangeFamily, { base, text }>>` | Override family colours. Default: `familyColors(strata.theme)`, following `theme.diffScheme`. |
| `pollEvery` | `number` | How often (seconds) the timeline follows the replay. Default 0.1. |
| `current` | `StrataDiff \| null` | Supply the comparison directly (SSR, tests). |

`changesByLayer(diff)` counts changes per layer id (each change on `DiffHunk.layer`, the layer most of its nodes are in); pass it to `<LayerList badges>` so hidden layers show how many changes they hide.

### `<AuditPanel>` (`kgstrata/react/audit`)

Two totals (relations that walk, joins a relation matches directly), then the gaps grouped by kind: relations that do not walk, upper nodes not mapped, lower nodes nothing maps onto, unused joins, joins only a path uses. Each group shows its count and colour; each line says why it is a gap. Clicking a line selects it on the map and frames it; clicking it again lets go. Renders nothing until an audit is on screen.

```tsx
import { auditPlugin } from 'kgstrata/audit'
import { AuditPanel } from 'kgstrata/react/audit'

const PLUGINS = [auditPlugin()] as const

<StrataCanvas data={data} plugins={PLUGINS} onReady={(_, [audit]) => void audit.show()}>
  <aside className="kgs-panel"><AuditPanel /></aside>
</StrataCanvas>
```

| Prop | Type | Meaning |
|---|---|---|
| `audit` | `AuditApi \| null` | Plugin API. Default: the `'audit'` plugin from context. |
| `colors` | `Partial<{ gap, weak }>` | Override the gap colours. Default: `auditColors(strata.theme)`. |
| `limit` | `number` | Lines shown per group before "N more". Default 40. |
| `current` | `MappingAudit \| null` | Supply the audit directly (SSR, tests). |

Node names come from `strata.data`. `auditItems(audit, label?, t?)` returns the same lines as data (`{ group, target, title, detail? }`, in display order) for your own panel.

## Styles

`import 'kgstrata/react/styles.css'` is optional. Without it the panels are unstyled markup. The stylesheet does not position anything. `.kgs-panel` is a frosted-glass container you can wrap panels in. `.kgs-canvas` gets its defaults from the component itself (see above), not from this stylesheet.

Colours are CSS custom properties on `:root`. Override them on `:root` or on any ancestor.

The theme feeds them too: `<StrataCanvas>` writes the variables that follow from its instance's theme on its own container, as a zero-specificity rule (`:where([data-kgs-scope="…"]){…}` in its `<style>`), and updates them after `setTheme`. It only writes the ones whose value differs from what `DARK` gives, so with the default theme it writes nothing and your `:root` values apply. When it does write one, it wins over values inherited from ancestors, while a `className` or `style` on the container still wins over it. `themeVars(theme)` returns the same map (`--kgs-bg` and `--kgs-overlay` from `background`; `--kgs-text`, `--kgs-border*`, `--kgs-hover`, `--kgs-pressed`, `--kgs-track` from `label.primary`; `--kgs-text-2` from `label.secondary`; `--kgs-text-3` from `plate.caption`; `--kgs-accent*` from `accent`), `themeRule(selector, vars)` the CSS, for a container of your own.


| Variable | Default | Used for |
|---|---|---|
| `--kgs-bg` | `#04060a` | Text on the accent-coloured play button |
| `--kgs-overlay` | `rgba(14, 18, 26, 0.72)` | Panel and tooltip background |
| `--kgs-border` | `rgba(255, 255, 255, 0.07)` | Borders |
| `--kgs-border-strong` | `rgba(255, 255, 255, 0.13)` | Hover borders, tooltip border |
| `--kgs-text` | `#e7ebf3` | Primary text |
| `--kgs-text-2` | `#a6afbf` | Secondary text |
| `--kgs-text-3` | `#7a8495` | Muted text |
| `--kgs-accent` | `#9fe6ff` | Focus rings, slider thumbs, step numbers |
| `--kgs-accent-rgb` | `159, 230, 255` | Same colour as RGB components, for translucent fills |
| `--kgs-hover` | `rgba(255, 255, 255, 0.04)` | Row hover |
| `--kgs-pressed` | `rgba(255, 255, 255, 0.07)` | Pressed buttons |
| `--kgs-track` | `rgba(255, 255, 255, 0.14)` | Slider tracks, switch |
| `--kgs-badge-bg` | `rgba(255, 190, 110, 0.18)` | Layer badge background |
| `--kgs-badge-text` | `#ffcf8a` | Layer badge text |
| `--kgs-mark` | `linear-gradient(90deg, #9fb4ff, #9fe6ff)` | Layer marker bar |

Transitions are switched off under `prefers-reduced-motion: reduce`.

## Server-side rendering

- Importing `kgstrata/react` on the server is safe: no browser globals are touched at import time. three.js is imported, but not started.
- On the server `<StrataCanvas>` renders the empty host div and its children; the engine is only created in an effect, so it never runs on the server. Panels render with empty state (`useStrataState` returns the empty values listed above).
- On the client the canvas appears after hydration. Panels fill in once the instance exists.
- With Next.js or similar, render the component on the client only if you want to avoid importing three.js on the server (for example with a dynamic import that disables SSR).

`<StrataCanvas>` uses `useLayoutEffect` only in the browser (`useEffect` on the server), so React 18 prints no "useLayoutEffect does nothing on the server" warning (checked with React 18.3.1 and in the tests with `renderToString`).

Checked in the tests (`renderToStaticMarkup`, React 19): `<StrataCanvas data={null}><LayerList /></StrataCanvas>` renders `<div class="kgs-canvas"><style>:where(.kgs-canvas){…}</style><div class="kgs-canvas-host" style="position:absolute;inset:0"></div><ol class="kgs-layer-list" aria-label="Layers"></ol></div>`.

## Without `<StrataCanvas>`

`kgstrata/react` also exports the DOM-free pieces it is built from: `mountStrata` (create, install plugins, set data, clean up on failure), `bindEvents`, `createStateStore`, `EMPTY_STATE`, `canvasFallback`, `textFor`, `tipLines`, `layerCount`, `themeVars`, `themeRule`, `CANVAS_CSS`, `CANVAS_HOST_STYLE`, and their types (`MountResult`, `PluginApis`, `StateStore`, `StrataEventProps`, `StrataFactory`, `StrataSource`, `StrataState`, `StrataStateKey`, `TextFn`).
