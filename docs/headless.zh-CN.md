# 不带渲染

[English](headless.md)

这篇讲怎么不渲染、只用 `kgstrata/headless` 里的校验、布局和穿透计算：在 Node 里跑，在 Worker 里跑，或者交给你自己的渲染器。

```ts
import { validate, resolve, layoutStrata, bridgesOf, stageOf } from 'kgstrata/headless'
```

`kgstrata/headless` 不引入 three.js，也不引入 kgdiff，不碰浏览器的全局对象。运行时只依赖 `d3-force`。只装这个包就行：

```sh
npm install kgstrata
```

`three` 声明成了 peer 依赖，包管理器可能还是会装上它；但 `kgstrata/headless` 能走到的代码都不引入它。

## 里面有什么

| 导出 | 用途 |
|---|---|
| `validate(data, { locale? })` | 返回 `DataIssue` 列表，不抛异常。见 [data.zh-CN.md](data.zh-CN.md#校验)。 |
| `normalize(data, { nodeStyles?, palette?, locale? })` | `{ data: Normalized, issues }`。丢掉有问题的项、补齐缺省，别的都留着（子节点和它们的关系也在）。 |
| `project(normalized, expanded?)` | `Resolved`：按展开了哪些节点生成要画的图。子节点收进祖先，关系上卷。 |
| `resolve(data, opts?)` | `normalize` 加上全部收起的 `project`：`{ resolved, issues }`。 |
| `relationId(relation)` | 关系没写 id 时得到的 id：`source\|type\|target`。 |
| `DEFAULT_NODE_STYLES` | 内置的 `type` → 形状表。 |
| `layoutStrata(resolved, { radius?, anchor? })` | 确定性的布局，返回 `StrataLayout`。同样的输入，同样的输出。 |
| `layoutToJSON(layout)`、`layoutFromJSON(json)` | 把 `StrataLayout` 存成 JSON（两张 `Map` 换成数组），再读回来。 |
| `checkLayout(resolved, layout, locale?)` | 这份布局能不能用在这张图上：能用是 `null`，不能用是一条 `layout-incomplete`。 |
| `isFatal(issue)` | 整份数据用不了的问题（契约版本不对）是 `true`。 |
| `placeChildren(layout, resolved)` | 在全部收起的布局上，把展开的子节点围着父节点摆上，别的不动。 |
| `unionData(a, b)` | 两份 `Resolved` 的合集（对比两版时用）。 |
| `stageOf({ radii, mix, secondaryScale?, spread? })` | 按主角的分量算每层的缩放、亮度、高度。 |
| `scaleAt(d, secondaryScale?)`、`levelAt(d)` | 离主角 `d` 层远的层的缩放和亮度。 |
| `bridgesOf(layerOf, cross, hidden)` | 穿过隐藏层的连接。 |
| `auditMappings(data, opts?)` | 上层的每条关系能不能经下层的连接走通，下层的每条连接上层有没有交代，哪些节点没有映射。见[审计映射](#审计映射)。 |
| `DARK`、`createTheme`、`backdropOf`、`MESSAGES`、`message`、`localeOf`、`DEFAULT_LOCALE`、`StrataError` | 主题和语言的数据。 |
| 契约的类型 | 输入（`StrataData`、`LayerSpec`、`NodeSpec`、`RelationSpec`、`GroupingSpec`、`GroupSpec`、`NodeStyle`、`NodeShape`、`Attrs`、`AttrValue`、`DataIssue`），和上面这些函数收、交的东西（`Normalized`、`NormalNode`、`NormalRelation`、`Resolved`、`ResolvedLayer`、`ResolvedNode`、`ResolvedEdge`、`ResolvedLink`、`ResolvedGroup`、`StrataLayout`、`StrataLayoutJSON`、`LayoutOptions`、`PlacedNode`、`MappingBlock`、`BlockType`、`LinkClass`、`GroupTerritory`，审计的 `AuditOptions`、`MappingAudit`、`RelationAudit`、`JoinAudit`、`JoinPath`）。每帧画的样子（`Looks`、`NodeLook`、`EdgeLook`、`BaseNode`……）只在 `kgstrata/internals`。 |

## 在 CI 里校验

```ts
// check-model.ts：用 tsx 跑，或者用能直接去掉 TypeScript 类型的 Node 版本跑
import { readFileSync } from 'node:fs'
import { validate, type StrataData } from 'kgstrata/headless'

const data = JSON.parse(readFileSync('model.json', 'utf8')) as StrataData
const issues = validate(data, { locale: 'zh-CN' })
for (const i of issues) console.log(`${i.level}\t${i.code}\t${i.id ?? ''}\t${i.message}`)
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
```

## 在 Node 里跑布局

```ts
import { resolve, layoutStrata } from 'kgstrata/headless'

const { resolved, issues } = resolve(data)
const layout = layoutStrata(resolved, { radius: 26, anchor: 'onto' })

for (const [id, n] of layout.nodes) {
  // n.layer：层的下标（0 是最上面）；n.x、n.z：盘面坐标，盘心在 (0, 0)；n.r：半径
  console.log(id, n.layer, n.x.toFixed(2), n.z.toFixed(2))
}
layout.radii      // 每层盘面的半径
layout.anchor     // 基准层的下标
layout.blocks     // 对应块：{ type, anchors, aligned, center, … }
layout.linkClass  // 映射的 id → 'primary' | 'inner' | 'outer'
layout.groups     // 基准层那个分组维度里每个组的扇区
```

`LayoutOptions`：

| 选项 | 缺省 | 含义 |
|---|---|---|
| `radius` | `26` | 基准层盘面的半径（世界单位）。 |
| `anchor` | 映射最多的那层 | 基准层的 id（就是 `Strata` 的 `anchor` 选项）。0.1 里叫 `primary`。 |

`Strata` 自己用的是 `radius = 26 × max(1, √(n / 110))`，`n` 是最大那层的节点数，图越大盘越大。想得到一模一样的坐标，就传同样的值；注入布局的函数拿到的 `defaults` 就是这几项。

## 预先算好布局，交给 `Strata`

布局是确定的，但几千个节点时并不便宜。算一次（在 Worker 里、服务端、构建时），存下来，再注入：

```ts
// 服务端或者构建时
import { resolve, layoutStrata, layoutToJSON } from 'kgstrata/headless'
const { resolved } = resolve(data)
const json = JSON.stringify(layoutToJSON(layoutStrata(resolved, { radius: 26, anchor: 'onto' })))

// 浏览器里
import { Strata } from 'kgstrata'
import { layoutFromJSON } from 'kgstrata/headless'
const cached = layoutFromJSON(JSON.parse(json))
const strata = new Strata(host, { anchor: 'onto', layout: () => cached })
strata.setData(data) // 缓存的布局盖住了所有节点时返回 []
```

这个函数在布局全部收起的图时调（装了看变化插件时，两版的合集也会问它；那里返回 `null` 让引擎自己算）。布局缺节点、或者和层对不上时，`setData` 返回一条 `layout-incomplete`（warning），布局改为自己算。展开的子节点用 `placeChildren` 添在上面。JSON 不是 `layoutToJSON` 写的（格式 1）时，`layoutFromJSON` 抛 `TypeError`。

在 Node 24 里验证过：下面这段两层的数据从构建产物里跑，得到一个一对一的块。

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

## 自己画

画 2D 图或者在服务端出图，有 `Resolved` 和 `StrataLayout` 就够了。每层是一个盘，第 `i` 层往下错开一段再画：

```ts
import { resolve, layoutStrata, type StrataData } from 'kgstrata/headless'

/** 名字、颜色都来自数据：写进标记之前先转义 */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function toSvg(data: StrataData, layerGap = 70): string {
  const { resolved } = resolve(data)
  const layout = layoutStrata(resolved)
  const R = Math.max(...layout.radii)
  // 把每个盘竖向压扁，假装是斜着看
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

节点名、id、颜色都是数据里写什么就是什么。写进 SVG 或 HTML 之前要像上面的 `esc` 那样转义：不转义的话，名字写成 `</title><script>…</script>` 这样的，SVG 内联到页面里或者单独打开时就会执行。

展开的子节点：`project(normalize(data).data, ['tbl:company'])` 得到这张表展开后的图，`placeChildren(收起时的布局, 展开后的图)` 在收起时的布局上补上字段的位置。

## 审计映射

`auditMappings` 回答两层模型的两个问题：本体里的每条关系，在物理层要连哪几张表才能走通；每条外键，本体里有没有说明它为什么在那儿。按全部收起来算：字段之间的映射和外键算在各自的表上。

```ts
import { auditMappings } from 'kgstrata/headless'

const audit = auditMappings(data) // 上层 'onto'、下层 'table'（相邻两层里映射最多的那一对）
for (const r of audit.relations) {
  if (r.status === 'joined') console.log(r.id, r.paths.map((p) => p.nodes.join(' → ')))
  else console.log(r.id, r.status) // 'unreachable' 或 'unmapped'
}
const orphans = audit.joins.filter((j) => j.coverage === 'unused')
```

规则：

- **走得通。** 上层关系 A–B 是 `joined`：A 映射到的某个下层节点和 B 映射到的某个下层节点之间，最多 `maxHops` 条连接（默认 3）就连得上。两端在同一个节点上是 0 条。连接是下层里 `type` 在 `joinTypes`（默认 `['fk']`）里的关系，不管方向。`unreachable`：两端都有映射，但没有够短的路径。`unmapped`：有一端没映射到任何东西。
- **只给最短的。** `paths` 是连接最少的那些路径，最多 `maxPaths` 条（默认 3），两端映射的分量大的在前。不拿更长的路径凑数：有了短的，更长的多半是绕路。
- **没映射的节点不当桥。** 路径不经过上层没有任何东西映射到的下层节点（维表、临时表）：这种表会把不相干的表连起来，把缺口藏住。`throughUnmapped: true` 放开。
- **连接的覆盖**，每条连接一档：两端映射到的上层节点之间有直接关系是 `direct`（`direct` 列出这些关系）；只被给出的路径走到是 `via-path`（`usedBy`）；都不是就是 `unused`。
- `unmappedUpper` / `unmappedLower`：这两层之间没有映射的节点。

`upper`、`lower` 指定哪两层（层的 id）；只给一个，另一个取相邻的那层。层不存在或者两个一样，抛 `StrataError('audit-layers')`。结果是纯 JSON。关系和连接的 id 是 `project(normalize(data))` 里的，所以从字段上卷上来的关系，id 是两张表的 `source|type|target`。

## 穿过隐藏层的连接

`bridgesOf` 回答“如果把 X 层藏起来，什么会连到什么”。指标 → 本体 → 表三层时，隐藏本体层，每个指标就直接连到它最终落的表上；分量是经过了几条不同的中间路径。

它按下标算：

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
  console.log(`${ids[b.s]} → ${ids[b.t]}，经过 ${b.weight} 条路径`)
}
```

规则：只接跨层的映射（不走隐藏层里层内的关系）；一路往下走，不会绕回同一层；连着隐藏几层也能接。上面的节点往下什么都落不到，就没有穿透线，所以这本身就是一次端到端的缺口检查。

## 主次的比例

主角、配角的大小背后是纯函数 `stageOf`：

```ts
stageOf({ radii: [26, 20], mix: [1, 0] })
// { scales: [1, 0.728], levels: [1, 0.5], sides: [0, 1], heights: [9.35, -9.35], tightness: 0.84 }
```

`scales[1]` 是 0.728 而不是 0.56，因为大小是相对主角的半径说的：第二个盘画成 0.56 × 26 = 14.56 个世界单位，是它自己半径 20 的 0.728。规则见 [design.zh-CN.md](design.zh-CN.md)。

## 限制

- 注入的布局要是同一份数据的：位置按节点的 id 找，层按下标对。
- `StrataLayout` 里的下标（`layer`、`group`、`blocks`）都是对你传进去的那份 `Resolved` 说的，不是 id。
