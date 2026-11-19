// 路径回放里不碰渲染器的计算：跳过隐藏层的步骤、走到第几步、每一段长到哪、每帧往 Looks 上叠什么。

import { mixHex } from '../color.js'
import type { EdgeLook, Looks, PlacedNode } from '../types.js'

/** Seconds per path step. */
export const STEP = 0.8
/** The step numbers drawn next to visited nodes (①…⑳). */
export const DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** One replay run: the visited nodes (base indexes), which segments skip hidden layers, and when it starts (engine clock). */
export interface PathRun {
  nodes: number[]
  /** `dashed[k]`: between step k and k+1 nodes in hidden layers were skipped; drawn dashed. */
  dashed: boolean[]
  start: number
}

/**
 * Steps as given (node indexes, `-1` for unknown) → steps actually visited. Two consecutive steps on the
 * same node merge; steps in hidden layers are skipped and the segment around them is dashed.
 */
export function stepsOf(indices: readonly number[], layerOf: (i: number) => number, hidden: ReadonlySet<number>): { nodes: number[]; dashed: boolean[] } {
  const all = indices.filter((i, k, arr) => i >= 0 && i !== arr[k - 1])
  const nodes: number[] = []
  const dashed: boolean[] = []
  let skipped = false
  for (const i of all) {
    if (hidden.has(layerOf(i))) {
      skipped = true
      continue
    }
    if (nodes.length > 0) dashed.push(skipped)
    nodes.push(i)
    skipped = false
  }
  return { nodes, dashed }
}

/** How many nodes are lit `elapsed` seconds after the start (0 before the start). */
export function reachedAt(elapsed: number, count: number): number {
  return Math.min(count, Math.floor(elapsed / STEP) + 1)
}

/** How far segment k (step k to k+1) has grown, 0..1. */
export function segmentProgress(elapsed: number, k: number): number {
  return Math.max(0, Math.min(1, (elapsed - k * STEP) / STEP))
}

/** The spotlight ranks for the style: `rank[i]` is node i's step (from 1), 0 = not reached. A node visited twice keeps the later step. */
export function rankOf(nodes: readonly number[], reached: number, out: Int32Array): Int32Array {
  out.fill(0)
  for (let k = 0; k < reached; k++) out[nodes[k]] = k + 1
  return out
}

function segment(): EdgeLook {
  return {
    visible: false,
    a: { x: 0, z: 0, layer: 0, lift: 0 },
    b: { x: 0, z: 0, layer: 0, lift: 0 },
    arc: 0,
    colorA: '#ffffff',
    colorB: '#ffffff',
    alpha: 0,
    width: 1,
    dash: false,
    progress: 1,
    fromTarget: false,
    flow: 0,
    phase: 0,
    intensity: 1,
  }
}

/** What drawing a path needs from the model: labels, ids, positions, node colours and the theme's accent. */
export interface PathPaintModel {
  labels: readonly string[]
  ids: readonly string[]
  layout: { nodes: Map<string, PlacedNode> }
  colors: readonly string[]
  accent: string
}

/**
 * Step ②: paints the path over the styled looks: step numbers on visited nodes, a ripple at the tip,
 * segments growing in order and then a comet along them (in `Looks.extra.path`). Brightness is the
 * style's job (`rankOf`). With `run` `null` it clears its own lines.
 */
export function paintPath(looks: Looks, m: PathPaintModel, run: PathRun | null, time: number) {
  const segs = looks.extra.path
  if (!run) {
    segs.length = 0
    return
  }
  const { nodes, dashed } = run
  const elapsed = time - run.start
  const reached = reachedAt(elapsed, nodes.length)
  // 序号：同一个节点走到两次，按后一次标
  for (let k = 0; k < reached; k++) {
    const i = nodes[k]
    const o = looks.nodes[i]
    o.step = k + 1
    if (o.label) o.label.text = `${DIGITS[k] ?? k + 1} ${m.labels[i]}`
  }
  // 路径的笔尖处：盘面荡开一圈
  if (reached > 0) {
    const k = reached - 1
    const ni = nodes[k]
    const p = m.layout.nodes.get(m.ids[ni])!
    looks.ripples.push({ x: p.x, z: p.z, layer: looks.nodes[ni].layer, p: Math.min(0.999, (elapsed - k * STEP) / 1.6), color: m.accent })
    looks.nodes[ni].pulse = ((elapsed - k * STEP) % 1.6) / 1.6
  }
  // 路径的每一段：按顺序长出来，长完以后彗星沿路走
  const extra = Math.max(0, nodes.length - 1)
  segs.length = extra
  for (let k = 0; k < extra; k++) {
    const o = (segs[k] ??= segment())
    const a = looks.nodes[nodes[k]]
    const b = looks.nodes[nodes[k + 1]]
    o.a.x = a.x
    o.a.z = a.z
    o.a.layer = a.layer
    o.a.lift = a.lift
    o.b.x = b.x
    o.b.z = b.z
    o.b.layer = b.layer
    o.b.lift = b.lift
    const len = Math.hypot(a.x - b.x, a.z - b.z)
    const prog = segmentProgress(elapsed, k)
    o.visible = prog > 0
    o.arc = a.layer === b.layer ? len * 0.16 + 0.4 : 0.6
    o.colorA = mixHex(m.colors[nodes[k]], m.accent, 0.55)
    o.colorB = mixHex(m.colors[nodes[k + 1]], m.accent, 0.55)
    o.alpha = 0.9
    o.width = 1.6
    // 这一段跳过了隐藏层里的节点：画成虚线
    o.dash = !!dashed[k]
    o.progress = prog
    o.fromTarget = false
    o.flow = prog >= 1 ? 0.9 : 0
    o.phase = k * 0.137
    o.intensity = 1.2
  }
}
