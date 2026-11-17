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
| `clear()` | `() => void` | Stops and forgets the path. |
| `ids` | `string[] \| null` | The ids given to `play`, or `null`. |
| `reached` | `number` | How many steps are lit. |
| `live` | `PathProgress` | `{ ids, reached }`: the steps actually walked (after skipping hidden layers and merging) and how many are lit. |
| `shot()` | `() => void` | Frames the whole path. |
| `on('step', cb)` | `() => void` | Called when `live` changes: a new step lit, or the walked steps changed after hiding a layer or expanding a node. |

Behaviour:

- Hiding or showing a layer, or expanding a node, re-computes the steps without restarting.
- Clicking empty space stops the current run (`ids` is kept, so `getView().path` still has it). `setData` and a mode taking over clear the path.
- With `followHero` on, the hero switches to the layer the path has reached and the camera reframes the whole path.
- With reduced motion, the path is shown complete at once.

### View state

The plugin registers `path` in the view state and adds it to the `StrataView` type:

```ts
strata.getView().path        // string[] | null
strata.setView({ path: ['onto:person', 'tbl:person'] }) // plays it from the start
strata.setView({ path: null })                            // clears it
```

### Low-level exports

`stepsOf`, `reachedAt`, `segmentProgress`, `rankOf`, `paintPath`, `STEP`, `DIGITS` (①②③…) and the types `PathRun`, `PathPaintModel`, `PathProgress`, `PathEvents` are exported for tests and for building similar overlays. They do not touch the renderer.

## Version comparison: `kgstrata/diff`

Compares two versions of the data with [kgdiff](https://github.com/iiwish/kgdiff) and draws the semantic changes (added, removed, renamed, merged, re-mapped, re-pointed) on the union of both versions. Changes can be replayed one by one.

Extra install:

```sh
npm install @kgdiff/core @kgdiff/scene @kgdiff/layout
```

kgdiff ships three WebAssembly files (about 1.9 MB together). Vite 8 needs no configuration; for Vite 6 and other bundlers see [getting-started.md](getting-started.md#webassembly-and-kgstratadiff).

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

diff.setView({ layer: 'before' })   // 'union' | 'before' | 'after' | 'replay'
diff.play(true)                     // replay all changes in order
diff.selectHunk(2)                  // select one change; the camera frames it
diff.exit()                         // back to the normal view
```

`diffPlugin(options?)` takes `{ locale?: Locale }`, the language kgdiff writes change descriptions in. It defaults to the instance's `locale`.

### `DiffApi`

| Member | Type | Meaning |
|---|---|---|
| `show(before, after, opts?)` | `Promise<StrataDiff \| null>` | Lays out the union of both versions once and takes over the view (a [mode](#overlays-and-modes)). Async. Only the latest call counts: if `show`, `exit`, `setData` or `dispose` happens while kgdiff is working, it resolves to `null`. |
| `exit()` | `() => void` | Returns to the normal view (no re-layout) and cancels a pending `show`. |
| `active` | `boolean` | A comparison is on screen. |
| `current` | `StrataDiff \| null` | The comparison on screen. |
| `view` | `Readonly<DiffView> \| null` | Replay state. Change it with `setView`, `play`, `selectHunk`. |
| `playing` | `boolean` | Replay is running. |
| `setView(patch)` | `(patch: Partial<DiffView>) => void` | Changes the replay state, e.g. `{ layer: 'after' }` or `{ layer: 'replay', t: 1200 }`. Not the same as `strata.setView`. |
| `play(on)` | `(on: boolean) => void` | Starts (from the start, or where it stopped) or pauses the replay. |
| `selectHunk(i)` | `(i: number) => void` | Selects change `i` (`-1` clears) and frames it. With `followHero`, its layer becomes the hero. |
| `shot(i)` | `(i: number) => void` | Frames change `i`. |
| `on('enter' \| 'exit', cb)` | `() => void` | `enter` with the `StrataDiff` (also after a re-comparison caused by expanding a node), `exit` with `null`. |

`show` options: `{ replaces?: Record<string, string[]> }`, new node id → old node ids it absorbed. Without it, a merge looks like one node removed and another added.

```ts
await diff.show(before, after, { replaces: { 'onto:party': ['onto:person', 'onto:company'] } })
```

Expanding or collapsing a node while comparing re-runs the comparison at the new level of detail. Collapsed, a field added to a table shows as a changed table (its folded children are an attribute) and a changed mapping weight.

### Result types

```ts
interface StrataDiff {
  scene: Scene                                 // kgdiff's scene
  base: { nodes: BaseNode[]; edges: BaseEdge[] }  // union graph as drawn
  hunks: DiffHunk[]
  duration: number                             // replay length in ms at 1× speed
  stats: { added: number; removed: number; changed: number } // nodes + edges
}

interface DiffHunk {
  index: number
  id: string
  kind: string
  family: ChangeFamily     // 'added' | 'removed' | 'content' | 'structure' | 'identity'
  title: string            // localized description
  subtitle: string
  nodes: number[]          // indexes into base.nodes
  context: number[]
  center: [number, number]
  layer: number
  radius: number
  start: number            // replay window, ms
  end: number
}

interface DiffView {
  layer: 'union' | 'before' | 'after' | 'replay'
  t: number                // replay time in ms
  selectedHunk: number
  hoveredNode: number
  selectedNode: number
  reducedMotion: boolean
  emphasis: number
}
```

`familyColors()` returns the colour of each change family (`{ base, text }`) as kgdiff draws them, for building your own panel. The React `DiffPanel` uses it.

### Low-level exports

`buildStrataDiff`, `createDiffLooks`, `toKgdiffGraph`, `quietOf`, `applyQuiet`, and the constants `ATTR` (`strata.layer`, `strata.group`, `strata.folds`, `strata.weight`) and `HIERARCHY_PREDICATE` (`strata:parent`) describe how kgstrata data is handed to kgdiff. See the "What goes to kgdiff" section of [design.md](design.md).

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

`ctx` is everything the core shares. Private engine state is not reachable. Where a member uses indexes, they refer to the model currently drawn (`ctx.current`).

**Read**

| Member | Meaning |
|---|---|
| `model` | The normal view's `Model`, or `null` before `setData`. Unchanged while a mode has taken over. |
| `current` | The model being drawn: the mode's while a mode is active, otherwise `model`. |
| `mode` | Name of the plugin whose mode is active, or `null`. |
| `renderer` | The `StrataRenderer`. |
| `time` | Engine clock in seconds. |
| `reducedMotion` | `prefers-reduced-motion` at creation. |
| `locale`, `theme` | The instance's language and resolved theme. Use them for your text and colours. |
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
| `followTo(layer, refit?)` | If `followHero` is on, makes layer `layer` (index) the hero. `refit`: `'overview'` reframes unless the user moved the camera, `'none'` (default) leaves the camera, a function is called when the hero actually changed. |
| `releaseFocus()` | Releases a single-layer focus without moving the camera. |
| `select(id)` | Same as `strata.select`. |
| `fit(points, { elevation, margin })` | Frames `PlatePoint`s (`{ layer, x, z }` in plate coordinates). Uses target heights and scales while layers are still moving. |

**Hook in** (each returns an unsubscribe function, except `registerView`)

| Member | Meaning |
|---|---|
| `overlay(layer)` | Adds an overlay. |
| `onFrame(cb)` | Called every frame before styling, with `{ time, dt }`. |
| `onChange(cb)` | `'data'` new data; `'model'` the normal view was rebuilt (expand/collapse); `'hidden'` hidden layers changed; `'mode'` a mode took over. |
| `onExpand(cb)` | Called on expand/collapse before the core rebuilds. Return `true` to handle it yourself (the core then does not rebuild). |
| `onDispose(cb)` | Called from `strata.dispose()`. |
| `registerView(key, { get, set })` | Adds a field to `getView()` / `setView()`. Throws `view-core-key` or `view-key-taken` on a clash. |
| `on(event, cb)` / `emit(event, v)` | Core events (same names as `strata.on`). |

### Overlays and modes

There are two ways to change the picture. A plugin can use both.

- **Overlay** (`ctx.overlay({ spotlight?, paint? })`): adds to the normal view. `spotlight()` returns a `Spotlight` (`{ rank }`, one entry per drawn node, `> 0` means lit, `0` means dimmed) or `null`. The core styler uses it to dim everything else, in the right order with focus and hero dimming. `paint(looks, frame)` runs after styling and can write into the frame's `Looks` (labels, badges, step numbers, `looks.extra.path`, ripples). Path replay is an overlay. If several overlays return a spotlight, the last installed wins.
- **Mode** (`ctx.takeOver(mode)`): replaces what is drawn. A `StrataMode` provides its own `model`, renderer `base` and a `looks(frame)` function, and optionally `hover(i)`, `select(i)`, `released()`. Only one mode is active at a time; another plugin taking over, or `setData`, calls `released()` on the previous one. Version comparison is a mode. Note: building a new `Model` needs internal helpers that are not exported yet, so in practice a third-party mode can only reuse `ctx.model` and must fill every `NodeLook` and `EdgeLook` itself.

### The frame pipeline

Every frame the `Looks` go through a fixed pipeline; each writer owns its part:

1. **Base style**: the core styler (with the overlays' spotlight), or the active mode's `looks()`.
2. **Overlays**: each overlay's `paint`, in install order. Skipped while a mode is active.
3. **Core post-processing**: hidden layers fade out (nodes, lines, plates). Applies to modes too.

`onFrame` callbacks run before step 1.

### Example: highlight nodes of one type

An overlay plugin that lights every node of a given `type`, adds a badge to their labels, and stores its state in the view. This file is [`examples/plugin/src/highlight-type.ts`](../examples/plugin/src/highlight-type.ts) and is type-checked and built with the examples.

```ts
import { Emitter, type Model, type StrataPlugin } from 'kgstrata'

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
 * It also stores its state in the view (`getView().highlight`).
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

      // Save and restore with getView() / setView().
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
strata.getView().highlight // 'relation'
```

### Registering view state

`ctx.registerView(key, { get, set })` adds `key` to `getView()` and routes `setView({ [key]: value })` to your `set` (only when the value is not `undefined`). Plugin slots are applied after the core's hero, focus and group, and before `selected`.

To make the key part of the `StrataView` type, augment it. From an application or a separate package, augment the public module `kgstrata`, as above. This was verified with TypeScript 7.0.2 against the built type declarations (the [plugin example](../examples/plugin) does it). The bundled path plugin augments the internal module instead, because it is compiled inside the package.

### Checklist

- Index arrays by the model you were given and rebuild them when `ctx.model` changes (on `'data'` and `'model'` changes, or by comparing references as above).
- Do nothing heavy in `spotlight` and `paint`; they run every frame. Reuse arrays.
- Use `ctx.theme` for colours and `ctx.locale` for text.
- For async work, check `ctx.disposed` (and your own request counter) before using the result.
- Clean up your own listeners in `ctx.onDispose`.
