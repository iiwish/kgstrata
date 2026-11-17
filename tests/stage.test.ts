import { describe, expect, it } from 'vitest'
import { levelAt, scaleAt, stageOf } from '../src/stage'

const ELEVATION = 0.5
/** 一摞层在屏幕上的宽高比（宽 : 高），按设计俯角算 */
function aspect(radii: number[], scales: number[], heights: number[]) {
  const r = radii.map((R, i) => R * scales[i])
  const n = r.length
  const tall = (heights[0] - heights[n - 1]) * Math.cos(ELEVATION) + (r[0] + r[n - 1]) * Math.sin(ELEVATION)
  return (2 * Math.max(...r)) / tall
}

describe('比例：离主角越远越小、越暗', () => {
  it('scaleAt / levelAt', () => {
    expect(scaleAt(0)).toBe(1)
    expect(scaleAt(1)).toBeCloseTo(0.56, 9)
    expect(scaleAt(2)).toBeCloseTo(0.56 * 0.72, 9)
    expect(scaleAt(3)).toBeCloseTo(0.56 * 0.72 * 0.72, 9)
    expect(scaleAt(9)).toBe(0.24)
    expect(scaleAt(1, 0.4)).toBeCloseTo(0.4, 9)
    expect(levelAt(0)).toBe(1)
    expect(levelAt(1)).toBeCloseTo(0.5, 9)
    expect(levelAt(2)).toBeCloseTo(0.4, 9)
    expect(levelAt(9)).toBe(0.25)
  })

  it('四层一样大，第二层当主角：0.56 / 1 / 0.56 / 0.40', () => {
    const s = stageOf({ radii: [30, 30, 30, 30], mix: [0, 1, 0, 0] })
    expect(s.scales.map((v) => +v.toFixed(4))).toEqual([0.56, 1, 0.56, 0.4032])
    expect(s.levels.map((v) => +v.toFixed(4))).toEqual([0.5, 1, 0.5, 0.4])
    expect(s.sides.map((v) => +v.toFixed(4))).toEqual([1, 0, 1, 1.2])
  })

  it('配角的大小是相对主角说的：大层当配角，画出来是主角的 0.56', () => {
    const s = stageOf({ radii: [20, 30], mix: [1, 0] })
    expect(s.scales[0]).toBe(1)
    expect(30 * s.scales[1]).toBeCloseTo(0.56 * 20, 9)
  })

  it('本来就小的层当配角不会被放大', () => {
    const s = stageOf({ radii: [30, 10], mix: [1, 0] })
    expect(s.scales[1]).toBe(1)
  })

  it('分量全是 0：不分主次，都原大原亮', () => {
    const s = stageOf({ radii: [30, 20], mix: [0, 0] })
    expect(s.scales).toEqual([1, 1])
    expect(s.levels).toEqual([1, 1])
  })

  it('secondaryScale 可以改', () => {
    const s = stageOf({ radii: [30, 30], mix: [1, 0], secondaryScale: 0.4 })
    expect(s.scales[1]).toBeCloseTo(0.4, 9)
  })
})

describe('比例：分量连续变', () => {
  it('各一半：两层一样大、一样亮', () => {
    const s = stageOf({ radii: [30, 30], mix: [0.5, 0.5] })
    expect(s.scales[0]).toBeCloseTo(0.78, 9)
    expect(s.scales[1]).toBeCloseTo(0.78, 9)
    expect(s.levels[0]).toBeCloseTo(0.75, 9)
    expect(s.levels[1]).toBeCloseTo(0.75, 9)
  })

  it('从 0 拖到 1：大小单调、没有跳变', () => {
    let prev = stageOf({ radii: [30, 30], mix: [1, 0] })
    for (let k = 1; k <= 20; k++) {
      const t = k / 20
      const s = stageOf({ radii: [30, 30], mix: [1 - t, t] })
      expect(s.scales[1]).toBeGreaterThanOrEqual(prev.scales[1] - 1e-9)
      expect(s.scales[0]).toBeLessThanOrEqual(prev.scales[0] + 1e-9)
      expect(Math.abs(s.scales[1] - prev.scales[1])).toBeLessThan(0.05)
      expect(Math.abs(s.heights[0] - prev.heights[0])).toBeLessThan(1.5)
      prev = s
    }
    expect(prev.scales[1]).toBeCloseTo(1, 9)
    expect(prev.scales[0]).toBeCloseTo(0.56, 9)
  })
})

describe('比例：层距', () => {
  it('从上到下依次降低，整摞上下居中', () => {
    const s = stageOf({ radii: [20, 29, 30], mix: [0, 1, 0] })
    expect(s.heights[0]).toBeGreaterThan(s.heights[1])
    expect(s.heights[1]).toBeGreaterThan(s.heights[2])
    expect(s.heights[0] + s.heights[2]).toBeCloseTo(0, 9)
  })

  it('相邻两层的间隔按两层缩放后的半径之和来定：小层靠得拢', () => {
    const s = stageOf({ radii: [30, 30, 30, 30], mix: [1, 0, 0, 0] })
    const gaps = [0, 1, 2].map((i) => s.heights[i] - s.heights[i + 1])
    expect(gaps[0]).toBeGreaterThan(gaps[1])
    expect(gaps[1]).toBeGreaterThan(gaps[2])
    const r = s.scales.map((v) => 30 * v)
    expect(gaps[0] / (r[0] + r[1])).toBeCloseTo(gaps[1] / (r[1] + r[2]), 9)
  })

  it('两层：放得下，松紧不到下限，整摞的宽高比正好在预算上', () => {
    const radii = [28.8, 30.4]
    const s = stageOf({ radii, mix: [1, 0] })
    expect(s.tightness).toBeGreaterThan(0.7)
    expect(s.tightness).toBeLessThanOrEqual(0.85)
    expect(aspect(radii, s.scales, s.heights)).toBeGreaterThanOrEqual(1.45 - 1e-6)
  })

  it('三层、主角在中间：收紧一些，仍在预算里', () => {
    const radii = [21, 28.8, 30.4]
    const s = stageOf({ radii, mix: [0, 1, 0] })
    expect(s.tightness).toBeGreaterThanOrEqual(0.5)
    expect(s.tightness).toBeLessThan(0.7)
    expect(aspect(radii, s.scales, s.heights)).toBeGreaterThanOrEqual(1.45 - 1e-6)
  })

  it('层再多也不会比下限更挤', () => {
    const s = stageOf({ radii: [30, 30, 30, 30, 30, 30], mix: [0, 0, 1, 0, 0, 0] })
    expect(s.tightness).toBe(0.5)
  })

  it('spread 是层距的倍数', () => {
    const a = stageOf({ radii: [30, 30], mix: [1, 0] })
    const b = stageOf({ radii: [30, 30], mix: [1, 0], spread: 1.5 })
    expect(b.heights[0] - b.heights[1]).toBeCloseTo((a.heights[0] - a.heights[1]) * 1.5, 9)
  })

  it('只有一层', () => {
    const s = stageOf({ radii: [30], mix: [1] })
    expect(s.scales).toEqual([1])
    expect(s.heights).toEqual([0])
  })
})
