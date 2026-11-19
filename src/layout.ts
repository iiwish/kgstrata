// 布局：解析后的数据（Resolved）→ StrataLayout。全程确定性——初始位置只由 id 的哈希决定，d3-force 本身的随机源是固定种子。
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type {
  BlockType,
  GroupTerritory,
  LayoutOptions,
  LinkClass,
  MappingBlock,
  PlacedNode,
  Resolved,
  ResolvedLayer,
  ResolvedNode,
  StrataLayout,
} from './types.js'

/** 主图层模拟用的基准半径；跑完再缩放到 opts.radius */
const R0 = 15
const TAU = Math.PI * 2

// ─── 工具 ────────────────────────────────────────────────────────────────────

/** FNV-1a，映射到 [0, 1)：替代 Math.random，保证同输入同输出 */
function hash01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}

/** 夹到 (-π, π] */
function wrap(a: number): number {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}

function centroidOf(pts: { x: number; z: number }[]): { x: number; z: number } | null {
  if (pts.length === 0) return null
  let x = 0
  let z = 0
  for (const p of pts) {
    x += p.x
    z += p.z
  }
  return { x: x / pts.length, z: z / pts.length }
}

/** 指定 tick 数时让 alpha 恰好在最后一 tick 衰减到 alphaMin（0.001） */
function decayFor(ticks: number): number {
  return 1 - Math.pow(0.001, 1 / ticks)
}

interface SimNode extends SimulationNodeDatum {
  id: string
  ax: number
  ay: number
  /** 扇区中心角；NaN 表示不受扇区约束 */
  sector: number
  half: number
  rad: number
}

type SimLink = SimulationLinkDatum<SimNode> & { cross: boolean }

interface Pos {
  x: number
  z: number
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

export function layoutStrata(data: Resolved, opts: LayoutOptions = {}): StrataLayout {
  const R = opts.radius ?? 26
  const layers = data.layers
  const groupIndex = new Map(data.groups.map((g, i) => [g.id, i]))
  const nodeLayer = new Map<string, number>()
  const specOf = new Map<string, ResolvedNode>()
  // 这里只摆顶层节点；展开出来的子节点最后围着父节点摆（placeChildren）
  const tops = layers.map((l) => l.nodes.filter((n) => n.parent === undefined))
  tops.forEach((nodes, li) =>
    nodes.forEach((n) => {
      if (!nodeLayer.has(n.id)) {
        nodeLayer.set(n.id, li)
        specOf.set(n.id, n)
      }
    }),
  )

  // 邻接：同层边、跨层 links 都算进 degree
  const degree = new Map<string, number>()
  const intraNbrs = new Map<string, string[]>()
  const linkNbrs = new Map<string, string[]>()
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)
  const push = (m: Map<string, string[]>, a: string, b: string) => {
    const arr = m.get(a)
    if (arr) arr.push(b)
    else m.set(a, [b])
  }
  const intraEdges: [string, string][][] = layers.map(() => [])
  layers.forEach((l, li) => {
    for (const e of l.edges ?? []) {
      if (e.source === e.target) continue
      if (nodeLayer.get(e.source) !== li || nodeLayer.get(e.target) !== li) continue
      intraEdges[li].push([e.source, e.target])
      bump(e.source)
      bump(e.target)
      push(intraNbrs, e.source, e.target)
      push(intraNbrs, e.target, e.source)
    }
  })
  for (const k of data.links) {
    if (k.source === k.target || !nodeLayer.has(k.source) || !nodeLayer.has(k.target)) continue
    bump(k.source)
    bump(k.target)
    push(linkNbrs, k.source, k.target)
    push(linkNbrs, k.target, k.source)
  }
  const deg = (id: string) => degree.get(id) ?? 0
  const radiusOf = (n: ResolvedNode): number => 0.28 + 0.05 * Math.min(deg(n.id), 10)

  // 几张图之间的映射数：挑基准、定摆放顺序都用它
  const between = layers.map(() => layers.map(() => 0))
  for (const k of data.links) {
    const a = nodeLayer.get(k.source)
    const b = nodeLayer.get(k.target)
    if (a === undefined || b === undefined || a === b) continue
    between[a][b]++
    between[b][a]++
  }
  // 基准：指定的那张图；没指定就挑和别的图映射最多的那张——它是别的图都要对上的那一张。一样多时取靠前的
  let anchorIdx = opts.anchor !== undefined ? layers.findIndex((l) => l.id === opts.anchor) : -1
  if (anchorIdx < 0) {
    let most = -1
    layers.forEach((_, i) => {
      const c = between[i].reduce((x, y) => x + y, 0)
      if (c > most) {
        most = c
        anchorIdx = i
      }
    })
  }

  // 扇区：张角 ∝ max(成员数, 1.5)，从 -π/2 逆时针排
  const anchorNodes = anchorIdx >= 0 ? tops[anchorIdx].filter((n) => nodeLayer.get(n.id) === anchorIdx) : []
  const counts = data.groups.map(() => 0)
  for (const n of anchorNodes) {
    const gi = n.group !== undefined ? groupIndex.get(n.group) : undefined
    if (gi !== undefined) counts[gi]++
  }
  // 扇区只分给主图层那个分组维度里的组：别的维度的组（比如表按库分的那些）不占地方
  const scope = anchorIdx >= 0 ? layers[anchorIdx].grouping : undefined
  const weights = counts.map((c, i) => (scope === undefined || data.groups[i].grouping === undefined || data.groups[i].grouping === scope ? Math.max(c, 1.5) : 0))
  const totalW = weights.reduce((a, b) => a + b, 0) || 1
  const sectors: { angle: number; span: number }[] = []
  {
    let start = -Math.PI / 2
    for (const w of weights) {
      const span = (w / totalW) * TAU
      sectors.push({ angle: wrap(start + span / 2), span })
      start += span
    }
  }

  const pos = new Map<string, Pos>()
  const blocks: MappingBlock[] = []
  /** 每个节点所在的对应块：夹在中间的层会同时在上下两个块里 */
  const blocksOf = new Map<string, number[]>()
  const linkClass = new Map<string, LinkClass>()

  // ── 主图层 ──
  if (anchorIdx >= 0) {
    layoutPrimary(anchorNodes, intraEdges[anchorIdx], {
      R,
      groupIndex,
      sectors,
      deg,
      intraNbrs,
      rWorld: radiusOf,
      out: pos,
    })
  }

  // 领域的重心按主图层的声明成员算；没有成员的领域落在扇区中线 0.5R 处
  const territories: GroupTerritory[] = data.groups.map((g, i) => {
    const members = anchorNodes.filter((n) => n.group === g.id).map((n) => pos.get(n.id)!)
    const s = sectors[i]
    const c = centroidOf(members) ?? { x: Math.cos(s.angle) * 0.5 * R, z: Math.sin(s.angle) * 0.5 * R }
    let spread = 0
    for (const m of members) spread = Math.max(spread, Math.hypot(m.x - c.x, m.z - c.z))
    return { index: i, id: g.id, angle: s.angle, span: s.span, centroid: [c.x, c.z], spread }
  })

  // ── 其余层 ──
  // 每次挑和已经摆好的图映射最多的那张，这样它总有东西可以对齐
  const ref = anchorIdx >= 0 ? anchorIdx : 0
  const order: number[] = []
  {
    const placedGraphs = anchorIdx >= 0 ? [anchorIdx] : []
    const rest = layers.map((_, i) => i).filter((i) => i !== anchorIdx)
    while (rest.length > 0) {
      const score = (i: number) => placedGraphs.reduce((x, p) => x + between[i][p], 0)
      rest.sort((a, b) => score(b) - score(a) || Math.abs(a - ref) - Math.abs(b - ref) || a - b)
      const next = rest.shift()!
      order.push(next)
      placedGraphs.push(next)
    }
  }

  for (const li of order) {
    const nodes = tops[li].filter((n) => nodeLayer.get(n.id) === li)
    // 映射：一端在这一层，另一端在已经摆好的层
    const inLayer = new Set(nodes.map((n) => n.id))
    const maps: Mapping[] = []
    data.links.forEach((k, index) => {
      const a = inLayer.has(k.target) ? k.source : inLayer.has(k.source) ? k.target : null
      if (a === null || k.source === k.target) return
      const f = a === k.source ? k.target : k.source
      const al = nodeLayer.get(a)
      if (al === undefined || al === li || !pos.has(a)) return
      const w = typeof k.weight === 'number' && Number.isFinite(k.weight) && k.weight > 0 ? k.weight : 1
      maps.push({ index, id: k.id, anchor: a, aligned: f, weight: w, primary: !!k.primary })
    })
    if (maps.length > 0) layoutAligned(nodes, maps, { R, li, rOf: radiusOf, intraNbrs, out: pos, blocks, blocksOf, layerOf: (id) => nodeLayer.get(id) ?? -1, linkClass })
    else {
      // 和已经摆好的图一条映射都没有：没东西可对齐，就自己按力导摆
      layoutPrimary(nodes, intraEdges[li], { R, groupIndex, sectors, deg, intraNbrs, rWorld: radiusOf, out: pos })
    }
  }

  // ── 汇总 ──
  const placed = new Map<string, PlacedNode>()
  const radii: number[] = []
  layers.forEach((_, li) => {
    const nodes = tops[li].filter((n) => nodeLayer.get(n.id) === li)
    const imp = importanceOf(nodes, deg)
    let maxR = 0
    for (const n of nodes) {
      const p = pos.get(n.id) ?? { x: 0, z: 0 }
      const r = radiusOf(n)
      maxR = Math.max(maxR, Math.hypot(p.x, p.z) + r)
      const gi = n.group !== undefined ? groupIndex.get(n.group) : undefined
      placed.set(n.id, {
        id: n.id,
        layer: li,
        x: p.x,
        z: p.z,
        r,
        group: gi ?? -1,
        depth: 0,
        degree: deg(n.id),
        importance: imp.get(n.id)!,
        blocks: blocksOf.get(n.id) ?? [],
      })
    }
    radii.push(Math.max(maxR + 2.5, 0.45 * R, 8))
  })

  const layout: StrataLayout = { nodes: placed, radii, groups: territories, anchor: anchorIdx, blocks, linkClass }
  return layers.some((l) => l.nodes.some((n) => n.parent !== undefined)) ? placeChildren(layout, data) : layout
}

// ─── 展开出来的子节点 ────────────────────────────────────────────────────────

/** 子节点画多大（世界单位） */
const CHILD_R = 0.2

/** Adds expanded children around their parents on a laid-out graph. Top-level positions do not move, so expanding never reshuffles the picture. `base` is the collapsed layout, `data` the graph drawn now. Children join their parent's mapping block; mappings to children take the class of the rolled-up mapping. */
export function placeChildren(base: StrataLayout, data: Resolved): StrataLayout {
  const nodes = new Map(base.nodes)
  const radii = [...base.radii]
  const linkClass = new Map(base.linkClass)
  const groupIndex = new Map(data.groups.map((g, i) => [g.id, i]))
  const parentOf = new Map<string, string>()
  const degree = new Map<string, number>()
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)
  for (const l of data.layers) {
    for (const e of l.edges ?? []) {
      bump(e.source)
      bump(e.target)
    }
  }
  for (const k of data.links) {
    bump(k.source)
    bump(k.target)
  }
  data.layers.forEach((layer, li) => {
    const kids = new Map<string, ResolvedNode[]>()
    for (const n of layer.nodes) {
      if (n.parent === undefined) continue
      parentOf.set(n.id, n.parent)
      const arr = kids.get(n.parent)
      if (arr) arr.push(n)
      else kids.set(n.parent, [n])
    }
    // 一层一层往里摆：父节点先有位置，子节点才有地方围
    let pending = [...kids.keys()]
    while (pending.length > 0) {
      const ready = pending.filter((id) => nodes.has(id))
      if (ready.length === 0) break
      pending = pending.filter((id) => !nodes.has(id))
      for (const pid of ready) {
        const p = nodes.get(pid)!
        const list = kids.get(pid)!
        // 一圈：离父节点够远、彼此也排得开。从“背向盘心”的方向起排，位置由顺序定
        const rho = Math.max(p.r + 0.9, (list.length * (CHILD_R * 2 + 0.6)) / TAU) * Math.pow(0.6, p.depth)
        const a0 = Math.hypot(p.x, p.z) > 1e-6 ? Math.atan2(p.z, p.x) : -Math.PI / 2
        list.forEach((n, i) => {
          const a = a0 + (TAU * i) / list.length
          const x = p.x + Math.cos(a) * rho
          const z = p.z + Math.sin(a) * rho
          const r = CHILD_R * Math.pow(0.8, p.depth)
          const gi = n.group !== undefined ? groupIndex.get(n.group) : undefined
          nodes.set(n.id, {
            id: n.id,
            layer: li,
            x,
            z,
            r,
            group: gi ?? p.group,
            depth: p.depth + 1,
            degree: degree.get(n.id) ?? 0,
            importance: typeof n.weight === 'number' && Number.isFinite(n.weight) ? Math.min(1, Math.max(0, n.weight)) : 0.2,
            blocks: p.blocks,
          })
          radii[li] = Math.max(radii[li] ?? 0, Math.hypot(x, z) + r + 2.5)
        })
      }
    }
  })
  // 连到子节点上的映射：收起时它上卷成了“顶层祖先之间”的那条映射，归类跟着它
  const top = (id: string) => {
    let cur = id
    for (let p = parentOf.get(cur); p !== undefined; p = parentOf.get(cur)) cur = p
    return cur
  }
  for (const k of data.links) {
    if (linkClass.has(k.id)) continue
    const cls = base.linkClass.get(`${top(k.source)}|${k.type ?? ''}|${top(k.target)}`)
    if (cls) linkClass.set(k.id, cls)
  }
  return { ...base, nodes, radii, linkClass }
}

// ─── 重要度 ──────────────────────────────────────────────────────────────────

function importanceOf(nodes: ResolvedNode[], deg: (id: string) => number): Map<string, number> {
  const out = new Map<string, number>()
  // 分位：并列的节点取它们名次的平均，避免同度数的节点亮度不同
  const sorted = nodes.map((n) => deg(n.id)).sort((a, b) => a - b)
  const n = sorted.length
  const rank = new Map<number, number>()
  for (let i = 0; i < n; ) {
    let j = i
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++
    rank.set(sorted[i], n === 1 ? 1 : (i + j) / 2 / (n - 1))
    i = j + 1
  }
  for (const nd of nodes) out.set(nd.id, rank.get(deg(nd.id))!)
  for (const n of nodes) {
    if (typeof n.weight === 'number' && Number.isFinite(n.weight)) out.set(n.id, Math.min(1, Math.max(0, n.weight)))
  }
  return out
}

// ─── 主图层：扇区力导 ────────────────────────────────────────────────────────

function layoutPrimary(
  nodes: ResolvedNode[],
  edges: [string, string][],
  ctx: {
    R: number
    groupIndex: Map<string, number>
    sectors: { angle: number; span: number }[]
    deg: (id: string) => number
    intraNbrs: Map<string, string[]>
    rWorld: (n: ResolvedNode) => number
    out: Map<string, Pos>
  },
): void {
  const { R, groupIndex, sectors, deg, intraNbrs } = ctx
  if (nodes.length === 0) return

  // 没写 group 的节点只为布局借一个领域：跟着同层邻居里票数最多的领域走，几轮传播让链状的也能借到
  const eff = new Map<string, number>()
  for (const n of nodes) {
    const gi = n.group !== undefined ? groupIndex.get(n.group) : undefined
    if (gi !== undefined) eff.set(n.id, gi)
  }
  for (let round = 0; round < nodes.length; round++) {
    let changed = false
    for (const n of nodes) {
      if (eff.has(n.id)) continue
      const votes = new Map<number, { c: number; best: number }>()
      for (const o of intraNbrs.get(n.id) ?? []) {
        const g = eff.get(o)
        if (g === undefined) continue
        const v = votes.get(g) ?? { c: 0, best: 0 }
        v.c++
        v.best = Math.max(v.best, deg(o))
        votes.set(g, v)
      }
      let pick = -1
      let pv = { c: 0, best: -1 }
      for (const [g, v] of [...votes].sort((a, b) => a[0] - b[0])) {
        if (v.c > pv.c || (v.c === pv.c && v.best > pv.best)) {
          pick = g
          pv = v
        }
      }
      if (pick >= 0) {
        eff.set(n.id, pick)
        changed = true
      }
    }
    if (!changed) break
  }
  const loose = nodes.filter((n) => !eff.has(n.id))

  const maxDeg = Math.max(1, ...nodes.map((n) => deg(n.id)))
  // 模拟空间随节点数按面积放大：几千个节点挤在 R0 = 15 里，碰撞检测会退化成近乎两两比较
  const R0s = R0 * Math.max(1, Math.sqrt(nodes.length / 110))
  const toSim = R0s / R
  const sim: SimNode[] = nodes.map((n) => {
    const hub = deg(n.id) / maxDeg
    const rA = R0s * (0.42 + 0.48 * (1 - hub))
    const g = eff.get(n.id)
    let theta: number
    let sector = NaN
    let half = 0
    if (g !== undefined) {
      sector = sectors[g].angle
      half = (sectors[g].span / 2) * 0.9
      theta = sector
    } else {
      theta = -Math.PI / 2 + (TAU * loose.indexOf(n)) / loose.length
    }
    const ax = Math.cos(theta) * rA
    const ay = Math.sin(theta) * rA
    // 初始位置：锚点附近按 id 哈希抖动，角度不出扇区
    const jt = g !== undefined ? (hash01(n.id + '#a') - 0.5) * 1.6 * half : 0
    const jr = rA * (0.85 + 0.3 * hash01(n.id + '#r'))
    return {
      id: n.id,
      ax,
      ay,
      sector,
      half,
      rad: ctx.rWorld(n) * toSim + 1.4,
      x: Math.cos(theta + jt) * jr,
      y: Math.sin(theta + jt) * jr,
    }
  })
  const effOf = new Map(sim.map((s) => [s.id, eff.get(s.id)]))
  const links: SimLink[] = edges.map(([s, t]) => ({
    source: s,
    target: t,
    cross: effOf.get(s) === undefined || effOf.get(s) !== effOf.get(t),
  }))

  // 扇区约束：越界的切向推回，靠盘心的径向推出，力度与越界量成正比
  // 内缘按当前外径取比例：manyBody 会把整体撑到 R0 之外，事后缩放时固定的 0.2·R0 会被压得太靠里
  const sectorForce = (alpha: number) => {
    let outer = R0s
    for (const s of sim) outer = Math.max(outer, Math.hypot(s.x!, s.y!))
    const inner = 0.2 * outer
    for (const s of sim) {
      const x = s.x!
      const y = s.y!
      const rho = Math.hypot(x, y)
      if (rho < inner) {
        const ux = rho > 1e-9 ? x / rho : Math.cos(Number.isNaN(s.sector) ? 0 : s.sector)
        const uy = rho > 1e-9 ? y / rho : Math.sin(Number.isNaN(s.sector) ? 0 : s.sector)
        const k = (inner - rho) * 2 * alpha
        s.vx! += ux * k
        s.vy! += uy * k
      }
      if (Number.isNaN(s.sector) || rho < 1e-9) continue
      const d = wrap(Math.atan2(y, x) - s.sector)
      const over = Math.abs(d) - s.half
      if (over <= 0) continue
      // 切向（角度增大方向）是 (-sin, cos)；按弧长算力度
      const k = -Math.sign(d) * over * rho * 0.5 * alpha
      s.vx! += (-y / rho) * k
      s.vy! += (x / rho) * k
    }
  }

  // 大图少跑几轮、Barnes-Hut 放粗一点：初始位置已经在各自的锚点附近，收敛用不了 400 轮
  const ticks = nodes.length > 600 ? Math.max(90, Math.round((400 * 600) / nodes.length)) : 400
  const theta = nodes.length > 600 ? 1.2 : 0.9
  const simulation = forceSimulation<SimNode>(sim)
    .stop()
    .alphaDecay(decayFor(ticks))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => (l.cross ? 7 : 5))
        .strength((l) => (l.cross ? 0.2 : 0.5)),
    )
    .force('charge', forceManyBody<SimNode>().strength(-28).distanceMax(30).theta(theta))
    .force('collide', forceCollide<SimNode>((d) => d.rad))
    .force('ax', forceX<SimNode>((d) => d.ax).strength(0.12))
    .force('ay', forceY<SimNode>((d) => d.ay).strength(0.12))
    .force('sector', sectorForce)
  simulation.tick(ticks)

  let maxRho = 0
  for (const s of sim) maxRho = Math.max(maxRho, Math.hypot(s.x!, s.y!))
  const k = maxRho > 1e-9 ? R / maxRho : 1
  for (const s of sim) ctx.out.set(s.id, { x: s.x! * k, z: s.y! * k })
}

/** 一轮两两分离；钉住的点不动，由另一方承担全部位移 */
function separate(
  pts: { id: string; x: number; z: number; pinned?: boolean }[],
  minDist: (i: number, j: number) => number,
): void {
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]
      const b = pts[j]
      if (a.pinned && b.pinned) continue
      const m = minDist(i, j)
      let dx = b.x - a.x
      let dz = b.z - a.z
      let dist = Math.hypot(dx, dz)
      if (dist >= m) continue
      if (dist < 1e-9) {
        // 完全重合时按 id 哈希定方向
        const ang = hash01(a.id + '|' + b.id) * TAU
        dx = Math.cos(ang)
        dz = Math.sin(ang)
        dist = 0
      } else {
        dx /= dist
        dz /= dist
      }
      const over = m - dist
      const wa = a.pinned ? 0 : b.pinned ? 1 : 0.5
      const wb = 1 - wa
      a.x -= dx * over * wa
      a.z -= dz * over * wa
      b.x += dx * over * wb
      b.z += dz * over * wb
    }
  }
}

// ─── 排在外圈（没有映射的节点用） ────────────────────────────────────────────

function layoutRing(
  nodes: ResolvedNode[],
  ctx: {
    R: number
    rOf: (n: ResolvedNode) => number
    linkedPlaced: (id: string, preferPrimary: boolean) => Pos[]
    out: Map<string, Pos>
  },
): void {
  const { R, rOf, out } = ctx
  if (nodes.length === 0) return
  const rr = R * 1.06
  const ring: { id: string; a: number; r: number }[] = []
  const loose: ResolvedNode[] = []
  for (const n of nodes) {
    let sx = 0
    let sz = 0
    for (const p of ctx.linkedPlaced(n.id, false)) {
      const h = Math.hypot(p.x, p.z)
      if (h < 1e-6) continue
      sx += p.x / h
      sz += p.z / h
    }
    // 圆周平均：所连节点方向相互抵消时视作没有方向
    if (Math.hypot(sx, sz) < 1e-6) loose.push(n)
    else ring.push({ id: n.id, a: Math.atan2(sz, sx), r: rOf(n) })
  }

  const sortRing = () => ring.sort((p, q) => p.a - q.a || (p.id < q.id ? -1 : 1))
  const gapOf = (p: { r: number }, q: { r: number }) => (p.r + q.r + 2.2) / rr

  const relax = () => {
    if (ring.length < 2) return
    sortRing()
    const need = ring.reduce((s, p, i) => s + gapOf(p, ring[(i + 1) % ring.length]), 0)
    if (need >= TAU) {
      // 放不下就均分，保持原有顺序
      const a0 = ring[0].a
      ring.forEach((p, i) => (p.a = wrap(a0 + (TAU * i) / ring.length)))
      return
    }
    for (let it = 0; it < 400; it++) {
      let moved = false
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]
        const q = ring[(i + 1) % ring.length]
        let d = q.a - p.a
        if (i === ring.length - 1) d += TAU
        const g = gapOf(p, q)
        if (d < g - 1e-9) {
          const push = (g - d) / 2
          p.a -= push
          q.a += push
          moved = true
        }
      }
      for (const p of ring) p.a = wrap(p.a)
      sortRing()
      if (!moved) break
    }
    for (const p of ring) p.a = wrap(p.a)
  }

  relax()
  // 没有 links 的逐个插进当前最大的空隙
  for (const n of loose) {
    if (ring.length === 0) {
      ring.push({ id: n.id, a: -Math.PI / 2, r: rOf(n) })
      continue
    }
    sortRing()
    let best = 0
    let bestGap = -1
    for (let i = 0; i < ring.length; i++) {
      let d = ring[(i + 1) % ring.length].a - ring[i].a
      if (i === ring.length - 1) d += TAU
      if (d > bestGap) {
        bestGap = d
        best = i
      }
    }
    ring.push({ id: n.id, a: wrap(ring[best].a + bestGap / 2), r: rOf(n) })
  }
  relax()
  for (const p of ring) out.set(p.id, { x: Math.cos(p.a) * rr, z: Math.sin(p.a) * rr })
}

// ─── 其余的层：对齐到它所映射的节点下方 ─────────────────────────────────────

interface Mapping {
  /** data.links 的下标 */
  index: number
  id: string
  /** 数据里指定了它是主映射 */
  primary: boolean
  /** 已经摆好的一端 */
  anchor: string
  /** 这一层的一端 */
  aligned: string
  weight: number
}

/**
 * 把映射看成一张二分图。先挑主映射：定位一侧的每个节点挑分量最大的那条；对齐一侧还没被挑中的节点
 * 再各挑一条。被主映射连在一起的就是一个对应块，块作为整体上下对齐：
 * 一对一的正正落在下方；一对多的围着那个点散开；多对一的落在几个定位节点的重心下面。
 * 没有映射的节点排到外圈，朝着本层邻居的方向。
 */
function layoutAligned(
  nodes: ResolvedNode[],
  maps: Mapping[],
  ctx: {
    R: number
    li: number
    rOf: (n: ResolvedNode) => number
    intraNbrs: Map<string, string[]>
    out: Map<string, Pos>
    blocks: MappingBlock[]
    blocksOf: Map<string, number[]>
    /** 节点在哪一层 */
    layerOf: (id: string) => number
    linkClass: Map<string, LinkClass>
  },
): void {
  const { R, rOf, out } = ctx
  if (nodes.length === 0) return
  const byAnchor = new Map<string, Mapping[]>()
  const byAligned = new Map<string, Mapping[]>()
  const push = (m: Map<string, Mapping[]>, k: string, v: Mapping) => {
    const arr = m.get(k)
    if (arr) arr.push(v)
    else m.set(k, [v])
  }
  for (const m of maps) {
    push(byAnchor, m.anchor, m)
    push(byAligned, m.aligned, m)
  }

  // ── 挑主映射：分量大的优先；一样大就挑对方连得少的（更专一），再按 id ──
  const primary = new Set<number>()
  const taken = new Set<string>()
  for (const a of [...byAnchor.keys()].sort()) {
    const best = [...byAnchor.get(a)!].sort(
      (p, q) => Number(q.primary) - Number(p.primary) || q.weight - p.weight || byAligned.get(p.aligned)!.length - byAligned.get(q.aligned)!.length || (p.aligned < q.aligned ? -1 : p.aligned > q.aligned ? 1 : p.index - q.index),
    )[0]
    primary.add(best.index)
    taken.add(best.aligned)
  }
  for (const f of [...byAligned.keys()].sort()) {
    if (taken.has(f)) continue
    const best = [...byAligned.get(f)!].sort(
      (p, q) => Number(q.primary) - Number(p.primary) || q.weight - p.weight || byAnchor.get(p.anchor)!.length - byAnchor.get(q.anchor)!.length || (p.anchor < q.anchor ? -1 : p.anchor > q.anchor ? 1 : p.index - q.index),
    )[0]
    primary.add(best.index)
  }

  // ── 成块：并查集 ──
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let cur = x
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!
      parent.set(cur, r)
      cur = next
    }
    return r
  }
  // 两层的 id 全局唯一，直接放进同一个并查集
  for (const m of maps) {
    if (!parent.has(m.anchor)) parent.set(m.anchor, m.anchor)
    if (!parent.has(m.aligned)) parent.set(m.aligned, m.aligned)
  }
  for (const m of maps) {
    if (!primary.has(m.index)) continue
    const a = find(m.anchor)
    const b = find(m.aligned)
    if (a !== b) parent.set(a > b ? a : b, a > b ? b : a)
  }
  const members = new Map<string, { anchors: string[]; aligned: string[] }>()
  for (const id of [...parent.keys()].sort()) {
    const root = find(id)
    const g = members.get(root) ?? { anchors: [], aligned: [] }
    members.set(root, g)
    if (byAnchor.has(id)) g.anchors.push(id)
    else g.aligned.push(id)
  }
  for (const root of [...members.keys()].sort()) {
    const g = members.get(root)!
    const index = ctx.blocks.length
    const type: BlockType = g.anchors.length === 1 ? (g.aligned.length === 1 ? 'one-one' : 'one-many') : g.aligned.length === 1 ? 'many-one' : 'many-many'
    const c = centroidOf(g.anchors.map((a) => out.get(a)!))!
    ctx.blocks.push({ index, type, anchors: g.anchors, aligned: g.aligned, anchorLayer: ctx.layerOf(g.anchors[0]), alignedLayer: ctx.li, center: [c.x, c.z] })
    for (const id of [...g.anchors, ...g.aligned]) {
      const list = ctx.blocksOf.get(id)
      if (list) list.push(index)
      else ctx.blocksOf.set(id, [index])
    }
  }
  const blockAt = (id: string) => find(id)
  for (const m of maps) ctx.linkClass.set(m.id, primary.has(m.index) ? 'primary' : blockAt(m.anchor) === blockAt(m.aligned) ? 'inner' : 'outer')

  // ── 目标位置：块里和它有映射的定位节点，按分量取重心 ──
  const mapped = nodes.filter((n) => byAligned.has(n.id))
  const pts = mapped.map((n) => {
    let x = 0
    let z = 0
    let w = 0
    const root = blockAt(n.id)
    for (const m of byAligned.get(n.id)!) {
      if (blockAt(m.anchor) !== root) continue
      const p = out.get(m.anchor)!
      x += p.x * m.weight
      z += p.z * m.weight
      w += m.weight
    }
    const g = members.get(root)!
    // 一对一的钉住：正正落在下方，分离时不动
    return { id: n.id, tx: x / w, tz: z / w, x: x / w, z: z / w, pinned: g.anchors.length === 1 && g.aligned.length === 1 }
  })
  // 目标重合的（一对多）围着那个点排一圈，不交给分离去随机推开
  const stacks = new Map<string, typeof pts>()
  for (const p of pts) {
    const key = `${Math.round(p.tx * 4)},${Math.round(p.tz * 4)}`
    const arr = stacks.get(key)
    if (arr) arr.push(p)
    else stacks.set(key, [p])
  }
  for (const stack of stacks.values()) {
    if (stack.length < 2) continue
    const rho = 1.2 + 0.32 * stack.length
    const a0 = hash01(stack[0].id + '#fan') * TAU
    stack.forEach((p, i) => {
      const a = a0 + (TAU * i) / stack.length
      p.tx = p.x = p.tx + Math.cos(a) * rho
      p.tz = p.z = p.tz + Math.sin(a) * rho
    })
  }
  const radii = mapped.map(rOf)
  const minD = (i: number, j: number) => radii[i] + radii[j] + 1.4
  for (let it = 0; it < 80; it++) {
    for (const p of pts) {
      if (p.pinned) continue
      p.x += (p.tx - p.x) * 0.1
      p.z += (p.tz - p.z) * 0.1
    }
    separate(pts, minD)
  }
  for (let it = 0; it < 20; it++) separate(pts, minD)
  for (const p of pts) out.set(p.id, { x: p.x, z: p.z })

  // ── 没有映射的：外圈，朝着本层邻居的方向 ──
  const orphans = nodes.filter((n) => !byAligned.has(n.id))
  if (orphans.length > 0) {
    const reach = Math.max(R, ...pts.map((p) => Math.hypot(p.x, p.z)))
    layoutRing(orphans, {
      R: reach,
      rOf,
      linkedPlaced: (id) => (ctx.intraNbrs.get(id) ?? []).filter((o) => byAligned.has(o)).map((o) => out.get(o)!),
      out,
    })
  }
}

// ─── 两版合集 ────────────────────────────────────────────────────────────────

/** 以 b 的顺序为准，a 独有的项插回它在 a 里前一项之后（前面都没有就放最前） */
function mergeOrdered<T>(a: T[], b: T[], key: (t: T) => string, keep: (t: T) => boolean = () => true): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  for (const t of b) {
    const k = key(t)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  let prevKey: string | null = null
  for (const t of a) {
    const k = key(t)
    if (seen.has(k)) {
      prevKey = k
      continue
    }
    if (!keep(t)) continue
    const at = prevKey === null ? 0 : out.findIndex((o) => key(o) === prevKey) + 1
    out.splice(at, 0, t)
    seen.add(k)
    prevKey = k
  }
  return out
}

export function unionData(a: Resolved, b: Resolved): Resolved {
  // 节点 id 全局唯一：b 里出现过的（哪怕换了层）就不再收 a 的那份
  const bNodeIds = new Set(b.layers.flatMap((l) => l.nodes.map((n) => n.id)))
  const aLayers = new Map(a.layers.map((l) => [l.id, l]))
  const bIds = new Set(b.layers.map((l) => l.id))
  const merged = mergeOrdered(a.layers, b.layers, (l) => l.id).map((l): ResolvedLayer => {
    if (!bIds.has(l.id)) return { ...l, nodes: l.nodes.filter((n) => !bNodeIds.has(n.id)) }
    const al = aLayers.get(l.id)
    if (!al) return l
    const nodes = mergeOrdered(al.nodes, l.nodes, (n) => n.id, (n) => !bNodeIds.has(n.id))
    const edges = mergeOrdered(al.edges ?? [], l.edges ?? [], (e) => e.id)
    const out: ResolvedLayer = { ...l, nodes }
    if (edges.length > 0 || l.edges || al.edges) out.edges = edges
    return out
  })
  const result: Resolved = {
    groups: mergeOrdered(a.groups, b.groups, (g) => g.id),
    layers: merged,
    links: mergeOrdered(a.links, b.links, (k) => k.id),
  }
  if (a.folded || b.folded) result.folded = { ...a.folded, ...b.folded }
  const title = b.title ?? a.title
  if (title !== undefined) result.title = title
  return result
}
