// kgdiff 适配层：两版 Resolved → kgdiff 场景；每帧把 kgdiff 的平面样式翻译成 3D 的 Looks。
// 语义（五类变化、颜色、回放编排）全部交给 kgdiff，这里只做坐标、层、抬升这些 3D 才有的事。

import { diff, type GraphInput, type EdgeInput, type NodeInput, type AttrValue } from '@kgdiff/core'
import type { LayoutResult } from '@kgdiff/layout'
import {
  buildScene,
  createViewState,
  createVisualResolver,
  type ChangeFamily,
  type FrameVisuals,
  type LabelVisual,
  type Scene,
} from '@kgdiff/scene'
import type {
  BaseEdge,
  BaseNode,
  EdgeLook,
  LabelLook,
  Looks,
  NodeLook,
  ResolvedNode,
  Resolved,
  StrataLayout,
} from '../types.js'

import { DEFAULT_LOCALE, message, type Locale } from '../locale.js'
import { DEFAULT_SHAPE, magnitudeOf } from '../model.js'
import { DARK, type Theme } from '../theme.js'

export type { ChangeFamily }

export interface DiffHunk {
  index: number
  id: string
  kind: string
  family: ChangeFamily
  title: string
  subtitle: string
  /** 这个 hunk 自己的节点（base 下标）；relations 类 hunk 没有自己的节点，此时为它的上下文节点 */
  nodes: number[]
  /** 读懂它需要的上下文节点（base 下标，不含 nodes） */
  context: number[]
  /** nodes 的盘面重心 */
  center: [number, number]
  /** nodes 里出现最多的层 */
  layer: number
  radius: number
  /** 回放窗口（ms，1× 速度） */
  start: number
  end: number
}

export interface StrataDiff {
  scene: Scene
  base: { nodes: BaseNode[]; edges: BaseEdge[] }
  hunks: DiffHunk[]
  duration: number
  /** 节点 + 边的合计 */
  stats: { added: number; removed: number; changed: number }
}

export interface DiffView {
  layer: 'union' | 'before' | 'after' | 'replay'
  t: number
  selectedHunk: number
  hoveredNode: number
  selectedNode: number
  reducedMotion: boolean
  emphasis: number
}

// kgstrata 自己放进 kgdiff 图里的东西都带 strata 前缀，不会和用户数据里的关系类型、属性撞名
/** 包含关系（子 → 父）的谓词：子节点换了父节点，kgdiff 认成“挪位置” */
export const HIERARCHY_PREDICATE = 'strata:parent'
/** 没写类型的关系用的谓词 */
const DEFAULT_PREDICATE = 'strata:related'
/** 节点在哪一层、哪个组、里面收着哪些子节点；关系的分量 */
export const ATTR = { layer: 'strata.layer', group: 'strata.group', folds: 'strata.folds', weight: 'strata.weight' } as const


// ─── Resolved → kgdiff 图 ──────────────────────────────────────────────────

/**
 * replaces：新节点 id → 它吸收了哪些旧节点（kgdiff 会认成合并）。
 * 节点的 type 是它自己的类型（实体、表……）；层和组是属性，换层、换组都报成属性变了。
 * 收在节点里的子节点（表里的字段）记成一条属性：没展开的时候，加字段、删字段也看得到。
 * 关系带着 id、分量和属性：映射的分量变了、口径变了都算变化。
 * locale：没写类型的关系、包含关系显示成什么字（kgdiff 写变化说明时用）；谓词本身不随语言变。
 */
export function toKgdiffGraph(data: Resolved, replaces: Record<string, string[]> = {}, locale: Locale = DEFAULT_LOCALE): GraphInput {
  const related = message(locale, 'label.related')
  const partOf = message(locale, 'label.part-of')
  const nodes: NodeInput[] = []
  const edges: EdgeInput[] = []
  const withWeight = (attrs: Record<string, AttrValue> | undefined, weight: number | undefined) =>
    weight === undefined ? attrs : { ...attrs, [ATTR.weight]: weight }
  for (const layer of data.layers) {
    for (const n of layer.nodes) {
      const attrs: Record<string, AttrValue> = { ...n.attrs, [ATTR.layer]: layer.id }
      if (n.group !== undefined) attrs[ATTR.group] = n.group
      if (n.folds?.length) attrs[ATTR.folds] = [...n.folds].sort()
      nodes.push({ id: n.id, label: n.label, type: n.type, attrs, replaces: Object.hasOwn(replaces, n.id) ? replaces[n.id] : undefined })
      if (n.parent !== undefined) {
        edges.push({ id: `${n.id}|${HIERARCHY_PREDICATE}|${n.parent}`, source: n.id, target: n.parent, predicate: HIERARCHY_PREDICATE, label: partOf })
      }
    }
    for (const e of layer.edges ?? []) {
      edges.push({ id: e.id, source: e.source, target: e.target, predicate: e.type ?? DEFAULT_PREDICATE, label: e.label ?? e.type ?? related, attrs: withWeight(e.attrs, e.weight) })
    }
  }
  for (const l of data.links) {
    edges.push({ id: l.id, source: l.source, target: l.target, predicate: l.type ?? DEFAULT_PREDICATE, label: l.label ?? l.type ?? related, attrs: withWeight(l.attrs, l.weight) })
  }
  return { nodes, edges, meta: data.title ? { name: data.title } : undefined }
}

function specIndex(data: Resolved): Map<string, ResolvedNode> {
  const m = new Map<string, ResolvedNode>()
  for (const layer of data.layers) for (const spec of layer.nodes) m.set(spec.id, spec)
  return m
}

// ─── 构建 ────────────────────────────────────────────────────────────────────

export async function buildStrataDiff(
  before: Resolved,
  after: Resolved,
  layout: StrataLayout,
  opts: { locale?: Locale; replaces?: Record<string, string[]>; theme?: Theme } = {},
): Promise<StrataDiff> {
  const locale = opts.locale ?? DEFAULT_LOCALE
  const res = await diff(toKgdiffGraph(before, {}, locale), toKgdiffGraph(after, opts.replaces, locale), {
    match: { strategy: 'id' },
    edgeIdentity: 'id',
    hierarchyPredicates: [HIERARCHY_PREDICATE],
  })

  // 合集 id 一般就是 after id（否则 before id）；万一布局用的是另一版的 id，退回去查
  const placedOf = (unionId: string) => {
    const direct = layout.nodes.get(unionId)
    if (direct) return direct
    const u = res.index.node(unionId)
    return (u?.afterId && layout.nodes.get(u.afterId)) || (u?.beforeId && layout.nodes.get(u.beforeId)) || undefined
  }

  const positions = new Map<string, { x: number; y: number }>()
  const radii = new Map<string, number>()
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const u of res.nodes) {
    const p = placedOf(u.id)
    // 布局漏掉的节点放在盘心，避免 kgdiff 把它挤出场景、下标对不上
    const x = p?.x ?? 0, y = p?.z ?? 0, r = p?.r ?? 0.5
    positions.set(u.id, { x, y })
    radii.set(u.id, r)
    x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r)
  }
  if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1 }
  const kgLayout = {
    positions,
    radii,
    bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    scope: 'all',
    hidden: new Map(),
    components: [],
    stats: { strategy: 'union', iterations: 0, nodes: res.nodes.length, ms: 0 },
  } as unknown as LayoutResult

  const scene = buildScene(res, kgLayout, { theme: (opts.theme ?? DARK).diffScheme, locale })

  const beforeSpecs = specIndex(before)
  const afterSpecs = specIndex(after)
  // 星等按合集里每层的顶层节点数算，和全景的档位对得上
  const layerCount = new Map<number, number>()
  for (const p of layout.nodes.values()) if (p.depth === 0) layerCount.set(p.layer, (layerCount.get(p.layer) ?? 0) + 1)
  const baseNodes: BaseNode[] = scene.nodes.map((sn) => {
    const u = res.index.node(sn.id)
    const ref = (u?.afterId !== undefined ? afterSpecs.get(u.afterId) : undefined)
      ?? (u?.beforeId !== undefined ? beforeSpecs.get(u.beforeId) : undefined)
    const p = placedOf(sn.id)
    return {
      id: sn.id,
      layer: p?.layer ?? 0,
      shape: ref?.shape ?? DEFAULT_SHAPE,
      r: p?.r ?? sn.r,
      group: p?.group ?? -1,
      mono: ref?.mono ?? false,
      mag: p ? magnitudeOf(p, layerCount.get(p.layer) ?? 1) : 3,
    }
  })

  const baseEdges: BaseEdge[] = scene.edges.map((se) => {
    const pred = res.index.edge(se.id)?.predicate
    const kind = baseNodes[se.s].layer !== baseNodes[se.t].layer
      ? 'cross'
      : pred === HIERARCHY_PREDICATE ? 'contain' : 'intra'
    return { s: se.s, t: se.t, kind }
  })

  const windowOf = new Map(scene.timeline.windows.map((w) => [w.hunk, w]))
  const hunks: DiffHunk[] = scene.hunks.map((h) => {
    const own = [...h.nodes]
    const context = h.context.filter((i) => !own.includes(i))
    const pts = own.length ? own : context
    let cx = 0, cz = 0
    const count = new Map<number, number>()
    for (const i of pts) {
      cx += scene.nodes[i].x; cz += scene.nodes[i].y
      const l = baseNodes[i].layer
      count.set(l, (count.get(l) ?? 0) + 1)
    }
    if (pts.length) { cx /= pts.length; cz /= pts.length }
    let layer = 0, best = -1
    for (const [l, c] of count) if (c > best || (c === best && l < layer)) { layer = l; best = c }
    let far = 0
    for (const i of pts) far = Math.max(far, Math.hypot(scene.nodes[i].x - cx, scene.nodes[i].y - cz))
    const w = windowOf.get(h.index)
    return {
      index: h.index,
      id: h.id,
      kind: h.kind,
      family: h.family,
      title: h.title,
      subtitle: h.subtitle,
      nodes: own.length ? own : context,
      context: own.length ? context : [],
      center: [cx, cz],
      layer,
      radius: far + 4,
      start: w?.start ?? 0,
      end: w?.end ?? 0,
    }
  })

  const s = scene.stats
  return {
    scene,
    base: { nodes: baseNodes, edges: baseEdges },
    hunks,
    duration: scene.timeline.duration,
    stats: {
      added: s.nodes.added + s.edges.added,
      removed: s.nodes.removed + s.edges.removed,
      changed: s.nodes.modified + s.edges.modified,
    },
  }
}

// ─── 颜色：kgdiff 可能给 rgba()，契约要 #rrggbb，透明度并进 alpha ─────────

interface Rgb { hex: string; a: number }
const colorCache = new Map<string, Rgb>()
function parseColor(c: string): Rgb {
  let v = colorCache.get(c)
  if (v) return v
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c)
  if (m) {
    const h = (n: string) => Math.round(Math.min(255, Number(n))).toString(16).padStart(2, '0')
    v = { hex: `#${h(m[1])}${h(m[2])}${h(m[3])}`, a: m[4] === undefined ? 1 : Number(m[4]) }
  } else if (/^#[0-9a-f]{8}$/i.test(c)) {
    v = { hex: c.slice(0, 7).toLowerCase(), a: parseInt(c.slice(7), 16) / 255 }
  } else if (/^#[0-9a-f]{3}$/i.test(c)) {
    v = { hex: `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase(), a: 1 }
  } else {
    v = { hex: c, a: 1 }
  }
  colorCache.set(c, v)
  return v
}

// ─── 每帧 ────────────────────────────────────────────────────────────────────

const GOLDEN = 0.618033988749895
const LIFT_FLY = 3.2
const LIFT_RISE = 2.4
const LIFT_SINK = 1.6

function newEnd() { return { x: 0, z: 0, layer: 0, lift: 0 } }
function newEdgeLook(): EdgeLook {
  return {
    visible: false, a: newEnd(), b: newEnd(), arc: 0, colorA: '#000000', colorB: '#000000', alpha: 0,
    width: 1, dash: false, progress: 1, fromTarget: false, flow: 0, phase: 0, intensity: 1,
  }
}
function newNodeLook(): NodeLook {
  return {
    visible: false, x: 0, z: 0, layer: 0, lift: 0, scale: 1, color: '#000000', intensity: 1, alpha: 1,
    ghost: false, ring: null, halo: null, pulse: 0, label: null, label2: null, badge: null, step: 0,
  }
}

function weightOf(w: number): 400 | 500 | 600 {
  return w < 450 ? 400 : w < 550 ? 500 : 600
}

/** 复用旧的 LabelLook（回放里标签每帧都在，不要每帧分配） */
function toLabel(v: LabelVisual | null, prev: LabelLook | null, mono: boolean): LabelLook | null {
  if (!v) return null
  const c = parseColor(v.color)
  const l = prev ?? { text: '', color: '', alpha: 0, size: 0, weight: 400, strike: false, priority: 0 }
  l.text = v.text
  l.color = c.hex
  l.alpha = v.alpha * c.a
  l.size = v.size + 1
  l.weight = weightOf(v.weight)
  l.strike = v.strike
  l.priority = v.priority
  l.mono = mono
  return l
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export function createDiffLooks(d: StrataDiff): { resolve(view: DiffView, out?: Looks): Looks } {
  const { scene, base } = d
  const resolver = createVisualResolver(scene)
  const neutralNode = scene.theme.neutral.node
  const nodeCount = base.nodes.length
  const edgeCount = base.edges.length

  let layerCount = 0
  let groupCount = 0
  for (const n of base.nodes) {
    layerCount = Math.max(layerCount, n.layer + 1)
    groupCount = Math.max(groupCount, n.group + 1)
  }

  // 每个 hunk 碰到哪些层（自己的节点 + 上下文），聚焦时其他层压暗
  const hunkLayers = d.hunks.map((h) => {
    const m = new Uint8Array(layerCount)
    for (const i of h.nodes) m[base.nodes[i].layer] = 1
    for (const i of h.context) m[base.nodes[i].layer] = 1
    return m
  })
  // 节点所在 hunk 的回放开始时刻：删除节点只在自己的窗口开始后才下沉，别被别的 hunk 的压暗带着沉
  const nodeHunkStart = new Float64Array(nodeCount).fill(Infinity)
  for (let i = 0; i < nodeCount; i++) {
    const h = scene.nodes[i].hunk
    if (h >= 0 && d.hunks[h]) nodeHunkStart[i] = d.hunks[h].start
  }

  let frame: FrameVisuals | undefined
  const lifts = new Float64Array(nodeCount)
  const ripplePools = new WeakMap<Looks, Looks['ripples']>()

  // glyph 只有平面坐标：找这一帧离它最近的可见节点，借它的层和抬升
  const nearest = (x: number, y: number) => {
    let best = -1, bd = Infinity
    const nodes = frame!.nodes
    for (let i = 0; i < nodeCount; i++) {
      const v = nodes[i]
      const dd = (v.x - x) ** 2 + (v.y - y) ** 2
      if (dd < bd) { bd = dd; best = i }
    }
    return best
  }

  function resolve(view: DiffView, out?: Looks): Looks {
    frame = resolver.resolve(
      createViewState({
        layer: view.layer,
        t: view.t,
        selectedHunk: view.selectedHunk,
        hoveredNode: view.hoveredNode,
        selectedNode: view.selectedNode,
        reducedMotion: view.reducedMotion,
        emphasis: view.emphasis,
      }),
      frame,
    )
    const looks: Looks = out ?? { nodes: [], edges: [], extra: { bridges: [], path: [], marks: [] }, groups: [], neutral: 1, layers: [], ripples: [] }
    const replay = view.layer === 'replay'
    const motion = !view.reducedMotion

    // ── 节点
    const nl = looks.nodes
    while (nl.length < nodeCount) nl.push(newNodeLook())
    nl.length = nodeCount
    let ripplePool = ripplePools.get(looks)
    if (!ripplePool) { ripplePool = []; ripplePools.set(looks, ripplePool) }
    looks.ripples.length = 0

    for (let i = 0; i < nodeCount; i++) {
      const v = frame.nodes[i]
      const sn = scene.nodes[i]
      const b = base.nodes[i]
      const o = nl[i]
      o.visible = v.visible && v.alpha > 0.003
      o.x = v.x
      o.z = v.y
      o.layer = b.layer
      o.scale = sn.r > 0 ? clamp(v.r / sn.r, 0, 1.6) : 1
      if (!Number.isFinite(o.scale)) o.scale = 0
      const fill = parseColor(v.fill ?? v.stroke ?? neutralNode)
      o.color = fill.hex
      o.ghost = v.fill === null
      o.intensity = (v.family !== 'neutral' ? 1.35 : 0.7) * (view.selectedHunk >= 0 && sn.hunk === view.selectedHunk ? 1.15 : 1)
      o.alpha = v.alpha
      if (v.ring) {
        const c = parseColor(v.ring.color)
        const r = o.ring ?? { color: '', alpha: 0 }
        r.color = c.hex; r.alpha = v.ring.alpha * c.a
        o.ring = r
      } else o.ring = null
      if (v.halo) {
        const c = parseColor(v.halo.color)
        const h = o.halo ?? { color: '', alpha: 0, size: 2.6 }
        h.color = c.hex; h.alpha = v.halo.alpha * c.a; h.size = 2.6
        o.halo = h
      } else o.halo = null
      o.pulse = v.pulse
      o.badge = v.badge?.text ?? null
      o.step = 0
      o.label = toLabel(v.label, o.label, b.mono)
      o.label2 = toLabel(v.secondaryLabel, o.label2, b.mono)

      // ── 抬升：3D 才有的动作
      let lift = 0
      if (motion) {
        if ((sn.role === 'merge-source' || sn.role === 'split-target') && sn.flow !== undefined && sn.flow >= 0) {
          const f = scene.nodes[sn.flow]
          // 合并：自己 → 目标；拆分：来源 → 自己
          const sx = sn.role === 'merge-source' ? sn.x : f.x
          const sy = sn.role === 'merge-source' ? sn.y : f.y
          const ex = sn.role === 'merge-source' ? f.x : sn.x
          const ey = sn.role === 'merge-source' ? f.y : sn.y
          const span = Math.hypot(ex - sx, ey - sy)
          if (span > 1e-6) {
            const p = clamp(Math.hypot(v.x - sx, v.y - sy) / span, 0, 1)
            // 弧高随飞行距离：挨得近的不必跳得很高，远的封顶
            lift = Math.min(LIFT_FLY, 0.9 + span * 0.35) * Math.sin(Math.PI * p)
          }
        } else if (sn.presentAfter && !sn.presentBefore) {
          // kgdiff 在窗口前只把 alpha 置 0、半径不变；回放里没出现的当作还没长，先待在盘下
          const grown = replay && !o.visible ? 0 : Math.min(o.scale, 1)
          if (grown < 1) lift = -LIFT_RISE * (1 - grown)
        } else if (sn.presentBefore && !sn.presentAfter) {
          if (replay && view.t >= nodeHunkStart[i]) lift = -LIFT_SINK * (1 - Math.min(1, v.alpha / 0.9))
        }
      }
      o.lift = lift
      lifts[i] = lift

      if (v.pulse > 0 && o.visible) {
        const k = looks.ripples.length
        const r = ripplePool[k] ?? (ripplePool[k] = { x: 0, z: 0, layer: 0, p: 0, color: '' })
        r.x = v.x; r.z = v.y; r.layer = b.layer; r.p = v.pulse
        r.color = parseColor(v.ring?.color ?? v.fill ?? v.stroke ?? neutralNode).hex
        looks.ripples.push(r)
      }
    }

    // ── 边
    const el = looks.edges
    while (el.length < edgeCount) el.push(newEdgeLook())
    el.length = edgeCount
    for (let i = 0; i < edgeCount; i++) {
      const v = frame.edges[i]
      const se = scene.edges[i]
      const be = base.edges[i]
      const o = el[i]
      const c = parseColor(v.color)
      o.visible = v.visible && v.alpha > 0.003
      o.a.x = v.x1; o.a.z = v.y1; o.a.layer = base.nodes[se.s].layer; o.a.lift = lifts[se.s]
      o.b.x = v.x2; o.b.z = v.y2; o.b.layer = base.nodes[se.t].layer; o.b.lift = lifts[se.t]
      const len = Math.hypot(v.x2 - v.x1, v.y2 - v.y1)
      o.arc = be.kind === 'cross' ? 0 : 0.12 * len + Math.abs(v.curvature) * len * 0.5
      o.colorA = o.colorB = c.hex
      o.alpha = v.alpha * c.a
      o.width = v.width * 1.1
      o.dash = v.dash !== null
      o.progress = v.progress
      o.fromTarget = v.fromTarget
      const changed = se.family !== 'neutral'
      o.flow = changed ? 0.7 : 0
      o.phase = (i * GOLDEN) % 1
      o.intensity = changed ? 1.25 : 0.55
    }

    // ── glyph → 标记线（合并箭头、边的幽灵）
    const ml = looks.extra.marks
    let k = 0
    for (const g of frame.glyphs) {
      if (g.kind === 'pivot' || g.kind === 'move-arrow') continue
      if (ml.length <= k) ml.push(newEdgeLook())
      const o = ml[k++]
      const c = parseColor(g.color)
      const na = nearest(g.x1, g.y1)
      const nb = nearest(g.x2, g.y2)
      const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1)
      const arrow = g.kind === 'merge-arrow' || g.kind === 'split-arrow' || g.kind === 'replacement-arrow'
      o.visible = g.alpha > 0.003 && g.progress > 0
      o.a.x = g.x1; o.a.z = g.y1; o.a.layer = na >= 0 ? base.nodes[na].layer : 0; o.a.lift = na >= 0 ? lifts[na] : 0
      o.b.x = g.x2; o.b.z = g.y2; o.b.layer = nb >= 0 ? base.nodes[nb].layer : 0; o.b.lift = nb >= 0 ? lifts[nb] : 0
      o.arc = arrow ? 2.5 + 0.25 * len : 0.12 * len + Math.abs(g.curvature) * len * 0.5
      o.colorA = o.colorB = c.hex
      o.alpha = g.alpha * c.a
      o.width = g.width * 1.1
      o.dash = arrow ? g.dash !== null : true
      o.progress = g.progress
      o.fromTarget = false
      o.flow = arrow ? 0.7 : 0
      o.phase = (k * GOLDEN) % 1
      o.intensity = arrow ? 1.25 : 0.9
    }
    for (let i = k; i < ml.length; i++) ml[i].visible = false

    // ── 领域、层
    const gr = looks.groups
    gr.length = groupCount
    gr.fill(0)
    looks.neutral = 1
    const ly = looks.layers
    ly.length = layerCount
    ly.fill(1)
    let focus = view.selectedHunk
    if (focus < 0 && replay) {
      // 回放里没选 hunk 时，跟着正在播的那个
      for (const h of d.hunks) if (view.t >= h.start && view.t <= h.end) { focus = h.index; break }
    }
    const touched = focus >= 0 ? hunkLayers[focus] : undefined
    if (touched) {
      const dim = 1 - 0.45 * clamp(frame.spotlight, 0, 1)
      for (let l = 0; l < layerCount; l++) if (!touched[l]) ly[l] = dim
    }
    return looks
  }

  return { resolve }
}
