# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/iiwish/kgstrata/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/iiwish/kgstrata/releases/tag/v0.1.0
