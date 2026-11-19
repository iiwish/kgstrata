# Plugins

[简体中文](plugins.zh-CN.md)

This page covers the two bundled plugins (path replay and version comparison) and how to write your own against the plugin contract in `src/plugin.ts`.

The core `Strata` only draws a layered graph. Everything else is a plugin installed with `strata.use(plugin)`, which returns the plugin's own API, fully typed:

```ts
const path = strata.use(pathPlugin()) // PathApi
```

A plugin name can be installed once per instance. Plugins can be installed before or after `setData`.

## Path replay: `kgstrata/path`

Lights up a sequence of nodes one step at a time, numbers them and draws the segments between them. Typical use: a question walks through the ontology, drops into the tables and follows foreign keys.

Nothing extra to install. The entry does not import kgdiff.

```ts
import { Strata } from 'kgstrata'
import { pathPlugin } from 'kgstrata/path'

const strata = new Strata(host)
const path = strata.use(pathPlugin())
strata.setData(data)

path.play(['onto:person', 'onto:investment', 'tbl:investment', 'tbl:company'])
path.on('step', ({ ids, reached }) => console.log(`${reached}/${ids.length}`))
```

### `PathApi`

| Member | Type | Meaning |
|---|---|---|
| `play(ids)` | `(ids: string[]) => void` | Walks the given node ids in order, one step every 0.8 s (`STEP`). A folded child counts as its drawn ancestor; consecutive steps on the same node merge; steps in hidden layers are skipped and the gap is drawn dashed. Clears the selection, releases a single-layer focus, frames the path. Does nothing before `setData`. |
| `clear()` | `() => void` | Stops and forgets the path. If the path framed the camera and the user has not moved it since, the camera returns to the overview. |
| `ids` | `string[] \| null` | The ids given to `play`, or `null`. |
| `progress` | `PathProgress` | `{ ids, reached }`: the steps actually walked (after skipping hidden layers and merging) and how many are lit. Same value as the `step` event. |
| `shot(opts?)` | `(opts?: { duration?: number }) => void` | Frames the whole path. `duration` in seconds (default 1.2; `0` jumps). |
| `on('step', cb)` | `() => void` | Called when `progress` changes: a new step lit, or the walked steps changed after hiding a layer or expanding a node. |

Behaviour:

- Hiding or showing a layer, or expanding a node, re-computes the steps without restarting.
- Clicking empty space stops the current run (`ids` is kept, so `strata.view.path` still has it). Clicking the selected node again only releases the selection (`SelectInfo.pointer.hit` is that node), and the run goes on. `setData` and a mode taking over clear the path.
- With `follow` on, the hero switches to the layer the path has reached and the camera reframes the whole path.
- With reduced motion, the path is shown complete at once.

### View state

The plugin registers `path` in the view state and adds it to the `StrataView` type:

```ts
strata.view.path        // string[] | null
strata.setView({ path: ['onto:person', 'tbl:person'] }) // plays it from the start
strata.setView({ path: null })                            // clears it
```

### Low-level exports

`stepsOf`, `reachedAt`, `segmentProgress`, `rankOf`, `paintPath`, `STEP`, `DIGITS` (①②③…) and the types `PathRun`, `PathPaintModel`, `PathProgress`, `PathEvents` are exported for tests and for building similar overlays. They do not touch the renderer.

## Version comparison: `kgstrata/diff`

Compares two versions of the data with [kgdiff](https://github.com/iiwish/kgdiff) and draws the semantic changes (added, removed, renamed, merged, re-mapped, re-pointed) on the union of both versions. Changes can be replayed one by one.

Extra install:

```sh
npm install @kgdiff/core @kgdiff/scene @kgdiff/layout @kgdiff/compute
```

`@kgdiff/compute` (kgdiff's WebAssembly engine) is a dependency of `@kgdiff/core` too, but `kgstrata/diff` imports it too (with a dynamic `import()` that only runs when you pass `wasm`, below), bundlers resolve that import at build time, and strict package managers (pnpm) only resolve packages you list yourself. kgdiff ships three WebAssembly files (about 1.9 MB together). Vite 8, webpack 5 and Next.js need no configuration; for the others see [Bundlers](getting-started.md#bundlers).

```ts
import { Strata } from 'kgstrata'
import { diffPlugin } from 'kgstrata/diff'

const strata = new Strata(host)
const diff = strata.use(diffPlugin())
strata.setData(after)

const result = await diff.show(before, after)
if (result) {
  console.log(result.stats)                     // { added, removed, changed }
  for (const h of result.hunks) console.log(h.family, h.title, h.subtitle)
}

diff.update({ layer: 'before' })    // 'union' | 'before' | 'after' | 'replay'
diff.play(true)                     // replay all changes in order
diff.selectHunk(result!.hunks[2].id) // select one change by id; the camera frames it
diff.exit()                         // back to the normal view
```

`diffPlugin(options?)` takes `{ locale?: Locale; wasm?: { compute?, layout?, formats? } }`. `locale` is the language kgdiff writes change descriptions in. It defaults to the instance's `locale` and follows `setLocale` (the comparison on screen is redone in the new language). kgdiff itself only knows `'en'` and `'zh-CN'`: for any other language (registered with `registerLocale`) its change descriptions fall back along the language's fallback chain to one of those two, usually `'en'`, while the display names kgstrata hands to kgdiff ("related to", "part of") use the registered language.

`wasm` says where kgdiff's three WebAssembly modules are loaded from (`string | URL` each). kgdiff finds them next to its own code with `new URL('…', import.meta.url)`, which esbuild and plain Rollup do not handle; there, give the URLs the bundler produced for `@kgdiff/compute/compute.wasm`, `/layout.wasm` and `/formats.wasm`. They are passed to `init({ sources })` of `@kgdiff/compute` before the first comparison. kgdiff loads all three on the first comparison, so give all three. Without `wasm` nothing changes. Example: [Bundlers](getting-started.md#bundlers).

### `DiffApi`

| Member | Type | Meaning |
|---|---|---|
| `show(before, after, opts?)` | `Promise<StrataDiff \| null>` | Lays out the union of both versions once and takes over the view (a [mode](#overlays-and-modes)). Async. Only the latest call counts: if `show`, `exit`, `setData` or `dispose` happens while kgdiff is working, it resolves to `null`. |
| `exit()` | `() => void` | Returns to the normal view (no re-layout) and cancels a pending `show`. The camera returns to the overview unless the user moved it while comparing. |
| `active` | `boolean` | A comparison is on screen. |
| `current` | `StrataDiff \| null` | The comparison on screen. |
| `view` | `Readonly<DiffView> \| null` | A copy of the comparison view. Change it with `update`, `play`, `selectHunk`. |
| `playing` | `boolean` | Replay is running. |
| `update(patch)` | `(patch: Partial<DiffView>) => void` | Changes the view, e.g. `{ layer: 'after' }` or `{ layer: 'replay', t: 1200 }`. `t` is clamped to the duration; an unknown hunk id counts as none. Does not stop a running replay (use `play(false)`). Named `setView` in 0.1. |
| `play(on)` | `(on: boolean) => void` | Starts (from the start, or where it stopped) or pauses the replay. |
| `selectHunk(id)` | `(id: string \| null) => void` | Selects a change by `DiffHunk.id` (`null` clears) and frames it. With `follow`, `hunk.layer` becomes the hero. |
| `shot(id, opts?)` | `(id: string, opts?: { duration?: number }) => void` | Frames a change by id. `duration` in seconds (default 1.2; `0` jumps). |
| `on('enter' \| 'exit', cb)` | `() => void` | `enter` with the `StrataDiff` (also after a re-comparison caused by expanding a node, `setLocale` or `setTheme`), `exit` with `null`. |

`show` options: `{ replaces?: Record<string, string[]> }`, new node id → old node ids it absorbed. Without it, a merge looks like one node removed and another added.

```ts
await diff.show(before, after, { replaces: { 'onto:party': ['onto:person', 'onto:company'] } })
```

Expanding or collapsing a node while comparing re-runs the comparison at the new level of detail. Collapsed, a field added to a table shows as a changed table (its folded children are an attribute) and a changed mapping weight. `setLocale` (when the plugin has no `locale` of its own) and `setTheme` re-run it too. A re-comparison keeps the view's `layer`, `t` and `selectedHunk` when that hunk id still exists.

### View state

While a comparison is on screen the plugin registers `diff` in the view state (and adds it to `StrataView`):

```ts
strata.view.diff  // { layer, t, selectedHunk } while comparing, otherwise null
strata.setView({ diff: { layer: 'after', t: 0, selectedHunk: 'remove:c:invoice' } })
```

The two versions are not part of the view state, so `setView` cannot start a comparison: `diff` is applied only while one is on screen, and `null` or a value given while not comparing is ignored. To restore a saved view, call `diff.show(before, after)` first, then `setView`.

### Result types

```ts
interface StrataDiff {
  hunks: DiffHunk[]
  duration: number                             // replay length in ms at 1× speed
  stats: { added: number; removed: number; changed: number } // nodes + edges
  scene: Scene                                 // low level: kgdiff's scene (not covered by semver)
  base: { nodes: BaseNode[]; edges: BaseEdge[] }  // low level: the union graph as drawn (not covered by semver)
}

interface DiffHunk {
  id: string               // stable for the same pair of versions; selectHunk / shot / DiffView take it
  kind: string
  family: ChangeFamily     // 'added' | 'removed' | 'content' | 'structure' | 'identity'
  title: string            // localized description
  subtitle: string
  nodes: string[]          // node ids (union of both versions)
  context: string[]        // node ids needed to read it
  center: [number, number]
  layer: string            // layer id where most of its nodes are
  radius: number
  start: number            // replay window, ms
  end: number
}

interface DiffView {
  layer: 'union' | 'before' | 'after' | 'replay'
  t: number                // replay time in ms
  selectedHunk: string | null
}
```

`familyColors(scheme?)` returns the colour of each change family (`{ base, text }`) as kgdiff draws them, for building your own panel. Pass the theme (`familyColors(strata.theme)`) or `'dark' | 'light'`; it follows `theme.diffScheme`. The React `DiffPanel` does this.

### Low-level exports

`buildStrataDiff`, `createDiffLooks`, `hunkIndex`, `toKgdiffGraph`, `quietOf`, `applyQuiet`, the types `DiffFrameState` (the full per-frame state: `DiffView` plus hovered and selected node indexes, reduced motion, emphasis) and `HunkIndex`, and the constants `ATTR` (`strata.layer`, `strata.group`, `strata.folds`, `strata.weight`) and `HIERARCHY_PREDICATE` (`strata:parent`) describe how kgstrata data is handed to kgdiff. See the "What goes to kgdiff" section of [design.md](design.md).

## Writing a plugin

A plugin is an object with a `name` and an `install(ctx)` function. `install` receives a `StrataContext` and returns whatever API you want `use()` to hand back.

```ts
import type { StrataPlugin } from 'kgstrata'

export function myPlugin(): StrataPlugin<{ hello(): void }> {
  return {
    name: 'my-plugin',
    install(ctx) {
      return { hello: () => console.log(ctx.locale) }
    },
  }
}
```

### `StrataContext`

`ctx` is everything the core shares. Private engine state is not reachable. This is the plugin author's low-level interface: members take ids where they can (`followTo` takes a layer id, `fit` node ids). Indexes remain where hot paths and drawing need them (`hidden`, `indexOf`, `fitPoints`, a mode's `hover` / `select`); they refer to the model currently drawn (`ctx.current`) and change with new data and expand/collapse. The user-facing API (`Strata` methods and events) only uses ids. The types of `model` and `renderer` come from [`kgstrata/internals`](#kgstratainternals).

**Read**

| Member | Meaning |
|---|---|
| `model` | The normal view's `Model`, or `null` before `setData`. Unchanged while a mode has taken over. |
| `current` | The model being drawn: the mode's while a mode is active, otherwise `model`. |
| `mode` | Name of the plugin whose mode is active, or `null`. |
| `renderer` | The `StrataRenderer` (the only way to reach it; `strata.renderer` is private). |
| `time` | Engine clock in seconds. |
| `reducedMotion` | `prefers-reduced-motion` at creation. |
| `locale`, `theme` | The instance's current language and resolved theme. Both can change (`setLocale` emits `locale`; `setTheme` calls `onChange('theme')`). Use them for your text and colours. |
| `text(key, vars?)` | A text in the instance's language, with its `messages` overrides. |
| `disposed` | The engine was disposed; drop late async results. |
| `hidden` | `ReadonlySet<number>` of hidden layer indexes. |
| `expanded` | `ReadonlySet<string>` of expanded node ids, as set (including ids without children). |
| `indexOf(id)` | Index of a node in the normal view; a folded child maps to its drawn ancestor; `-1` if absent. |

**Use the core's rules**

| Member | Meaning |
|---|---|
| `normalize(data)` | Normalizes data with the instance's `nodeStyles`, palette and locale. Issues are dropped. |
| `layoutOf(resolved)` | Lays out with the instance's rules (plate radius grows with node count, anchor from options). |

**Change things**

| Member | Meaning |
|---|---|
| `takeOver(mode)` | Starts a mode. Returns a `ModeHandle` (`active`, `release({ rebuild? })`). |
| `rebuild()` | Rebuilds the normal view for the current expanded set and clears the selection. |
| `followTo(layer, refit?)` | If `follow` is on, makes layer `layer` (a layer id of the model being drawn; unknown ids do nothing) the hero. `refit`: `'overview'` reframes unless the user moved the camera, `'none'` (default) leaves the camera, a function is called when the hero actually changed. |
| `releaseFocus()` | Releases a single-layer focus without moving the camera. |
| `select(id)` | Same as `strata.select`: emits `select` (`source: 'api'`) and follows the hero. |
| `fit(nodes, { elevation, margin, duration? })` | Frames these nodes (ids), at their layout positions in the model being drawn. A folded child counts as its drawn ancestor; unknown ids are skipped. Uses target heights and scales while layers are still moving, and leaves the stack view first. |
| `fitPoints(points, { elevation, margin, duration? })` | Same, for arbitrary `PlatePoint`s (`{ layer, x, z }`: layer index and plate coordinates). |
| `releaseCamera({ duration? })` | Hands the camera back after `fit` / `fitPoints`: returns to the overview if a plugin framed it and the user has not moved it since (or it is still on the overview); otherwise does nothing. Call it when what you framed goes away. Releasing a mode does this by itself. |

**Hook in** (each returns an unsubscribe function, except `registerView`)

| Member | Meaning |
|---|---|
| `overlay(layer)` | Adds an overlay. |
| `onFrame(cb)` | Called every frame before styling, with `{ time, dt }`. |
| `onChange(cb)` | `'data'` new data; `'model'` the normal view was rebuilt (expand/collapse); `'hidden'` hidden layers changed; `'mode'` a mode took over; `'theme'` the theme changed (rebuild your own models and colours from `ctx.theme`). |
| `onExpand(cb)` | Called on expand/collapse before the core rebuilds. Return `true` to handle it yourself (the core then does not rebuild). |
| `onDispose(cb)` | Called from `strata.dispose()`. |
| `registerView(key, { get, set })` | Adds a field to `strata.view` / `setView()`. Throws `view-core-key` or `view-key-taken` on a clash. |
| `on(event, cb)` | Core events (same names as `strata.on`). |

There is no `emit`: a plugin cannot fake core events (`hover`, `select`, `hero`…). The core emits them itself when you call the methods above (`select`, `followTo`, `releaseFocus`; taking over and releasing emit `hover(null)`). Give your plugin its own events with an `Emitter` on its API, as both bundled plugins do.

### Overlays and modes

There are two ways to change the picture. A plugin can use both.

- **Overlay** (`ctx.overlay({ spotlight?, paint? })`): adds to the normal view. `spotlight()` returns a `Spotlight` (`{ rank }`, one entry per drawn node, `> 0` means lit, `0` means dimmed) or `null`. The core styler uses it to dim everything else, in the right order with focus and hero dimming. `paint(looks, frame)` runs after styling and can write into the frame's `Looks` (labels, badges, step numbers, `looks.extra.path`, ripples). Path replay is an overlay. If several overlays return a spotlight, the last installed wins.
- **Mode** (`ctx.takeOver(mode)`): replaces what is drawn. A `StrataMode` provides its own `model`, renderer `base` and a `looks(frame)` function, and optionally `hover(i)`, `select(i)`, `released()`. Only one mode is active at a time; another plugin taking over, or `setData`, calls `released()` on the previous one. Version comparison is a mode. Building a `Model` and styling it uses `kgstrata/internals`; see the [take-over example](#example-a-take-over-mode).

### The frame pipeline

Every frame the `Looks` go through a fixed pipeline; each writer owns its part:

1. **Base style**: the core styler (with the overlays' spotlight), or the active mode's `looks()`.
2. **Overlays**: each overlay's `paint`, in install order. Skipped while a mode is active.
3. **Core post-processing**: hidden layers fade out (nodes, lines, plates). Applies to modes too.

`onFrame` callbacks run before step 1.

### Example: highlight nodes of one type

An overlay plugin that lights every node of a given `type`, adds a badge to their labels, and stores its state in the view. This file is [`examples/plugin/src/highlight-type.ts`](../examples/plugin/src/highlight-type.ts) and is type-checked and built with the examples.

```ts
import { Emitter, type StrataPlugin } from 'kgstrata'
// The Model type lives in the low-level entry (not covered by semver); an overlay only reads it.
import type { Model } from 'kgstrata/internals'

/** What the plugin hands back from `strata.use(...)`. */
export interface HighlightTypeApi {
  /** Light up every node of this `type` (as written in the data). `null` turns it off. */
  set(type: string | null): void
  readonly type: string | null
  /** How many drawn nodes are lit. Fields folded inside a collapsed table are not drawn, so they do not count. */
  readonly count: number
  on(event: 'change', cb: (type: string | null) => void): () => void
}

/**
 * An overlay plugin: it never takes over the frame. Each frame it
 * 1. hands the core styler a spotlight (lit nodes stay bright, the rest dim), and
 * 2. paints a small badge next to each lit node's label.
 * It also stores its state in the view (`strata.view.highlight`).
 */
export function highlightTypePlugin(options: { badge?: string } = {}): StrataPlugin<HighlightTypeApi> {
  const badge = options.badge ?? '●'
  return {
    name: 'highlight-type',
    install(ctx) {
      const events = new Emitter<{ change: string | null }>()
      let type: string | null = null
      // Cache per model: the core rebuilds the model on setData and on expand/collapse.
      let cached: { model: Model; type: string | null; rank: Int32Array; count: number } | null = null

      const rankFor = (m: Model) => {
        if (cached && cached.model === m && cached.type === type) return cached
        // rank[i] > 0 marks node i as lit. Order does not matter here, so every match gets 1.
        const rank = new Int32Array(m.base.nodes.length)
        let count = 0
        m.specs.forEach((spec, i) => {
          if (type !== null && spec.type === type) {
            rank[i] = 1
            count++
          }
        })
        cached = { model: m, type, rank, count }
        return cached
      }

      ctx.overlay({
        // ① Asked before the core styles the frame. Return null to stay out of the way.
        spotlight: () => {
          const m = ctx.model
          if (type === null || !m || ctx.mode !== null) return null
          return { rank: rankFor(m).rank }
        },
        // ② Called after styling, only while no mode has taken over.
        paint: (looks) => {
          const m = ctx.model
          if (type === null || !m) return
          const { rank } = rankFor(m)
          for (let i = 0; i < rank.length; i++) if (rank[i] > 0) looks.nodes[i].badge = badge
        },
      })

      const set = (next: string | null) => {
        if (next === type) return
        type = next
        events.emit('change', type)
      }

      // Save and restore with strata.view / setView().
      ctx.registerView<string | null>('highlight', { get: () => type, set })
      // New data: keep the type, the cache is keyed by model and refreshes by itself.
      ctx.onDispose(() => events.clear())

      return {
        set,
        get type() {
          return type
        },
        get count() {
          const m = ctx.model
          return m && type !== null ? rankFor(m).count : 0
        },
        on: (event, cb) => events.on(event, cb),
      }
    },
  }
}
```

Using it:

```ts
import { Strata } from 'kgstrata'
import { highlightTypePlugin } from './highlight-type'

declare module 'kgstrata' {
  interface StrataView {
    highlight?: string | null
  }
}

const strata = new Strata(host)
const highlight = strata.use(highlightTypePlugin({ badge: '◆' }))
strata.setData(data)

highlight.set('relation')
strata.view.highlight // 'relation'
```

The overlay only reads `ctx.model`, so it needs nothing from `kgstrata/internals` except the `Model` type.

### `kgstrata/internals`

The low-level entry for plugins that take over the frame. **Nothing here is covered by semver**: minor versions may change it; check the changelog when you upgrade. The stable API is `kgstrata` and `kgstrata/headless`.

| Export | Purpose |
|---|---|
| `buildModel(data, layout, theme?)`, `Model` | Index a `Resolved` graph and its `StrataLayout` for the styler and the renderer. `model.renderer` is the `RendererBase` a mode hands over. |
| `Styler`, `StyleState`, `Spotlight` | The core styler: hover, selection, focus, hero dimming, spotlight. `new Styler(model).resolve(state)` gives a frame's `Looks`. |
| `nodeColor`, `magnitudeOf`, `DEFAULT_SHAPE` | A node's resting colour and magnitude. |
| `composeFrame`, `fadePresence`, `spotlightOf` | The per-frame pipeline pieces (for tests). |
| `StrataRenderer`, `RendererBase`, `RendererOptions`, `PlatesInput`, `PlateInput` | Renderer types (`ctx.renderer`). |
| `Looks`, `NodeLook`, `EdgeLook`, `EdgeEnd`, `LabelLook`, `ExtraEdges`, `BaseNode`, `BaseEdge`, `EdgeKind` | What a frame draws (an overlay's `paint`, a mode's `looks`) and the renderer's base. Not exported from `kgstrata` or `kgstrata/headless`. |

It does not import kgdiff or React.

### Example: a take-over mode

A mode plugin that draws only one node and its direct neighbours, laid out afresh, with the core styler. Clicking another node re-centres on it, clicking empty space goes back. This file is [`examples/plugin/src/neighbourhood.ts`](../examples/plugin/src/neighbourhood.ts) and is type-checked and built with the examples.

```ts
import { Emitter, type ModeHandle, type StrataPlugin } from 'kgstrata'
import type { Resolved } from 'kgstrata/headless'
// Taking over the frame needs the low-level entry. Nothing in it is covered by semver:
// minor versions may change it, so check the changelog when you upgrade.
import { buildModel, Styler, type StyleState } from 'kgstrata/internals'

/** What the plugin hands back from `strata.use(...)`. */
export interface NeighbourhoodApi {
  /** Take over the view and draw only this node and its direct neighbours (on every layer), laid out afresh. */
  show(id: string): boolean
  /** Hand the frame back to the normal view. */
  exit(): void
  /** The node in the middle, or `null` when the normal view is drawn. */
  readonly center: string | null
  on(event: 'change', cb: (center: string | null) => void): () => void
}

/**
 * A mode plugin: while active it replaces what is drawn.
 * 1. Build a smaller `Resolved` graph from the drawn one (`ctx.model.data`).
 * 2. Lay it out with the engine's rules (`ctx.layoutOf`) and build a `Model` from it (`buildModel`).
 * 3. Style it with the core `Styler` and hand the core a `StrataMode` (`ctx.takeOver`).
 * Hidden layers, hero proportions and the camera keep working: the core applies them to modes too.
 */
export function neighbourhoodPlugin(): StrataPlugin<NeighbourhoodApi> {
  return {
    name: 'neighbourhood',
    install(ctx) {
      const events = new Emitter<{ change: string | null }>()
      let center: string | null = null
      let handle: ModeHandle | null = null

      const set = (next: string | null) => {
        if (next === center) return
        center = next
        events.emit('change', center)
      }

      const show = (id: string): boolean => {
        const m = ctx.model
        const at = m?.index.get(id)
        if (!m || at === undefined) return false
        // Keep the node, its neighbours (`adj` covers edges inside a layer and mappings across layers).
        const keep = new Set([id, ...m.adj[at].map((j) => m.base.nodes[j].id)])
        const data: Resolved = {
          groups: m.data.groups,
          // Every layer stays, so layer indexes, the hero and hidden layers still line up with the normal view.
          layers: m.data.layers.map((l) => ({
            ...l,
            // Drop `parent`: an expanded field may be kept without its table, so everything is laid out as top level.
            nodes: l.nodes.filter((n) => keep.has(n.id)).map(({ parent: _parent, ...n }) => n),
            edges: (l.edges ?? []).filter((e) => keep.has(e.source) && keep.has(e.target)),
          })),
          links: m.data.links.filter((k) => keep.has(k.source) && keep.has(k.target)),
        }
        const model = buildModel(data, ctx.layoutOf(data), ctx.theme)
        const styler = new Styler(model)
        // The node in the middle stays selected; hovering lights neighbours as usual.
        const state: StyleState = { hover: -1, selected: model.index.get(id) ?? -1, focusLayer: null, stage: null, spot: null, group: -1, time: 0 }
        handle = ctx.takeOver({
          model,
          base: model.renderer,
          looks: (frame) => {
            state.time = frame.time
            return styler.resolve(state)
          },
          hover: (i) => (state.hover = i),
          // Clicking another node re-centres on it; clicking empty space goes back.
          select: (i) => {
            if (i < 0) exit()
            else show(model.base.nodes[i].id)
          },
          // The core took the frame back (new data, or another plugin's mode).
          released: () => {
            handle = null
            set(null)
          },
        })
        set(id)
        return true
      }

      const exit = () => {
        const h = handle
        handle = null
        h?.release()
        set(null)
      }

      ctx.onDispose(() => events.clear())

      return {
        show,
        exit,
        get center() {
          return center
        },
        on: (event, cb) => events.on(event, cb),
      }
    },
  }
}
```

### Registering view state

`ctx.registerView(key, { get, set })` adds `key` to `strata.view` and routes `setView({ [key]: value })` to your `set` (only when the value is not `undefined`). Plugin slots are applied after the core's hero, focus and group, and before `selected`.

To make the key part of the `StrataView` type, augment it. From an application or a separate package, augment the public module `kgstrata`, as above. This was verified with TypeScript 7.0.2 against the built type declarations (the [plugin example](../examples/plugin) does it). The bundled path plugin augments the internal module instead, because it is compiled inside the package.

### Checklist

- Index arrays by the model you were given and rebuild them when `ctx.model` changes (on `'data'` and `'model'` changes, or by comparing references as above).
- Do nothing heavy in `spotlight` and `paint`; they run every frame. Reuse arrays.
- Use `ctx.theme` for colours and `ctx.locale` for text.
- For async work, check `ctx.disposed` (and your own request counter) before using the result.
- Clean up your own listeners in `ctx.onDispose`.
