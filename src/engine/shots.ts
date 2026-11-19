// 镜头取景：每个机位框哪些点、怎么框。算点的部分是纯的（按层的目标高度、目标缩放：层还在缓动时也能对准），
// 交给渲染器的镜头（rig.frame / fit / fly）在后半部分。

import { FLOAT } from '../renderer/index.js'
import type { Model } from '../model.js'
import type { FitOptions, PlatePoint } from '../plugin.js'
import { emit, currentOf, hiddenOf, type Core } from './core.js'
import { arrange } from './layers.js'
import type { ShotName } from './types.js'

export type Vec3 = [number, number, number]

/** 层现在要去的高度和缩放（渲染器的 goalY / goalScale） */
export interface Goals {
  goalY(layer: number): number
  goalScale(layer: number): number
}

/** 一层盘面的边上的四个点：配角那一层是缩小的，按缩小之后的大小算 */
export function rimPoints(radius: number | undefined, layer: number, g: Goals): Vec3[] {
  const R = (radius ?? 20) * g.goalScale(layer)
  const y = g.goalY(layer)
  return [
    [R, y, 0],
    [-R, y, 0],
    [0, y, R],
    [0, y, -R],
  ]
}

/** 总览要框住的点：所有可见层的盘边 */
export function overviewPoints(radii: readonly number[], hidden: ReadonlySet<number>, g: Goals): Vec3[] {
  return radii.flatMap((r, li) => (hidden.has(li) ? [] : rimPoints(r, li, g)))
}

/** 从正上方看（叠看、一张图时的俯视）：y 是看的那一层的高度，R 是最大的盘面半径 */
export function topPose(R: number, y: number) {
  return { pos: [0, y + R * 6.2, 0.01] as Vec3, target: [0, y, 0] as Vec3, fov: 21 }
}

/** 盘面上的点换成世界坐标：按层的目标高度和缩放，浮在盘面上面一点 */
export function worldPoints(points: readonly PlatePoint[], g: Goals): Vec3[] {
  return points.map((p): Vec3 => {
    const sc = g.goalScale(p.layer)
    return [p.x * sc, g.goalY(p.layer) + FLOAT, p.z * sc]
  })
}

/**
 * 节点（id）在盘面上的点：按模型的布局，层是节点画在哪一层。indexOf 把收起的子节点算到画出来的祖先头上；
 * 找不到的节点跳过
 */
export function nodePoints(m: Pick<Model, 'base' | 'layout'>, ids: readonly string[], indexOf: (id: string) => number): PlatePoint[] {
  const out: PlatePoint[] = []
  for (const id of ids) {
    const n = m.base.nodes[indexOf(id)]
    const p = n && m.layout.nodes.get(n.id)
    if (p) out.push({ layer: n.layer, x: p.x, z: p.z })
  }
  return out
}

// 有主角时镜头贴近：主角那一层铺满画面，配角露在它的上方或下方；上面多留一点：弧线和名字会高出盘面
const OVERVIEW_HERO = { elevation: 0.5, azimuth: 0, padX: 0.05, padTop: 0.12, padBottom: 0.05 }
const OVERVIEW_FLAT = { elevation: 0.55, azimuth: 0, margin: 0.86 }
const LAYER_FIT = { elevation: 0.72, margin: 1.02 }

/** 从叠看换到别的镜头：先把层距放回去，后面按放回去之后的高度取景 */
function leaveOverlay(c: Core) {
  if (!c.overlay) return
  c.overlay = false
  arrange(c)
}

/** 机位。layer 是 'layer' 机位框的那一层的下标 */
export function camera(c: Core, name: ShotName, duration: number, layer?: number) {
  const r = c.renderer
  c.autoFrame = name === 'overview'
  c.pluginFramed = false
  const radii = (currentOf(c)?.renderer.plates.plates ?? []).map((p) => p.radius)
  if (name !== 'top') leaveOverlay(c)
  if (name === 'overview') {
    const pts = overviewPoints(radii, hiddenOf(c), r)
    if (c.hero.hero >= 0) r.rig.frame(pts, { ...OVERVIEW_HERO, duration })
    else r.rig.fit(pts, { ...OVERVIEW_FLAT, duration })
    return
  }
  if (name === 'top') return top(c, radii)
  if (layer !== undefined) r.rig.fit(rimPoints(radii[layer], layer, r), { ...LAYER_FIT, duration })
}

/** 叠看：几张图叠在一起对照，层距收到几乎为零，从正上方看。只有一张图时是主图层的地图：其余层收起来 */
function top(c: Core, radii: number[]) {
  const r = c.renderer
  const m = currentOf(c)
  const prim = m?.renderer.anchor ?? 0
  const R = Math.max(...radii)
  if ((m?.data.layers.length ?? 0) >= 2) {
    if (c.state.focusLayer !== null) {
      c.state.focusLayer = null
      emit(c, 'focus', null)
    }
    c.overlay = true
    arrange(c)
    r.rig.fly(topPose(R, 0))
    return
  }
  if (!c.active && c.state.focusLayer !== prim) {
    c.state.focusLayer = prim
    r.setLayout(prim, c.spread)
    emit(c, 'focus', m?.data.layers[prim]?.id ?? null)
  }
  r.rig.fly(topPose(R, r.goalY(prim)))
}

/** 镜头框住盘面上的这些点（给插件用：路径、某一处变化） */
export function fitPoints(c: Core, points: readonly PlatePoint[], opts: FitOptions) {
  if (c.disposed) return
  c.autoFrame = false
  c.pluginFramed = true
  leaveOverlay(c)
  c.renderer.rig.fit(worldPoints(points, c.renderer), opts)
}

/**
 * 插件交还镜头：镜头还是插件框的（用户之后没动过）、或者本来就停在总览，就回到总览；
 * 用户自己摆过的镜头不动
 */
export function releaseCamera(c: Core, duration = 1.3) {
  if (c.disposed || !(c.autoFrame || c.pluginFramed)) return
  camera(c, 'overview', duration)
}
