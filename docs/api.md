# API reference

[简体中文](api.zh-CN.md)

This page lists every public member of `Strata`, its options, the view state, the events and the camera shots, as defined in `src/engine.ts` and `src/plugin.ts`. Plugins are in [plugins.md](plugins.md), React in [react.md](react.md), the data shape in [data.md](data.md).

```ts
import { Strata, StrataError, type StrataOptions, type StrataView } from 'kgstrata'
```

## `new Strata(host, options?)`

```ts
constructor(host: HTMLElement, options?: StrataOptions)
```

Creates the WebGL canvas inside `host` and starts the animation loop. Nothing is drawn until `setData`.

Throws `StrataError` with `code: 'webgl-unavailable'` if no WebGL context can be created. In that case nothing has been attached to the page; the original error is on `cause`.

`options` is read once. To change an option that has no setter (`locale`, `theme`, `nodeStyles`, `anchor`, `secondaryScale`), dispose the instance and create a new one.

## `StrataOptions`

| Option | Type | Default | Meaning |
|---|---|---|---|
| `hero` | `string` | the layout anchor | Layer id that is the hero: full size, full brightness. The others shrink and dim. Ignored when `heroMix` is given. |
| `heroMix` | `Record<string, number>` | — | Per-layer hero weight 0..1 (layer id → weight). `1` is full size, `0` is a supporting layer; layers not listed count as 0. The layer with the largest weight is the hero. |
| `followHero` | `boolean` | `false` | The hero follows what you ask about: selecting a node makes its layer the hero; plugins can follow too (the path reaching a layer, a selected change). |
| `secondaryScale` | `number` | `0.56` | Size of the layer next to the hero, relative to the hero. Clamped to 0.2..1. Layers further away get smaller (×0.72 per step, at least 0.24). |
| `anchor` | `string` | layer with the most mappings | Layer id used as the layout anchor: it is laid out by force simulation, the others are aligned to it. |
| `hidden` | `string[]` | `[]` | Layer ids hidden at start. |
| `expanded` | `string[]` | `[]` | Node ids expanded at start (their children are drawn). |
| `nodeStyles` | `Record<string, NodeStyle>` | built-ins | Node `type` → `{ shape?, mono? }`. Merged over `DEFAULT_NODE_STYLES`. See [data.md](data.md#nodes-nodespec). |
| `locale` | `'en' \| 'zh-CN'` | `'en'` | Language of issue messages, error messages and plugin text. Codes do not change. |
| `theme` | `DeepPartial<Theme>` | `DARK` | Overrides applied on top of the dark theme for this instance. See [theming-and-i18n.md](theming-and-i18n.md). |

"Hero" only applies when there are at least two layers. With one layer there is no hero, and `setHero`, `setHeroMix` do nothing.

## Properties

| Member | Type | Meaning |
|---|---|---|
| `renderer` | `StrataRenderer` (readonly) | The three.js renderer. `renderer.gl` is the `WebGLRenderer`, `renderer.rig.camera` / `renderer.rig.controls` the camera and orbit controls. Advanced use; not a stable API yet. |
| `locale` | `Locale` (readonly) | The instance's language. |
| `theme` | `Theme` (readonly) | The resolved theme (`createTheme(options.theme)`). |
| `reducedMotion` | `boolean` (readonly) | `prefers-reduced-motion: reduce` at creation. The idle rotation is off and path replay jumps to the end. |
| `data` | `StrataData \| null` (getter) | The object last passed to `setData`, as given. |
| `mode` | `string \| null` (getter) | Name of the plugin whose mode has taken over the frame (`'diff'` while comparing), or `null`. |
| `layers` | `LayerInfo[]` (getter) | Each layer and whether it is visible. |
| `heroInfo` | `HeroInfo` (getter) | Current hero, follow flag and weights. |
| `expanded` | `string[]` (getter) | Expanded nodes that actually have children. |

```ts
interface LayerInfo { id: string; name: string; visible: boolean }
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
| `setData(data: StrataData)` | `DataIssue[]` | Validates, drops broken items, lays out and draws. Returns the issues (empty when clean). Resets selection, focus and any plugin mode; keeps hidden layers and expanded nodes by id. Emits `hero`, `layers`, `expand`. |

### Plugins

| Method | Returns | Meaning |
|---|---|---|
| `use<Api>(plugin: StrataPlugin<Api>)` | `Api` | Installs a plugin and returns its API. Installing two plugins with the same `name` throws `StrataError('plugin-installed')`. After `dispose`, a plugin with a known name returns the existing API instead of throwing. |

### Hero and layers

| Method | Returns | Meaning |
|---|---|---|
| `setHero(layer: string)` | `void` | Makes this layer the hero (weight 1, others 0) and its "home". Ignored for hidden or unknown layers, and with a single layer. Reframes the camera. |
| `setHeroMix(mix: Record<string, number>)` | `void` | Continuous version: sets each layer's weight 0..1. Missing layers count as 0. If every weight is 0 (or only hidden layers get weight), the current hero keeps weight 1. |
| `setFollowHero(on: boolean)` | `void` | Turns "hero follows selection" on or off. Emits `hero`. |
| `setLayerVisible(layer: string, visible: boolean)` | `boolean` | Shows or hides a layer. Returns `false` if the layer is unknown or it is the last visible layer. Hidden layers fade out; layers they separated get dashed **bridge** lines; a hidden hero hands over to the nearest visible layer. Emits `layers` (and `hero` if the hero changed). |
| `focusLayer(layer: string \| null)` | `void` | With several layers: makes `layer` the hero, or with `null` returns to the hero's home. With one layer: focuses that layer and collapses the others, `null` releases. Emits `focus`. |
| `setSpread(s: number)` | `void` | Multiplier for the distance between layers (default 1). |

### Nodes and groups

| Method | Returns | Meaning |
|---|---|---|
| `select(id: string \| null)` | `void` | Selects a node by id (`null` clears). A folded child selects its drawn ancestor. Does **not** emit `select` and does not trigger `followHero`; those come from pointer clicks only. |
| `expand(id: string, on = true)` | `void` | Expands (or with `false` collapses) one node. |
| `setExpanded(ids: Iterable<string>)` | `void` | Sets the full set of expanded nodes; everything else collapses. Top-level positions do not change. Emits `expand` and `hover(null)`. |
| `highlightGroup(id: string \| null)` | `void` | Emphasizes one group: `"grouping/group"`, or a bare group id. `null` clears. |

### Camera

| Method | Returns | Meaning |
|---|---|---|
| `shot(name: ShotName, arg?: number, duration = 1.3)` | `void` | Moves the camera. See [Shots](#shots). `duration` is in seconds; `0` jumps. |
| `setInset(px: number)` | `void` | Width in CSS pixels covered by a panel on the right. The picture is centred in the remaining area. |

### View state

| Method | Returns | Meaning |
|---|---|---|
| `getView()` | `StrataView` | Everything needed to restore the current view, by id. |
| `setView(view: Partial<StrataView>)` | `void` | Restores a view. Every field is optional; layers and nodes that no longer exist are skipped. Emits `hero` and `layers`. |

### Events and cleanup

| Method | Returns | Meaning |
|---|---|---|
| `on(event, cb)` | `() => void` | Subscribes to a core event. Returns the unsubscribe function. |
| `dispose()` | `void` | Stops the loop, frees GPU resources, removes the canvas, drops the WebGL context, calls plugin dispose hooks and clears listeners. Safe to call more than once; afterwards every other method is a no-op. |

## `StrataView`

```ts
interface StrataView {
  hero: Record<string, number>   // layer id → hero weight
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
const view = strata.getView()
localStorage.setItem('view', JSON.stringify(view))
// later
strata.setView(JSON.parse(localStorage.getItem('view')!))
// or just part of it
strata.setView({ hidden: ['onto'], selected: 'tbl:company' })
```

`setView` applies fields in this order: `follow`, `spread`, `expanded`, `hidden`, `hero`, `focus`, `group`, plugin slots, `selected`, `camera`. If `camera` is missing and the user has not moved the camera, it reframes the overview.

The path plugin adds `path` (see [plugins.md](plugins.md#path-replay-kgstratapath)). Plugin keys must not clash with the core keys above.

## Events

Subscribe with `strata.on(name, cb)`; the callback receives the value in the second column.

| Event | Payload | Emitted when |
|---|---|---|
| `hover` | `HoverInfo \| null` | The pointer enters a node, moves over it, or leaves (`null`). Also `null` after expand/collapse and when a mode takes over. |
| `select` | `HoverInfo \| null` | A click (pointer up without dragging). `null` when clicking empty space. Not emitted by `select()`. |
| `tick` | `number` | Every rendered frame, with the engine clock in seconds. |
| `focus` | `string \| null` | `focusLayer()` is called (layer id or `null`), the stack shot clears focus, or a mode takes over (`null`). |
| `hero` | `HeroInfo` | The hero, its weights or the follow flag change; after `setData` and `setView`. |
| `layers` | `LayerInfo[]` | Visibility changes; after `setData`, `setView`, and when a mode takes over or releases. |
| `expand` | `string[]` | The set of expanded nodes changes; after `setData`. |
| `contextlost` | `null` | The WebGL context was lost. The loop is paused. |
| `contextrestored` | `null` | The context is back; resources are re-uploaded and the loop resumes. |

```ts
interface HoverInfo {
  id: string          // node id
  label: string       // as drawn (a diff mode may show a new name)
  layer: string       // layer *name*
  group: string | null// group *name*
  folds: number       // number of folded children; > 0 means it can be expanded
  expanded: boolean
  x: number           // pointer position in CSS pixels, relative to the canvas
  y: number
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
| `shot('layer', index)` | Frames one layer. `index` is the layer's position in `strata.layers` (0 = top), not its id. |

Framing a path or a single change belongs to the plugins (`path.shot()`, `diff.shot(i)`).

## Errors

`StrataError extends Error` and adds a stable `code`. The `message` follows the instance's `locale`.

| `code` | Thrown by |
|---|---|
| `webgl-unavailable` | `new Strata()` |
| `plugin-installed` | `use()` with a name already installed |
| `view-core-key` | a plugin's `ctx.registerView()` with a core key (`hero`, `follow`, …) |
| `view-key-taken` | a plugin's `ctx.registerView()` with a key another plugin registered |

Data problems are not thrown; they are returned by `setData` / `validate` as `DataIssue` (see [data.md](data.md#validation)).

## Other exports of `kgstrata`

Besides `Strata` the core entry exports the plugin contract (`Emitter`, `StrataPlugin`, `StrataContext`, `StrataOverlay`, `StrataMode`, `ModeHandle`, `FrameInfo`, `PlatePoint`, `StrataChange`, `StrataEvents`, `ViewSlot`, `Spotlight`, `Model`, `RendererBase`, `RendererOptions`, `StrataRenderer`), the types `HeroInfo`, `HoverInfo`, `LayerInfo`, `ShotName`, `StrataOptions`, `StrataView`, and everything in [`kgstrata/headless`](headless.md).
