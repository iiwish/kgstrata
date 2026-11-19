import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { small } from './fixtures/small'
import type { StrataData } from '../src/types'

// 引擎行为的回归快照：一串操作之后，引擎发的事件、交给（假）渲染器的调用、视图状态，原样记下来比对。
// 拆 src/engine 的时候先录下五个场景、拆完对比没有差异；留下这三个：隐藏层（淡出、穿透线、让位）、视图状态往返、
// 插件的叠加层和模式接管再交还。每帧的样子只在 look() 处记一份摘要，免得快照跟着帧数膨胀。

const log: unknown[] = []
const r4 = (v: unknown): unknown => {
  if (typeof v === 'number') return Math.round(v * 1e4) / 1e4
  if (Array.isArray(v)) return v.map(r4)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r4(x)]))
  return v
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
interface L {
  nodes: { visible: boolean; alpha: number; intensity: number; step: number; label: { alpha: number } | null }[]
  edges: { visible: boolean; alpha: number }[]
  extra: Record<string, { visible: boolean; alpha: number }[]>
  presence?: number[]
  layers: number[]
  groups: number[]
}
const digest = (l: L) =>
  r4({
    n: l.nodes.filter((x) => x.visible).length,
    na: sum(l.nodes.map((x) => x.alpha)),
    ni: sum(l.nodes.map((x) => x.intensity)),
    st: l.nodes.map((x) => x.step).join(''),
    la: sum(l.nodes.map((x) => x.label?.alpha ?? 0)),
    e: l.edges.filter((x) => x.visible).length,
    ea: sum(l.edges.map((x) => x.alpha)),
    x: Object.fromEntries(Object.entries(l.extra).map(([k, v]) => [k, [v.length, sum(v.map((e) => e.alpha))]])),
    p: l.presence ?? null,
    ly: l.layers,
    g: l.groups,
  })

class FakeCanvas {
  handlers = new Map<string, (e: unknown) => void>()
  style: Record<string, string> = {}
  addEventListener(type: string, cb: (e: unknown) => void) {
    this.handlers.set(type, cb)
  }
  removeEventListener(type: string) {
    this.handlers.delete(type)
  }
  getBoundingClientRect() {
    return { left: 0, top: 0 }
  }
  fire(type: string, e: Record<string, unknown> = {}) {
    this.handlers.get(type)?.({ clientX: 0, clientY: 0, buttons: 0, preventDefault() {}, ...e })
  }
}
let picked = -1
let lastLooks: L | null = null
/** 记下最近一帧的样子的摘要 */
const look = () => log.push(['looks', lastLooks && digest(lastLooks)])
const rec =
  (name: string, map: (...a: unknown[]) => unknown = (...a) => a) =>
  (...args: unknown[]) =>
    void log.push([name, r4(map(...args))])

vi.mock('../src/renderer/index.js', () => ({
  FLOAT: 0.45,
  StrataRenderer: class {
    gl = { domElement: new FakeCanvas() }
    rig = {
      idleRotate: true,
      fitAspect: 1,
      fitHeight: 1,
      controls: { addEventListener() {}, target: { x: 0, y: 0, z: 0 } },
      camera: { position: { x: 0, y: 0, z: 40 } },
      frame: rec('rig.frame'),
      fit: rec('rig.fit'),
      fly: rec('rig.fly'),
    }
    theme: unknown
    constructor(_host: unknown, opts: { theme: unknown }) {
      this.theme = opts.theme
    }
    setBase = rec('setBase', (b) => {
      const x = b as { nodes: unknown[]; edges: unknown[]; anchor: number }
      return [x.nodes.length, x.edges.length, x.anchor]
    })
    setLayout = rec('setLayout')
    setInset = rec('setInset')
    resize() {}
    restore() {}
    dispose() {}
    goalY = (l: number) => -l * 10
    goalScale = (l: number) => 1 - l * 0.1
    pick = () => picked
    setTheme = rec('setTheme', () => [])
    frame = (l: unknown) => void (lastLooks = l as L)
  },
}))

const { Strata } = await import('../src/engine')
type S = InstanceType<typeof Strata>

let frames: ((t: number) => void)[] = []
let now = 0
beforeEach(() => {
  log.length = 0
  picked = -1
  lastLooks = null
  frames = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => (frames.push(cb), frames.length))
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

/** 走 n 帧（每帧 16ms） */
function step(n = 1) {
  for (let i = 0; i < n; i++) {
    const cb = frames.pop()
    frames.length = 0
    now += 16
    cb?.(now)
  }
}

const host = {} as HTMLElement
const canvasOf = (s: S) => (s as unknown as { renderer: { gl: { domElement: FakeCanvas } } }).renderer.gl.domElement

function make(opts: ConstructorParameters<typeof Strata>[1] = {}) {
  const s = new Strata(host, opts)
  for (const ev of ['hover', 'select', 'focus', 'hero', 'layers', 'expanded', 'locale', 'theme'] as const) s.on(ev, (v) => log.push(['ev:' + ev, ev === 'theme' ? 'theme' : r4(v)]))
  return s
}
const view = (s: S) => log.push(['view', r4(s.view)])
const click = (s: S, i: number) => {
  picked = i
  canvasOf(s).fire('pointerdown', { clientX: 3, clientY: 4 })
  canvasOf(s).fire('pointerup', { clientX: 3, clientY: 4 })
}
const one = (): StrataData => {
  const d = small(2)
  d.layers = d.layers.filter((l) => l.id === 'onto')
  d.nodes = d.nodes.filter((n) => n.layer === 'onto')
  return d
}

describe('引擎行为的回归快照', () => {
  it('隐藏、显示层，穿透线和让位', () => {
    const s = make({ hero: 'onto' })
    s.setData(small(3))
    step(1)
    s.setLayerVisible('onto', false)
    step(5)
    look()
    s.setLayerVisible('table', false)
    s.setLayerVisible('metric', false)
    s.setHero('onto')
    s.setHeroMix({ onto: 1 })
    step(30)
    look()
    s.setLayerVisible('onto', true)
    step(30)
    look()
    view(s)
    expect(log.map((e) => JSON.stringify(e)).join('\n')).toMatchSnapshot()
  })

  it('view / setView 往返', () => {
    const a = make({ follow: true })
    a.setData(small(3))
    a.setLayerVisible('metric', false)
    a.expand('tbl:orders')
    a.setHeroMix({ onto: 0.3, table: 0.8 })
    a.select('tbl:customers')
    a.highlightGroup('sales')
    a.setSpread(1.2)
    const v = a.view
    log.length = 0
    const b = make()
    b.setData(small(3))
    log.length = 0
    b.setView(v)
    view(b)
    b.setView({ hidden: ['onto', 'table', 'metric'] })
    b.setView({ heroMix: { metric: 1 }, focus: 'onto', selected: 'nope' })
    view(b)
    // 只有一张图：聚焦的层在视图状态里
    const c = make()
    c.setData(one())
    c.shot('top')
    view(c)
    c.focusLayer(null)
    c.setView({ focus: 'onto' })
    view(c)
    c.setView({ focus: null })
    view(c)
    expect(log.map((e) => JSON.stringify(e)).join('\n')).toMatchSnapshot()
  })

  it('插件：路径叠加层、看变化接管再交还、换主题', async () => {
    const { pathPlugin } = await import('../src/path')
    const { diffPlugin } = await import('../src/diff')
    const s = make({ follow: true })
    const path = s.use(pathPlugin())
    const diff = s.use(diffPlugin())
    s.setData(small(3))
    step(1)
    path.play(['m:gmv', 'c:order', 'tbl:orders'])
    step(80)
    look()
    log.push(['path', path.ids, r4(path.progress)])
    view(s)
    const after = small(3)
    after.nodes = after.nodes.filter((n) => n.id !== 'c:product')
    after.relations = after.relations.filter((r) => r.source !== 'c:product' && r.target !== 'c:product')
    await diff.show(small(3), after)
    step(3)
    picked = 2
    canvasOf(s).fire('pointermove', { clientX: 1, clientY: 1 })
    click(s, 2)
    s.setLayerVisible('metric', false)
    step(3)
    look()
    view(s)
    diff.exit()
    step(3)
    look()
    view(s)
    s.setTheme({ accent: '#ff0000' })
    step(1)
    view(s)
    expect(log.map((e) => JSON.stringify(e)).join('\n')).toMatchSnapshot()
  })
})
