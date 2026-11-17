// kgstrata 的契约：输入数据、布局结果、渲染器每帧要画的样子。
// 各模块只通过这里的类型互相说话：layout 产出 StrataLayout，styler / diff 产出 Looks，renderer 只画 Looks。

// ─── 输入数据（对外的契约） ──────────────────────────────────────────────────
//
// 四样东西，都是扁平的列表：层、节点、关系、分组。
// - 每一层都是一张图。关系只有一种：两端在同一层就是层内的关系，在不同层就是映射。它有 id，可以被选中、标注、对比。
// - 节点可以有 parent：表示“包含”（表包含字段，本体包含属性）。子节点平时收在父节点里，
//   连到子节点上的关系上卷到父节点（字段级的映射上卷成表级的映射，分量相加）；展开父节点时子节点才画出来。
// - 数据只说“是什么”（type、分组），不说“画成什么样”：形状、等宽字、颜色由样式和主题决定，数据里的颜色只是覆盖。

/** 附带的信息：任何能写成 JSON 的值（和 kgdiff 的 Attrs 一样） */
export type AttrValue = string | number | boolean | null | readonly AttrValue[] | { readonly [key: string]: AttrValue }
export type Attrs = { readonly [key: string]: AttrValue }

export interface LayerSpec {
  id: string
  name: string
  /** 这一层按哪个分组维度着色、分疆域（groupings 的 id）。不写就用第一个维度 */
  grouping?: string
}

export interface NodeSpec {
  /** 全局唯一（跨层也不重复）。validate 会查 */
  id: string
  /** 在哪一层（层的 id） */
  layer: string
  label: string
  /** 它是什么（实体、关系本体、表、字段……）。画成什么形状由 nodeStyles 按 type 定 */
  type?: string
  /** 包含它的节点（同一层）。见上面的说明 */
  parent?: string
  /** 属于哪个组：分组维度的 id → 组的 id（比如表既按领域分、又按库分，就写两项） */
  groups?: Record<string, string>
  /** 重要度 0..1，缺省按连接数算 */
  weight?: number
  attrs?: Attrs
}

export interface RelationSpec {
  /** 不写就按“起点|类型|终点”生成。同一对节点之间有几条同类型的关系时要自己写 */
  id?: string
  source: string
  target: string
  /** 关系的类型（投资、外键、落地……）。对比两版时按它认是不是同一条关系 */
  type?: string
  /** 显示用的文字，缺省用 type */
  label?: string
  /** 分量，缺省 1。映射的分量是“对上了多少”；一个节点有多条映射时，分量最大的是主映射 */
  weight?: number
  /** 指定它是主映射（跨层的关系才有意义），优先于分量 */
  primary?: boolean
  /** 别的信息：口径条件、外键的 join 键…… */
  attrs?: Attrs
}

export interface GroupSpec {
  id: string
  name: string
  /** 颜色覆盖（#rrggbb）。不写就从主题的色板里按顺序取 */
  color?: string
}

/** 一个分组维度：领域、库…… */
export interface GroupingSpec {
  id: string
  name?: string
  groups: GroupSpec[]
}

export interface StrataData {
  /** 契约的版本，现在是 2 */
  version: 2
  title?: string
  /** 从上到下 */
  layers: LayerSpec[]
  nodes: NodeSpec[]
  relations: RelationSpec[]
  groupings?: GroupingSpec[]
}

/** 节点类型 → 画成什么样。数据不带样式，在这里配 */
export interface NodeStyle {
  shape?: NodeShape
  /** 名字用等宽字（表名、字段） */
  mono?: boolean
}

/** 形状说的是“这是什么”，不说“变了什么”（kgdiff 的规则：空心只表示这一版没有）。 */
export type NodeShape = 'bead' | 'octa' | 'tablet' | 'prism' | 'page'

/** validate 查出来的问题 */
export interface DataIssue {
  level: 'error' | 'warning'
  /** 机器可读的种类：duplicate-node、unknown-layer、dangling-relation…… */
  code: string
  message: string
  /** 出问题的那一项的 id */
  id?: string
}

// ─── 整理过的数据（内部用） ──────────────────────────────────────────────────
// 两步：
// 1. normalize()：把输入查过一遍、补齐缺省，什么都不丢——所有的节点（包括收在里面的字段）、所有的关系都在。
// 2. project()：按“现在展开了哪些节点”生成要画的那张图（Resolved）：没展开的子节点收进祖先，
//    连到它们身上的关系上卷。布局、样式、对比都吃 Resolved；到了这里，引用都是有效的，id 都是全的。

export interface ResolvedGroup {
  /** 全局唯一：“维度 id/组 id” */
  id: string
  name: string
  /** 深色主题下的颜色，#rrggbb */
  color: string
  /** 属于哪个分组维度 */
  grouping?: string
}

export interface ResolvedNode {
  id: string
  label: string
  /** 所在层的分组维度里它属于哪个组（ResolvedGroup 的 id） */
  group?: string
  type?: string
  shape?: NodeShape
  mono?: boolean
  /** 包含它的节点（同一层）。Resolved 里只有展开出来的子节点才带；顶层节点没有 */
  parent?: string
  weight?: number
  attrs?: Attrs
  /** 收在它里面、现在没画出来的子孙（id）。没有就不写 */
  folds?: string[]
}

/** 整理过的节点：比 ResolvedNode 多一个“在哪一层” */
export interface NormalNode extends Omit<ResolvedNode, 'folds'> {
  /** layers 的下标 */
  layer: number
}

/** 整理过的关系：id 是全的，分量是有效的 */
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

/** normalize() 的结果：什么都不丢的那一份 */
export interface Normalized {
  title?: string
  groups: ResolvedGroup[]
  /** 从上到下 */
  layers: { id: string; name: string; grouping?: string }[]
  nodes: NormalNode[]
  relations: NormalRelation[]
}

/** 同层的关系 */
export interface ResolvedEdge {
  id: string
  source: string
  target: string
  label?: string
  type?: string
  weight?: number
  attrs?: Attrs
  /** 由哪些关系上卷来的（关系的 id）。没有上卷就不写 */
  members?: string[]
}

/** 跨层的关系（映射） */
export interface ResolvedLink {
  id: string
  source: string
  target: string
  type?: string
  label?: string
  weight?: number
  primary?: boolean
  attrs?: Attrs
  /** 这条映射是由哪些关系上卷来的（关系的 id）。没有上卷就不写 */
  members?: string[]
}

export interface ResolvedLayer {
  id: string
  name: string
  /** 这一层用的分组维度 */
  grouping?: string
  nodes: ResolvedNode[]
  /** 同层的边（包含关系用 ResolvedNode.parent，不写在这里） */
  edges?: ResolvedEdge[]
}

export interface Resolved {
  title?: string
  groups: ResolvedGroup[]
  /** 从上到下 */
  layers: ResolvedLayer[]
  links: ResolvedLink[]
  /** 收起的子节点 → 它现在算在哪个节点头上（最近的画出来的祖先） */
  folded?: Record<string, string>
}

// ─── 布局结果 ────────────────────────────────────────────────────────────────

export interface PlacedNode {
  id: string
  layer: number
  /** 盘面坐标（世界单位），盘心在 (0, 0) */
  x: number
  z: number
  /** 世界单位的半径 */
  r: number
  /** groups 的下标，没有归属为 -1 */
  group: number
  /** 嵌套的深度：顶层节点 0，展开出来的子节点 1，再往里 2…… */
  depth: number
  degree: number
  /** 0..1，同层内按连接数分位 */
  importance: number
  /** 所在的对应块（blocks 的下标）。夹在中间的层的节点会同时在上、下两个块里；不在任何块里是空的 */
  blocks: number[]
}

/**
 * 映射线的三种：primary 主映射（成块用的那几条，对齐后近乎垂直）；inner 同一个块里的其余映射；
 * outer 跨块的次映射。
 */
export type LinkClass = 'primary' | 'inner' | 'outer'

/** 对应块的基数：定位一侧（先摆的那层）的个数 : 对齐一侧的个数 */
export type BlockType = 'one-one' | 'one-many' | 'many-one' | 'many-many'

/** 对应块：被主映射连在一起的一组节点，作为一个整体上下对齐 */
export interface MappingBlock {
  index: number
  type: BlockType
  /** 定位的一侧：先摆好的那层的节点（本体） */
  anchors: string[]
  /** 对齐过去的一侧（表） */
  aligned: string[]
  /** 定位一侧、对齐一侧各在哪一层 */
  anchorLayer: number
  alignedLayer: number
  /** 定位一侧的重心（盘面坐标） */
  center: [number, number]
}

export interface GroupTerritory {
  index: number
  id: string
  /** 扇区中心角（弧度，x 轴正向起逆时针，按 (cos, sin) → (x, z)） */
  angle: number
  /** 扇区张角 */
  span: number
  /** 主图层上这个领域的本体的重心 */
  centroid: [number, number]
  /** 重心到最远成员的距离 */
  spread: number
}

export interface StrataLayout {
  nodes: Map<string, PlacedNode>
  /** 每层盘面的半径（按层的下标），所有盘同心 */
  radii: number[]
  groups: GroupTerritory[]
  /** 主图层（做布局基准的那张图）的下标 */
  primary: number
  /** 对应块 */
  blocks: MappingBlock[]
  /** 两张图之间的映射各是哪一种：映射的 id → 分类。不是图和图之间的映射不在里面 */
  linkClass: Map<string, LinkClass>
}

export interface LayoutOptions {
  /** 主图层的半径，缺省 26 */
  radius?: number
  /**
   * 哪一张图做布局的基准（层的 id）：它自己按力导摆，别的图向它对齐。
   * 不写就挑和别的图映射最多的那张（正好两张图时是第一张）。
   */
  primary?: string
}

// ─── 渲染器画的东西 ──────────────────────────────────────────────────────────

/** 渲染器的静态底子：节点和边的固定属性。变的都在 Looks 里。 */
export interface BaseNode {
  id: string
  layer: number
  shape: NodeShape
  /** 世界单位的基础半径 */
  r: number
  group: number
  mono: boolean
  /** 星等 0..5：0 最亮。决定光点的大小和光晕，不随交互变 */
  mag: number
}

/** intra 层内的关系；contain 父节点到展开出来的子节点；cross 跨层的映射 */
export type EdgeKind = 'intra' | 'contain' | 'cross'

export interface BaseEdge {
  /** BaseNode 的下标 */
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
  /** 屏幕像素 */
  size: number
  weight: 400 | 500 | 600
  strike: boolean
  /** 越大越先占位（碰撞避让） */
  priority: number
  mono?: boolean
}

export interface NodeLook {
  visible: boolean
  /** 盘面坐标；回放里节点会移动，所以每帧给 */
  x: number
  z: number
  layer: number
  /** 相对盘面的抬升（世界单位）：新增从盘下升起为负，合并时飞过去为正 */
  lift: number
  /** 乘在基础半径上 */
  scale: number
  /** 芯的颜色 #rrggbb */
  color: string
  /** 亮度倍数：1 正常，>1 会泛光，<1 压暗 */
  intensity: number
  alpha: number
  /** 空心虚线（这一版没有：kgdiff 的删除幽灵） */
  ghost: boolean
  ring: { color: string; alpha: number } | null
  halo: { color: string; alpha: number; size: number } | null
  /** 0 = 无；(0,1) = 一圈外扩的涟漪的进度 */
  pulse: number
  label: LabelLook | null
  /** 改名时的旧名，划掉，排在主标签下面 */
  label2: LabelLook | null
  badge: string | null
  /** 路径回放里的序号，0 = 无 */
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
  /** 二次贝塞尔控制点相对两端中点抬起的高度（世界单位），0 = 直线；弧线中点实际抬起 arc / 2 */
  arc: number
  colorA: string
  colorB: string
  alpha: number
  /** 屏幕像素 */
  width: number
  dash: boolean
  /** 从 a 端画出的比例 [0, 1]（长出 / 收回的动画） */
  progress: number
  /** progress 从 b 端算起 */
  fromTarget: boolean
  /** 彗星的强度 0..1：0 不流动 */
  flow: number
  /** 彗星的相位 0..1，错开用 */
  phase: number
  /** 亮度倍数，>1 泛光 */
  intensity: number
}

export interface ExtraEdges {
  bridges: EdgeLook[]
  path: EdgeLook[]
  marks: EdgeLook[]
}

export interface Looks {
  nodes: NodeLook[]
  /** 和 base.edges 一一对应 */
  edges: EdgeLook[]
  /** 不在底子里的线，各归各的：穿透线、路径的每一段、kgdiff 的标记（合并箭头、边的幽灵） */
  extra: ExtraEdges
  /** 领域的强调 0..1，按 groups 下标：盘面疆域和灯光跟着它亮 */
  groups: number[]
  /** 0 = 疆域按领域着色；1 = 全部退成灰（看变化的时候） */
  neutral: number
  /** 每层的强调 0..1（聚焦一层时其他层压暗） */
  layers: number[]
  /** 每层在不在场 0..1，缺省都在。隐藏一层时它从 1 淡到 0，盘面跟着淡出 */
  presence?: number[]
  /** 点阵整体亮到多少 0..1，缺省 1。指着某样东西、走路径时点阵退后一步 */
  ground?: number
  /** 盘面涟漪：盘面坐标 + 层 + 进度 0..1 */
  ripples: { x: number; z: number; layer: number; p: number; color: string }[]
}
