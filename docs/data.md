# Data contract

[简体中文](data.zh-CN.md)

This page describes the `StrataData` object you pass to `setData`, how containment and roll-up work, every validation issue, and some modelling advice. The types live in `src/types.ts` and are exported from `kgstrata` and `kgstrata/headless`.

## Overview

Four flat lists: layers, nodes, relations, groupings.

```ts
import type { StrataData } from 'kgstrata'

const data: StrataData = {
  version: 2,
  title: 'Company model', // optional
  layers: [
    // top to bottom
    { id: 'onto', name: 'Ontology', grouping: 'domain' },
    { id: 'table', name: 'Tables', grouping: 'database' },
  ],
  groupings: [
    { id: 'domain', name: 'Domain', groups: [{ id: 'party', name: 'Parties' }, { id: 'equity', name: 'Equity', color: '#46d8a8' }] },
    { id: 'database', groups: [{ id: 'ods', name: 'ODS' }] },
  ],
  nodes: [
    { id: 'onto:investment', layer: 'onto', label: 'Investment', type: 'relation', groups: { domain: 'equity' } },
    { id: 'tbl:investment', layer: 'table', label: 'investment', type: 'table', groups: { domain: 'equity', database: 'ods' } },
    { id: 'tbl:investment.amount', layer: 'table', label: 'amount', type: 'field', parent: 'tbl:investment' },
  ],
  relations: [{ source: 'onto:investment', target: 'tbl:investment.amount', type: 'maps-to', attrs: { filter: 'amount > 0' } }],
}
```

Rules that hold everywhere:

- **Every layer is a graph.** A layer has only an id, a name and the grouping it uses. There is no per-layer layout mode.
- **There is one kind of relation.** If both ends are in the same layer it is a relation inside that layer. If they are in different layers it is a mapping between layers.
- **Data says what things are, not how they look.** Nodes carry a `type`; shapes come from the `nodeStyles` option. Group colours are optional overrides; by default they come from the theme palette.
- **The public API uses ids, never indexes.** `setHero('table')`, `select('onto:investment')`, `setLayerVisible('onto', false)`.

## `StrataData`

| Field | Type | Notes |
|---|---|---|
| `version` | `2` | Contract version. Anything else is reported as `version` (see below). |
| `title` | `string?` | Passed through. Used as the graph name when comparing versions. |
| `layers` | `LayerSpec[]` | Top to bottom. |
| `nodes` | `NodeSpec[]` | |
| `relations` | `RelationSpec[]` | |
| `groupings` | `GroupingSpec[]?` | Grouping dimensions (domain, database, …). |

### Layers: `LayerSpec`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique among layers. |
| `name` | `string` | Shown on the plate and in the layer list. |
| `grouping` | `string?` | Id of the grouping this layer is coloured and partitioned by. Defaults to the first grouping. |

There is no limit on the number of layers. Two is the core case (ontology over tables); a metrics layer above or a dashboard layer below works the same way. The engine picks one layer as the layout **anchor** (the one with the most mappings to other layers, or the `anchor` option); the other layers are aligned to it.

### Nodes: `NodeSpec`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique across **all** layers. |
| `layer` | `string` | Layer id. |
| `label` | `string` | Display name. |
| `type` | `string?` | What it is: `'relation'`, `'table'`, `'field'`, your own types. Picks the shape through `nodeStyles`. |
| `parent` | `string?` | Id of the node that contains this one, in the same layer. See [Containment](#containment-and-roll-up). |
| `groups` | `Record<string, string>?` | Grouping id → group id. A node can belong to a group in several dimensions. |
| `weight` | `number?` | Importance, 0..1. Overrides the default, which ranks nodes by degree within their layer. Values outside 0..1 are reported and clamped. |
| `attrs` | `Attrs?` | Any JSON value. Not drawn; compared by `kgstrata/diff`. |

Built-in styles for `type` (`DEFAULT_NODE_STYLES`):

| `type` | Shape | Monospace label | Children called |
|---|---|---|---|
| `relation` | `octa` (diamond) | no | — |
| `table` | `tablet` | yes | fields / 字段 |
| `field` | `tablet` | yes | — |
| `metric` | `prism` | no | — |
| `document` | `page` | no | — |
| anything else | `bead` (round) | no | — |

Add or override styles with the `nodeStyles` option. Shapes are `'bead' | 'octa' | 'tablet' | 'prism' | 'page'`. `childNoun` names what a node of that type contains, for the tooltip ("22 fields · double-click to expand"): a word, or a record by language looked up along the fallback chain. Without it the tooltip says "22 inside · double-click to expand".

```ts
new Strata(host, {
  nodeStyles: {
    board: { shape: 'page' },
    column: { shape: 'tablet', mono: true },
    entity: { childNoun: { en: 'attributes', 'zh-CN': '属性' } },
  },
})
```

### Relations: `RelationSpec`

| Field | Type | Notes |
|---|---|---|
| `id` | `string?` | Defaults to `` `${source}\|${type ?? ''}\|${target}` `` (`relationId()`). Give an explicit id when the same pair has several relations of the same type. |
| `source`, `target` | `string` | Node ids. |
| `type` | `string?` | `'fk'`, `'maps-to'`, … Relations are matched by `type` when rolled up and when comparing versions. |
| `label` | `string?` | Display text. Defaults to `type`. |
| `weight` | `number?` | Positive number, default 1. For a mapping it means "how much of this lines up", e.g. the number of fields. |
| `primary` | `boolean?` | Marks this mapping as the primary one for its nodes. Only meaningful across layers. Beats `weight`. |
| `attrs` | `Attrs?` | Anything else: filter conditions, join keys. Not drawn; compared by `kgstrata/diff`. |

### Groupings: `GroupingSpec` and `GroupSpec`

```ts
interface GroupingSpec { id: string; name?: string; groups: GroupSpec[] }
interface GroupSpec { id: string; name: string; color?: string /* #rrggbb */ }
```

- Each layer uses one grouping (`layer.grouping`, default: the first). A node's colour comes from its group in that grouping; nodes without a group get a neutral colour.
- The anchor layer is divided into sectors, one per group of its grouping. Nodes of the same group sit together, so a colour covers an area instead of being scattered.
- Group ids only need to be unique inside their grouping. Internally a group is `"<grouping>/<group>"`; `highlightGroup()` and `strata.group` accept and return that full form (a bare group id also works in `highlightGroup` when it is unambiguous).
- Groups without `color` take colours from `theme.palette` in order.

## Containment and roll-up

`parent` means "contains": a table contains its fields, a concept can contain its properties. Parent and child must be in the same layer.

- **Collapsed (default):** children are not drawn. Relations attached to a child are drawn on its nearest drawn ancestor. Several relations that end up between the same two drawn nodes with the same `type` are merged into one, and their weights are added. A relation whose two ends fold into the same node (two fields of one table) is not drawn.
- **Expanded:** `strata.expand(id)`, `setExpanded(ids)`, the `expanded` option, or a double-click. The children are drawn in a ring around the parent and their relations go back to them. Top-level nodes do not move.

So you can write mappings at field level and let the weight follow:

```ts
// three field-level mappings…
{ source: 'onto:investment', target: 'tbl:investment.company_id', type: 'maps-to' },
{ source: 'onto:investment', target: 'tbl:investment.person_id', type: 'maps-to' },
{ source: 'onto:investment', target: 'tbl:investment.amount', type: 'maps-to' },
// …are drawn as one table-level mapping onto:investment → tbl:investment with weight 3
// while tbl:investment is collapsed.
```

Details of a rolled-up relation:

- its id is `` `${drawnSource}|${type ?? ''}|${drawnTarget}` ``, and `members` lists the ids of the original relations;
- `primary` is set if any member was primary;
- `attrs` are **not** carried over: they belong to the individual relations, and merging them would be guesswork. The rolled-up relation has no `attrs`; read the originals through `members` (in `normalize(data).data.relations`), or expand the node to draw them. Version comparison of a collapsed table therefore reports changed `attrs` only once the table is expanded.

## Weight and the primary mapping

Mappings are many-to-many, so layers are aligned by **correspondence blocks**, not by single nodes:

1. Each node on the anchor side picks one mapping as primary: a mapping with `primary: true` first, then the largest `weight`, then the one whose other end has fewer mappings, then by id.
2. Nodes on the aligned side that were not picked yet pick one the same way.
3. Nodes joined by primary mappings form a block. A block is `one-one`, `one-many`, `many-one` or `many-many`. One-to-one tables sit straight below their concept; one-to-many tables spread around that point; many-to-one tables sit below the centre of their concepts.

Mapping lines come in three classes: `primary`, `inner` (other mappings inside the same block) and `outer` (between blocks, drawn as fine dashed lines). `layoutStrata()` returns them as `blocks` and `linkClass`. Tables with no mapping go to the outer ring, towards their foreign-key neighbours. Concepts with no mapping stay where the ontology layout put them, with no line below.

Foreign keys between tables do not influence positions. That way a relation in the ontology and the foreign key that implements it end up on top of each other, which is what the "stack" view (`shot('top')`) relies on.

## Validation

`validate(data, { locale })` returns a list of `DataIssue`. It never throws. `setData` and `normalize` run it too and return the same list.

```ts
interface DataIssue {
  level: 'error' | 'warning'
  code: string     // stable; branch on this
  message: string  // human text, in the chosen locale
  id?: string      // the item at fault (node, relation, layer, grouping or group id)
}
```

`error` means something cannot be used: with an `id`, that item is dropped; without one (`version`), the whole input is unusable. `warning` means the item is used but is probably a mistake. The table lists exactly what `normalize` (and therefore `setData`) does with each case.

| `code` | Level | When | What happens |
|---|---|---|---|
| `version` | error | `version` is not `2`. | The whole input is unusable: `normalize` returns an empty graph and `setData` draws nothing, keeps the previous data and returns the issues. No `id` (`isFatal(issue)` is `true`). |
| `duplicate-grouping` | warning | Two groupings share an id. | The later one is ignored. |
| `duplicate-group` | warning | Two groups in one grouping share an id. | The later one is ignored. `id` is the group id. |
| `duplicate-layer` | error | Two layers share an id. | The later one is dropped. |
| `unknown-grouping` | warning | `layer.grouping` names a grouping that does not exist. | The layer uses the first grouping. |
| `duplicate-node` | error | Two nodes share an id (across all layers). | The later one is dropped. |
| `unknown-layer` | error | `node.layer` names a layer that does not exist. | The node is dropped. |
| `unknown-group` | warning | `node.groups` names a group that does not exist in that grouping. | The node has no group in that grouping. |
| `bad-weight` | warning | Node `weight` outside 0..1. | Kept; clamped to 0..1 by the layout. |
| `bad-weight` | warning | Relation `weight` is not a positive finite number. | Treated as 1. |
| `unknown-parent` | error | `node.parent` does not exist. | The node is kept, without a parent. |
| `parent-layer` | error | Node and parent are in different layers. | The node is kept, without a parent. |
| `parent-cycle` | error | Following `parent` comes back to the node. | Each node on the cycle is kept, without a parent. |
| `dangling-relation` | error | `source` or `target` is not a (kept) node. | The relation is dropped. |
| `duplicate-relation` | error | Two relations with the same explicit `id`. | The later one is dropped. |
| `duplicate-relation` | warning | Two relations without `id` get the same generated id. | The later one is dropped. Give them explicit ids. |
| `self-relation` | warning | `source === target`. | Kept in the data, never drawn. |

`bad-weight` and `duplicate-relation` each cover two cases; the `message` says which. Messages exist in English and Simplified Chinese; the `code` does not change with the locale.

```ts
import { validate } from 'kgstrata/headless'

const issues = validate(data, { locale: 'en' })
const errors = issues.filter((i) => i.level === 'error')
if (errors.some((i) => i.code === 'duplicate-node')) {
  /* … */
}
```

## Modelling advice

- **Prefix ids with the layer** (`onto:`, `tbl:`). Node ids must be unique across layers, and prefixes keep paths and view state readable.
- **Write mappings at the finest level you have.** Field-level mappings roll up into table-level weights for free, and they become visible when someone expands the table.
- **Use `weight` or `primary` when one mapping is clearly the main one.** Otherwise ties are broken by degree and id, which is stable but may not match what you mean.
- **Keep `type` semantic** (`'table'`, `'relation'`, `'metric'`) and map it to shapes with `nodeStyles`. Do not encode looks in the data.
- **Use a second grouping for the physical layer** if the domain split does not fit tables (for example by database or schema).
- **Put relation details in `attrs`** (join keys, filter conditions). They are not drawn, but version comparison reports changes to them.
- **Give relations explicit ids** when you plan to compare versions and the same pair can have several relations of one type. The comparison matches relations by id.
- **Run `validate` in CI** on generated data. It is in `kgstrata/headless` and runs in Node without three.js.
