// kgstrata 的契约：输入数据、布局结果、渲染器每帧要画的样子。
// 各模块只通过这里的类型互相说话：layout 产出 StrataLayout，styler / diff 产出 Looks，renderer 只画 Looks。

// ─── 输入数据（对外的契约） ──────────────────────────────────────────────────
//
// 四样东西，都是扁平的列表：层、节点、关系、分组。
// - 每一层都是一张图。关系只有一种：两端在同一层就是层内的关系，在不同层就是映射。它有 id，可以被选中、标注、对比。
// - 节点可以有 parent：表示“包含”（表包含字段，本体包含属性）。子节点平时收在父节点里，
//   连到子节点上的关系上卷到父节点（字段级的映射上卷成表级的映射，分量相加）；展开父节点时子节点才画出来。
// - 数据只说“是什么”（type、分组），不说“画成什么样”：形状、等宽字、颜色由样式和主题决定，数据里的颜色只是覆盖。

/** Extra information: any JSON value (the same as kgdiff's `Attrs`). */
export type AttrValue = string | number | boolean | null | readonly AttrValue[] | { readonly [key: string]: AttrValue }
export type Attrs = { readonly [key: string]: AttrValue }

export interface LayerSpec {
  id: string
  name: string
  /** The grouping (id in `groupings`) this layer is coloured and divided by. Default: the first one. */
  grouping?: string
}

export interface NodeSpec {
  /** Unique across all layers. `validate` checks it. */
  id: string
  /** Layer id. */
  layer: string
  label: string
  /** What it is (entity, table, field…). Its shape comes from `nodeStyles` by type. */
  type?: string
  /** The node that contains it (same layer); for example a table containing a field. Children are folded by default. */
  parent?: string
  /** Groups: grouping id → group id (a table grouped by domain and by database has two entries). */
  groups?: Record<string, string>
  /** Importance 0..1; default from the number of connections. */
  weight?: number
  attrs?: Attrs
}

export interface RelationSpec {
  /** Default: generated as `source|type|target`. Give one when the same two nodes have several relations of the same type. */
  id?: string
  source: string
  target: string
  /** Relation type (invests, foreign key, implemented by…). Comparing two versions matches relations by it. */
  type?: string
  /** Display text; default `type`. */
  label?: string
  /** Weight, default 1. For mappings it says how well they match; the mapping with the largest weight is a node's primary mapping. */
  weight?: number
  /** Marks it as the primary mapping (only meaningful between layers); takes precedence over weight. */
  primary?: boolean
  /** Other information: conditions, join keys… */
  attrs?: Attrs
}

export interface GroupSpec {
  id: string
  name: string
  /** Colour override (`#rrggbb`). Default: taken in order from the theme's palette. */
  color?: string
}

/** A grouping dimension: domain, database… */
export interface GroupingSpec {
  id: string
  name?: string
  groups: GroupSpec[]
}

export interface StrataData {
  /** Contract version, currently 2. */
  version: 2
  title?: string
  /** Top to bottom. */
  layers: LayerSpec[]
  nodes: NodeSpec[]
  relations: RelationSpec[]
  groupings?: GroupingSpec[]
}

/** How a node type is drawn. Data carries no styling; it is configured here. */
export interface NodeStyle {
  shape?: NodeShape
  /** Monospace label (table and field names). */
  mono?: boolean
  /** What its folded children are called ("fields" in "22 fields"): one word, or per language (`{ en: 'fields', fr: 'champs' }`, looked up along the fallback chain). Default: the neutral "N inside". */
  childNoun?: string | Readonly<Partial<Record<string, string>>>
}

/** A shape says what a node is, not what changed (kgdiff's rule: hollow only means absent in this version). */
export type NodeShape = 'bead' | 'octa' | 'tablet' | 'prism' | 'page'

/** An issue found by `validate`. */
export interface DataIssue {
  level: 'error' | 'warning'
  /** Machine-readable kind: `duplicate-node`, `unknown-layer`, `dangling-relation`… */
  code: string
  message: string
  /** Id of the item with the issue. */
  id?: string
}

// ─── 整理过的数据（内部用） ──────────────────────────────────────────────────
// 两步：
// 1. normalize()：把输入查过一遍、补齐缺省，什么都不丢——所有的节点（包括收在里面的字段）、所有的关系都在。
// 2. project()：按“现在展开了哪些节点”生成要画的那张图（Resolved）：没展开的子节点收进祖先，
//    连到它们身上的关系上卷。布局、样式、对比都吃 Resolved；到了这里，引用都是有效的，id 都是全的。

export interface ResolvedGroup {
  /** Unique: `"grouping/group"`. */
  id: string
  name: string
  /** Colour on the dark theme, `#rrggbb`. */
  color: string
  /** The grouping it belongs to. */
  grouping?: string
}

export interface ResolvedNode {
  id: string
  label: string
  /** Its group in its layer's grouping (`ResolvedGroup.id`). */
  group?: string
  type?: string
  shape?: NodeShape
  mono?: boolean
  /** The node containing it (same layer). In `Resolved` only expanded children have it; top-level nodes do not. */
  parent?: string
  weight?: number
  attrs?: Attrs
  /** Descendants folded into it and not drawn (ids). Absent when there are none. */
  folds?: string[]
}

/** A normalized node: a `ResolvedNode` plus its layer. */
export interface NormalNode extends Omit<ResolvedNode, 'folds'> {
  /** Index in `layers`. */
  layer: number
}

/** A normalized relation: complete id, valid weight. */
export interface NormalRelation {
  id: string
  source: string
  target: string
  type?: string
  label?: string
  weight: number
  primary?: boolean
  attrs?: Attrs
}

/** The result of `normalize()`: nothing dropped except broken items. */
export interface Normalized {
  title?: string
  groups: ResolvedGroup[]
  /** Top to bottom. */
  layers: { id: string; name: string; grouping?: string }[]
  nodes: NormalNode[]
  relations: NormalRelation[]
}

/** A relation within a layer. */
export interface ResolvedEdge {
  id: string
  source: string
  target: string
  label?: string
  type?: string
  weight?: number
  attrs?: Attrs
  /** The relations rolled up into it (ids). Absent when nothing was rolled up. */
  members?: string[]
}

/** A relation between layers (a mapping). */
export interface ResolvedLink {
  id: string
  source: string
  target: string
  type?: string
  label?: string
  weight?: number
  primary?: boolean
  attrs?: Attrs
  /** The relations rolled up into this mapping (ids). Absent when nothing was rolled up. */
  members?: string[]
}

export interface ResolvedLayer {
  id: string
  name: string
  /** The grouping this layer uses. */
  grouping?: string
  nodes: ResolvedNode[]
  /** Edges within the layer (containment is `ResolvedNode.parent`, not listed here). */
  edges?: ResolvedEdge[]
}

export interface Resolved {
  title?: string
  groups: ResolvedGroup[]
  /** Top to bottom. */
  layers: ResolvedLayer[]
  links: ResolvedLink[]
  /** Folded child → the node it counts as now (its nearest drawn ancestor). */
  folded?: Record<string, string>
}

// ─── 布局结果 ────────────────────────────────────────────────────────────────

export interface PlacedNode {
  id: string
  layer: number
  /** Plate coordinates (world units); the plate centre is (0, 0). */
  x: number
  z: number
  /** Radius in world units. */
  r: number
  /** Index in `groups`; `-1` without a group. */
  group: number
  /** Nesting depth: 0 for top-level nodes, 1 for expanded children, 2 further in… */
  depth: number
  degree: number
  /** 0..1, connection-count percentile within the layer. */
  importance: number
  /** The mapping blocks it is in (indexes in `blocks`). Nodes of middle layers can be in a block above and one below; empty when in none. */
  blocks: number[]
}

/** The three kinds of mapping lines: `primary` (the mappings forming blocks, near vertical after alignment), `inner` (other mappings within a block), `outer` (secondary mappings between blocks). */
export type LinkClass = 'primary' | 'inner' | 'outer'

/** Cardinality of a block: anchor side count : aligned side count. */
export type BlockType = 'one-one' | 'one-many' | 'many-one' | 'many-many'

/** A mapping block: nodes connected by primary mappings, aligned as a whole. */
export interface MappingBlock {
  index: number
  type: BlockType
  /** The anchor side: nodes of the layer laid out first. */
  anchors: string[]
  /** The aligned side. */
  aligned: string[]
  /** Layer index of the anchor side. */
  anchorLayer: number
  alignedLayer: number
  /** Centroid of the anchor side (plate coordinates). */
  center: [number, number]
}

export interface GroupTerritory {
  index: number
  id: string
  /** Sector centre angle (radians, counter-clockwise from +x, (cos, sin) → (x, z)). */
  angle: number
  /** Sector span (radians). */
  span: number
  /** Centroid of this group's nodes on the anchor layer. */
  centroid: [number, number]
  /** Distance from the centroid to the furthest member. */
  spread: number
}

export interface StrataLayout {
  nodes: Map<string, PlacedNode>
  /** Plate radius per layer (by layer index); all plates are concentric. */
  radii: number[]
  groups: GroupTerritory[]
  /** Index of the anchor layer (`StrataOptions.anchor`); `-1` without layers. */
  anchor: number
  /** Mapping blocks. */
  blocks: MappingBlock[]
  /** Class of each mapping between layers: mapping id → class. */
  linkClass: Map<string, LinkClass>
}

export interface LayoutOptions {
  /** Radius of the anchor layer's plate; default 26. */
  radius?: number
  /** Layer id of the layout anchor: laid out by force simulation, the others aligned to it. Default: the layer with the most mappings (the first with exactly two layers). Same as `StrataOptions.anchor`. */
  anchor?: string
}

/** A `StrataLayout` as JSON (`layoutToJSON` / `layoutFromJSON`): the two maps become arrays. */
export interface StrataLayoutJSON {
  /** Format version, currently 1. */
  format: 1
  nodes: PlacedNode[]
  radii: number[]
  groups: GroupTerritory[]
  anchor: number
  blocks: MappingBlock[]
  /** `[mapping id, class]`. */
  linkClass: [string, LinkClass][]
}

// ─── 渲染器画的东西 ──────────────────────────────────────────────────────────

/** Renderer base: the fixed properties of nodes and edges. What changes is in `Looks`. */
export interface BaseNode {
  id: string
  layer: number
  shape: NodeShape
  /** Base radius in world units. */
  r: number
  group: number
  mono: boolean
  /** Magnitude 0..5, 0 brightest. Sets dot size and halo; does not change with interaction. */
  mag: number
}

/** `intra` within a layer; `contain` parent to expanded child; `cross` a mapping between layers. */
export type EdgeKind = 'intra' | 'contain' | 'cross'

export interface BaseEdge {
  /** Index of a `BaseNode`. */
  s: number
  t: number
  kind: EdgeKind
}

export interface LabelLook {
  text: string
  /** #rrggbb */
  color: string
  /** 0..1 */
  alpha: number
  /** Screen pixels. */
  size: number
  weight: 400 | 500 | 600
  strike: boolean
  /** Higher takes its place first (label collision avoidance). */
  priority: number
  mono?: boolean
}

export interface NodeLook {
  visible: boolean
  /** Plate coordinates; given every frame because nodes move during replay. */
  x: number
  z: number
  layer: number
  /** Lift above the plate (world units): negative rises from below (added), positive flies over (merged). */
  lift: number
  /** Factor on the base radius. */
  scale: number
  /** Core colour `#rrggbb`. */
  color: string
  /** Brightness factor: 1 normal, above 1 glows, below 1 dims. */
  intensity: number
  alpha: number
  /** Hollow and dashed (absent in this version: kgdiff's removal ghost). */
  ghost: boolean
  ring: { color: string; alpha: number } | null
  halo: { color: string; alpha: number; size: number } | null
  /** 0 = none; (0, 1) = progress of an expanding ripple. */
  pulse: number
  label: LabelLook | null
  /** The old name on a rename, struck through below the main label. */
  label2: LabelLook | null
  badge: string | null
  /** Step number in path replay; 0 = none. */
  step: number
}

export interface EdgeEnd {
  x: number
  z: number
  layer: number
  lift: number
}

export interface EdgeLook {
  visible: boolean
  a: EdgeEnd
  b: EdgeEnd
  /** Height of the quadratic Bézier control point above the midpoint (world units); 0 = straight. The arc's midpoint rises by `arc / 2`. */
  arc: number
  colorA: string
  colorB: string
  alpha: number
  /** Screen pixels. */
  width: number
  dash: boolean
  /** Drawn fraction from end a, 0..1 (grow / retract animation). */
  progress: number
  /** `progress` counts from end b. */
  fromTarget: boolean
  /** Comet strength 0..1; 0 = no flow. */
  flow: number
  /** Comet phase 0..1, for staggering. */
  phase: number
  /** Brightness factor; above 1 glows. */
  intensity: number
}

export interface ExtraEdges {
  bridges: EdgeLook[]
  path: EdgeLook[]
  marks: EdgeLook[]
}

export interface Looks {
  nodes: NodeLook[]
  /** One per `base.edges`. */
  edges: EdgeLook[]
  /** Lines not in the base, each owned by its writer: bridges, path segments, kgdiff marks (merge arrows, edge ghosts). */
  extra: ExtraEdges
  /** Group emphasis 0..1 by group index: plate territories and lights follow it. */
  groups: number[]
  /** 0 = territories coloured by group; 1 = all grey (while comparing). */
  neutral: number
  /** Layer emphasis 0..1 (other layers dim while one is focused). */
  layers: number[]
  /** Layer presence 0..1, default 1. Fades from 1 to 0 when a layer is hidden; its plate fades with it. */
  presence?: number[]
  /** Overall brightness of the dot grid 0..1, default 1; it steps back while something is hovered or a path plays. */
  ground?: number
  /** Plate ripples: plate coordinates, layer and progress 0..1. */
  ripples: { x: number; z: number; layer: number; p: number; color: string }[]
}
