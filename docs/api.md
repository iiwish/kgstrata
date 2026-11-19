# API reference

[简体中文](api.zh-CN.md)

This page lists every public member of `Strata`, its options, the view state, the events and the camera shots, as defined in `src/engine/` (`index.ts`, `types.ts`) and `src/plugin.ts`. Plugins are in [plugins.md](plugins.md), React in [react.md](react.md), the data shape in [data.md](data.md).

```ts
import { Strata, StrataError, type StrataOptions, type StrataView } from 'kgstrata'
```

## `new Strata(host, options?)`

```ts
constructor(host: HTMLElement, options?: StrataOptions)
```

Creates the WebGL canvas inside `host` and starts the animation loop. Nothing is drawn until `setData`.

Throws `StrataError` with `code: 'webgl-unavailable'` if no WebGL context can be created. In that case nothing has been attached to the page; the original error is on `cause`.

`options` is read once. `locale`, `messages` and `theme` have setters (`setLocale`, `setTheme`). To change an option that has no setter (`nodeStyles`, `anchor`, `layout`, `secondaryScale`), dispose the instance and create a new one.

## `StrataOptions`

| Option | Type | Default | Meaning |
|---|---|---|---|
| `hero` | `string` | the anchor layer | Layer id that is the hero: full size, full brightness. The others shrink and dim. Ignored when `heroMix` is given. Without it the hero is the anchor layer (`anchor`, or the layer with the most mappings). |
| `heroMix` | `Record<string, number>` | — | Per-layer hero weight 0..1 (layer id → weight). `1` is full size, `0` is a supporting layer; layers not listed count as 0. The layer with the largest weight is the hero. |
| `follow` | `boolean` | `false` | The hero follows what you ask about: selecting a node makes its layer the hero; plugins can follow too (the path reaching a layer, a selected change). `setFollow` changes it later. |
| `secondaryScale` | `number` | `0.56` | Size of the layer next to the hero, relative to the hero. Clamped to 0.2..1. Layers further away get smaller (×0.72 per step, at least 0.24). |
| `anchor` | `string` | layer with the most mappings | Layer id used as the layout anchor: it is laid out by force simulation, the others are aligned to it. Same as `LayoutOptions.anchor` and `StrataLayout.anchor` in [headless.md](headless.md). |
| `layout` | `LayoutProvider` | — | Inject a precomputed layout. See [Injecting a layout](#injecting-a-layout). |
| `hidden` | `string[]` | `[]` | Layer ids hidden at start. |
| `expanded` | `string[]` | `[]` | Node ids expanded at start (their children are drawn). |
| `nodeStyles` | `Record<string, NodeStyle>` | built-ins | Node `type` → `{ shape?, mono?, childNoun? }`. Merged over `DEFAULT_NODE_STYLES`. See [data.md](data.md#nodes-nodespec). |
| `locale` | `Locale` (`string`) | `'en'` | Language of issue messages, error messages, panel and plugin text. Built in: `'en'`, `'zh-CN'`; others need `registerLocale` first. Codes do not change. `setLocale` changes it later. |
| `messages` | `Partial<Record<MessageKey, string>>` | — | Overrides single texts for this instance, whatever the language. See [theming-and-i18n.md](theming-and-i18n.md). |
| `theme` | `DeepPartial<Theme>` | `DARK` | Overrides applied on top of the dark theme for this instance. `setTheme` changes it later. See [theming-and-i18n.md](theming-and-i18n.md). |

"Hero" only applies when there are at least two layers. With one layer there is no hero, and `setHero`, `setHeroMix` do nothing (they still return the current `HeroInfo`, with `id: null`).

## Properties

| Member | Type | Meaning |
|---|---|---|
| `locale` | `Locale` (getter) | The instance's current language. |
| `messages` | `Partial<Record<MessageKey, string>>` (getter) | The per-instance text overrides. |
| `theme` | `Theme` (getter) | The resolved theme (`createTheme(options.theme)`, or the last `setTheme`). |
| `reducedMotion` | `boolean` (readonly) | `prefers-reduced-motion: reduce` at creation. The idle rotation is off and path replay jumps to the end. |
| `data` | `StrataData \| null` (getter) | The object last passed to `setData`, as given. |
| `mode` | `string \| null` (getter) | Name of the plugin whose mode has taken over the frame (`'diff'` while comparing), or `null`. |
| `layers` | `LayerInfo[]` (getter) | Each layer, whether it is visible, and its number of top-level nodes. |
| `hero` | `HeroInfo` (getter) | Current hero, follow flag and weights (the `hero` event carries the same). Not to be confused with the option `hero`, the layer id to start with. |
| `follow` | `boolean` (getter) | Whether the hero follows the selection (`setFollow`). |
| `spread` | `number` (getter) | Layer spacing multiplier (`setSpread`). |
| `inset` | `{ top, right, bottom, left }` (getter) | Space covered by panels, in CSS pixels (`setInset`). A copy. |
| `expanded` | `string[]` (getter) | Expanded nodes that actually have children (the `expanded` event carries the same). |
| `selected` | `string \| null` (getter) | The selected node's id (`select`). |
| `focus` | `string \| null` (getter) | The focused layer's id (`focusLayer`; the `focus` event carries the same). Only with one layer; `null` with several. |
| `group` | `string \| null` (getter) | The emphasized group, `"grouping/group"` (`highlightGroup`). |
| `view` | `StrataView` (getter) | Everything needed to restore the current view, by id; a new object each time. See [`StrataView`](#strataview). |

```ts
interface LayerInfo {
  id: string
  name: string
  visible: boolean
  count: number                  // top-level nodes (folded or expanded children not counted)
}
interface HeroInfo {
  id: string | null              // layer with the largest weight; null with a single layer
  follow: boolean
  mix: Record<string, number>    // layer id → weight 0..1
}
```

## Methods

### Data

| Method | Returns | Meaning |
|---|---|---|
| `setData(data: StrataData)` | `DataIssue[]` | Validates, drops broken items, lays out and draws. Returns the issues (empty when clean). Resets selection, focus and any plugin mode; keeps hidden layers and expanded nodes by id. Emits `hero`, `layers`, `expanded`. If the whole input is unusable (wrong `version`: an `error` without `id`, see `isFatal`), nothing changes: the view and `strata.data` stay as they were and only the issues are returned. An unusable injected layout adds a `layout-incomplete` warning. |

### Plugins

| Method | Returns | Meaning |
|---|---|---|
| `use<Api>(plugin: StrataPlugin<Api>)` | `Api` | Installs a plugin and returns its API. Installing two plugins with the same `name` throws `StrataError('plugin-installed')`. After `dispose`, a plugin with a known name returns the existing API instead of throwing. |

### Hero and layers

| Method | Returns | Meaning |
|---|---|---|
| `setHero(layer: string)` | `HeroInfo` | Makes this layer the hero (weight 1, others 0) and its "home". Ignored for hidden or unknown layers, and with a single layer. Reframes the camera. Returns the hero state after the call: if `id` is not `layer`, nothing changed. |
| `setHeroMix(mix: Record<string, number>)` | `HeroInfo` | Continuous version: sets each layer's weight 0..1 (values are clamped). Missing layers **and hidden layers** count as 0. If every weight ends up 0 (for example only hidden layers got weight), the call is treated as empty and the current hero keeps weight 1. Returns the hero state after the call; its `mix` is what actually applies. |
| `setFollow(on: boolean)` | `HeroInfo` | Turns "the hero follows the selection" on or off. Emits `hero`; returns the hero state after the call. |
| `setLayerVisible(layer: string, visible: boolean)` | `LayerInfo \| null` | Shows or hides a layer. Returns that layer's `LayerInfo` after the call, or `null` for an unknown layer. The last visible layer cannot be hidden: then the result still has `visible: true`. Hidden layers fade out; layers they separated get dashed **bridge** lines; a hidden hero hands over to the nearest visible layer. Emits `layers` (and `hero` if the hero changed). |
| `focusLayer(layer: string \| null)` | `void` | With one layer: focuses it (frames it; `strata.focus` and the `focus` event carry its id), `null` releases. With several layers "which layer am I looking at" is the hero, so it is the same as `setHero(layer)`, and `null` returns to the hero's home: nothing is focused, no `focus` event (a `hero` event instead). See [design.md](design.md#clicking-a-layer). |
| `setSpread(s: number)` | `void` | Multiplier for the distance between layers (default 1). Read it back with `spread`. |

### Nodes and groups

| Method | Returns | Meaning |
|---|---|---|
| `select(id: string \| null)` | `void` | Selects a node by id (`null` clears; an unknown id clears too). A folded child selects its drawn ancestor. Takes the same path as a click: emits `select` with `source: 'api'`, and with `follow` on the node's layer becomes the hero (the camera reframes only if the user has not moved it). |
| `expand(id: string, on = true)` | `void` | Expands (or with `false` collapses) one node. |
| `setExpanded(ids: Iterable<string>)` | `void` | Sets the full set of expanded nodes; everything else collapses. Top-level positions do not change. Emits `expanded` and `hover(null)`. |
| `highlightGroup(id: string \| null)` | `void` | Emphasizes one group: `"grouping/group"`, or a bare group id. `null` clears. |

### Camera

| Method | Returns | Meaning |
|---|---|---|
| `shot(name: ShotName, opts?: ShotOptions)` | `void` | Moves the camera. See [Shots](#shots). `opts.layer` is a layer id, used by `'layer'`. `opts.duration` is in seconds (default 1.3); `0` jumps. |
| `setInset(inset: Inset)` | `void` | Space in CSS pixels covered by panels on each side: `{ top?, right?, bottom?, left? }`, missing sides are 0 (`setInset({})` clears). Shots centre the picture in the remaining area. An axis where panels cover 60% or more is ignored. |

```ts
interface ShotOptions { layer?: string; duration?: number }
interface Inset { top?: number; right?: number; bottom?: number; left?: number }
```

### Language and theme

| Method | Returns | Meaning |
|---|---|---|
| `setLocale(locale: Locale, messages?)` | `void` | Switches the language; with `messages`, also replaces the text overrides. Later issue messages, errors, tooltip nouns and React panels follow. Emits `locale`. The diff plugin re-compares in the new language unless it was given its own `locale`. Issues already returned are not rewritten. |
| `text(key: MessageKey, vars?)` | `string` | One text in the instance's language, with its overrides. |
| `setTheme(overrides: DeepPartial<Theme>)` | `void` | Replaces the theme. `overrides` apply on top of `DARK`, like the option (so `setTheme({})` returns to `DARK`). Rebuilds the clear colour, backdrop, plates, label atlas and node and line colours (group colours are re-taken from the new palette). Layout, selection, hidden layers, expanded nodes and camera do not change. Plugins get `onChange('theme')`; emits `theme`. |

### View state

| Method | Returns | Meaning |
|---|---|---|
| `setView(view: Partial<StrataView>)` | `void` | Restores a view (read it with the `view` getter). Every field is optional; layers and nodes that no longer exist are skipped. Emits `hero` and `layers`. |

### Events and cleanup

| Method | Returns | Meaning |
|---|---|---|
| `on(event, cb)` | `() => void` | Subscribes to a core event. Returns the unsubscribe function. |
| `dispose()` | `void` | Stops the loop, frees GPU resources, removes the canvas, drops the WebGL context, calls plugin dispose hooks and clears listeners. Safe to call more than once; afterwards every other method is a no-op. |

## `StrataView`

```ts
interface StrataView {
  heroMix: Record<string, number> // layer id → hero weight (as StrataOptions.heroMix / setHeroMix)
  follow: boolean
  hidden: string[]               // hidden layer ids
  expanded: string[]             // expanded node ids
  selected: string | null        // selected node id
  group: string | null           // emphasized group, "grouping/group"
  focus: string | null           // focused layer (single-layer case only)
  spread: number
  camera: { position: [number, number, number]; target: [number, number, number] }
  // plus one field per plugin that registered a view slot, e.g. `path?: string[] | null`
}
```

It is plain JSON. Store it, put it in a URL, restore it elsewhere:

```ts
const view = strata.view
localStorage.setItem('view', JSON.stringify(view))
// later
strata.setView(JSON.parse(localStorage.getItem('view')!))
// or just part of it
strata.setView({ hidden: ['onto'], selected: 'tbl:company' })
```

`setView` applies fields in this order: `follow`, `spread`, `expanded`, `hidden`, `heroMix`, `focus`, `group`, plugin slots, `selected`, `camera`. If `camera` is missing and the user has not moved the camera, it reframes the overview.

Restoring `selected` emits `select` with `source: 'api'`, but does **not** follow the hero or move the camera: it restores state, it is not the user asking about a node.

The path plugin adds `path` and the diff plugin adds `diff` (see [plugins.md](plugins.md)). Plugin keys must not clash with the core keys above.

## Events

Subscribe with `strata.on(name, cb)`; the callback receives the value in the second column.

| Event | Payload | Emitted when |
|---|---|---|
| `hover` | `HoverInfo \| null` | The pointer enters a node, moves over it, or leaves (`null`). Also `null` after expand/collapse and when a mode takes over. Only the pointer causes hovers, so there is no `source`. |
| `select` | `SelectInfo` | The selection changed: a click (pointer up without dragging; `source: 'pointer'`), or `select()`, `ctx.select()`, `setView({ selected })` (`source: 'api'`). `node` is `null` when the selection was cleared (empty space, clicking the selected node again, `select(null)`). For pointer selections `pointer.hit` tells the two clicks apart: the node under the pointer, `null` on empty space. |
| `tick` | `number` | Every rendered frame, with the engine clock in seconds. |
| `focus` | `string \| null` | The focused layer changed (one layer only): `focusLayer()`, `setView({ focus })`, the top shot (focuses the layer, or clears focus before stacking), a mode taking over while a layer is focused (`null`). The payload is always the new `strata.focus`. |
| `hero` | `HeroInfo` | The hero, its weights or the follow flag change; after `setData` and `setView`. |
| `layers` | `LayerInfo[]` | Visibility changes; after `setData`, `setView`, and when a mode takes over or releases. |
| `expanded` | `string[]` | The set of expanded nodes changes (the new `strata.expanded`); after `setData`. |
| `contextlost` | `null` | The WebGL context was lost. The loop is paused. |
| `contextrestored` | `null` | The context is back; resources are re-uploaded and the loop resumes. |
| `locale` | `Locale` | `setLocale()` was called. |
| `theme` | `Theme` | `setTheme()` was called; the new full theme. |

```ts
interface NodeInfo {
  id: string                 // node id
  label: string              // as drawn (a diff mode may show a new name)
  layer: string              // layer id
  layerName: string          // layer name
  group: string | null       // group id, "grouping/group"
  groupName: string | null   // group name
  folds: number              // number of folded children; > 0 means it can be expanded
  childNoun: string | null   // what those children are called (NodeStyle.childNoun, in the current language)
  expanded: boolean
}
interface HoverInfo extends NodeInfo {
  pointer: { x: number; y: number }  // pointer position in CSS pixels, relative to the canvas
}
interface SelectInfo {
  node: NodeInfo | null      // the selected node; null = selection cleared
  source: 'pointer' | 'api'
  pointer: { x: number; y: number; hit: string | null } | null  // null for 'api'; hit: node under the pointer, null = empty space
}
```

Plugins have their own events on their own API (`path.on('step')`, `diff.on('enter' | 'exit')`).

## Shots

```ts
type ShotName = 'overview' | 'top' | 'layer'
```

| Call | Result |
|---|---|
| `shot('overview')` | Frames all visible layers. With a hero, the hero fills the view and the supporting layers show above or below it. |
| `shot('top')` | With several layers: the **stack** view. Layers are pressed together (spacing near zero) and seen from straight above, so matching relations overlap. Leaves the stack on the next other shot, `setHeroMix`, `setSpread` or hero change. With one layer: a top-down map of that layer. |
| `shot('layer', { layer: id })` | Frames one layer, by layer id. Unknown ids do nothing. |

Framing a path or a single change belongs to the plugins (`path.shot(opts?)`, `diff.shot(hunkId, opts?)`, both with `{ duration? }`).

## Errors

`StrataError extends Error` and adds a stable `code`. The `message` follows the instance's `locale`.

| `code` | Thrown by |
|---|---|
| `webgl-unavailable` | `new Strata()` |
| `plugin-installed` | `use()` with a name already installed |
| `view-core-key` | a plugin's `ctx.registerView()` with a core key (`heroMix`, `follow`, …) |
| `view-key-taken` | a plugin's `ctx.registerView()` with a key another plugin registered |
| `locale-builtin` | `registerLocale('en' \| 'zh-CN', …)` |
| `audit-layers` | `auditMappings()` with unknown or equal layers, or data with fewer than two layers (`kgstrata/headless`; the message follows `opts.locale`) |

Data problems are not thrown; they are returned by `setData` / `validate` as `DataIssue` (see [data.md](data.md#validation)).

## Injecting a layout

```ts
type LayoutProvider = (data: Resolved, defaults: LayoutOptions) => StrataLayout | null | undefined
```

The engine asks `options.layout` whenever it lays out a graph: the collapsed normal view on `setData`, and the union of both versions in the diff plugin (`ctx.layoutOf`). Return a `StrataLayout` to use it, or `null` / `undefined` to let the engine compute it. `defaults` is what the engine would pass to `layoutStrata` (plate radius, `anchor`), so `layoutStrata(data, defaults)` reproduces the built-in result.

A returned layout must place every node of `data` on its own layer and have one radius per layer (`checkLayout`). Otherwise `setData` returns a `layout-incomplete` warning (with the first missing node as `id`) and the engine computes the layout itself. Expanded children are always added on top of the given layout with `placeChildren`; top-level positions do not move.

```ts
import { layoutFromJSON } from 'kgstrata/headless'

const cached = layoutFromJSON(await (await fetch('/layout.json')).json()) // written with layoutToJSON on the server
const strata = new Strata(host, { layout: () => cached })
strata.setData(data)
```

## Other exports of `kgstrata`

Besides `Strata` the core entry exports the plugin contract (`Emitter`, `StrataPlugin`, `StrataContext`, `StrataOverlay`, `StrataMode`, `ModeHandle`, `FrameInfo`, `PlatePoint`, `StrataChange`, `StrataEvents`, `ViewSlot`, `Spotlight`), the types `HeroInfo`, `HoverInfo`, `NodeInfo`, `SelectInfo`, `SelectSource`, `LayerInfo`, `LayoutProvider`, `ShotName`, `ShotOptions`, `Inset`, `PointerPosition`, `StrataOptions`, `StrataView`, `FitOptions`, and everything in [`kgstrata/headless`](headless.md).

It does not export the model, the styler, the renderer or the per-frame render types (`Looks`, `NodeLook`, `EdgeLook`, `BaseNode`, …). Those are in `kgstrata/internals`, for plugins that take over the frame, and are **not covered by semver** (see [plugins.md](plugins.md#kgstratainternals)).
