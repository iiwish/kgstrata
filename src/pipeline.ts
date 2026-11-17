// 每一帧的 Looks 怎么来：① 基础样式 → ② 叠加层 → ③ 核心的统一后处理。见 plugin.ts 开头的说明。
// 这里是不碰渲染器的那部分，单独拿出来好测。

import type { FrameInfo, StrataOverlay } from './plugin.js'
import type { Spotlight } from './styler.js'
import type { Looks } from './types.js'

/** 几个叠加层都给了强调串时，后装的说了算 */
export function spotlightOf(overlays: readonly StrataOverlay[]): Spotlight | null {
  let out: Spotlight | null = null
  for (const o of overlays) out = o.spotlight?.() ?? out
  return out
}

/**
 * 走一遍管线。base 出 ① 的样子（核心的样式或接管的模式），没有就返回 null；
 * paintOverlays 为 false 时跳过 ②（有模式接管时叠加层不画）；post 是 ③。
 */
export function composeFrame(
  base: () => Looks | null,
  overlays: readonly StrataOverlay[],
  frame: FrameInfo,
  post: (looks: Looks) => void,
  paintOverlays = true,
): Looks | null {
  const looks = base()
  if (!looks) return null
  if (paintOverlays) for (const o of overlays) o.paint?.(looks, frame)
  post(looks)
  return looks
}

/**
 * ③ 隐藏的层：节点、关系、盘面一起淡出。presence 是每层现在在不在场 0..1，原地缓动到 goals（1 显示，0 隐藏）；
 * layerOf[i] 是第 i 个节点在哪一层（和 looks.nodes 对齐）。
 * 返回穿透线该显出来多少 0..1：等隐藏的层淡下去了再显出来；没有隐藏的层是 0。
 */
export function fadePresence(looks: Looks, presence: number[], goals: readonly number[], layerOf: (i: number) => number, nodeCount: number, dt: number): number {
  let anyHidden = false
  let most = 0
  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i]
    presence[i] += (goal - presence[i]) * Math.min(1, dt * 6)
    if (Math.abs(goal - presence[i]) < 0.004) presence[i] = goal
    if (goal === 0) {
      anyHidden = true
      most = Math.max(most, presence[i])
    }
  }
  looks.presence = presence
  const bridgeIn = anyHidden ? 1 - most : 0
  if (!anyHidden && presence.every((p) => p === 1)) return bridgeIn
  for (let i = 0; i < nodeCount; i++) {
    const p = presence[layerOf(i)] ?? 1
    if (p >= 1) continue
    const l = looks.nodes[i]
    l.alpha *= p
    if (p < 0.02) l.visible = false
  }
  // 所有的线都看两端在哪一层：底子的边和 extra 里谁的线都一样（穿透线、插件的线、kgdiff 的合并箭头和删除的幽灵边）
  for (const list of [looks.edges, ...Object.values(looks.extra)]) {
    for (const l of list) {
      const p = Math.min(presence[l.a.layer] ?? 1, presence[l.b.layer] ?? 1)
      if (p >= 1) continue
      l.alpha *= p
      if (p < 0.02) l.visible = false
    }
  }
  return bridgeIn
}
