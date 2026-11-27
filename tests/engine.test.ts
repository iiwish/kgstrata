import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { small } from './fixtures/small'
import type { SelectInfo, StrataView } from '../src/engine'
import { layoutStrata } from '../src/layout'
import { layoutFromJSON, layoutToJSON } from '../src/layout-io'
import { registerLocale } from '../src/locale'
import { resolve } from '../src/resolve'
import { DARK } from '../src/theme'
import type { LabelOptions, Resolved, StrataLayout } from '../src/types'

// 引擎本身（选中、镜头、主次、语言、主题、注入的布局）。渲染器要 WebGL：这里换成一个只记账的假渲染器，
// 引擎的其余部分（整理、布局、模型、样式、事件）都是真的。

/** 假渲染器记下来的调用 */
const calls: { name: string; args: unknown[] }[] = []
const record = (name: string) => (...args: unknown[]) => void calls.push({ name, args })

/** 假的画布：记下监听，测试里直接调 */
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

/** pick 返回什么：测试里改 */
let picked = -1

vi.mock('../src/renderer/index.js', () => ({
  FLOAT: 0.45,
  StrataRenderer: class {
    gl = { domElement: new FakeCanvas() }
    rig = {
      idleRotate: true,
      fitAspect: 1,
      fitHeight: 1,
      controls: {
        handlers: new Map<string, () => void>(),
        addEventListener(type: string, cb: () => void) {
          this.handlers.set(type, cb)
        },
        target: { x: 0, y: 0, z: 0 },
      },
      camera: { position: { x: 0, y: 0, z: 40 } },
      frame: record('frame'),
      fit: record('fit'),
      fly: record('fly'),
    }
    theme: unknown
    constructor(_host: unknown, opts: { theme: unknown }) {
      this.theme = opts.theme
    }
    setBase = record('setBase')
    setLayout = record('setLayout')
    setInset = record('setInset')
    resize() {}
    restore() {}
    dispose() {}
    goalY = () => 0
    goalScale = () => 1
    pick = () => picked
    setTheme = (t: unknown) => {
      this.theme = t
      calls.push({ name: 'setTheme', args: [t] })
    }
  },
}))

const { Strata } = await import('../src/engine')

beforeEach(() => {
  calls.length = 0
  picked = -1
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

const host = {} as HTMLElement
const canvasOf = (s: InstanceType<typeof Strata>) => (s as unknown as { renderer: { gl: { domElement: FakeCanvas } } }).renderer.gl.domElement
/** 引擎画的那一帧的样子：有了它指针才点得中东西 */
const primeLooks = (s: InstanceType<typeof Strata>) => ((s as unknown as { core: { looks: unknown } }).core.looks = { nodes: [] })
/** 用户拖了一下镜头（轨道控制的 start） */
const userMoves = (s: InstanceType<typeof Strata>) =>
  (s as unknown as { renderer: { rig: { controls: { handlers: Map<string, () => void> } } } }).renderer.rig.controls.handlers.get('start')!()
const indexOfNode = (s: InstanceType<typeof Strata>, id: string) => (s as unknown as { core: { model: { index: Map<string, number> } } }).core.model.index.get(id)!

describe('只认 id', () => {
  it("shot('layer', id) 框住那一层；不认得的层什么都不做", () => {
    const s = new Strata(host)
    s.setData(small(3))
    calls.length = 0
    s.shot('layer', { layer: 'table' })
    expect(calls.filter((c) => c.name === 'fit')).toHaveLength(1)
    calls.length = 0
    s.shot('layer', { layer: 'nope' })
    s.shot('layer')
    expect(calls.filter((c) => c.name === 'fit')).toHaveLength(0)
  })

  it('悬停：layer、group 是 id，名字另给；表收着的字段数和名词', () => {
    const s = new Strata(host, { locale: 'zh-CN' })
    s.setData(small(2))
    primeLooks(s)
    const hovers: unknown[] = []
    s.on('hover', (h) => hovers.push(h))
    picked = indexOfNode(s, 'tbl:orders')
    canvasOf(s).fire('pointermove', { clientX: 30, clientY: 40 })
    expect(hovers[0]).toMatchObject({
      id: 'tbl:orders',
      layer: 'table',
      layerName: '物理表',
      group: 'domain/sales',
      groupName: '销售',
      folds: 2,
      childNoun: '字段',
      expanded: false,
      pointer: { x: 30, y: 40 },
    })
    expect(Object.keys(hovers[0] as object)).not.toContain('x')
    // 英文的名词；自己配的 nodeStyles 盖掉内置的
    const en = new Strata(host, { nodeStyles: { entity: { childNoun: 'attributes' } } })
    en.setData(small(2))
    primeLooks(en)
    const got: unknown[] = []
    en.on('hover', (h) => got.push(h))
    picked = indexOfNode(en, 'tbl:orders')
    canvasOf(en).fire('pointermove')
    picked = indexOfNode(en, 'c:order')
    canvasOf(en).fire('pointermove')
    expect(got.map((h) => (h as { childNoun: string | null }).childNoun)).toEqual(['fields', 'attributes'])
  })

  it('LayerInfo.count 是顶层节点数（收着的字段不算，展开以后也不算）', () => {
    const s = new Strata(host)
    s.setData(small(2))
    expect(s.layers.map((l) => [l.id, l.count])).toEqual([
      ['onto', 4],
      ['table', 4],
    ])
    s.expand('tbl:orders')
    expect(s.layers.find((l) => l.id === 'table')!.count).toBe(4)
  })
})

describe('程序选中和鼠标选中走同一条路', () => {
  it('select(id) 发 select 事件（source api），开着跟随时主角跟过去', () => {
    const s = new Strata(host, { follow: true })
    s.setData(small(2))
    const events: SelectInfo[] = []
    s.on('select', (e) => events.push(e))
    expect(s.hero.id).toBe('onto')
    s.select('tbl:products')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ node: { id: 'tbl:products', layer: 'table' }, source: 'api', pointer: null })
    expect(s.hero.id).toBe('table')
    expect(s.view.selected).toBe('tbl:products')
    // 收在表里的字段算在表头上；null 清掉，也发事件
    s.select('fld:orders.id')
    expect(events[1].node?.id).toBe('tbl:orders')
    s.select(null)
    expect(events[2]).toEqual({ node: null, source: 'api', pointer: null })
  })

  it('不开跟随：主角不动', () => {
    const s = new Strata(host)
    s.setData(small(2))
    s.select('tbl:products')
    expect(s.hero.id).toBe('onto')
  })

  it('setView 恢复选中：事件照发（source api），但不跟随、不抢镜头', () => {
    const s = new Strata(host, { follow: true })
    s.setData(small(2))
    const events: SelectInfo[] = []
    s.on('select', (e) => events.push(e))
    calls.length = 0
    s.setView({ selected: 'tbl:products', camera: { position: [1, 2, 3], target: [0, 0, 0] } })
    expect(events).toEqual([expect.objectContaining({ node: expect.objectContaining({ id: 'tbl:products' }), source: 'api' })])
    expect(s.hero.id).toBe('onto')
    // 镜头只按给的 camera 飞一次，没有为了跟随重新取景
    expect(calls.filter((c) => c.name === 'frame' || c.name === 'fit')).toHaveLength(0)
    expect(calls.filter((c) => c.name === 'fly')).toHaveLength(1)
  })

  it('点一下：source pointer，带指针的位置；再点一次放开', () => {
    const s = new Strata(host, { follow: true })
    s.setData(small(2))
    primeLooks(s)
    const events: SelectInfo[] = []
    s.on('select', (e) => events.push(e))
    picked = indexOfNode(s, 'tbl:customers')
    canvasOf(s).fire('pointerdown', { clientX: 5, clientY: 6 })
    canvasOf(s).fire('pointerup', { clientX: 5, clientY: 6 })
    expect(events[0]).toMatchObject({ node: { id: 'tbl:customers' }, source: 'pointer', pointer: { x: 5, y: 6 } })
    expect(s.hero.id).toBe('table')
    canvasOf(s).fire('pointerdown', { clientX: 5, clientY: 6 })
    canvasOf(s).fire('pointerup', { clientX: 5, clientY: 6 })
    expect(events[1]).toMatchObject({ node: null, source: 'pointer' })
  })
})

describe('基准层叫 anchor', () => {
  it('不写 hero 时主角是基准层（anchor 选项）', () => {
    const s = new Strata(host, { anchor: 'table' })
    s.setData(small(2))
    expect(s.hero.id).toBe('table')
    const t = new Strata(host, { anchor: 'table', hero: 'onto' })
    t.setData(small(2))
    expect(t.hero.id).toBe('onto')
  })
})

describe('契约版本不对是真正的 error', () => {
  it('setData 不画，返回问题；原来的数据和画面不动', () => {
    const s = new Strata(host)
    const good = small(2)
    expect(s.setData(good)).toEqual([])
    calls.length = 0
    const issues = s.setData({ ...small(2), version: 1 as 2 })
    expect(issues).toEqual([expect.objectContaining({ level: 'error', code: 'version' })])
    expect(issues[0].id).toBeUndefined()
    expect(s.data).toBe(good)
    expect(calls.filter((c) => c.name === 'setBase')).toHaveLength(0)
  })
})

describe('语言', () => {
  it('setLocale 换语言、发 locale 事件；messages 按实例覆盖个别文案', () => {
    const s = new Strata(host, { messages: { 'ui.layers': 'Strata' } })
    expect(s.text('ui.layers')).toBe('Strata')
    expect(s.text('ui.overview')).toBe('Overview')
    const got: string[] = []
    s.on('locale', (l) => got.push(l))
    s.setLocale('zh-CN')
    expect(s.locale).toBe('zh-CN')
    expect(got).toEqual(['zh-CN'])
    // 覆盖不随语言变；换语言时可以一起换掉
    expect(s.text('ui.layers')).toBe('Strata')
    expect(s.text('ui.overview')).toBe('总览')
    s.setLocale('zh-CN', {})
    expect(s.text('ui.layers')).toBe('层')
  })

  it('登记的语言：缺的键回退；问题描述、悬停的名词跟着它', () => {
    registerLocale('engine-test', { 'issue.duplicate-layer': 'Couche {layer} en double' }, { fallback: 'zh-CN' })
    const s = new Strata(host, { locale: 'engine-test' })
    const d = small(2)
    d.layers.push({ ...d.layers[0] })
    expect(s.setData(d).find((i) => i.code === 'duplicate-layer')?.message).toBe('Couche onto en double')
    expect(s.text('ui.overview')).toBe('总览')
  })
})

describe('setTheme', () => {
  it('换主题：渲染器重建，组的颜色按新色板，布局和选中不动', () => {
    const s = new Strata(host)
    s.setData(small(2))
    s.select('tbl:products')
    const model = () => (s as unknown as { core: { model: { layout: StrataLayout; data: Resolved } } }).core.model
    const before = model().layout
    const themes: unknown[] = []
    s.on('theme', (t) => themes.push(t))
    calls.length = 0
    s.setTheme({ background: '#ffffff', palette: ['#111111', '#222222'] })
    expect(s.theme.background).toBe('#ffffff')
    expect(themes).toEqual([s.theme])
    expect(calls.some((c) => c.name === 'setTheme')).toBe(true)
    expect(calls.some((c) => c.name === 'setBase')).toBe(true)
    // 没写颜色的组从新色板里取；写了颜色的不变
    expect(model().data.groups.map((g) => g.color)).toEqual(['#58c6ff', '#222222'])
    // 不重新布局：顶层节点的位置原样
    for (const [id, p] of before.nodes) expect(model().layout.nodes.get(id)).toMatchObject({ x: p.x, z: p.z })
    expect(s.view.selected).toBe('tbl:products')
    // 盖在 DARK 上，不是盖在现在的主题上
    s.setTheme({})
    expect(s.theme).toEqual(DARK)
  })
})

describe('注入布局', () => {
  it('用注入的布局；headless 算好、存成 JSON、拿回来的也行', () => {
    const json = JSON.parse(JSON.stringify(layoutToJSON(layoutStrata(resolvedOf(small(2)), { radius: 26, anchor: 'onto' }))))
    const cached = layoutFromJSON(json)
    const seen: { radius?: number; anchor?: string }[] = []
    const s = new Strata(host, { anchor: 'onto', layout: (_data, defaults) => (seen.push(defaults), cached) })
    expect(s.setData(small(2))).toEqual([])
    expect(seen[0]).toEqual({ radius: 26, anchor: 'onto' })
    const lay = (s as unknown as { core: { expansion: { baseLayout: StrataLayout } } }).core.expansion.baseLayout
    expect(lay).toBe(cached)
    // 展开仍然在注入的布局上添子节点
    s.expand('tbl:orders')
    const m = (s as unknown as { core: { model: { layout: StrataLayout } } }).core.model
    expect(m.layout.nodes.get('fld:orders.id')).toBeDefined()
    expect(m.layout.nodes.get('tbl:orders')).toMatchObject({ x: cached.nodes.get('tbl:orders')!.x })
  })

  it('缺节点：给一条带 code 的问题，改为自己算；返回 null 就安静地自己算', () => {
    const full = layoutStrata(resolvedOf(small(2)))
    const nodes = new Map(full.nodes)
    nodes.delete('tbl:products')
    const s = new Strata(host, { layout: () => ({ ...full, nodes }) })
    const issues = s.setData(small(2))
    expect(issues).toEqual([expect.objectContaining({ level: 'warning', code: 'layout-incomplete', id: 'tbl:products' })])
    const lay = (s as unknown as { core: { expansion: { baseLayout: StrataLayout } } }).core.expansion.baseLayout
    expect(lay.nodes.has('tbl:products')).toBe(true)
    expect(new Strata(host, { layout: () => null }).setData(small(2))).toEqual([])
  })
})

describe('视图状态', () => {
  it('核心的那几项都用 id', () => {
    const s = new Strata(host)
    s.setData(small(3))
    s.setLayerVisible('onto', false)
    const v: StrataView = s.view
    expect(v.hidden).toEqual(['onto'])
    expect(Object.keys(v.heroMix)).toEqual(['metric', 'onto', 'table'])
  })
})

function resolvedOf(d: ReturnType<typeof small>) {
  return resolve(d).resolved
}

describe('看变化插件的接口', async () => {
  const { diffPlugin } = await import('../src/diff')
  const { pathPlugin } = await import('../src/path')
  const before = small(2)
  const after = small(2)
  after.nodes.push({ id: 'tbl:refunds', layer: 'table', label: 'refunds', type: 'table', groups: { domain: 'sales' } })
  after.relations.push({ source: 'tbl:refunds', target: 'tbl:orders', type: 'fk' })
  after.nodes = after.nodes.filter((n) => n.id !== 'c:product')
  after.relations = after.relations.filter((r) => r.source !== 'c:product' && r.target !== 'c:product')

  it('变化只用 id；视图只露三项；update、selectHunk 认 id；视图状态在看的时候登记', async () => {
    const s = new Strata(host, { follow: true })
    const diff = s.use(diffPlugin())
    s.setData(after)
    expect(s.view.diff).toBe(null)
    const d = (await diff.show(before, after))!
    expect(d.hunks.length).toBeGreaterThan(0)
    const layers = new Set(s.layers.map((l) => l.id))
    for (const h of d.hunks) {
      expect(layers.has(h.layer)).toBe(true)
      for (const id of [...h.nodes, ...h.context]) expect(typeof id).toBe('string')
      expect('index' in h).toBe(false)
    }
    expect(diff.view).toEqual({ layer: 'union', t: 0, selectedHunk: null })
    const added = d.hunks.find((h) => h.nodes.includes('tbl:refunds'))!
    diff.selectHunk(added.id)
    expect(diff.view!.selectedHunk).toBe(added.id)
    // 跟随：这处变化落在哪一层，哪一层当主角
    expect(s.hero.id).toBe(added.layer)
    diff.update({ selectedHunk: 'nope', layer: 'after' })
    expect(diff.view).toEqual({ layer: 'after', t: 0, selectedHunk: null })
    diff.update({ layer: 'replay', t: 1e9 })
    expect(diff.view!.t).toBe(d.duration)
    expect(s.view.diff).toEqual({ layer: 'replay', t: d.duration, selectedHunk: null })
    // setView 正在看的时候恢复看的版本和选中的变化
    s.setView({ diff: { layer: 'before', t: 0, selectedHunk: added.id } })
    expect(diff.view!.selectedHunk).toBe(added.id)
    diff.exit()
    expect(s.view.diff).toBe(null)
    // 没在看时 setView 里的 diff 不管
    s.setView({ diff: { layer: 'before', t: 0, selectedHunk: added.id } })
    expect(diff.active).toBe(false)
  })

  it('换语言：没指定语言时按新语言重新比；登记的语言 kgdiff 不认，落到内置的那一种', async () => {
    registerLocale('engine-test-fr', { 'label.related': 'lié à' })
    const s = new Strata(host)
    const diff = s.use(diffPlugin())
    s.setData(after)
    const en = (await diff.show(before, after))!
    const entered = new Promise((ok) => diff.on('enter', ok))
    s.setLocale('zh-CN')
    const zh = (await entered) as typeof en
    expect(zh.hunks.map((h) => h.id)).toEqual(en.hunks.map((h) => h.id))
    expect(zh.hunks.some((h) => /\p{Script=Han}/u.test(h.title))).toBe(true)
    const again = new Promise((ok) => diff.on('enter', ok))
    s.setLocale('engine-test-fr')
    const fr = (await again) as typeof en
    expect(fr.hunks.map((h) => h.title)).toEqual(en.hunks.map((h) => h.title))
  })

  it('换主题时重新比一遍；模式期间插件也收到 theme', async () => {
    const s = new Strata(host)
    const diff = s.use(diffPlugin())
    s.setData(after)
    await diff.show(before, after)
    const entered = new Promise((ok) => diff.on('enter', ok))
    s.setTheme({ diffScheme: 'light' })
    await entered
    expect(diff.active).toBe(true)
  })

  it('路径：程序清掉选中不会停下这一趟，点在空白处才停', () => {
    const s = new Strata(host)
    const path = s.use(pathPlugin())
    s.setData(small(2))
    primeLooks(s)
    path.play(['c:order', 'tbl:orders'])
    s.select(null)
    expect(path.progress.ids).toEqual(['c:order', 'tbl:orders'])
    picked = -1
    canvasOf(s).fire('pointerdown')
    canvasOf(s).fire('pointerup')
    expect(path.progress.ids).toEqual([])
    expect(path.ids).toEqual(['c:order', 'tbl:orders'])
  })
})

describe('插件框过的镜头交还给总览', async () => {
  const { diffPlugin } = await import('../src/diff')
  const { pathPlugin } = await import('../src/path')
  const before = small(2)
  const after = small(2)
  after.nodes = after.nodes.filter((n) => n.id !== 'c:product')
  after.relations = after.relations.filter((r) => r.source !== 'c:product' && r.target !== 'c:product')
  const overviews = () => calls.filter((c) => c.name === 'frame').length

  it('路径：clear 以后回到总览；用户动过镜头就不动', () => {
    const s = new Strata(host)
    const path = s.use(pathPlugin())
    s.setData(small(2))
    path.play(['c:order', 'tbl:orders'])
    expect(calls.some((c) => c.name === 'fit')).toBe(true)
    calls.length = 0
    path.clear()
    expect(overviews()).toBe(1)
    // 没有路径时 clear 不动镜头
    path.clear()
    expect(overviews()).toBe(1)

    path.play(['c:order', 'tbl:orders'])
    userMoves(s)
    calls.length = 0
    path.clear()
    expect(overviews()).toBe(0)
  })

  it('路径：插件框完以后用户又选了别的机位，clear 不抢镜头', () => {
    const s = new Strata(host)
    const path = s.use(pathPlugin())
    s.setData(small(2))
    path.play(['c:order', 'tbl:orders'])
    s.shot('top')
    calls.length = 0
    path.clear()
    expect(overviews()).toBe(0)
  })

  it('看变化：选中一处变化（镜头框住它）以后 exit 回到总览；用户动过镜头就不动', async () => {
    const s = new Strata(host)
    const diff = s.use(diffPlugin())
    s.setData(after)
    const d = (await diff.show(before, after))!
    diff.selectHunk(d.hunks[0].id)
    expect(calls.some((c) => c.name === 'fit')).toBe(true)
    calls.length = 0
    diff.exit()
    expect(overviews()).toBe(1)

    await diff.show(before, after)
    diff.selectHunk(d.hunks[0].id)
    userMoves(s)
    calls.length = 0
    diff.exit()
    expect(overviews()).toBe(0)
  })

  it('看变化：一直停在总览时，exit 按全景的层重新取景', async () => {
    const s = new Strata(host)
    const diff = s.use(diffPlugin())
    s.setData(after)
    await diff.show(before, after)
    calls.length = 0
    diff.exit()
    expect(overviews()).toBe(1)
  })
})

describe('0.2 收尾的几处接口', () => {
  const one = () => {
    const d = small(2)
    d.layers = d.layers.filter((l) => l.id === 'onto')
    d.nodes = d.nodes.filter((n) => n.layer === 'onto')
    return d
  }

  it('focusLayer：几张图并存时等于 setHero，不聚焦、不发 focus；事件和 view.focus 总是对得上', () => {
    const s = new Strata(host)
    s.setData(small(3))
    const focus: (string | null)[] = []
    const heroes: (string | null)[] = []
    s.on('focus', (f) => focus.push(f))
    s.on('hero', (h) => heroes.push(h.id))
    s.focusLayer('table')
    expect(s.hero.id).toBe('table')
    expect(s.view.focus).toBe(null)
    s.setHero('metric')
    s.focusLayer(null)
    // 回到主角的“家”（setHero 设的那层）
    expect(s.hero.id).toBe('metric')
    expect(focus).toEqual([])
    expect(heroes).toEqual(['table', 'metric'])
    // 一张图：聚焦，事件带的就是视图状态里的
    const t = new Strata(host)
    t.setData(one())
    const got: (string | null)[] = []
    t.on('focus', (f) => got.push(f))
    t.focusLayer('onto')
    expect(got).toEqual(['onto'])
    expect(t.view.focus).toBe('onto')
    t.focusLayer(null)
    expect(got).toEqual(['onto', null])
    expect(t.view.focus).toBe(null)
  })

  it('setHeroMix / setHero 返回实际的主次；隐藏的层分量是 0', () => {
    const s = new Strata(host)
    s.setData(small(3))
    s.setLayerVisible('metric', false)
    const r = s.setHeroMix({ metric: 1, onto: 0.4, table: 0.8 })
    expect(r).toEqual({ id: 'table', follow: false, mix: { metric: 0, onto: 0.4, table: 0.8 } })
    expect(r).toEqual(s.hero)
    // 分量全给了隐藏的层：等于没给，主角那层独当主角
    expect(s.setHeroMix({ metric: 1 }).mix).toEqual({ metric: 0, onto: 0, table: 1 })
    expect(s.setHero('metric').id).toBe('table')
    expect(s.setHero('nope').id).toBe('table')
    expect(s.setHero('onto').id).toBe('onto')
    // 一张图：不分主次
    const t = new Strata(host)
    t.setData(one())
    expect(t.setHeroMix({ onto: 1 })).toEqual({ id: null, follow: false, mix: {} })
  })

  it('setLayerVisible 返回这一层调用之后的样子；没有这层是 null', () => {
    const s = new Strata(host)
    s.setData(small(2))
    expect(s.setLayerVisible('onto', false)).toEqual({ id: 'onto', name: '本体', visible: false, count: 4 })
    // 最后一张可见的图藏不了：visible 还是 true
    expect(s.setLayerVisible('table', false)?.visible).toBe(true)
    expect(s.setLayerVisible('nope', false)).toBe(null)
    expect(s.setLayerVisible('onto', true)?.visible).toBe(true)
  })

  it('ctx.followTo 给层的 id，ctx.fit 给节点的 id（收起的算祖先），fitPoints 给盘面的点', () => {
    let ctx!: import('../src/plugin').StrataContext
    const s = new Strata(host, { follow: true })
    s.use({ name: 'probe', install: (c) => void (ctx = c) })
    s.setData(small(2))
    ctx.followTo('table')
    expect(s.hero.id).toBe('table')
    ctx.followTo('nope')
    expect(s.hero.id).toBe('table')
    calls.length = 0
    ctx.fit(['fld:orders.id', 'nope', 'c:order'], { elevation: 0.5, margin: 1 })
    const fit = calls.find((c) => c.name === 'fit')!
    const m = (s as unknown as { core: { model: { layout: StrataLayout } } }).core.model
    const orders = m.layout.nodes.get('tbl:orders')!
    expect((fit.args[0] as number[][]).map((p) => [p[0], p[2]])).toEqual([
      [orders.x, orders.z],
      [m.layout.nodes.get('c:order')!.x, m.layout.nodes.get('c:order')!.z],
    ])
    calls.length = 0
    ctx.fitPoints([{ layer: 0, x: 1, z: 2 }], { elevation: 0.5, margin: 1 })
    expect(calls.find((c) => c.name === 'fit')!.args[0]).toEqual([[1, 0.45, 2]])
  })

  it('路径：再点一次选中的节点只是放开选中，不停回放；点空白才停。pointer.hit 分得清这两种', () => {
    return import('../src/path').then(({ pathPlugin }) => {
      const s = new Strata(host)
      const path = s.use(pathPlugin())
      s.setData(small(2))
      primeLooks(s)
      const events: SelectInfo[] = []
      s.on('select', (e) => events.push(e))
      path.play(['c:order', 'tbl:orders'])
      const click = (i: number) => {
        picked = i
        canvasOf(s).fire('pointerdown')
        canvasOf(s).fire('pointerup')
      }
      click(indexOfNode(s, 'c:order'))
      click(indexOfNode(s, 'c:order'))
      expect(events.slice(-2).map((e) => [e.node?.id ?? null, e.pointer?.hit])).toEqual([
        ['c:order', 'c:order'],
        [null, 'c:order'],
      ])
      expect(path.progress.ids).toEqual(['c:order', 'tbl:orders'])
      click(-1)
      expect(events.at(-1)!.pointer).toEqual({ x: 0, y: 0, hit: null })
      expect(path.progress.ids).toEqual([])
      expect('reached' in path).toBe(false)
    })
  })
})

describe('0.2 命名收尾', () => {
  it('状态都有 getter：selected、focus、group、view；展开的事件叫 expanded，和 getter 同名', () => {
    const s = new Strata(host)
    const expanded: string[][] = []
    s.on('expanded', (ids) => expanded.push(ids))
    s.setData(small(2))
    expect([s.selected, s.focus, s.group]).toEqual([null, null, null])
    s.select('fld:orders.id')
    expect(s.selected).toBe('tbl:orders')
    s.highlightGroup('sales')
    expect(s.group).toBe('domain/sales')
    s.expand('tbl:orders')
    expect(s.expanded).toEqual(['tbl:orders'])
    expect(expanded.at(-1)).toEqual(s.expanded)
    // view 每次给一份新的
    const v = s.view
    expect(v).toMatchObject({ selected: s.selected, group: s.group, focus: s.focus, expanded: s.expanded })
    expect(s.view).not.toBe(v)

    // focus 只在一张图时有，和 focus 事件带的一样
    const one = small(2)
    one.layers = one.layers.filter((l) => l.id === 'onto')
    one.nodes = one.nodes.filter((n) => n.layer === 'onto')
    const ids = new Set(one.nodes.map((n) => n.id))
    one.relations = one.relations.filter((r) => ids.has(r.source) && ids.has(r.target))
    const t = new Strata(host)
    t.setData(one)
    let got: string | null = 'unset'
    t.on('focus', (id) => (got = id))
    t.focusLayer('onto')
    expect(t.focus).toBe('onto')
    expect(got).toBe(t.focus)
    t.focusLayer(null)
    expect(t.focus).toBe(null)
  })

  it('shot 的选项：layer 和 duration 放在一个对象里', () => {
    const s = new Strata(host)
    s.setData(small(2))
    calls.length = 0
    s.shot('layer', { layer: 'table', duration: 0 })
    const fit = calls.find((c) => c.name === 'fit')!
    expect((fit.args[1] as { duration: number }).duration).toBe(0)
    calls.length = 0
    s.shot('overview', { duration: 0.2 })
    expect((calls.find((c) => c.name === 'frame')!.args[1] as { duration: number }).duration).toBe(0.2)
  })

  it('follow：选项、getter、setFollow（返回 HeroInfo，发 hero）', () => {
    const s = new Strata(host, { follow: true })
    s.setData(small(2))
    expect(s.follow).toBe(true)
    expect(s.hero.follow).toBe(true)
    const heroes: boolean[] = []
    s.on('hero', (h) => heroes.push(h.follow))
    expect(s.setFollow(false)).toEqual(s.hero)
    expect(s.follow).toBe(false)
    expect(heroes).toEqual([false])
    expect(s.view.follow).toBe(false)
    expect('setFollowHero' in s).toBe(false)
    expect('heroInfo' in s).toBe(false)
  })

  it('视图状态里主次的分量叫 heroMix；setView({ heroMix }) 恢复', () => {
    const s = new Strata(host)
    s.setData(small(2))
    expect(Object.keys(s.view)).toContain('heroMix')
    expect(Object.keys(s.view)).not.toContain('hero')
    s.setView({ heroMix: { table: 1 } })
    expect(s.hero.id).toBe('table')
  })

  it('setInset 四边；缺的边是 0；getter 给一份拷贝', () => {
    const s = new Strata(host)
    calls.length = 0
    s.setInset({ right: 300, top: 40 })
    expect(calls.find((c) => c.name === 'setInset')!.args[0]).toEqual({ top: 40, right: 300, bottom: 0, left: 0 })
    expect(s.inset).toEqual({ top: 40, right: 300, bottom: 0, left: 0 })
    s.setInset({ left: -5, bottom: Number.NaN })
    expect(s.inset).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    s.inset.left = 9
    expect(s.inset.left).toBe(0)
  })

  it('spread 的 getter 和 setSpread 成对', () => {
    const s = new Strata(host)
    s.setData(small(2))
    s.setSpread(1.5)
    expect(s.spread).toBe(1.5)
    expect(s.view.spread).toBe(1.5)
  })

  it('插件拿不到 emit：不能伪造核心事件', () => {
    let ctx!: import('../src/plugin').StrataContext
    const s = new Strata(host)
    s.use({ name: 'probe', install: (c) => void (ctx = c) })
    expect('emit' in ctx).toBe(false)
  })
})

describe('映射审计插件', async () => {
  const { auditPlugin, auditColors } = await import('../src/audit')
  const { auditMappings } = await import('../src/headless')
  const { panorama, layered } = await import('../demo/src/data')
  type Mode = { model: { index: Map<string, number>; base: { nodes: { id: string; layer: number }[]; edges: { s: number; t: number; kind: string }[] }; edgeId: string[] }; looks(f: { time: number; dt: number }): import('../src/types').Looks; select?(i: number): void }
  const modeOf = (s: InstanceType<typeof Strata>) => (s as unknown as { core: { active: { mode: Mode } | null } }).core.active?.mode ?? null
  const frame = (s: InstanceType<typeof Strata>) => modeOf(s)!.looks({ time: 1, dt: 0.016 })
  const node = (s: InstanceType<typeof Strata>, id: string) => modeOf(s)!.model.index.get(id)!
  const edge = (s: InstanceType<typeof Strata>, id: string) => modeOf(s)!.model.edgeId.indexOf(id)
  const C = auditColors('dark')

  const setup = (data = panorama('en')) => {
    const s = new Strata(host)
    const audit = s.use(auditPlugin())
    s.setData(data)
    return { s, audit, data }
  }

  it('show 审计 strata 现在的数据、接管画面；exit 交还', () => {
    const { s, audit, data } = setup()
    const seen: string[] = []
    audit.on('enter', () => seen.push('enter'))
    audit.on('exit', () => seen.push('exit'))
    calls.length = 0
    const a = audit.show()!
    expect(a).toEqual(auditMappings(data))
    expect(a.maxHops).toBe(3)
    expect(s.mode).toBe('audit')
    expect(audit.active).toBe(true)
    expect(audit.current).toBe(a)
    expect(calls.filter((c) => c.name === 'setBase')).toHaveLength(1)
    audit.exit()
    expect(s.mode).toBeNull()
    expect(audit.active).toBe(false)
    expect(audit.current).toBeNull()
    expect(seen).toEqual(['enter', 'exit'])
    // 没在审计时 exit、select 什么都不做
    audit.exit()
    audit.select({ kind: 'node', id: 'c:order' })
    expect(seen).toEqual(['enter', 'exit'])
  })

  it('没有数据时 show 返回 null；层不对照样抛 audit-layers', () => {
    const s = new Strata(host)
    const audit = s.use(auditPlugin())
    expect(audit.show()).toBeNull()
    s.setData(panorama('en'))
    expect(() => audit.show({ upper: 'nope' })).toThrow(expect.objectContaining({ code: 'audit-layers' }))
    expect(s.mode).toBeNull()
  })

  it('平时：只有缺口带颜色，没缺口的退成灰', () => {
    const { s, audit } = setup()
    audit.show()
    const L = frame(s)
    expect(L.neutral).toBe(1)
    // 走不通的本体关系：缺口色的虚线
    const unreachable = L.edges[edge(s, 'c:customer||c:coupon_claim')]
    expect([unreachable.colorA, unreachable.dash]).toEqual([C.gap, true])
    // 完全没用到的外键：缺口色的实线；只被路径用到的：弱一档的颜色
    const unused = L.edges[edge(s, 'tbl:orders|fk|tbl:dim_date')]
    expect([unused.colorA, unused.dash]).toEqual([C.gap, false])
    expect(L.edges[edge(s, 'tbl:reviews|fk|tbl:order_items')].colorA).toBe(C.weak)
    // 一端没映射的关系不另外标：缺口在节点上
    expect(L.edges[edge(s, 'c:order||c:invoice')].colorA).not.toBe(C.gap)
    // 没映射的节点：缺口色的环、出名字；走不通的关系两端出名字；没缺口的节点名字收起
    const invoice = L.nodes[node(s, 'c:invoice')]
    expect(invoice.ring?.color).toBe(C.gap)
    expect(invoice.label!.alpha).toBe(1)
    expect(L.nodes[node(s, 'c:coupon_claim')].label!.alpha).toBe(1)
    expect(L.nodes[node(s, 'tbl:dim_region')].ring?.color).toBe(C.gap)
    const quiet = L.nodes[node(s, 'tbl:wishlists')]
    expect(quiet.ring).toBeNull()
    expect(quiet.label!.alpha).toBe(0)
    // 静止时没有东西泛光
    expect(Math.max(...L.nodes.map((n) => n.intensity))).toBeLessThanOrEqual(1)
  })

  it('不在审计的两层里的节点压暗、不出名字', () => {
    const { s, audit } = setup(layered(3, 'en'))
    audit.show()
    const L = frame(s)
    const m = modeOf(s)!.model
    const metric = m.base.nodes.findIndex((n) => n.layer === 0)
    expect(L.nodes[metric].label!.alpha).toBe(0)
    expect(L.nodes[metric].alpha).toBeLessThan(0.5)
  })

  it('选中一条走得通的关系：两端、路径上的表和外键亮起来，镜头框住，发 select', () => {
    const { s, audit } = setup()
    audit.show()
    const got: unknown[] = []
    audit.on('select', (v) => got.push(v))
    calls.length = 0
    audit.select({ kind: 'relation', id: 'c:customer||c:favorite' })
    expect(audit.selected).toEqual({ kind: 'relation', id: 'c:customer||c:favorite' })
    expect(got).toEqual([{ kind: 'relation', id: 'c:customer||c:favorite' }])
    expect(calls.some((c) => c.name === 'fit')).toBe(true)
    const L = frame(s)
    for (const id of ['c:customer', 'c:favorite', 'tbl:customers', 'tbl:wishlists']) expect(L.nodes[node(s, id)].intensity, id).toBeGreaterThan(1)
    expect(L.nodes[node(s, 'c:customer')].ring?.color).toBe(DARK.accent)
    const join = L.edges[edge(s, 'tbl:wishlists|fk|tbl:customers')]
    expect(join.flow).toBeGreaterThan(0)
    expect(join.colorA).toBe(DARK.accent)
    // 别的缺口退一步
    expect(L.edges[edge(s, 'tbl:orders|fk|tbl:dim_date')].alpha).toBeLessThan(0.5)
    expect(L.nodes[node(s, 'tbl:dim_date')].intensity).toBeLessThan(1)
  })

  it('选中只被路径用到的外键：用到它的本体关系一起亮', () => {
    const { s, audit } = setup()
    const a = audit.show()!
    const j = a.joins.find((x) => x.id === 'tbl:reviews|fk|tbl:order_items')!
    audit.select({ kind: 'join', id: j.id })
    const L = frame(s)
    for (const id of j.usedBy) expect(L.edges[edge(s, id)].intensity, id).toBeGreaterThan(1)
    expect(L.edges[edge(s, j.id)].colorA).toBe(C.weak)
  })

  it('在图上点节点选中它，再点一次或点空白处放开；未知的项清掉选中，镜头交还', () => {
    const { s, audit } = setup()
    audit.show()
    const mode = modeOf(s)!
    mode.select!(node(s, 'c:invoice'))
    expect(audit.selected).toEqual({ kind: 'node', id: 'c:invoice' })
    expect(frame(s).nodes[node(s, 'c:order')].intensity).toBeGreaterThan(1)
    mode.select!(node(s, 'c:invoice'))
    expect(audit.selected).toBeNull()
    mode.select!(node(s, 'c:invoice'))
    mode.select!(-1)
    expect(audit.selected).toBeNull()
    audit.select({ kind: 'relation', id: 'c:customer||c:favorite' })
    calls.length = 0
    audit.select({ kind: 'join', id: 'nope' })
    expect(audit.selected).toBeNull()
    expect(calls.filter((c) => c.name === 'frame')).toHaveLength(1)
  })

  it('选中以后 exit 回到总览；用户动过镜头就不动', () => {
    const { s, audit } = setup()
    audit.show()
    audit.select({ kind: 'node', id: 'c:invoice' })
    calls.length = 0
    audit.exit()
    expect(calls.filter((c) => c.name === 'frame')).toHaveLength(1)
    audit.show()
    audit.select({ kind: 'node', id: 'c:invoice' })
    userMoves(s)
    calls.length = 0
    audit.exit()
    expect(calls.filter((c) => c.name === 'frame')).toHaveLength(0)
  })

  it('审计按收起来画：审计时展开不改画面，交还时全景按新的展开状态重建', () => {
    const { s, audit } = setup(small(2))
    audit.show()
    const table = small(2).nodes.find((n) => n.parent)!.parent!
    calls.length = 0
    s.expand(table)
    expect(s.expanded).toEqual([table])
    expect(calls.filter((c) => c.name === 'setBase')).toHaveLength(0)
    expect(s.mode).toBe('audit')
    audit.exit()
    const m = (s as unknown as { core: { model: { index: Map<string, number> } } }).core.model
    expect([...m.index.keys()].some((id) => small(2).nodes.find((n) => n.id === id)?.parent === table)).toBe(true)
  })

  it('已经展开着也按收起来审计、画面不带子节点', () => {
    const data = small(2)
    const table = data.nodes.find((n) => n.parent)!.parent!
    const s = new Strata(host)
    const audit = s.use(auditPlugin())
    s.setData(data)
    s.expand(table)
    audit.show()
    const kids = data.nodes.filter((n) => n.parent === table).map((n) => n.id)
    expect(kids.some((id) => modeOf(s)!.model.index.has(id))).toBe(false)
  })

  it('视图状态带着选中项；换数据就退出；换主题选中项接着用', async () => {
    const { s, audit } = setup()
    expect(s.view.audit).toBeNull()
    audit.show()
    audit.select({ kind: 'relation', id: 'c:customer||c:coupon_claim' })
    expect(s.view.audit).toEqual({ selected: { kind: 'relation', id: 'c:customer||c:coupon_claim' } })
    s.setView({ audit: { selected: { kind: 'node', id: 'c:invoice' } } })
    expect(audit.selected).toEqual({ kind: 'node', id: 'c:invoice' })
    const { createTheme } = await import('../src/theme')
    s.setTheme(createTheme({ diffScheme: 'light' }))
    expect(audit.active).toBe(true)
    expect(audit.selected).toEqual({ kind: 'node', id: 'c:invoice' })
    expect(frame(s).nodes[node(s, 'c:invoice')].ring?.color).toBe(DARK.accent)
    expect(frame(s).nodes[node(s, 'tbl:dim_region')].ring?.color).toBe(auditColors('light').gap)
    let exited = false
    audit.on('exit', () => (exited = true))
    s.setData(panorama('en'))
    expect(exited).toBe(true)
    expect(audit.active).toBe(false)
  })

  it('别的模式接管时审计退出', async () => {
    const { diffPlugin } = await import('../src/diff')
    const { s, audit } = setup(small(2))
    const diff = s.use(diffPlugin())
    audit.show()
    let exited = false
    audit.on('exit', () => (exited = true))
    await diff.show(small(2), small(2))
    expect(s.mode).toBe('diff')
    expect(exited).toBe(true)
  })
})

describe('名字的规则', () => {
  type Inner = { styler: { resolve(st: unknown): { nodes: { label: { alpha: number } }[] } }; model: { index: Map<string, number> } }
  const rest = { hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: 0 }
  /** 平时（没指着东西、不分主次）这个节点的名字出多少 */
  const labelOf = (s: InstanceType<typeof Strata>, id: string) => {
    const c = (s as unknown as { core: Inner }).core
    return c.styler.resolve(rest).nodes[c.model.index.get(id)!].label.alpha
  }
  const limitOf = (s: InstanceType<typeof Strata>) => (s as unknown as { renderer: { labelLimit: number } }).renderer.labelLimit

  it('选项和 setLabels：样式按新规则出名字，上限交给渲染器；getter 给拷贝', () => {
    const given: LabelOptions = { mode: 'hover', nodes: { 'c:order': 'always' }, max: 12.7 }
    const s = new Strata(host, { labels: given })
    s.setData(small(2))
    expect(limitOf(s)).toBe(12)
    expect(labelOf(s, 'c:order')).toBe(1)
    expect(labelOf(s, 'tbl:orders')).toBe(0)
    // 改调用方给的对象不影响引擎；getter 给的也是拷贝
    given.nodes!['c:order'] = 'hover'
    expect(s.labels).toEqual({ mode: 'hover', nodes: { 'c:order': 'always' }, max: 12.7 })
    s.labels.nodes!['c:order'] = 'hover'
    expect(labelOf(s, 'c:order')).toBe(1)
    s.setLabels({ max: -3 })
    expect(s.labels).toEqual({ max: -3 })
    expect(limitOf(s)).toBe(160)
    expect(labelOf(s, 'tbl:orders')).toBe(1)
    // 展开、换主题重建样式时规则跟着
    s.setLabels({ layers: { table: 'hover' } })
    s.setTheme({ accent: '#ffffff' })
    expect(labelOf(s, 'tbl:orders')).toBe(0)
    s.expand('tbl:orders')
    expect(labelOf(s, 'tbl:orders')).toBe(0)
  })

  it('没有数据时 setLabels 也收下，setData 之后生效', () => {
    const s = new Strata(host)
    s.setLabels({ mode: 'hover' })
    s.setData(small(2))
    expect(labelOf(s, 'c:order')).toBe(0)
  })
})

describe('模式交接', async () => {
  const { auditPlugin } = await import('../src/audit')
  const { diffPlugin } = await import('../src/diff')
  type Inner = { model: { index: Map<string, number> }; active: unknown }
  const inner = (s: InstanceType<typeof Strata>) => (s as unknown as { core: Inner }).core
  const setup = () => {
    const s = new Strata(host)
    const audit = s.use(auditPlugin())
    const diff = s.use(diffPlugin())
    s.setData(small(2))
    return { s, audit, diff }
  }

  it('看变化时展开、审计接过去再交还：全景按现在的展开状态重建', async () => {
    const { s, audit, diff } = setup()
    await diff.show(small(2), small(2))
    s.expand('tbl:orders')
    await new Promise((r) => setTimeout(r, 0))
    expect(s.mode).toBe('diff')
    audit.show()
    audit.exit()
    expect(s.mode).toBeNull()
    expect(s.expanded).toEqual(['tbl:orders'])
    expect(inner(s).model.index.has('fld:orders.id')).toBe(true)
  })

  it('审计时展开过，换了数据以后再审计、交还：不白白重建，选中留着', () => {
    const { s, audit } = setup()
    audit.show()
    s.expand('tbl:orders')
    s.setData(small(2))
    s.select('c:order')
    audit.show()
    audit.exit()
    expect(s.view.selected).toBe('c:order')
  })

  it('还没回来的 diff.show 不把画面从之后的审计手里抢回去', async () => {
    const { s, audit, diff } = setup()
    const p = diff.show(small(2), small(2))
    audit.show()
    expect(await p).toBeNull()
    expect(s.mode).toBe('audit')
    expect(audit.active).toBe(true)
    // 之后的展开也不会让看变化重新比、抢回画面
    s.expand('tbl:orders')
    await new Promise((r) => setTimeout(r, 0))
    expect(s.mode).toBe('audit')
  })

  it('销毁时接管着的模式被收回：插件不再以为自己在接管，发 exit', () => {
    const { s, audit } = setup()
    const seen: string[] = []
    audit.on('exit', () => seen.push('exit'))
    audit.show()
    s.dispose()
    expect(audit.active).toBe(false)
    expect(s.mode).toBeNull()
    expect(seen).toEqual(['exit'])
  })
})
