import type { ShaderMaterial } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { small } from './fixtures/small'
import { Strata } from '../src/engine'
import { layoutStrata } from '../src/layout'
import { StrataError } from '../src/locale'
import { buildModel, nodeColor } from '../src/model'
import { StrataRenderer } from '../src/renderer'
import { Edges } from '../src/renderer/edges'
import { createFog, placeFog, type Fog } from '../src/renderer/fog'
import { Marks } from '../src/renderer/marks'
import { Nodes } from '../src/renderer/nodes'
import { Plates } from '../src/renderer/plates'
import { normalize, project } from '../src/resolve'
import { Styler } from '../src/styler'
import { DARK, createTheme } from '../src/theme'

// 主题按实例：createTheme 的结果互不相干；雾一个渲染器一份。
// 要 WebGL 上下文的部分（整个 StrataRenderer 跑起来、两个实例同时画）在这里测不了，只测不碰上下文的那些零件。

describe('主题', () => {
  it('不写就是 DARK 的一份拷贝：值一样，对象不是同一个', () => {
    const t = createTheme()
    expect(t).toEqual(DARK)
    expect(t).not.toBe(DARK)
    expect(t.palette).not.toBe(DARK.palette)
    expect(t.label).not.toBe(DARK.label)
  })

  it('DARK 是冻住的', () => {
    expect(Object.isFrozen(DARK)).toBe(true)
    expect(Object.isFrozen(DARK.palette)).toBe(true)
    expect(Object.isFrozen(DARK.label)).toBe(true)
  })

  it('覆盖：对象逐层合并，数组整个替换，别的项不动', () => {
    const t = createTheme({ accent: '#ff0000', label: { primary: '#000000' }, palette: ['#111111'], magnitude: [1, 1] })
    expect(t.accent).toBe('#ff0000')
    expect(t.label).toEqual({ ...DARK.label, primary: '#000000' })
    expect(t.palette).toEqual(['#111111'])
    expect(t.magnitude).toEqual([1, 1])
    expect(t.backdrop).toEqual(DARK.backdrop)
    expect(t.fogNear).toBe(DARK.fogNear)
  })

  it('两个 createTheme 的结果互不影响，也不影响 DARK', () => {
    const over = { palette: ['#111111', '#222222'], label: { primary: '#000000' } }
    const a = createTheme(over)
    const b = createTheme(over)
    ;(a.palette as string[])[0] = '#abcdef'
    ;(a.label as { primary: string }).primary = '#abcdef'
    ;(a.haloSize as number[])[0] = 99
    expect(b.palette[0]).toBe('#111111')
    expect(b.label.primary).toBe('#000000')
    expect(b.haloSize[0]).toBe(DARK.haloSize[0])
    // 覆盖用的对象也没被拿去共用
    expect(over.palette[0]).toBe('#111111')
    expect(DARK.haloSize[0]).toBe(3)
  })

  it('主题一路传下去：色板、点阵色、节点本色、样式都按实例的主题', () => {
    const data = small(2)
    const palette = ['#ff0000', '#00ff00', '#0000ff']
    const t = createTheme({ palette, tone: { primary: '#010203', aligned: '#040506' }, starWhite: 0, accent: '#123456' })
    const r = project(normalize(data, { palette: t.palette }).data)
    const lay = layoutStrata(r, { radius: 26 })
    const m = buildModel(r, lay, t)
    const d = buildModel(project(normalize(data).data), lay)
    const groupsWithoutColor = new Set((data.groupings ?? []).flatMap((g) => g.groups.filter((x) => !x.color).map((x) => `${g.id}/${x.id}`)))
    expect(groupsWithoutColor.size).toBeGreaterThan(0)
    for (const g of r.groups) if (groupsWithoutColor.has(g.id)) expect(palette).toContain(g.color)
    expect(m.renderer.plates.plates.map((p) => p.tone)).toEqual(m.renderer.plates.plates.map((p) => (p.index === m.renderer.primary ? '#010203' : '#040506')))
    expect(d.renderer.plates.plates.every((p) => p.tone === DARK.tone.primary)).toBe(true)
    // starWhite 0：节点本色就是组的颜色
    const i = m.base.nodes.findIndex((n) => n.group >= 0)
    expect(nodeColor(m, i)).toBe(m.groupColors[m.base.nodes[i].group])
    const looks = new Styler(m).resolve({ hover: -1, selected: -1, focusLayer: null, stage: null, spot: { rank: m.base.nodes.map((_, k) => (k === i ? 1 : 0)) }, group: -1, time: 0 })
    expect(looks.nodes[i].ring?.color).toBe('#123456')
  })
})

describe('雾：一个渲染器一份', () => {
  /** 一个渲染器里挂雾的四样材质 */
  function parts(fog: Fog) {
    const nodes = new Nodes(fog)
    const edges = new Edges(fog)
    const marks = new Marks(fog, 16)
    const plates = new Plates(DARK, fog)
    const uniforms = [
      (nodes.mesh.material as ShaderMaterial).uniforms,
      edges.material.uniforms,
      (marks.mesh.material as ShaderMaterial).uniforms,
    ]
    return { nodes, edges, marks, plates, uniforms }
  }

  it('初值是主题里的远近；两份互不影响', () => {
    const a = createFog(DARK.fogNear, DARK.fogFar)
    const b = createFog(10, 20)
    expect(a.uFogNear.value).toBe(70)
    expect(a.uFogFar.value).toBe(190)
    placeFog(a, 100)
    expect(a.uFogNear.value).toBe(112)
    expect(a.uFogFar.value).toBe(225)
    expect(b.uFogNear.value).toBe(10)
    expect(b.uFogFar.value).toBe(20)
  })

  it('两套材质各挂各的雾：摆一份的雾，另一套不动', () => {
    const fa = createFog(70, 190)
    const fb = createFog(70, 190)
    const pa = parts(fa)
    const pb = parts(fb)
    for (const u of pa.uniforms) {
      expect(u.uFogNear).toBe(fa.uFogNear)
      expect(u.uFogFar).toBe(fa.uFogFar)
    }
    placeFog(fa, 300)
    for (const u of pa.uniforms) expect(u.uFogNear.value).toBe(312)
    for (const u of pb.uniforms) {
      expect(u.uFogNear.value).toBe(70)
      expect(u.uFogFar.value).toBe(190)
    }
    for (const p of [pa, pb]) {
      p.nodes.dispose()
      p.edges.dispose()
      p.marks.dispose()
      p.plates.dispose()
    }
  })
})

describe('拿不到 WebGL', () => {
  const g = globalThis as Record<string, unknown>
  const had = { document: g.document, window: g.window }
  afterEach(() => {
    g.document = had.document
    g.window = had.window
  })

  /** 假的 document：画布能建，但 getContext 一律给 null（像禁用了 WebGL 的浏览器） */
  function noWebGL() {
    const canvas = { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, getContext: () => null }
    g.document = { createElementNS: () => canvas, createElement: () => canvas }
    g.window = { devicePixelRatio: 1 }
  }

  it('StrataRenderer 抛 StrataError，code 是 webgl-unavailable，消息按语言', () => {
    noWebGL()
    const host = { appendChild: () => expect.unreachable('拿不到上下文时不该往页面上挂东西') } as unknown as HTMLElement
    let caught: unknown
    try {
      new StrataRenderer(host)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(StrataError)
    expect((caught as StrataError).code).toBe('webgl-unavailable')
    expect((caught as StrataError).message).toMatch(/^WebGL is not available/)
    expect((caught as { cause?: unknown }).cause).toBeInstanceOf(Error)
  })

  it('new Strata 也一样，按选项的语言', () => {
    noWebGL()
    const host = { appendChild: () => expect.unreachable() } as unknown as HTMLElement
    expect(() => new Strata(host, { locale: 'zh-CN' })).toThrow('拿不到 WebGL')
    try {
      new Strata(host)
    } catch (e) {
      expect((e as StrataError).code).toBe('webgl-unavailable')
    }
  })
})
