# 数据契约

[English](data.md)

这篇讲交给 `setData` 的 `StrataData` 长什么样、包含和上卷怎么算、校验会报哪些问题，以及建模上的建议。类型在 `src/types.ts`，从 `kgstrata` 和 `kgstrata/headless` 都能引入。

## 总览

四个扁平的列表：层、节点、关系、分组。

```ts
import type { StrataData } from 'kgstrata'

const data: StrataData = {
  version: 2,
  title: '企业模型', // 可选
  layers: [
    // 从上到下
    { id: 'onto', name: '本体', grouping: 'domain' },
    { id: 'table', name: '物理表', grouping: 'database' },
  ],
  groupings: [
    { id: 'domain', name: '领域', groups: [{ id: 'party', name: '市场主体' }, { id: 'equity', name: '股权投资', color: '#46d8a8' }] },
    { id: 'database', groups: [{ id: 'ods', name: 'ODS' }] },
  ],
  nodes: [
    { id: 'onto:investment', layer: 'onto', label: '投资', type: 'relation', groups: { domain: 'equity' } },
    { id: 'tbl:investment', layer: 'table', label: 'investment', type: 'table', groups: { domain: 'equity', database: 'ods' } },
    { id: 'tbl:investment.amount', layer: 'table', label: 'amount', type: 'field', parent: 'tbl:investment' },
  ],
  relations: [{ source: 'onto:investment', target: 'tbl:investment.amount', type: '落地', attrs: { filter: 'amount > 0' } }],
}
```

处处成立的几条：

- **每一层都是一张图。** 层只有 id、名字和它用的分组维度，没有别的摆法。
- **关系只有一种。** 两端在同一层就是层内的关系，在不同层就是层间的映射。
- **数据只说“是什么”，不说“画成什么样”。** 节点写 `type`，形状由 `nodeStyles` 选项定。组的颜色可以写，不写就从主题色板取。
- **对外接口都用 id，不用下标。** `setHero('table')`、`select('onto:investment')`、`setLayerVisible('onto', false)`。

## `StrataData`

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | `2` | 契约版本。不是 2 会报 `version`（见下）。 |
| `title` | `string?` | 原样带着；对比两版时当作图的名字。 |
| `layers` | `LayerSpec[]` | 从上到下。 |
| `nodes` | `NodeSpec[]` | |
| `relations` | `RelationSpec[]` | |
| `groupings` | `GroupingSpec[]?` | 分组维度（领域、库……）。 |

### 层：`LayerSpec`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 层之间不重复。 |
| `name` | `string` | 显示在盘边和层列表里。 |
| `grouping` | `string?` | 这一层按哪个分组维度着色、分区。不写用第一个维度。 |

层数不限。两层是核心场景（本体在上，表在下）；上面加一层指标、下面加一层看板，做法一样。引擎挑一层做布局的**基准**（和别的层映射最多的那层，或者 `anchor` 选项指定的），别的层向它对齐。

### 节点：`NodeSpec`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | **所有层**里都不重复。 |
| `layer` | `string` | 层的 id。 |
| `label` | `string` | 显示的名字。 |
| `type` | `string?` | 它是什么：`'relation'`、`'table'`、`'field'`，或者你自己的类型。经 `nodeStyles` 决定形状。 |
| `parent` | `string?` | 包含它的节点（同一层）。见[包含和上卷](#包含和上卷)。 |
| `groups` | `Record<string, string>?` | 分组维度的 id → 组的 id。一个节点可以在几个维度里各属一组。 |
| `weight` | `number?` | 重要度 0..1。不写就按同层里的连接数排名。超出 0..1 会报问题，布局时夹到 0..1。 |
| `attrs` | `Attrs?` | 任意 JSON。不画出来；`kgstrata/diff` 会比较它。 |

内置的 `type` 样式（`DEFAULT_NODE_STYLES`）：

| `type` | 形状 | 名字用等宽字 | 子节点叫什么 |
|---|---|---|---|
| `relation` | `octa`（菱形） | 否 | — |
| `table` | `tablet`（标牌） | 是 | fields / 字段 |
| `field` | `tablet` | 是 | — |
| `metric` | `prism` | 否 | — |
| `document` | `page` | 否 | — |
| 其他 | `bead`（圆点） | 否 | — |

用 `nodeStyles` 选项增加或覆盖。形状有 `'bead' | 'octa' | 'tablet' | 'prism' | 'page'`。`childNoun` 是这类节点里收着的东西叫什么，悬停提示用（“22 个字段 · 双击展开”）：写一个词，或者按语言写（顺着语言的回退链找）。不写时提示是“内含 22 项 · 双击展开”。

```ts
new Strata(host, {
  nodeStyles: {
    board: { shape: 'page' },
    column: { shape: 'tablet', mono: true },
    entity: { childNoun: { en: 'attributes', 'zh-CN': '属性' } },
  },
})
```

### 关系：`RelationSpec`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string?` | 不写就是 `` `${source}\|${type ?? ''}\|${target}` ``（`relationId()`）。同一对节点之间有几条同类型的关系时要自己写。 |
| `source`、`target` | `string` | 节点的 id。 |
| `type` | `string?` | `'fk'`、`'落地'`……上卷和对比两版时按 `type` 认是不是同一种关系。 |
| `label` | `string?` | 显示的文字，缺省用 `type`。 |
| `weight` | `number?` | 正数，缺省 1。映射的分量是“对上了多少”，比如对上了几个字段。 |
| `primary` | `boolean?` | 指定它是主映射。只对跨层的关系有意义，优先于 `weight`。 |
| `attrs` | `Attrs?` | 别的信息：口径条件、join 键。不画出来；`kgstrata/diff` 会比较它。 |

### 分组：`GroupingSpec` 和 `GroupSpec`

```ts
interface GroupingSpec { id: string; name?: string; groups: GroupSpec[] }
interface GroupSpec { id: string; name: string; color?: string /* #rrggbb */ }
```

- 每层用一个维度（`layer.grouping`，缺省第一个）。节点的颜色来自它在这个维度里的组；没有组的节点是中性色。
- 基准层按它那个维度的组分成扇区，同组的节点挨在一起，颜色成片而不是碎点。
- 组的 id 只要在本维度里不重复。内部的组 id 是 `"维度/组"`：`highlightGroup()` 和 `strata.group` 用这个全称（`highlightGroup` 也认只写组 id，不重名时）。
- 没写 `color` 的组按顺序从 `theme.palette` 取色。

## 包含和上卷

`parent` 表示“包含”：表包含字段，本体可以包含属性。父子必须在同一层。

- **收起（缺省）**：子节点不画。连到子节点上的关系画在它最近的画出来的祖先上。上卷以后落在同一对节点之间、类型相同的几条关系合成一条，分量相加。两端收进同一个节点的关系（同一张表的两个字段之间）不画。
- **展开**：`strata.expand(id)`、`setExpanded(ids)`、`expanded` 选项，或者双击。子节点围着父节点画成一圈，关系回到各个子节点上。顶层节点不动。

所以映射可以写到字段级，分量自己就出来了：

```ts
// 三条字段级的映射……
{ source: 'onto:investment', target: 'tbl:investment.company_id', type: '落地' },
{ source: 'onto:investment', target: 'tbl:investment.person_id', type: '落地' },
{ source: 'onto:investment', target: 'tbl:investment.amount', type: '落地' },
// ……tbl:investment 收起时画成一条表级映射 onto:investment → tbl:investment，分量 3
```

上卷出来的关系：

- id 是 `` `${画出来的起点}|${type ?? ''}|${画出来的终点}` ``，`members` 列出原来那几条关系的 id；
- 只要有一条是 `primary`，它就是 `primary`；
- `attrs` **不**带过来：它们属于各条原始关系，合在一起只能靠猜。上卷出来的关系没有 `attrs`；要看原始的，按 `members` 去 `normalize(data).data.relations` 里找，或者展开节点把它们画出来。所以对比两版时，表收着的话 `attrs` 的变化要展开以后才报出来。

## 分量和主映射

映射是多对多的，所以对齐的单位是**对应块**，不是单个节点：

1. 基准一侧的每个节点挑一条主映射：先看 `primary: true`，再看 `weight` 最大，再看对方的映射少，最后按 id。
2. 对齐一侧还没被挑中的节点，用同样的办法各挑一条。
3. 被主映射连在一起的节点是一个块。块分 `one-one`、`one-many`、`many-one`、`many-many`。一对一的表正落在本体下方；一对多的围着那个点散开；多对一的落在几个本体的重心下面。

映射线分三类：`primary`（主映射）、`inner`（同一个块里的其余映射）、`outer`（块和块之间，画成细虚线）。`layoutStrata()` 的结果里有 `blocks` 和 `linkClass`。没有映射的表排到外圈，朝着它外键邻居的方向；没有映射的本体留在本体布局给它的位置，下面没有线。

表之间的外键不参与定位。这样本体上的一条关系和实现它的外键上下重合，“叠看”（`shot('top')`）靠的就是这一点。

## 校验

`validate(data, { locale })` 返回 `DataIssue` 列表，不抛异常。`setData` 和 `normalize` 也会跑它，返回同样的列表。

```ts
interface DataIssue {
  level: 'error' | 'warning'
  code: string     // 固定不变，程序按它判断
  message: string  // 给人看的，按所选语言
  id?: string      // 出问题的那一项（节点、关系、层、分组维度或组的 id）
}
```

`error` 表示用不了：带 `id` 的是那一项用不了、会被丢掉，不带 `id` 的（`version`）是整份数据用不了；`warning` 表示能用但多半写错了。下表逐条写明 `normalize`（也就是 `setData`）怎么处理。

| `code` | 级别 | 什么时候 | 怎么处理 |
|---|---|---|---|
| `version` | error | `version` 不是 `2`。 | 整份数据用不了：`normalize` 交回一张空图，`setData` 什么都不画、保留原来的数据，只返回问题。没有 `id`（`isFatal(issue)` 是 `true`）。 |
| `duplicate-grouping` | warning | 两个分组维度 id 相同。 | 后面的不算。 |
| `duplicate-group` | warning | 同一维度里两个组 id 相同。 | 后面的不算。`id` 是组的 id。 |
| `duplicate-layer` | error | 两层 id 相同。 | 后面的丢掉。 |
| `unknown-grouping` | warning | `layer.grouping` 指向不存在的维度。 | 这一层用第一个维度。 |
| `duplicate-node` | error | 两个节点 id 相同（跨层也算）。 | 后面的丢掉。 |
| `unknown-layer` | error | `node.layer` 指向不存在的层。 | 节点丢掉。 |
| `unknown-group` | warning | `node.groups` 写的组在那个维度里不存在。 | 节点在那个维度里没有组。 |
| `bad-weight` | warning | 节点的 `weight` 不在 0..1。 | 保留；布局时夹到 0..1。 |
| `bad-weight` | warning | 关系的 `weight` 不是有限的正数。 | 按 1 算。 |
| `unknown-parent` | error | `node.parent` 不存在。 | 节点保留，当作没有 parent。 |
| `parent-layer` | error | 节点和 parent 不在同一层。 | 节点保留，当作没有 parent。 |
| `parent-cycle` | error | 顺着 `parent` 走回了自己。 | 环上的每个节点都保留，当作没有 parent。 |
| `dangling-relation` | error | `source` 或 `target` 不是（保留下来的）节点。 | 关系丢掉。 |
| `duplicate-relation` | error | 两条关系显式写了相同的 `id`。 | 后面的丢掉。 |
| `duplicate-relation` | warning | 两条没写 `id` 的关系生成了相同的 id。 | 后面的丢掉。请给它们写上 id。 |
| `self-relation` | warning | `source === target`。 | 留在数据里，但不会画出来。 |

`bad-weight`、`duplicate-relation` 各对应两种情况，`message` 会说是哪一种。消息有英文和简体中文；`code` 不随语言变。

```ts
import { validate } from 'kgstrata/headless'

const issues = validate(data, { locale: 'zh-CN' })
const errors = issues.filter((i) => i.level === 'error')
if (errors.some((i) => i.code === 'duplicate-node')) {
  /* … */
}
```

## 建模建议

- **id 带上层的前缀**（`onto:`、`tbl:`）。节点 id 要跨层唯一，有前缀的路径和视图状态也好读。
- **映射写到你手里最细的那一级。** 字段级的映射自动上卷成表级的分量，别人展开表时也能看到细节。
- **哪条映射是主的很明确时，写 `weight` 或 `primary`。** 不写的话按连接数和 id 定，稳定但未必是你想要的。
- **`type` 保持语义**（`'table'`、`'relation'`、`'metric'`），用 `nodeStyles` 对应到形状。不要把样子写进数据。
- **物理层可以用另一个分组维度**，领域的划分不适合表时按库或 schema 分。
- **关系的细节放进 `attrs`**（join 键、口径条件）。它们不画出来，但对比两版时会报出变化。
- **准备对比版本时给关系写显式的 id**，尤其同一对节点之间可能有几条同类型关系的时候。对比按 id 认关系。
- **在 CI 里跑 `validate`** 检查生成的数据。它在 `kgstrata/headless` 里，Node 里就能跑，不需要 three.js。
