# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-27

### Added

- **`auditMappings(data, opts?)`** in `kgstrata/headless`: for two layers (the ontology and the tables), whether each upper relation can be walked through joins below (`joined` with the shortest paths, `unreachable`, `unmapped`), whether each join is accounted for above (`direct`, `via-path`, `unused`), and which nodes have no mapping. Works on everything collapsed; at most `maxHops` joins (3), only the shortest paths (at most `maxPaths`, 3), joins are relations of a `joinTypes` type (`['fk']`), and paths do not pass through unmapped nodes unless `throughUnmapped`. Plain JSON, no three.js. See docs/headless.md ("Audit the mappings"). New error code `audit-layers`.
- **Mapping audit plugin `kgstrata/audit`**: `auditPlugin()` draws the audit on the map as a mode, everything collapsed and positions unchanged. Only gaps get colour: unwalkable relations (dashed), unused joins, joins only a path uses (a weaker colour), nodes with no mapping (a ring). `audit.select({ kind, id })` lights up what a relation, join or node involves on both layers and frames it; clicking a node on the map selects it. API: `show(opts?)`, `exit()`, `active`, `current`, `selected`, `select`, `shot`, events `enter` / `exit` / `select`, view state `audit`, and `auditColors(theme)`. See docs/plugins.md ("Mapping audit").
- **`<AuditPanel>` in `kgstrata/react/audit`**: two totals and the gaps grouped by kind; click a line to select and frame it. `auditItems(audit, label?, t?)` gives the same lines as data. See docs/react.md.
- **`MappingAudit.maxHops`**: the limit the audit used.
- **`StrataContext.data`**: the object last passed to `setData` (`strata.data`), so a plugin can work on the data on screen.
- **Label rules: `StrataOptions.labels`, `strata.setLabels()`, `strata.labels`.** A mode (`'auto' | 'always' | 'hover'`) with overrides per layer, node type and node id (the most specific wins), and `max`, the number of names on screen at most (160). Types `LabelOptions` and `LabelMode` from `kgstrata`. See docs/api.md ("Labels").

### Changed

- **Small layers show every name.** Before, the bottom 40 % of each layer by importance never showed a name at rest, however much room there was, and a supporting layer kept only its one or two hubs (a three-node catalog layer showed one name). Now each layer shows its 40 most important names at least (all of them up to 40 nodes; large layers as before, about 60), and a supporting layer keeps its 8 most important names besides the hubs. Crowding is still handled by names giving way on screen. To keep a layer or type quiet, give it `'hover'` in `labels`.
- **`@kgdiff/layout` is no longer a peer dependency.** `kgstrata/diff` stopped importing it in 0.2.0 (it gives kgdiff its own positions), and `@kgdiff/scene` depends on it, so it is installed anyway. Install `@kgdiff/core`, `@kgdiff/scene` and `@kgdiff/compute`; an existing `@kgdiff/layout` in your `package.json` does no harm.

### Fixed

- **A pending `diff.show()` no longer takes the frame back** from another plugin's mode that took over while kgdiff was computing; it resolves to `null`, and expanding nodes afterwards does not restart the comparison.
- **Nodes expanded or collapsed while a mode draws** are applied to the normal view whichever mode hands the frame back. Before, if comparing was replaced by another mode (the audit), the normal view came back without the children it should show.
- **`dispose()` while a mode draws** now calls the mode's `released()`: `diff.active` / `audit.active` are `false` afterwards and their `exit` event fires.

### Internal

- `Model.edgeId` (`kgstrata/internals`): the relation id of each drawn edge (`''` for containment lines).
- `new Styler(model, labels?)` (`kgstrata/internals`): takes the label rules (`LabelOptions`) as an optional second argument.
- The demo page has an Audit tab.
- The demo page's data is now the Three Kingdoms on the Chinese page and the Trojan War on the English one (`demo/src/threekingdoms.ts`, `demo/src/troy.ts`, built by `demo/src/saga.ts`): events, sides and figures from top to bottom, families containing their members, and for the Changes tab the official history against *Romance of the Three Kingdoms*, Homer against the 2004 film *Troy*. `?data=threekingdoms|troy` picks one; the online store moved to `?data=shop`. The README screenshots show the new data.
- `pnpm check:bundlers` (`scripts/check-bundlers.mjs`): builds the packed package with Vite 8 and 6, webpack 5, Rollup, esbuild, Parcel 2 and Next.js 16 (Turbopack and `--webpack`), checks that kgdiff's three `.wasm` files are in each output, and with `--serve` runs every build in a browser page. Replaces the by-hand bundler check of 0.2.0.
- The release workflow publishes with npm trusted publishing once it is set up on npmjs.com, and falls back to the `NPM_TOKEN` secret until then (`release.yml`, CONTRIBUTING.md).

## [0.2.0] - 2026-11-19

0.2.0 cleans up the public API in one go. Almost every item below is a breaking change; see [Migrating from 0.1](#migrating-from-01) for a side-by-side table.

### Breaking

- **Ids everywhere, no exceptions.** `shot('layer', { layer })` takes a layer id. `HoverInfo.layer` is the layer id (the name is `layerName`); `HoverInfo.group` is the group id `"grouping/group"` (the name is `groupName`). `DiffHunk.nodes` / `context` are node ids and `DiffHunk.layer` is a layer id; `DiffHunk.index` is gone. `diff.selectHunk`, `diff.shot` and `DiffView.selectedHunk` take hunk ids (`null` clears). Indexes remain only in the plugin-author context where hot paths and drawing need them (`StrataContext`: `hidden`, `indexOf`, `fitPoints`, mode `hover` / `select`), documented as such.
- **Programmatic and pointer selection take the same path.** `select(id)` now emits `select` and triggers following (`follow`). The `select` payload is `SelectInfo { node: NodeInfo | null; source: 'pointer' | 'api'; pointer: { x, y } | null }` instead of `HoverInfo | null`. `setView({ selected })` emits `select` with `source: 'api'` but does not follow or move the camera. `ctx.select` behaves like `strata.select`.
- **The base layer is called `anchor` everywhere.** `LayoutOptions.primary` → `anchor`; `StrataLayout.primary` → `anchor`; `RendererBase.primary` / `PlatesInput.primary` → `anchor`. Relation `primary` (the primary mapping) and the `LinkClass` value `'primary'` are a different concept and keep their names. Without `hero`, the hero is the anchor layer.
- **Internals moved to `kgstrata/internals`.** `Model`, `RendererBase`, `RendererOptions` and `StrataRenderer` are no longer exported from `kgstrata`. The new entry `kgstrata/internals` exports `buildModel`, `Model`, `nodeColor`, `magnitudeOf`, `DEFAULT_SHAPE`, `Styler`, `StyleState`, `Spotlight`, `composeFrame`, `fadePresence`, `spotlightOf` and the renderer types. **It is not covered by semver.** `strata.renderer` is private; plugins use `ctx.renderer`.
- **`diff.setView` is now `diff.update`.** `DiffView` only has `layer`, `t` and `selectedHunk`; `hoveredNode`, `selectedNode`, `reducedMotion` and `emphasis` are internal (`DiffFrameState`). `diff.view` returns a copy. `StrataDiff` keeps `scene` and `base` as low-level fields not covered by semver.
- **`changesByLayer(diff)`** takes only the diff and counts each change on `DiffHunk.layer` (the layer most of its nodes are in, the same layer `follow` switches to). It used to take `(diff, layers)` and count by the first node.
- **A wrong contract `version` is a real error.** `normalize` returns an empty graph, and `setData` returns the issue without drawing anything and without changing `strata.data`. `validate` is unchanged (the issue was already `level: 'error'`, without `id`). New helper `isFatal(issue)`.
- **Unused theme fields removed:** `theme.root`, `theme.label.muted`, `theme.plate.dot`.
- **`focusLayer` and the `focus` event agree.** With several layers `focusLayer(id)` is exactly `setHero(id)` (`null` returns to the hero's home): nothing is focused, no `focus` event is emitted (a `hero` event is), and `strata.focus` stays `null`. With one layer it focuses that layer as before. The `focus` event now always carries the new `strata.focus`; a mode taking over emits `focus` only if a layer was focused. Rationale in docs/design.md ("Clicking a layer").
- **The hero setters return what actually applied.** `setHero(id)` and `setHeroMix(mix)` return `HeroInfo` (`setHeroMix` used to ignore hidden layers silently; its `mix` now shows the weights in effect). `setLayerVisible(id, visible)` returns the layer's `LayerInfo` after the call, or `null` for an unknown layer, instead of `boolean`.
- **`StrataContext` takes ids.** `ctx.followTo(layerId, refit?)` takes a layer id; `ctx.fit(nodeIds, opts)` frames nodes by id (a folded child counts as its drawn ancestor). The old point-based `fit` is `ctx.fitPoints(points, opts)`.
- **`PathApi.reached` removed**: it duplicated `path.progress.reached`.
- **`theme.fogNear` / `theme.fogFar` replaced by `theme.fog: { near, far }`**, distances behind the camera target, applied every frame (default `{ near: 12, far: 125 }`, the values the renderer used to hard-code). The old fields only mattered before the first frame.
- **`createTheme` derives the backdrop from `background`** when `background` is given without `backdrop` (`backdropOf`), so a new background colour is one line. Give `backdrop` to control the gradient yourself.
- **Render types moved to `kgstrata/internals`.** `kgstrata` and `kgstrata/headless` export the contract types by name instead of `export type *`: the input, and the types in headless function signatures (`Normalized`, `Resolved*`, `StrataLayout`, `PlacedNode`, …). `Looks`, `NodeLook`, `EdgeLook`, `EdgeEnd`, `LabelLook`, `ExtraEdges`, `BaseNode`, `BaseEdge` and `EdgeKind` are only in `kgstrata/internals`.
- **`SelectInfo.pointer` has `hit`**: the node under the pointer (`null` = empty space), so "clicked the selected node again" (`node: null`, `hit: id`) and "clicked empty space" (`hit: null`) can be told apart. Path replay stops only on empty space again; 0.2 previews also stopped it when the selected node was clicked again.
- **`shot` takes an options object.** `strata.shot(name, { layer?, duration? })` instead of `shot(name, layer?, duration?)`; the plugins follow: `path.shot({ duration? })`, `diff.shot(hunkId, { duration? })`. `ctx.fit` / `ctx.fitPoints` options take `duration?` too.
- **"The hero follows" is called `follow` everywhere.** `StrataOptions.followHero` → `follow`, `strata.setFollowHero(on)` → `setFollow(on)` (now returns `HeroInfo`); `StrataView.follow` and `HeroInfo.follow` already had the name. New getter `strata.follow`.
- **`strata.heroInfo` is `strata.hero`** (a `HeroInfo`, like the `hero` event). The view state's hero weights are `StrataView.heroMix` (was `hero`), matching `StrataOptions.heroMix` and `setHeroMix`; `setView({ heroMix })`. `StrataOptions.hero` (the starting hero's layer id) keeps its name. `heroMix` is now a reserved view key for plugins (`view-core-key`), `hero` no longer is.
- **Pointer positions are in `pointer`.** `HoverInfo` has `pointer: { x, y }` instead of top-level `x`, `y`, like `SelectInfo.pointer` (which also has `hit`). New type `PointerPosition`.
- **`PathApi.live` is `PathApi.progress`** (type `PathProgress`, what the `step` event carries); `<PathList live>` is `<PathList progress>`.
- **Plugins cannot emit core events.** `StrataContext.emit` is removed. Neither bundled plugin needed it; the core emits `hover(null)`, `select`, `hero`, `focus` itself from `takeOver` / `release`, `ctx.select`, `ctx.followTo`, `ctx.releaseFocus`. Use your own `Emitter` for plugin events.
- **State is read through getters named like the state.** `strata.getView()` is the getter `strata.view` (still a new object each time), paired with `setView` as `hero` / `setHero`, `spread` / `setSpread` and the rest are, and like `diff.view`. The event `expand` is `expanded`, named like the getter `strata.expanded` whose value it carries (as `hero`, `layers`, `locale` and `theme` already were); the React prop `onExpand` is `onExpanded`. New getters `strata.selected`, `strata.focus` and `strata.group` read what `select`, `focusLayer` and `highlightGroup` set (they were only in the view state). The plugin hook `ctx.onExpand` keeps its name: it runs before an expansion, it is not the event.
- **`setInset` takes all four sides:** `setInset({ top?, right?, bottom?, left? })` in CSS pixels (missing sides are 0) instead of `setInset(px)` for the right side only. Shots centre the picture in the remaining area, horizontally and vertically. New getter `strata.inset`.
- **`@kgdiff/compute` is an optional peer dependency** (`^0.12.3`) of `kgstrata/diff`, next to `@kgdiff/core`, `@kgdiff/layout` and `@kgdiff/scene`. `kgstrata/diff` imports it for the new `wasm` option (a dynamic `import()` that only runs when `wasm` is given, but bundlers resolve it at build time), so with strict package managers (pnpm) install it yourself. It is already a dependency of `@kgdiff/core` at the same version.
- **kgdiff peer dependencies are `^0.12.3`** (were `^0.12.1`) for `@kgdiff/core`, `@kgdiff/layout`, `@kgdiff/scene` and `@kgdiff/compute`. `kgstrata/diff` now gives `buildScene` its own positions (`SceneLayout`), moves merge and replacement arrows with the nodes they name (`node1` / `node2`) and reads colours with kgdiff's `parseColor`, all new in kgdiff 0.12.3.
- **Peer range of `three` and `@types/three` widened** to `>=0.154.0 <0.200.0` (0.154 to 0.187 run; 0.153 fails in the shaders).
- **`ui.tip-expand` is neutral:** `{n} inside · double-click to expand` / `内含 {n} 项 · 双击展开`. The noun comes from the node type (see `childNoun`).
- **`Locale` is `string`** (with `'en' | 'zh-CN'` as literal hints). `MESSAGES` only holds the built-in tables; use `messagesOf(locale)` for a registered one.
- **`<StrataCanvas>` renders one positioned container.** The markup is `<div class="kgs-canvas"><style>…</style><div class="kgs-canvas-host"></div>{children}</div>`. `className` / `style` go on the container; children sit over the canvas inside it. The container has default rules (`position: relative; width: 100%; height: 100%; min-height: 320px`) with zero specificity, so your own rules win and no stylesheet is needed.
- **`<LayerList counts>`** defaults to each layer's top-level node count (`LayerInfo.count`); pass `false` for no numbers.
- **`familyColors(scheme?)`** takes a theme or `'dark' | 'light'`; `<DiffPanel>` follows `theme.diffScheme`.

### Added

- `LayerInfo.count`: top-level nodes per layer (folded and expanded children not counted). The plate caption uses the same number.
- `registerLocale(name, messages, { fallback? })` with partial tables and a fallback chain (default `'en'`); `hasLocale`, `fallbackChain`, `builtinLocaleOf`, `messagesOf`, `pickText`. `StrataOptions.messages` overrides single texts per instance; `strata.text(key, vars)`, `strata.messages`.
- `strata.setLocale(locale, messages?)` and the `locale` event. React panels re-render; the diff plugin re-compares in the new language unless it was given a `locale`. kgdiff only knows `'en'` and `'zh-CN'`: other languages fall back along their chain (usually to `'en'`) for kgdiff's change descriptions.
- `strata.setTheme(overrides)` and the `theme` event; plugins get `onChange('theme')`. Rebuilds the clear colour, backdrop, plates, label atlas and node/line colours; no re-layout.
- `NodeStyle.childNoun` (`string` or per-language record); the built-in `table` style says fields / 字段. `NodeInfo.childNoun`, message key `ui.tip-expand-noun`.
- `StrataOptions.layout` (`LayoutProvider`): inject a precomputed `StrataLayout`. Missing nodes give a `layout-incomplete` warning and the layout is computed instead; expanded children are still added with `placeChildren`. `layoutToJSON` / `layoutFromJSON` / `checkLayout` in `kgstrata/headless`.
- `NodeInfo`, `SelectInfo`, `SelectSource`, `LayoutProvider` types; `StrataEvents.locale` / `theme`; `ctx.text`.
- The diff plugin registers `diff` in the view state while a comparison is on screen (`{ layer, t, selectedHunk }`, otherwise `null`). `setView({ diff })` only applies while comparing; the two versions are not part of the view.
- React: `useText`, `useStrataState(strata, 'locale' | 'theme')`, `onLocale` / `onTheme` props, `textFor`, `tipLines`, `layerCount`, `CANVAS_CSS`, `CANVAS_HOST_STYLE`. In development `<StrataCanvas>` warns once (through the message table) when its host has zero height.
- `diffPlugin({ wasm: { compute?, layout?, formats? } })`: where kgdiff's WebAssembly modules are loaded from (`string | URL`), passed to `init({ sources })` of `@kgdiff/compute` before the first comparison. For bundlers that do not handle `new URL(…, import.meta.url)` (esbuild, Rollup without a plugin). Without it nothing changes.
- Getters `strata.follow`, `strata.spread`, `strata.inset`, `strata.selected`, `strata.focus`, `strata.group`, `strata.view`; types `ShotOptions`, `Inset`, `PointerPosition`, `FitOptions`, `PathShotOptions`, `DiffShotOptions`, `DiffWasmSources`.
- docs/getting-started.md has a Bundlers section (Vite 6/8, webpack 5, Next.js 16, Rollup, esbuild, Parcel 2).
- `pnpm check:types-compat` (`scripts/compat-types.mjs`): type-checks the packed package with `skipLibCheck: false` on TypeScript 5.2 / 5.6 / latest × `@types/three` 0.160 / 0.170 / 0.187 × `moduleResolution` `bundler` / `nodenext`. All 18 combinations pass.
- The release workflow creates a GitHub Release from the version's `CHANGELOG.md` section after publishing.
- A complete "take-over mode" plugin example (`examples/plugin/src/neighbourhood.ts`), type-checked with the examples.
- `<StrataCanvas>` writes the theme's panel colours as `--kgs-*` variables on its container (only those that differ from `DARK`, as a zero-specificity rule) and updates them after `setTheme`. `themeVars(theme)` and `themeRule(selector, vars)` in `kgstrata/react`.
- `backdropOf(background)` in `kgstrata/headless`; `ctx.fitPoints`.
- `ctx.releaseCamera({ duration? })`: hands the camera back to the overview after `ctx.fit` / `ctx.fitPoints`, unless the user moved it since.

### Fixed

- **The camera returns to the overview after a path or a comparison.** `path.clear()` and `diff.exit()` left the camera where the plugin had framed the path or the selected change, and a released mode did not reframe for the normal view's layers. Now the camera returns to the overview unless the user moved it in the meantime (the core tracks whether a plugin framed it). Releasing a mode does this for every mode; overlays call `ctx.releaseCamera()`.
- **Type declarations work with older TypeScript and `@types/three`.** 0.1.0's `.d.ts` had `Scene<import("three").Object3DEventMap>`, `Group<…>` (`Type 'Scene' is not generic` with `@types/three` < 0.184 and `skipLibCheck: false`) and `Float32Array<ArrayBuffer>` (needs TypeScript ≥ 5.7). They are annotated without type arguments now, and `check:pack` rejects both patterns in `dist/**/*.d.ts`.
- **No React 18 server-rendering warning.** `<StrataCanvas>` used `useLayoutEffect`, which React 18 warns about in `renderToString`; it uses `useEffect` on the server now.
- **Public type declarations are in English.** JSDoc on everything exported from `kgstrata`, `kgstrata/headless`, `kgstrata/path`, `kgstrata/diff` and `kgstrata/react*` was Chinese, so editor hovers did not match the English docs. `check:pack` rejects Han characters in the public `.d.ts` files. (`kgstrata/internals` and implementation comments stay Chinese.)

### Documented

- Rolled-up relations do not carry `attrs` (see docs/data.md).
- `theme.background` is the clear colour and the base of the `backdrop` gradient drawn over it.

### Internal

- `src/engine.ts` is split into `src/engine/`: `Strata` (`index.ts`) only orchestrates; the hero state machine (`hero.ts`, pure), hidden layers and proportions (`layers.ts`), expanding and model rebuilds (`expansion.ts`), camera shots (`shots.ts`), pointer (`pointer.ts`), view state (`view.ts`), the plugin host and frame pipeline (`plugins.ts`) and the frame loop (`loop.ts`) are separate modules, with unit tests for the pure parts. Behaviour is unchanged (checked against recorded snapshots). Augmenting `StrataView` with `declare module 'kgstrata'` works as before.

### Migrating from 0.1

| 0.1 | 0.2 |
|---|---|
| `strata.shot('layer', 1)` | `strata.shot('layer', { layer: 'table' })` |
| `info.layer` (name) | `info.layerName`; `info.layer` is now the id |
| `info.group` (name) | `info.groupName`; `info.group` is now `"grouping/group"` |
| `strata.on('select', (info) => info?.id)` | `strata.on('select', ({ node, source }) => node?.id)` |
| `select(id)` was silent | `select(id)` emits `select` (`source: 'api'`) and follows the hero |
| `layoutStrata(data, { primary: 'onto' })` | `layoutStrata(data, { anchor: 'onto' })` |
| `layout.primary` | `layout.anchor` |
| `model.renderer.primary` | `model.renderer.anchor` |
| `import type { Model, StrataRenderer, RendererBase } from 'kgstrata'` | `import type { … } from 'kgstrata/internals'` (not semver-stable) |
| `strata.renderer` | `ctx.renderer` inside a plugin |
| `diff.setView({ layer: 'after' })` | `diff.update({ layer: 'after' })` |
| `diff.selectHunk(h.index)`, `selectHunk(-1)` | `diff.selectHunk(h.id)`, `selectHunk(null)` |
| `diff.shot(i)` | `diff.shot(h.id)` |
| `DiffView.selectedHunk: number` (`-1`) | `string \| null` |
| `DiffView.hoveredNode` / `selectedNode` / `reducedMotion` / `emphasis` | internal (`DiffFrameState`) |
| `hunk.nodes` / `hunk.context` (indexes) | node ids |
| `hunk.layer` (index) | layer id |
| `hunk.index` | removed; use `hunk.id` |
| `changesByLayer(diff, strata.layers)` | `changesByLayer(diff)` |
| `familyColors()` (always dark) | `familyColors(strata.theme)` |
| `setData` with `version !== 2` drew an empty view | returns the `version` error, draws nothing, keeps the old data |
| `theme.root`, `theme.label.muted`, `theme.plate.dot` | removed |
| `Locale = 'en' \| 'zh-CN'` | `string`; add languages with `registerLocale` |
| change `locale` / `theme` by re-creating the instance | `strata.setLocale()`, `strata.setTheme()` |
| `<StrataCanvas style={{ position: 'absolute', inset: 0 }}>` inside a positioned wrapper | `<StrataCanvas>` is its own positioned container; style it directly |
| `<LayerList counts={countTopLevel(data)} />` | `<LayerList />` (uses `LayerInfo.count`) |
| tooltip "{n} fields" for every node | "{n} inside", or the node type's `childNoun` |
| `strata.on('focus', …)` to learn which layer was clicked with several layers | `strata.on('hero', ({ id }) => …)`; `focus` only fires with one layer |
| `if (!strata.setLayerVisible(id, false)) …` | `if (strata.setLayerVisible(id, false)?.visible !== false) …` |
| `strata.setHero(id)`, `strata.setHeroMix(mix)` returned nothing | they return `HeroInfo`; `setHeroMix(mix).mix` is what applied (hidden layers 0) |
| `ctx.followTo(layerIndex)` | `ctx.followTo(layerId)` |
| `ctx.fit(points, opts)` | `ctx.fit(nodeIds, opts)`, or `ctx.fitPoints(points, opts)` |
| `path.reached` | `path.progress.reached` |
| `createTheme({ fogNear: 70, fogFar: 190 })` | `createTheme({ fog: { near: 12, far: 125 } })` (behind the camera target) |
| `setTheme({ background: '#fff' })` kept the dark backdrop | the backdrop follows; pass `backdrop` to keep your own |
| `import type { Looks, NodeLook, EdgeLook, BaseNode } from 'kgstrata'` (or `kgstrata/headless`) | `import type { … } from 'kgstrata/internals'` |
| `select` with `node: null` and `source: 'pointer'` meant "clicked empty space" | check `pointer.hit === null` (`node: null` also follows clicking the selected node again) |
| `strata.shot('layer', 'table', 0)` | `strata.shot('layer', { layer: 'table', duration: 0 })` |
| `path.shot()`, `diff.shot(id)` (no duration) | `path.shot({ duration })`, `diff.shot(id, { duration })` (both optional) |
| `new Strata(host, { followHero: true })` | `new Strata(host, { follow: true })` |
| `strata.setFollowHero(on)` | `strata.setFollow(on)` (returns `HeroInfo`) |
| `strata.heroInfo` | `strata.hero` |
| `strata.getView().hero`, `setView({ hero: mix })` | `strata.view.heroMix`, `setView({ heroMix: mix })` |
| `strata.on('hover', (h) => h?.x)` | `strata.on('hover', (h) => h?.pointer.x)` |
| `path.live` | `path.progress` |
| `<PathList live={…} />` | `<PathList progress={…} />` |
| `ctx.emit('hover', null)` in a plugin | removed; the core emits core events (taking over / releasing already emit `hover(null)`); use your own `Emitter` |
| `strata.setInset(320)` | `strata.setInset({ right: 320 })` |
| `strata.getView()` | `strata.view` |
| `strata.getView().selected` / `.focus` / `.group` | `strata.selected` / `strata.focus` / `strata.group` |
| `strata.on('expand', …)`, `<StrataCanvas onExpand={…}>` | `strata.on('expanded', …)`, `<StrataCanvas onExpanded={…}>` |
| `npm install @kgdiff/core @kgdiff/layout @kgdiff/scene` | also `@kgdiff/compute` (required with pnpm) |

## [0.1.0] - 2026-11-18

First public version.

### Layered 3D view (`kgstrata`)

- `Strata` draws several graphs as stacked planes: relations inside a layer stay in its plane, mappings between layers run vertically.
- Layers are aligned by correspondence blocks (one-one, one-many, many-one, many-many) built from primary mappings (`primary`, then `weight`). Deterministic layout; the anchor layer can be chosen with `anchor`.
- Mapping lines are classified as primary, inner (same block) and outer (between blocks).
- Any number of layers. Sizes, brightness and spacing follow fixed proportion rules with an aspect budget.

### Hero and supporting layers

- One layer is the hero (full size), the others shrink and dim: `hero` option, `setHero`, `secondaryScale`.
- Continuous weights per layer: `heroMix` option, `setHeroMix`.
- The hero can follow the selection, the path and the selected change: `followHero`, `setFollowHero`.
- Stack view (`shot('top')`): layers pressed together and seen from above.

### Hidden layers and bridges

- `hidden` option and `setLayerVisible`. Remaining layers keep their positions; proportions are recomputed; the last visible layer cannot be hidden.
- Mappings through hidden layers are drawn as dashed bridge lines, weighted by the number of intermediate nodes (`bridgesOf`).

### Containment and expanding

- `parent` on nodes (tables contain fields). Children are folded by default; their relations roll up to the nearest drawn ancestor, merged by type with weights added.
- Expand and collapse with double-click, `expand`, `setExpanded` or the `expanded` option. Top-level positions do not move. (The expanded look is a first version.)

### Interaction, view state and events

- Hover lights neighbours and the same correspondence block; click selects; `highlightGroup`, `focusLayer`, `setSpread`, `setInset`, camera shots `overview` / `top` / `layer`.
- `getView()` / `setView()` save and restore the whole view by id, including plugin slots.
- Events: `hover`, `select`, `tick`, `focus`, `hero`, `layers`, `expand`, `contextlost`, `contextrestored`.
- WebGL context loss and restore are handled. `new Strata` throws `StrataError('webgl-unavailable')` without WebGL. `dispose()` is idempotent.

### Data contract and validation

- `StrataData` version 2: flat lists of layers, nodes, relations and grouping dimensions; one relation type; `type` + `nodeStyles` for shapes.
- `validate` reports issues with stable codes; `setData` drops broken items, draws the rest and returns the issues.

### Plugins

- Plugin contract: `StrataPlugin`, `StrataContext`, overlays, modes, a fixed per-frame pipeline, view slots (`registerView`). Installed with `strata.use()`.
- Path replay, `kgstrata/path`: `pathPlugin()` lights a sequence of nodes step by step, skips hidden layers, frames the path, registers `path` in the view state.
- Version comparison, `kgstrata/diff`: `diffPlugin()` computes semantic changes with [kgdiff](https://github.com/iiwish/kgdiff) (added, removed, renamed, merged, re-mapped, re-pointed) and draws them on the union of both versions, with replay. kgdiff is an optional peer dependency needed only for this entry. `familyColors()` for custom panels.

### React (`kgstrata/react`)

- `<StrataCanvas>` (create, update data, dispose; fallback without WebGL), `StrataProvider`, `useStrata`, `usePlugin`, `useStrataEvent`, `useStrataState`.
- Panels `LayerList`, `FollowToggle`, `HeroMixSlider`, `SpreadSlider`, `ViewButtons`, `NodeTip`; `PathList` in `kgstrata/react/path`; `DiffPanel` in `kgstrata/react/diff`.
- Optional stylesheet `kgstrata/react/styles.css` with `--kgs-*` CSS variables.

### Language and theme

- `locale` option (`'en'`, `'zh-CN'`) for issue messages, errors, kgdiff descriptions and panel text. Codes never change with the language.
- `theme` option: per-instance overrides on the dark theme `DARK` via `createTheme`.

### Headless (`kgstrata/headless`)

- `validate`, `normalize`, `project`, `resolve`, `layoutStrata`, `placeChildren`, `unionData`, `stageOf`, `bridgesOf` and all contract types, without three.js or kgdiff. Runs in Node and Workers.

### Packaging

- Seven ESM entry points with per-file type declarations; `three`, `d3-force`, `@kgdiff/*` and `react` are not bundled. `pnpm check:pack` checks the build output, module boundaries and package contents.
- Type declarations resolve under both `moduleResolution: "bundler"` and `"NodeNext"` (relative imports carry `.js`); `check:pack` type-checks the package both ways.
- Documentation in English and Simplified Chinese, and four runnable examples (`examples/`).

[Unreleased]: https://github.com/iiwish/kgstrata/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/iiwish/kgstrata/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/iiwish/kgstrata/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/iiwish/kgstrata/releases/tag/v0.1.0
