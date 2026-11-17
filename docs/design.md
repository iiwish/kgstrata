# kgstrata design

[简体中文](design.zh-CN.md)

This page records the design rules behind kgstrata: what it is meant to answer, how layers are aligned, the data contract decisions, the core/plugin split, composition, proportions, hidden layers and the visual rules. Read it before changing how things look.

> Two graphs and a mapping: the ontology layer and the physical layer are each a graph, and between them is where each concept lands in the tables. Each graph gets a plane; the mapping runs in the third direction.

## The three questions

1. **Do they line up?** Which tables each concept lands on, which concepts land nowhere, which tables nobody claims.
2. **Is the structure consistent?** Can a relation in the ontology be walked in the physical layer? Does a foreign key in the physical layer have a matching relation in the ontology?
3. **How do I follow it?** Which join path corresponds to a path in the ontology; which concepts are affected when a table changes.

The current version answers the first. The second can only be checked by eye with the "stack" view; the third has a simple path replay.

## Core idea: vertical alignment

The two layers are not laid out independently. The ontology (the anchor layer, force-directed with one sector per domain) is placed first; each table lands below the concepts it maps to. Mappings are many-to-many, so the unit of alignment is a **correspondence block**:

- Each concept picks its heaviest mapping as primary (ties: the one whose other end has fewer mappings, then by id). Tables not picked yet pick one each.
- Nodes joined by primary mappings form a block. A one-to-one table sits right below its concept; one-to-many tables spread around that point; a many-to-one table sits below the centre of its concepts.
- Tables without mappings go to the outer ring, towards their foreign-key neighbours. Concepts without mappings stay where they are (their position in the ontology is information) with no line below.
- Foreign keys between tables do not influence positions. That way a relation in the ontology and the foreign key that implements it end up on top of each other and can be compared in the stack view.

Mapping lines come in three kinds: primary (nearly vertical), other mappings inside a block, and mappings between blocks (fine dashes).

## Data contract

The input is four flat lists: layers, nodes, relations, groupings (`StrataData` in `types.ts`, version 2). Decisions:

- **One kind of relation.** Whether it is inside a layer or across layers depends on where its ends are. Every relation has an id, so it can be selected, annotated, compared, and later carry a gap status.
- **`parent` means containment.** Children are folded into their parent by default; relations on a child roll up to the nearest drawn ancestor, merged by type with weights added. "Mapping weight = number of fields that line up" does not have to be filled in by hand: write the field-level mappings and it follows.
- **Normalizing and rolling up are two steps** (`resolve.ts`). `normalize` only checks and fills defaults and drops nothing: fields and field-level relations stay. `project(data, expanded)` produces the graph to draw. Expanding and collapsing just call `project` with a different set; the layout is computed for the fully collapsed graph and expanded children are added around their parents (`placeChildren`), so expanding never reshuffles the picture.
- **Semantics and presentation are separate.** Nodes carry a `type`; shape and monospace come from `nodeStyles` per type. Group colours are optional overrides; by default they come from the theme palette. Comparison-only facts ("what absorbed what") are not stored on nodes; they are a parameter of `diff.show`.
- **Groupings have dimensions**, and each layer uses its own. Sectors are only assigned to the groups of the anchor layer's dimension.
- **Every layer is a graph.** Earlier versions had tree, drop-point and outer-ring layouts. The core problem did not need them and they were removed; containment is expressed with `parent` everywhere.
- **Check before use** (`resolve.ts`). `validate` lists problems, `normalize` drops unusable items. Layout, styling and comparison only consume the output of `project` (`Resolved`), where every reference is valid and every relation has an id.
- **The public API speaks ids, not indexes.** The view state (hero weights, hidden layers, expanded nodes, selection, emphasized group, focused layer, spacing, camera, plus slots registered by plugins such as the path) is read and restored as a whole with `getView` / `setView`.
- **Extra lines in each frame's `Looks` have their own lists.** `edges` matches the base edges one to one; bridges, path segments and kgdiff marks live in `extra.bridges` / `extra.path` / `extra.marks` instead of depending on positions in one array.

### What goes to kgdiff

`diff/adapter.ts` translates `Resolved` into a kgdiff graph. The rule: lose nothing, and do not borrow another field's meaning.

- A node's `type` is its own type; its layer and group are attributes (`strata.layer` / `strata.group`).
- Relations carry their id (identity is by id) and attributes; the weight goes into `strata.weight`. A changed mapping weight or changed filter both count as changes.
- Children folded into a node are recorded as the attribute `strata.folds`. While collapsed, adding or removing a field shows up as "this table's attributes changed" and "the rolled-up mapping weight changed"; expanded, you see the fields themselves.
- Containment is a hierarchy edge with predicate `strata:parent`. Everything kgstrata adds is prefixed with `strata`, so it cannot clash with your relation types or attributes.

Things that need changes on the kgdiff side before they can go: the layout result is assembled by hand (`as unknown as LayoutResult`); merge arrows and removed-edge ghosts only have plane coordinates, so their layer height is borrowed from the nearest node, and since vertically aligned nodes share plane coordinates it can pick the wrong layer; colours are CSS strings that have to be parsed.

## Core and plugins

The core `Strata` only draws a layered graph: data (normalize / project), layout, model, hero and supporting layers, hidden layers and bridges, expanding nodes, hover and selection, emphasized group, focused layer, camera, the frame loop, events and view state. Path replay and version comparison are plugins (`strata.use(plugin)`); the core does not know about them. This keeps kgdiff and its WebAssembly away from people who only want the 3D view.

**Plugin contract** (`plugin.ts`): a plugin is `{ name, install(ctx): Api }`, and `use()` returns `Api` unchanged. `ctx` is the full list of what the core shares; private state stays private:

- read: the normal model, the current model, who has taken over, renderer, time, reduced motion, hidden layers, expanded nodes, id → index;
- use the core's rules: normalize with the instance options (`normalize`), lay out with them (`layoutOf`);
- change: take over (`takeOver`) and release (`release`), rebuild the normal view for the current expanded set (`rebuild`), follow (`followTo`, optionally with a "reframe if the hero changed" callback), release focus, select, frame points on the plates (`fit`);
- hooks: overlays (`overlay`), every frame (`onFrame`), state changes (`onChange`: new data, normal view rebuilt, hidden layers changed, a mode took over), expand (`onExpand`: return true to handle it), dispose, view state slots (`registerView`), core events.

**Overlays and modes.** An overlay adds to the normal view. Path replay gives the styler a sequence of nodes to emphasize (`Spotlight`; the styler dims the rest, which has to be combined in order with focus and hero dimming, so it happens in the styler), then writes step numbers, `extra.path` segments and ripples into `Looks` itself. A mode takes over what is drawn. Version comparison swaps in the union of both versions as the base and gets `Looks` from kgdiff; its "quiet background" rule (unchanged nodes lose their labels, unchanged edges dim) is applied in the same step. At most one mode is active at a time; when it takes over, hero weights are carried over by layer id and hidden layers stay hidden. Expanding a node during a comparison is handled by the plugin, which compares again.

**One pipeline per frame** (`pipeline.ts`): ① base style (the core styler, or the active mode) → ② overlays (only without a mode) → ③ core post-processing (hidden layers fade out, for the normal view and modes alike). Each writer owns its part: the styler does not know about paths, the core does not know about kgdiff's quiet rule.

**View state and camera.** `getView` / `setView` cover the core fields; a plugin registers its own slot with `registerView` and it is saved and restored together (the path plugin registers `path`; without the plugin the field does not exist; its type is added to `StrataView` with `declare module`). The core camera shots are `overview` / `top` / `layer`; framing a path or a change belongs to the plugins via `ctx.fit`. Events follow the same rule: core events are fixed, plugin events live on the plugin API.

## Language, theme and per-instance state

- **Every human-readable string goes through the message table** (`locale.ts`): validation messages, errors, display labels given to kgdiff ("related to", "part of"). Machine-readable things stay out: issue and error `code`s, predicates (`strata:parent`). The default is English; `StrataOptions.locale` / `validate(data, { locale })` switch it; the comparison plugin follows the core unless told otherwise. The table is plain data with no three.js, so the headless entry uses it too.
- **Themes are per instance** (`theme.ts`): `DARK` is the frozen default and `createTheme(overrides)` returns a new object every time. The theme travels down from the engine: model (dot grid colour), styler, every part of the renderer (background, plates, label fonts and outlines), path, comparison (kgdiff's colour scheme). Pure functions take it from options: `normalize` defaults to `DARK.palette`.
- **No mutable module-level state.** Fog uniforms belong to one renderer, and materials reference their own copy. What remains at module level is pure caches (hex → RGB, kgdiff colour parsing) and constant tables.
- **Context loss**: the loop stops and `contextlost` is emitted; when the context comes back three.js rebuilds GL state and re-uploads resources on demand, the renderer restores what three.js does not handle (clear colour, size and post-processing targets, canvas textures), the loop resumes and `contextrestored` is emitted.

## Composition: one hero, one supporting layer

The two graphs matter equally, but they are not shown as equals at the same time. Two plates of the same size split the picture in half: no focal point, twice the information, no hierarchy. That is why earlier versions never looked right however the styling was tuned.

- **The hero layer fills the view** at full size and brightness, with all its labels. By default it is the ontology.
- **Other layers support it**: the layer next to the hero is drawn at 0.56 of the hero's size, one step darker, with only the main labels; layers further away are smaller and darker. With the ontology as hero, the tables show below it; with the tables as hero, the ontology sits smaller above.
- **Which layer is the hero is a parameter**: `new Strata(host, { hero: 'layer id' })`; at runtime `setHero('layer id')` and the `hero` event. Positions and correspondences do not change, only sizes. The size of the next layer is a parameter too (`secondaryScale`, default 0.56); further layers follow the rules below.
- **The hero is continuous**: each layer has a hero weight 0..1 (`setHeroMix({ layerId: weight })`). 1 is full size and brightness, 0 is a supporting layer; size, brightness and number of labels follow the weight. `setHero` sets one layer to 1 and the rest to 0. The heaviest layer is the hero. Two layers at 0.5 are the same size; that is a state you can stop in during a transition, but not the recommended default, since it is the composition without a focal point. Whether to give users a slider is up to the integrator; the demo's slider is only a demonstration.
- **The hero can follow what you ask about** (`followHero`, off by default): selecting a node, a path reaching a layer, or looking at a change makes that layer the hero. Only selection counts, not hover; switching on hover would flicker. After the user has moved the camera, a hero change only resizes and does not take the camera away; during path replay the camera belongs to the replay, and it reframes the whole path when the hero changes.
- Once the supporting layer is smaller, mapping lines are no longer vertical but form a cone. The alignment property still holds: matching mapping lines do not cross; crossing ones are the mismatches.
- The **stack** view makes all layers the same size, presses them together and looks from straight above.

## Proportions with several layers

There is no limit on the number of layers. Whatever the count, three rules set the proportions (`stage.ts`, pure, tested):

**1. Further from the hero is smaller and darker.** The hero is full size. The next layer is 0.56 of the hero, each further layer ×0.72 (0.40, 0.29, …, at least 0.24). Brightness likewise: 0.5, then ×0.8 per layer. The stack narrows towards both ends like a tower in perspective, and the hierarchy is obvious.

Sizes are **relative to the hero**, not to each layer itself. Layers differ in size (ten metrics make a smaller plate than thirty concepts). If each shrank its own plate to 0.56, a big layer in a supporting role could look as big as a small hero, and the hierarchy would be lost. So a supporting layer is drawn at the hero's radius × its factor; a layer that is small to begin with is not enlarged.

**2. Neighbouring layers overlap a little on screen.** The gap is not fixed; it follows the sum of the two scaled radii. Big layers are far apart, small ones close together. Supporting layers do not cover each other, and a stack of small layers does not get long.

**3. The stack has an aspect budget (at least 1.45 wide : 1 high).** When it fits, neighbours overlap less; when it does not, supporting layers tuck further behind the hero, down to a limit. The hero keeps most of the width of the view instead of the camera pulling far back to fit every layer.

| Layers (hero position) | Drawn sizes (hero = 1) | Tightness |
|---|---|---|
| 2 (top) | 1 / 0.56 | 0.84, loose |
| 3 (middle) | 0.56 / 1 / 0.56 | 0.63 |
| 3 (top) | 1 / 0.56 / 0.40 | 0.58 |
| 4 (third) | 0.40 / 0.56 / 1 / 0.56 | 0.5, at the limit |

When the weights change continuously (`setHeroMix`), each layer's size and brightness are interpolated between "supporting" and "full" by its weight, and the gaps are recomputed.

The camera frames with the real perspective projection (`CameraRig.frame`), not with a bounding sphere: for a stack that is big at one end and small at the other, a bounding sphere misjudges the distance.

**The layout anchor and the hero are different things.** The anchor is the graph the others are aligned to: by default the one with the most mappings to other graphs (with metrics / ontology / tables, the ontology), or set with `anchor`. If no hero is given, the hero is the anchor. Nodes in a middle layer belong to a block above and a block below; pointing at one shows both.

## Hidden layers

Layers can be hidden (`setLayerVisible`, the `hidden` option). A layer is either shown or hidden; there is no third state.

- **Positions do not move.** There is no re-layout; the remaining layers stay where they are.
- **Proportions are recomputed.** Hidden layers take no space and do not count when measuring distance from the hero. Hiding layers loosens a crowded stack.
- **Relations pass through** (`bridge.ts`). The layer's own relations and its mappings to neighbours are not drawn; between the two layers it separated, the two halves of each mapping are joined into a dashed line. Hide the ontology and each metric connects straight to the tables it finally lands on, weighted by the number of concepts on the way. Only cross-layer mappings are chained, never relations inside the hidden layer; chains only go downward and never come back to the same layer; several hidden layers in a row chain too. A node that reaches nothing below gets no bridge, so hiding the middle layer is an end-to-end gap check.
- **The hero steps aside.** A hidden hero hands over to the nearest visible layer. The last visible layer cannot be hidden.
- **Paths skip.** A path through a hidden layer skips those steps and draws a dashed segment across the gap.
- **Changes cannot be hidden silently.** While comparing versions no bridges are drawn (kgdiff owns the lines there); the number of changes in a hidden layer is shown by the UI (the demo puts it in the layer list).

## Visual rules

The visuals are checked against a reference image (a panorama screenshot of the prototype). Every change is compared side by side with it instead of being derived from rules. Everything in the reference sits in the middle: there is light, but small and faint; there is a ground, but in one colour; there is atmosphere, but at low amplitude. The detours were all extremes: adding every kind of glow was light pollution; removing all of it gave a wireframe; making all colours saturated and then all grey were both wrong.

| Element | How it is drawn |
|---|---|
| Ground | An even dot grid covering the plate: equally spaced square dots on concentric rings, one blue-violet colour, larger near the camera. No outline; the two outer rings are slightly brighter so the edge is made of dots. Underneath, a very faint wash of the domain colours |
| Nodes | A softly glowing bead: saturated domain colour, slightly brighter core, a small faint halo. Smaller than you would expect; the picture needs empty space |
| Relations in a layer | Thin arcs, taking each end node's colour and blending in the middle. Longer arcs rise higher, up to a limit |
| Mapping lines | Hairline straight lines, one step thinner and fainter than in-layer arcs |
| Labels | Clean white text, regular weight, larger near the camera. Long-tail labels are hidden by default |
| Background | Slightly brighter dark blue in the middle, darker towards the edges |

What to keep:

- **Empty space.** Small nodes and few labels let the lines breathe. A node is drawn at only about seventy percent of its layout radius.
- **Colour in areas.** Each domain occupies an area of the plate, so colour reads as a region rather than scattered dots; the dot grid and wash only echo the domain colour slightly.
- **Dot grid weight depends on on-screen density.** The same grid is ground when the plate fills the view and a blob when the plate is half the size. So the supporting layer's dots are smaller and darker.
- **Bloom belongs to answers.** At rest nothing exceeds brightness 1 (the bloom threshold). A hovered node gets a ring and a slightly brighter halo; its neighbours and the nodes in its correspondence block show up with it; everything else, dot grid included, steps back.
- **Mapping lines must stay thin.** They are long and numerous; slightly thicker and they become a fence.
- **No extra shapes for correspondence blocks.** Cone-shaped light beams were tried and were redundant. The block type is visible from the shape of the mapping lines.
- **Check visuals at real pixel size.** Line widths and brightness cannot be judged on a scaled-down screenshot.

## Other

- Both layers use the same drawing style and differ only in shape: concepts are round, relation concepts are diamonds, tables are dark plates with a bright edge.
- While comparing versions, colour = kgdiff's five change families, and the base turns grey. Hollow shapes are used only for "absent in this version".
- Text laid flat on the plates only shows when looking from above.
- Motion only explains: comets show direction, ripples show "something changed here". `prefers-reduced-motion` is respected.

## Next

1. Gap computation and a gap list: for each ontology relation, whether the physical layer connects it directly, in a few hops, or not at all; for each foreign key, whether there is a matching relation. Colour would then show consistency.
2. Paths side by side: the ontology path on top, the matching join path below, connected by mapping lines.
3. The look of expanded fields: today a small ring of dots around the table; with many fields it gets crowded and labels overlap. It needs its own design.

## React wrapper

`kgstrata/react` only connects the engine to React: `<StrataCanvas>` creates and disposes in an effect (each strict-mode mount gets its own instance), and calls `setData` only when the `data` reference changes; `useStrataState` turns `layers`, `heroInfo`, `expanded` and the focused layer into React state with `useSyncExternalStore`, keeping the same reference when nothing changed. Panels output only `kgs-` prefixed markup; their look is in the optional `styles.css`, their position is up to you. The boundaries hold: `react/index` and `react/path` do not import kgdiff; `react/diff` gets it through `kgstrata/diff`.

## Modules

| Module | Input → output |
|---|---|
| `resolve.ts` | `StrataData` → `Normalized` (nothing dropped) → `Resolved` (folded and rolled up for an expanded set) |
| `layout.ts` | `Resolved` → `StrataLayout` (positions, blocks, mapping classes; deterministic) |
| `styler.ts` | data + layout + interaction state + spotlight → `Looks` (rest, hover, focus, emphasis) |
| `pipeline.ts` | Per-frame pipeline: ① base style → ② overlays → ③ hidden-layer fade |
| `plugin.ts` | Plugin contract (`StrataPlugin`, `StrataContext`, `StrataOverlay`, `StrataMode`), events, view slots |
| `renderer/*` | `BaseNode[]` / `BaseEdge[]` + `Looks` → pixels (three.js, instanced) |
| `engine.ts` | Core `Strata`: ties the above together; camera, picking, events, hero, hidden layers, expanding, plugins |
| `path/` | Path replay plugin: steps → spotlight; numbers, segments and ripples painted after styling |
| `diff/` | Comparison plugin: two `Resolved` + layout → kgdiff scene; per frame → `Looks` (the only place that imports `@kgdiff/*`) |

Entry points: `index.ts` (core, without kgdiff or the two plugins), `path/index.ts`, `diff/index.ts`, `headless.ts` (no three.js, no kgdiff), and for React `react/index.ts`, `react/path.tsx`, `react/diff.tsx`. The contract is in `src/types.ts`. The engine does not depend on React; `demo/` is the demo page.
