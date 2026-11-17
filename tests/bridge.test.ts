import { describe, expect, it } from 'vitest'
import { bridgesOf } from '../src/bridge'

// 三层：指标 0、1（第 0 层）；本体 2、3、4（第 1 层）；表 5、6、7（第 2 层）
const layerOf = [0, 0, 1, 1, 1, 2, 2, 2]
const cross: [number, number][] = [
  [0, 2], // 指标 0 → 本体 2
  [0, 3], // 指标 0 → 本体 3
  [1, 4], // 指标 1 → 本体 4（本体 4 没落到任何表）
  [2, 5], // 本体 2 → 表 5
  [3, 5], // 本体 3 → 表 5
  [6, 3], // 表 6 ← 本体 3（方向反着写也认）
]

describe('bridgesOf：隐藏中间层以后的穿透关系', () => {
  it('没有隐藏层就没有穿透', () => {
    expect(bridgesOf(layerOf, cross, new Set())).toEqual([])
  })

  it('隐藏本体：指标直接连到它最终落的表，分量是经过了几个本体', () => {
    expect(bridgesOf(layerOf, cross, new Set([1]))).toEqual([
      { s: 0, t: 5, weight: 2 },
      { s: 0, t: 6, weight: 1 },
    ])
  })

  it('落不到下面的指标没有穿透线：缺口自己露出来', () => {
    const b = bridgesOf(layerOf, cross, new Set([1]))
    expect(b.some((x) => x.s === 1)).toBe(false)
    // 没人认领的表也一样
    expect(b.some((x) => x.t === 7)).toBe(false)
  })

  it('隐藏最上或最下的一层：没有东西被它隔开，不产生穿透', () => {
    expect(bridgesOf(layerOf, cross, new Set([0]))).toEqual([])
    expect(bridgesOf(layerOf, cross, new Set([2]))).toEqual([])
  })

  it('不会绕回同一层：两个指标落在同一个本体上，不算它们之间有关系', () => {
    const b = bridgesOf([0, 0, 1], [[0, 2], [1, 2]], new Set([1]))
    expect(b).toEqual([])
  })

  it('连着隐藏两层也能接上，几条路就是几', () => {
    // 看板 0 → 指标 1、2 → 本体 3 → 表 4
    const layers = [0, 1, 1, 2, 3]
    const links: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]]
    expect(bridgesOf(layers, links, new Set([1, 2]))).toEqual([{ s: 0, t: 4, weight: 2 }])
    // 只隐藏指标：看板直接连到本体
    expect(bridgesOf(layers, links, new Set([1]))).toEqual([{ s: 0, t: 3, weight: 2 }])
    // 只隐藏本体：两个指标各连到表
    expect(bridgesOf(layers, links, new Set([2]))).toEqual([
      { s: 1, t: 4, weight: 1 },
      { s: 2, t: 4, weight: 1 },
    ])
  })

  it('层内的线不参与：只接跨层的映射', () => {
    // 本体 1、2 同层，1 → 2 是层内关系；指标 0 → 本体 1；本体 2 → 表 3
    expect(bridgesOf([0, 1, 1, 2], [[0, 1], [1, 2], [2, 3]], new Set([1]))).toEqual([])
  })

  it('跳过一层的直接映射不受影响，也不重复算', () => {
    // 指标 0 既直接连表 2，又经本体 1 连表 2
    expect(bridgesOf([0, 1, 2], [[0, 2], [0, 1], [1, 2]], new Set([1]))).toEqual([{ s: 0, t: 2, weight: 1 }])
  })
})
