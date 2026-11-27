# Headless use

[简体中文](headless.zh-CN.md)

This page shows how to use validation, layout and bridge computation from `kgstrata/headless` without rendering: in Node, in a Worker, or to feed your own renderer.

```ts
import { validate, resolve, layoutStrata, bridgesOf, stageOf } from 'kgstrata/headless'
```

`kgstrata/headless` does not import three.js or kgdiff and touches no browser globals. Its only runtime dependency is `d3-force`. Install just the package:

```sh
npm install kgstrata
```

`three` is declared as a peer dependency, so your package manager may install it anyway. Nothing reachable from `kgstrata/headless` imports it.

## What is in it

| Export | Purpose |
|---|---|
| `validate(data, { locale? })` | List of `DataIssue`. Never throws. See [data.md](data.md#validation). |
| `normalize(data, { nodeStyles?, palette?, locale? })` | `{ data: Normalized, issues }`. Drops broken items, fills defaults, keeps everything else (children and their relations included). |
| `project(normalized, expanded?)` | `Resolved`: the graph to draw for a set of expanded node ids. Folds children into ancestors and rolls up their relations. |
| `resolve(data, opts?)` | `normalize` + `project` with everything collapsed: `{ resolved, issues }`. |
| `relationId(relation)` | The id a relation gets when it has none: `source\|type\|target`. |
| `DEFAULT_NODE_STYLES` | Built-in `type` → shape table. |
| `layoutStrata(resolved, { radius?, anchor? })` | Deterministic layout: `StrataLayout`. Same input, same output. |
| `layoutToJSON(layout)`, `layoutFromJSON(json)` | Store a `StrataLayout` as JSON (its two `Map`s become arrays) and read it back. |
| `checkLayout(resolved, layout, locale?)` | Whether a layout can be used for this graph: `null`, or a `layout-incomplete` issue. |
| `isFatal(issue)` | `true` for an issue that makes the whole input unusable (wrong `version`). |
| `placeChildren(layout, resolved)` | Adds expanded children around their parents to a collapsed layout without moving anything else. |
| `unionData(a, b)` | Union of two `Resolved` graphs (used for version comparison). |
| `stageOf({ radii, mix, secondaryScale?, spread? })` | Per-layer scale, brightness and height for a hero weighting. |
| `scaleAt(d, secondaryScale?)`, `levelAt(d)` | Scale and brightness of a layer `d` steps from the hero. |
| `bridgesOf(layerOf, cross, hidden)` | Connections across hidden layers. |
| `auditMappings(data, opts?)` | Whether each relation of the upper layer can be walked through joins of the lower layer, whether each join is accounted for above, and which nodes have no mapping. See [Audit the mappings](#audit-the-mappings). |
| `DARK`, `createTheme`, `backdropOf`, `MESSAGES`, `message`, `localeOf`, `DEFAULT_LOCALE`, `StrataError` | Theme and language data. |
| the contract types | The input (`StrataData`, `LayerSpec`, `NodeSpec`, `RelationSpec`, `GroupingSpec`, `GroupSpec`, `NodeStyle`, `NodeShape`, `Attrs`, `AttrValue`, `DataIssue`) and what the functions above take and return (`Normalized`, `NormalNode`, `NormalRelation`, `Resolved`, `ResolvedLayer`, `ResolvedNode`, `ResolvedEdge`, `ResolvedLink`, `ResolvedGroup`, `StrataLayout`, `StrataLayoutJSON`, `LayoutOptions`, `PlacedNode`, `MappingBlock`, `BlockType`, `LinkClass`, `GroupTerritory`, and for the audit `AuditOptions`, `MappingAudit`, `RelationAudit`, `JoinAudit`, `JoinPath`). The per-frame render types (`Looks`, `NodeLook`, `EdgeLook`, `BaseNode`, …) are only in `kgstrata/internals`. |

## Validate in CI

```ts
// check-model.ts — run with tsx, or directly with a Node version that strips TypeScript types
import { readFileSync } from 'node:fs'
import { validate, type StrataData } from 'kgstrata/headless'

const data = JSON.parse(readFileSync('model.json', 'utf8')) as StrataData
const issues = validate(data)
for (const i of issues) console.log(`${i.level}\t${i.code}\t${i.id ?? ''}\t${i.message}`)
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
```

## Run the layout in Node

```ts
import { resolve, layoutStrata } from 'kgstrata/headless'

const { resolved, issues } = resolve(data)
const layout = layoutStrata(resolved, { radius: 26, anchor: 'onto' })

for (const [id, n] of layout.nodes) {
  // n.layer: layer index (0 = top); n.x, n.z: plate coordinates, plate centre at (0, 0); n.r: radius
  console.log(id, n.layer, n.x.toFixed(2), n.z.toFixed(2))
}
layout.radii      // plate radius per layer
layout.anchor     // index of the anchor layer
layout.blocks     // correspondence blocks: { type, anchors, aligned, center, … }
layout.linkClass  // mapping id → 'primary' | 'inner' | 'outer'
layout.groups     // sector per group of the anchor layer's grouping
```

`LayoutOptions`:

| Option | Default | Meaning |
|---|---|---|
| `radius` | `26` | Plate radius of the anchor layer, in world units. |
| `anchor` | layer with the most mappings | Anchor layer id (the `anchor` option of `Strata`). Called `primary` in 0.1. |

`Strata` itself uses `radius = 26 × max(1, √(n / 110))`, where `n` is the node count of the largest layer, so large graphs get larger plates. Pass the same value if you want identical coordinates; a `layout` provider receives exactly these options as `defaults`.

## Precompute the layout, hand it to `Strata`

The layout is deterministic but not free for thousands of nodes. Compute it once (in a Worker, on the server, at build time), store it, and inject it:

```ts
// on the server or at build time
import { resolve, layoutStrata, layoutToJSON } from 'kgstrata/headless'
const { resolved } = resolve(data)
const json = JSON.stringify(layoutToJSON(layoutStrata(resolved, { radius: 26, anchor: 'onto' })))

// in the browser
import { Strata } from 'kgstrata'
import { layoutFromJSON } from 'kgstrata/headless'
const cached = layoutFromJSON(JSON.parse(json))
const strata = new Strata(host, { anchor: 'onto', layout: () => cached })
strata.setData(data) // [] when the cached layout covers every node
```

The provider is called for the collapsed graph (and, with the diff plugin, for the union of two versions; return `null` there to let the engine compute it). If the layout misses a node or does not match the layers, `setData` returns a `layout-incomplete` warning and computes the layout itself. Expanded children are added on top with `placeChildren`. `layoutFromJSON` throws a `TypeError` when the JSON is not a layout written by `layoutToJSON` (format 1).

Verified in Node 24: the two-layer snippet below runs from the built package and prints a one-to-one block.

```ts
const data: StrataData = {
  version: 2,
  layers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  nodes: [{ id: 'x', layer: 'a', label: 'X' }, { id: 'y', layer: 'b', label: 'Y' }],
  relations: [{ source: 'x', target: 'y' }],
}

const layout = layoutStrata(resolve(data).resolved)
layout.blocks.map((b) => b.type) // ['one-one']
layout.linkClass                  // Map { 'x||y' => 'primary' }
```

## Draw it yourself

`Resolved` + `StrataLayout` are all you need for a 2D or server-side rendering. Each layer is a plate; place layer `i` at some vertical offset and draw:

```ts
import { resolve, layoutStrata, type StrataData } from 'kgstrata/headless'

/** Labels and colors come from the data: escape them before they go into markup */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function toSvg(data: StrataData, layerGap = 70): string {
  const { resolved } = resolve(data)
  const layout = layoutStrata(resolved)
  const R = Math.max(...layout.radii)
  // squash each plate vertically to fake a tilted view
  const at = (layer: number, x: number, z: number) => [x * 8 + R * 8, z * 3 + layer * layerGap + R * 3] as const
  const out: string[] = []
  for (const link of resolved.links) {
    const a = layout.nodes.get(link.source)!
    const b = layout.nodes.get(link.target)!
    const [x1, y1] = at(a.layer, a.x, a.z)
    const [x2, y2] = at(b.layer, b.x, b.z)
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8b96b4" stroke-width="0.5"/>`)
  }
  resolved.layers.forEach((layer, li) => {
    for (const node of layer.nodes) {
      const p = layout.nodes.get(node.id)!
      const [x, y] = at(li, p.x, p.z)
      const color = resolved.groups[p.group]?.color ?? '#aab6d6'
      out.push(`<circle cx="${x}" cy="${y}" r="3" fill="${esc(color)}"><title>${esc(node.label)}</title></circle>`)
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${R * 16} ${R * 6 + layerGap * resolved.layers.length}">${out.join('')}</svg>`
}
```

Labels, ids and colors are whatever the data says. Escape them, as `esc` does above, before you put them into SVG or HTML: an unescaped label such as `</title><script>…</script>` would run when the SVG is inlined into a page or opened on its own.

Expanded children: `project(normalize(data).data, ['tbl:company'])` gives the graph with that table open, and `placeChildren(collapsedLayout, projected)` adds the field positions to the collapsed layout.

## Audit the mappings

`auditMappings` answers the two questions of a two-layer model: for each relation of the ontology, which tables can you join to follow it; and for each foreign key, does the ontology say why it is there. It works on everything collapsed: mappings and foreign keys between fields count for their tables.

```ts
import { auditMappings } from 'kgstrata/headless'

const audit = auditMappings(data) // upper 'onto', lower 'table' (the adjacent pair with the most mappings)
for (const r of audit.relations) {
  if (r.status === 'joined') console.log(r.id, r.paths.map((p) => p.nodes.join(' → ')))
  else console.log(r.id, r.status) // 'unreachable' or 'unmapped'
}
const orphans = audit.joins.filter((j) => j.coverage === 'unused')
```

The rules:

- **Walkable.** An upper relation A–B is `joined` when some lower node A maps onto and some lower node B maps onto are connected by at most `maxHops` joins (default 3). Both on the same node is 0 joins. Joins are relations of the lower layer whose `type` is in `joinTypes` (default `['fk']`), in either direction. `unreachable`: both ends are mapped, no path is short enough. `unmapped`: an end maps onto nothing.
- **Only the shortest paths.** `paths` holds the paths with the fewest joins, at most `maxPaths` (default 3), heaviest mappings first (the weight is the mapping weight at each end). Longer paths are not added to fill up: once a short one exists, longer ones are mostly detours.
- **No unmapped bridges.** A path does not pass through a lower node that nothing above maps onto (a dimension table, a staging table): such tables join unrelated tables and would hide gaps. `throughUnmapped: true` allows it.
- **Join coverage**, for each join: `direct` when nodes mapped onto its two ends are related above (`direct` lists those relations); `via-path` when it is only walked by a reported path (`usedBy`); `unused` otherwise.
- `unmappedUpper` / `unmappedLower`: nodes with no mapping between the two layers.

`upper` and `lower` pick the layers (layer ids); giving one takes the adjacent layer for the other. Unknown or equal layers throw `StrataError('audit-layers')`. The result is plain JSON. Relation and join ids are those of `project(normalize(data))`, so a relation rolled up from fields has the id `source|type|target` of its tables. `maxHops` in the result records the limit used.

To see the gaps on the map, use the audit plugin ([`kgstrata/audit`](plugins.md#mapping-audit-kgstrataaudit)) and its list panel ([`<AuditPanel>`](react.md#auditpanel-kgstratareactaudit)).

## Bridges across hidden layers

`bridgesOf` answers "if layer X were hidden, what would connect to what?". With metrics → ontology → tables, hiding the ontology layer connects each metric to the tables it finally lands on. The weight is the number of distinct intermediate paths.

It works on indexes:

```ts
import { resolve, bridgesOf } from 'kgstrata/headless'

const { resolved } = resolve(data)
const ids: string[] = []
const layerOf: number[] = []
resolved.layers.forEach((l, li) => l.nodes.forEach((n) => (ids.push(n.id), layerOf.push(li))))
const index = new Map(ids.map((id, i) => [id, i]))
const cross = resolved.links.map((k): [number, number] => [index.get(k.source)!, index.get(k.target)!])

const ontology = resolved.layers.findIndex((l) => l.id === 'onto')
for (const b of bridgesOf(layerOf, cross, new Set([ontology]))) {
  console.log(`${ids[b.s]} → ${ids[b.t]} via ${b.weight} path(s)`)
}
```

Rules: only cross-layer mappings are chained (relations inside the hidden layer are not followed); chains always go downward, so they never come back to the same layer; several hidden layers in a row are chained too. A node above that reaches nothing below gets no bridge, which makes this an end-to-end gap check.

## Hero proportions

`stageOf` is the pure function behind the hero/supporting-layer sizes:

```ts
stageOf({ radii: [26, 20], mix: [1, 0] })
// { scales: [1, 0.728], levels: [1, 0.5], sides: [0, 1], heights: [9.35, -9.35], tightness: 0.84 }
```

`scales[1]` is 0.728, not 0.56, because sizes are relative to the hero's radius: the second plate is drawn at 0.56 × 26 = 14.56 world units, which is 0.728 of its own radius 20. See [design.md](design.md) for the rules.

## Limits

- An injected layout must be for the same data: positions are looked up by node id, layers by index.
- Indexes in `StrataLayout` (`layer`, `group`, `blocks`) refer to the `Resolved` you passed in, not to ids.
