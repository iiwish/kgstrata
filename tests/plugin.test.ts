import { describe, expect, it } from 'vitest'
import { SMALL_PATH, small } from './fixtures/small'
import { layoutStrata } from '../src/layout'
import { buildModel, nodeColor } from '../src/model'
import { paintPath, rankOf, reachedAt, segmentProgress, stepsOf, STEP, type PathRun } from '../src/path/steps'
import { composeFrame, fadePresence, spotlightOf } from '../src/pipeline'
import { CORE_VIEW_KEYS, Emitter, ViewRegistry, type StrataOverlay } from '../src/plugin'
import { normalize, project } from '../src/resolve'
import { Styler, type StyleState } from '../src/styler'
import type { EdgeLook, Looks } from '../src/types'

// 插件契约和每帧管线里不碰 WebGL 的部分：视图状态的登记、事件、管线的顺序、隐藏层的淡出、路径的步进

describe('视图状态的登记', () => {
  it('读出各插件的那一段；setView 只把给了的项交给登记它的插件', () => {
    const r = new ViewRegistry()
    let path: string[] | null = ['a', 'b']
    const got: unknown[] = []
    r.register<string[] | null>('path', { get: () => path, set: (v) => (got.push(v), (path = v)) })
    expect(r.read()).toEqual({ path: ['a', 'b'] })
    r.apply({ spread: 2 })
    expect(got).toEqual([])
    r.apply({ path: null })
    expect(got).toEqual([null])
    expect(r.read()).toEqual({ path: null })
  })

  it('没人登记就没有这一项', () => {
    expect(new ViewRegistry().read()).toEqual({})
  })

  it('不能占核心的项，也不能和别的插件重名', () => {
    const r = new ViewRegistry()
    for (const key of CORE_VIEW_KEYS) expect(() => r.register(key, { get: () => 0, set: () => {} })).toThrow()
    r.register('path', { get: () => null, set: () => {} })
    expect(() => r.register('path', { get: () => null, set: () => {} })).toThrow()
  })
})

describe('事件', () => {
  it('按名字分发，退订以后收不到', () => {
    const e = new Emitter<{ step: number; exit: null }>()
    const got: number[] = []
    const off = e.on('step', (v) => got.push(v))
    e.emit('step', 1)
    e.emit('exit', null)
    off()
    e.emit('step', 2)
    expect(got).toEqual([1])
  })
})

function edge(layerA: number, layerB: number): EdgeLook {
  return { visible: true, a: { x: 0, z: 0, layer: layerA, lift: 0 }, b: { x: 0, z: 0, layer: layerB, lift: 0 }, arc: 0, colorA: '#ffffff', colorB: '#ffffff', alpha: 1, width: 1, dash: false, progress: 1, fromTarget: false, flow: 0, phase: 0, intensity: 1 }
}

function fakeLooks(layers: number[]): Looks {
  return {
    nodes: layers.map((layer) => ({ visible: true, x: 0, z: 0, layer, lift: 0, scale: 1, color: '#ffffff', intensity: 1, alpha: 1, ghost: false, ring: null, halo: null, pulse: 0, label: null, label2: null, badge: null, step: 0 })),
    edges: [edge(0, 1)],
    extra: { bridges: [edge(0, 0)], path: [edge(1, 1)], marks: [edge(0, 1)] },
    groups: [],
    neutral: 0,
    layers: [1, 1],
    ripples: [],
  }
}

describe('每帧的管线', () => {
  it('① 基础样式 → ② 叠加层（按装的顺序）→ ③ 后处理', () => {
    const order: string[] = []
    const looks = fakeLooks([0])
    const overlays: StrataOverlay[] = [{ paint: () => order.push('a') }, { paint: () => order.push('b') }]
    const out = composeFrame(() => (order.push('base'), looks), overlays, { time: 0, dt: 0 }, () => order.push('post'))
    expect(out).toBe(looks)
    expect(order).toEqual(['base', 'a', 'b', 'post'])
  })

  it('有模式接管时叠加层不画，后处理照样走', () => {
    const order: string[] = []
    composeFrame(() => fakeLooks([0]), [{ paint: () => order.push('a') }], { time: 0, dt: 0 }, () => order.push('post'), false)
    expect(order).toEqual(['post'])
  })

  it('还没有样子就什么都不做', () => {
    let post = false
    expect(composeFrame(() => null, [], { time: 0, dt: 0 }, () => (post = true))).toBeNull()
    expect(post).toBe(false)
  })

  it('几个叠加层都给强调串时，后装的说了算；给 null 的不算', () => {
    const a = { rank: [1] }
    const b = { rank: [2] }
    expect(spotlightOf([])).toBeNull()
    expect(spotlightOf([{ spotlight: () => a }, { spotlight: () => null }])).toBe(a)
    expect(spotlightOf([{ spotlight: () => a }, { spotlight: () => b }])).toBe(b)
  })
})

describe('③ 隐藏层的淡出', () => {
  it('没有隐藏的层：什么都不动，穿透线不显', () => {
    const looks = fakeLooks([0, 1])
    const presence = [1, 1]
    expect(fadePresence(looks, presence, [1, 1], (i) => looks.nodes[i].layer, 2, 0.016)).toBe(0)
    expect(looks.presence).toBe(presence)
    expect(looks.nodes.every((n) => n.alpha === 1)).toBe(true)
  })

  it('隐藏的层缓到 0；节点、底子的边、extra 里所有的线（谁写的都一样）一起淡出', () => {
    const looks = fakeLooks([0, 1])
    const presence = [1, 1]
    // 走一大步：直接到 0
    const bridgeIn = fadePresence(looks, presence, [1, 0], (i) => looks.nodes[i].layer, 2, 1)
    expect(presence).toEqual([1, 0])
    expect(bridgeIn).toBe(1)
    expect(looks.nodes[0].visible).toBe(true)
    expect(looks.nodes[1].visible).toBe(false)
    expect(looks.edges[0].visible).toBe(false)
    expect(looks.extra.bridges[0].visible).toBe(true)
    expect(looks.extra.path[0].visible).toBe(false)
    expect(looks.extra.marks[0].visible).toBe(false)
  })

  it('淡到一半：分量乘进去，穿透线等它淡下去再显出来', () => {
    const looks = fakeLooks([0, 1])
    const presence = [1, 1]
    const bridgeIn = fadePresence(looks, presence, [1, 0], (i) => looks.nodes[i].layer, 2, 1 / 12)
    expect(presence[1]).toBeCloseTo(0.5)
    expect(bridgeIn).toBeCloseTo(0.5)
    expect(looks.nodes[1].alpha).toBeCloseTo(0.5)
    expect(looks.extra.path[0].alpha).toBeCloseTo(0.5)
  })
})

describe('路径的步进', () => {
  const layerOf = (i: number) => [0, 0, 1, 2, 2][i]

  it('找不到的步骤丢掉，连着两步落在同一个节点上并成一步', () => {
    expect(stepsOf([0, -1, 1, 1, 2], layerOf, new Set())).toEqual({ nodes: [0, 1, 2], dashed: [false, false] })
  })

  it('跳过隐藏层里的步骤，前后两步之间画成虚线', () => {
    expect(stepsOf([0, 2, 3, 4], layerOf, new Set([1]))).toEqual({ nodes: [0, 3, 4], dashed: [true, false] })
    // 头一步就在隐藏的层里：没有前一步，不用虚线
    expect(stepsOf([2, 3], layerOf, new Set([1]))).toEqual({ nodes: [3], dashed: [] })
  })

  it('每 STEP 秒点亮一个；还没起步是 0；不超过总数', () => {
    expect(reachedAt(-0.3, 5)).toBe(0)
    expect(reachedAt(0, 5)).toBe(1)
    expect(reachedAt(STEP * 2 + 0.01, 5)).toBe(3)
    expect(reachedAt(100, 5)).toBe(5)
    expect(segmentProgress(STEP * 1.5, 1)).toBeCloseTo(0.5)
    expect(segmentProgress(0, 1)).toBe(0)
    expect(segmentProgress(100, 1)).toBe(1)
  })

  it('强调串：排第几；同一个节点走到两次按后一次算', () => {
    expect([...rankOf([3, 1, 3], 3, new Int32Array(5))]).toEqual([0, 2, 0, 3, 0])
    expect([...rankOf([3, 1, 3], 1, new Int32Array(5))]).toEqual([0, 0, 0, 1, 0])
  })
})

describe('路径叠在核心的样式上', () => {
  const data = small(3)
  const resolved = project(normalize(data).data)
  const m = buildModel(resolved, layoutStrata(resolved, { radius: 26 }))
  const styler = new Styler(m)
  const nodes = SMALL_PATH.map((id) => m.index.get(id) ?? -1).filter((i) => i >= 0)
  const paint = { labels: m.specs.map((s) => s.label), ids: m.base.nodes.map((n) => n.id), layout: m.layout, colors: m.base.nodes.map((_, i) => nodeColor(m, i)), accent: m.theme.accent }
  const state = (): StyleState => ({ hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: 10 })

  it('核心的样式不认识路径：不出序号、不画路径段', () => {
    // 路径上的节点都画出来了（没有收进表里的字段）
    expect(nodes).toHaveLength(SMALL_PATH.length)
    const looks = styler.resolve(state())
    expect(looks.nodes.every((n) => n.step === 0)).toBe(true)
    expect(looks.extra.path).toEqual([])
    expect(looks.ripples).toEqual([])
  })

  it('强调串：串里的点亮，其余的、线、地面都退后', () => {
    const idle = structuredClone(styler.resolve(state()))
    const s = state()
    s.spot = { rank: rankOf(nodes, 2, new Int32Array(m.base.nodes.length)) }
    const lit = styler.resolve(s)
    expect(lit.ground).toBe(0.55)
    expect(lit.nodes[nodes[0]].intensity).toBeGreaterThan(idle.nodes[nodes[0]].intensity)
    expect(lit.nodes[nodes[0]].ring).not.toBeNull()
    const other = m.base.nodes.findIndex((_, i) => !nodes.includes(i))
    expect(lit.nodes[other].alpha).toBeLessThan(idle.nodes[other].alpha)
    expect(lit.edges[0].alpha).toBeCloseTo(idle.edges[0].alpha * 0.22)
    // 序号还是没有：那是插件叠的
    expect(lit.nodes[nodes[0]].step).toBe(0)
  })

  it('路径插件叠上序号、笔尖的涟漪和路径段；停下以后把自己的线清掉', () => {
    const run: PathRun = { nodes, dashed: nodes.slice(1).map((_, k) => k === 0), start: 10 - STEP * 1.5 }
    const s = state()
    s.spot = { rank: rankOf(nodes, reachedAt(10 - run.start, nodes.length), new Int32Array(m.base.nodes.length)) }
    const looks = styler.resolve(s)
    paintPath(looks, paint, run, 10)
    expect(looks.nodes[nodes[0]].step).toBe(1)
    expect(looks.nodes[nodes[1]].step).toBe(2)
    expect(looks.nodes[nodes[2]].step).toBe(0)
    expect(looks.nodes[nodes[0]].label!.text).toBe(`① ${m.specs[nodes[0]].label}`)
    expect(looks.ripples).toHaveLength(1)
    expect(looks.nodes[nodes[1]].pulse).toBeGreaterThan(0)
    expect(looks.extra.path).toHaveLength(nodes.length - 1)
    expect(looks.extra.path[0].progress).toBe(1)
    expect(looks.extra.path[0].dash).toBe(true)
    expect(looks.extra.path[1].progress).toBeCloseTo(0.5)
    expect(looks.extra.path[2].visible).toBe(false)
    // 下一帧没有路径了：样式自己清掉序号和涟漪，插件清掉路径段
    const after = styler.resolve(state())
    paintPath(after, paint, null, 11)
    expect(after.nodes.every((n) => n.step === 0)).toBe(true)
    expect(after.ripples).toEqual([])
    expect(after.extra.path).toEqual([])
  })
})
