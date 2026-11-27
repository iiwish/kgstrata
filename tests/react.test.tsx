import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { HeroInfo, HoverInfo, LayerInfo, Strata } from '../src/engine'
import { StrataError, message } from '../src/locale'
import { Emitter, type StrataEvents, type StrataPlugin } from '../src/plugin'
import { CANVAS_CSS, StrataCanvas, canvasFallback } from '../src/react/canvas'
import { themeRule, themeVars } from '../src/react/store'
import { DARK, createTheme } from '../src/theme'
import { useStrata } from '../src/react/context'
import { DiffPanel, changesByLayer } from '../src/react/diff'
import { familyColors } from '../src/diff'
import { FollowToggle, HeroMixSlider, LayerList, NodeTip, SpreadSlider, ViewButtons } from '../src/react/panels'
import { PathList, nodeInfoFrom } from '../src/react/path'
import { AuditPanel, auditItems } from '../src/react/audit'
import { auditColors } from '../src/audit'
import { auditMappings } from '../src/headless'
import { panorama } from '../demo/src/data'
import {
  EMPTY_STATE,
  bindEvents,
  countBy,
  createStateStore,
  heroPair,
  layerClickTarget,
  layerCount,
  layerMarkOpacity,
  layerPressed,
  mountStrata,
  sameValue,
  stepStatus,
  textFor,
  tipLines,
  zeroHeightWarning,
  type StrataSource,
} from '../src/react/store'
import type { StrataDiff } from '../src/diff'
import type { StrataData } from '../src/types'

// kgstrata/react 里不需要 WebGL 的部分：面板的结构、中英文、aria；hook 背后的纯函数；创建失败时的 fallback。
// <StrataCanvas> 真正创建引擎、换数据、销毁要 WebGL 和 DOM，这里没测（在效果页里手动过）。

const LAYERS: LayerInfo[] = [
  { id: 'onto', name: '本体', visible: true, count: 9 },
  { id: 'table', name: '物理表', visible: false, count: 22 },
]
const DUAL: HeroInfo = { id: 'onto', follow: true, mix: { onto: 1, table: 0 } }
const SINGLE: HeroInfo = { id: null, follow: false, mix: {} }
const html = (el: React.ReactElement) => renderToStaticMarkup(el)

describe('层列表', () => {
  it('每层一行：名字、计数、眼睛按钮；隐藏的层出徽标、主按钮禁用', () => {
    const out = html(<LayerList layers={LAYERS} hero={DUAL} focus={null} counts={{ onto: 12, table: 30 }} badges={new Map([['onto', 2], ['table', 3]])} locale="zh-CN" />)
    expect(out).toContain('<ol class="kgs-layer-list" aria-label="层">')
    expect(out).toContain('<span class="kgs-layer-name">本体</span>')
    expect(out).toContain('<em class="kgs-layer-count">12</em>')
    expect(out).toContain('class="kgs-layer kgs-off"')
    // 显示着的层不出徽标，隐藏的出
    expect(out).not.toContain('>2</u>')
    expect(out).toContain('<u class="kgs-layer-badge" title="这一层有 3 处变化">3</u>')
    expect(out).toContain('aria-label="隐藏本体"')
    expect(out).toContain('aria-label="显示物理表"')
    expect(out).toContain('title="显示这一层"')
    expect(out.match(/aria-pressed="true"/g)?.length).toBe(2) // 主角那行 + 显示着的眼睛
    expect(out).toContain('disabled=""')
    expect(out).toContain('type="button"')
  })

  it('计数缺省是每层的顶层节点数；给了 counts 用它，false 不出', () => {
    expect(layerCount(undefined, LAYERS[1])).toBe(22)
    expect(layerCount({ table: 61 }, LAYERS[1])).toBe(61)
    expect(layerCount(new Map([['onto', 3]]), LAYERS[1])).toBe(undefined)
    expect(layerCount(false, LAYERS[1])).toBe(undefined)
    const out = html(<LayerList layers={LAYERS} hero={DUAL} focus={null} locale="zh-CN" />)
    expect(out).toContain('<em class="kgs-layer-count">22</em>')
    expect(out).toContain('<em class="kgs-layer-count">9</em>')
    expect(html(<LayerList layers={LAYERS} hero={DUAL} focus={null} counts={false} />)).toContain('<em class="kgs-layer-count"></em>')
  })

  it('英文；徽标可以一直出', () => {
    const out = html(<LayerList layers={LAYERS} hero={SINGLE} focus={null} badges={{ onto: 2 }} badgeWhen="always" locale="en" />)
    expect(out).toContain('aria-label="Layers"')
    expect(out).toContain('aria-label="Hide 本体"')
    expect(out).toContain('title="Show this layer"')
    expect(out).toContain('title="2 changes in this layer"')
  })

  it('点一行：并存时当主角，一张图时聚焦、再点放开', () => {
    expect(layerClickTarget(DUAL, null, 'table')).toBe('table')
    expect(layerClickTarget(DUAL, 'table', 'table')).toBe('table')
    expect(layerClickTarget(SINGLE, null, 'onto')).toBe('onto')
    expect(layerClickTarget(SINGLE, 'onto', 'onto')).toBe(null)
    expect(layerClickTarget(null, null, 'onto')).toBe('onto')
  })

  it('按下和小条的亮度', () => {
    expect(layerPressed(DUAL, null, LAYERS[0])).toBe(true)
    expect(layerPressed(SINGLE, 'onto', LAYERS[0])).toBe(true)
    expect(layerPressed(SINGLE, 'table', { ...LAYERS[1], visible: false })).toBe(false)
    expect(layerMarkOpacity(DUAL, null, LAYERS[1])).toBe(0.15)
    expect(layerMarkOpacity({ ...DUAL, mix: { onto: 0.5 } }, null, LAYERS[0])).toBeCloseTo(0.65)
    expect(layerMarkOpacity(SINGLE, null, LAYERS[0])).toBe(1)
    expect(layerMarkOpacity(SINGLE, 'table', LAYERS[0])).toBe(0.35)
  })
})

describe('其他核心面板', () => {
  it('主角跟随：只有分主次时出', () => {
    expect(html(<FollowToggle hero={SINGLE} />)).toBe('')
    expect(html(<FollowToggle hero={null} />)).toBe('')
    const out = html(<FollowToggle hero={DUAL} locale="zh-CN" />)
    expect(out).toContain('aria-pressed="true"')
    expect(out).toContain('<span>主角跟随</span>')
    expect(html(<FollowToggle hero={{ ...DUAL, follow: false }} locale="en" />)).toContain('aria-pressed="false"')
  })

  it('主次滑杆：正好两层、分主次时出，值是第二层的分量', () => {
    expect(heroPair(DUAL, LAYERS)?.map((l) => l.id)).toEqual(['onto', 'table'])
    expect(heroPair(DUAL, [...LAYERS, { id: 'm', name: 'm', visible: true, count: 1 }])).toBe(null)
    expect(heroPair(SINGLE, LAYERS)).toBe(null)
    expect(html(<HeroMixSlider hero={SINGLE} layers={LAYERS} />)).toBe('')
    const out = html(<HeroMixSlider hero={{ ...DUAL, mix: { onto: 0.3, table: 0.7 } }} layers={LAYERS} locale="zh-CN" />)
    expect(out).toContain('<span>主次</span>')
    expect(out).toContain('value="0.7"')
    expect(out).toContain('type="range"')
  })

  it('层距、镜头按钮', () => {
    const spread = html(<SpreadSlider locale="zh-CN" />)
    expect(spread).toContain('<span>层距</span>')
    expect(spread).toContain('min="0.4"')
    expect(spread).toContain('value="1"')
    expect(html(<SpreadSlider locale="en" />)).toContain('Spacing')
    const views = html(<ViewButtons locale="zh-CN" />)
    expect(views).toContain('role="group"')
    expect(views).toContain('aria-label="镜头"')
    expect(views).toContain('>总览</button>')
    expect(views).toContain('>叠看</button>')
    expect(html(<ViewButtons locale="en" />)).toContain('>Overview</button>')
  })

  it('悬停提示：名字、层名 · 组名、能展开的写“N 个字段”（名词按节点类型）', () => {
    const info: HoverInfo = { id: 't', label: 'orders', layer: 'table', layerName: '物理表', group: 'domain/order', groupName: '订单', folds: 12, childNoun: '字段', expanded: false, pointer: { x: 100, y: 50 } }
    expect(html(<NodeTip info={null} />)).toBe('')
    const zh = html(<NodeTip info={info} locale="zh-CN" />)
    expect(zh).toContain('role="tooltip"')
    expect(zh).toContain('left:116px;top:64px')
    // 显示的是名字，不是 id
    expect(zh).toContain('<b>orders</b><span>物理表 · 订单</span><span>12 个字段 · 双击展开</span>')
    expect(html(<NodeTip info={{ ...info, expanded: true }} locale="zh-CN" />)).toContain('<span>双击收起</span>')
    expect(html(<NodeTip info={{ ...info, childNoun: 'fields' }} locale="en" />)).toContain('12 fields · double-click to expand')
    // 没有可展开的：不出第三行
    expect(html(<NodeTip info={{ ...info, folds: 0, group: null, groupName: null }} locale="zh-CN" />)).toContain('<span>物理表</span></div>')
  })

  it('悬停提示：没配名词时是中性的说法', () => {
    const info: HoverInfo = { id: 'c', label: '客户', layer: 'onto', layerName: '本体', group: null, groupName: null, folds: 3, childNoun: null, expanded: false, pointer: { x: 0, y: 0 } }
    expect(tipLines(info, textFor(null, 'zh-CN'))).toEqual({ where: '本体', fold: '内含 3 项 · 双击展开' })
    expect(tipLines(info, textFor(null, 'en'))).toEqual({ where: '本体', fold: '3 inside · double-click to expand' })
    expect(tipLines({ ...info, folds: 0 }, textFor(null, 'en')).fold).toBe(null)
  })
})

describe('路径面板', () => {
  const data = {
    version: 2,
    layers: [{ id: 'onto', name: '本体' }, { id: 'table', name: '物理表' }],
    nodes: [
      { id: 'a', layer: 'onto', label: '顾客' },
      { id: 'b', layer: 'onto', label: '订单' },
      { id: 'c', layer: 'table', label: 'orders' },
    ],
    relations: [],
  } as StrataData
  const paths = [
    { id: 'p1', question: '顾客的订单落在哪张表？', nodes: ['a', 'b', 'c'] },
    { id: 'p2', question: '另一个问题', nodes: ['c'] },
  ]

  it('展开正在看的那个问题：序号、名字、层；点亮的、跳过的', () => {
    const out = html(<PathList paths={paths} path={null} active="p1" progress={{ ids: ['a', 'c'], reached: 1 }} nodeInfo={nodeInfoFrom(data)} locale="zh-CN" />)
    expect(out).toContain('aria-label="问题"')
    expect(out).toContain('class="kgs-path kgs-on"')
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('<li class="kgs-step kgs-lit"><b>①</b><span>顾客</span><em>本体</em></li>')
    expect(out).toContain('<li class="kgs-step kgs-skipped" title="这一步在隐藏的层里，跳过了"><b>②</b><span>订单</span>')
    expect(out).toContain('<li class="kgs-step"><b>③</b><span>orders</span><em>物理表</em></li>')
    // 没展开的问题不列步骤
    expect(out.match(/kgs-steps/g)?.length).toBe(1)
    expect(html(<PathList paths={paths} path={null} active="p1" progress={{ ids: ['a'], reached: 0 }} nodeInfo={nodeInfoFrom(data)} locale="en" />)).toContain(
      'title="This step is in a hidden layer and was skipped"',
    )
  })

  it('每一步的状态；查不到的节点原样显示 id', () => {
    expect(stepStatus('a', { ids: ['a', 'b'], reached: 1 })).toBe('lit')
    expect(stepStatus('b', { ids: ['a', 'b'], reached: 1 })).toBe('pending')
    expect(stepStatus('x', { ids: ['a', 'b'], reached: 2 })).toBe('skipped')
    expect(stepStatus('x', { ids: [], reached: 0 })).toBe('pending')
    expect(nodeInfoFrom(data)('zzz')).toEqual({ label: 'zzz', layer: '' })
    expect(nodeInfoFrom(null)('a')).toEqual({ label: 'a', layer: '' })
  })
})

describe('看变化的面板', () => {
  const hunk = (index: number, family: string, layer: string, start: number, end: number) => ({
    id: `h${index}`,
    kind: 'k',
    family,
    title: `变化 ${index}`,
    subtitle: index === 0 ? '说明' : '',
    nodes: [`n${index}`],
    context: [],
    center: [0, 0],
    layer,
    radius: 1,
    start,
    end,
  })
  const diff = {
    hunks: [hunk(0, 'added', 'onto', 0, 100), hunk(1, 'added', 'table', 100, 200), hunk(2, 'removed', 'table', 200, 300)],
    duration: 300,
    stats: { added: 2, removed: 1, changed: 0 },
  } as unknown as StrataDiff
  const colors = { added: { base: '#00ff00', text: '#aaffaa' }, removed: { base: '#ff0000', text: '#ffaaaa' } }

  it('五类变化的计数、三个版本按钮、回放条、变化列表', () => {
    const out = html(<DiffPanel diff={null} current={diff} colors={colors} locale="zh-CN" />)
    expect(out).toContain('data-family="added" style="color:#aaffaa"><i style="background:#00ff00"></i>新增 2</span>')
    expect(out).toContain('删除 1')
    expect(out).toContain('role="group" aria-label="版本"')
    expect(out).toContain('aria-pressed="true">叠加</button>')
    expect(out).toContain('aria-pressed="false">之前</button>')
    expect(out).toContain('aria-label="回放"')
    expect(out).toContain('aria-label="回放进度"')
    expect(out).toContain('max="300"')
    expect(out).toContain('aria-label="变化列表"')
    expect(out).toContain('<span>变化 0</span><em>说明</em>')
    expect(out.match(/<li>/g)?.length).toBe(3)
  })

  it('英文；没有差异时不出', () => {
    const out = html(<DiffPanel diff={null} current={diff} colors={colors} locale="en" />)
    expect(out).toContain('Added 2')
    expect(out).toContain('>Before</button>')
    expect(out).toContain('aria-label="Replay"')
    expect(html(<DiffPanel diff={null} current={null} />)).toBe('')
  })

  it('不给颜色时用 kgdiff 的', () => {
    expect(html(<DiffPanel diff={null} current={diff} locale="en" />)).toMatch(/data-family="added" style="color:#[0-9a-f]{6}/i)
  })

  it('每层有几处变化：算在它主要落在的那一层（层的 id）', () => {
    expect({ ...changesByLayer(diff) }).toEqual({ onto: 1, table: 2 })
    expect({ ...changesByLayer(null) }).toEqual({})
  })

  it('浅色方案的主题：缺省颜色跟着 diffScheme', () => {
    expect(familyColors('light').added.base).not.toBe(familyColors('dark').added.base)
    expect(familyColors({ diffScheme: 'light' })).toEqual(familyColors('light'))
    expect(familyColors()).toEqual(familyColors('dark'))
  })
})

describe('审计的面板', () => {
  const data = panorama('en')
  const audit = auditMappings(data)
  const label = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id

  it('缺口按组列出：走不通的关系、没映射的两层节点、没用到的外键、只被路径用到的外键', () => {
    const items = auditItems(audit, label)
    expect([...new Set(items.map((x) => x.group))]).toEqual(['broken', 'unmapped-upper', 'unmapped-lower', 'unused', 'via-path'])
    // 只列两端都有表、连不上的关系：一端没映射的算在那个节点上
    expect(items.filter((x) => x.group === 'broken').map((x) => x.target.id)).toEqual(['c:customer||c:coupon_claim', 'c:coupon||c:order'])
    expect(items.find((x) => x.target.id === 'c:customer||c:coupon_claim')).toEqual({
      group: 'broken',
      target: { kind: 'relation', id: 'c:customer||c:coupon_claim' },
      title: `${label('c:customer')} — ${label('c:coupon_claim')}`,
      detail: 'No join path within 3 hops',
    })
    expect(items.find((x) => x.target.id === 'c:promotion')!.detail).toBe('2 relations cannot be walked')
    expect(items.find((x) => x.target.id === 'tbl:orders|fk|tbl:dim_date')!.detail).toBe('An end has nothing mapped onto it')
    const via = items.find((x) => x.group === 'via-path')!
    expect(via.target).toEqual({ kind: 'join', id: 'tbl:reviews|fk|tbl:order_items' })
    expect(via.detail).toMatch(/^Used by the path of /)
    // 走得通的关系、直接对应的外键不列
    expect(items.some((x) => x.target.id === 'c:customer||c:favorite')).toBe(false)
    expect(items).toHaveLength(2 + 5 + 5 + 7 + 1)
  })

  it('两行总数、每组的数目和颜色、中文', () => {
    const out = html(<AuditPanel audit={null} current={audit} colors={{ gap: '#ff0000' }} locale="zh-CN" />)
    expect(out).toContain('关系 48 条，走得通 39 条')
    expect(out).toContain('外键 35 条，有关系直接对应 27 条')
    expect(out).toContain('<i style="background:#ff0000"></i><span>走不通的关系</span><b>2</b>')
    expect(out).toContain('<span>没映射到table</span><b>5</b>')
    expect(out).toContain(`<i style="background:${auditColors('dark').weak}"></i><span>只被路径用到的外键</span><b>1</b>`)
    expect(out).toContain('两端都有表，3 跳内连不上')
    expect(out).toContain('aria-pressed="false"')
  })

  it('每组超过上限时折起来；没有缺口时说一声；没有审计时不出', () => {
    const out = html(<AuditPanel audit={null} current={audit} limit={2} locale="en" />)
    expect(out).toContain('3 more')
    expect(out).toContain('5 more')
    const clean = { ...audit, relations: [], joins: [], unmappedUpper: [], unmappedLower: [] }
    expect(html(<AuditPanel audit={null} current={clean} locale="en" />)).toContain('No gaps')
    expect(html(<AuditPanel audit={null} current={null} />)).toBe('')
  })
})

describe('状态仓库', () => {
  /** 假的引擎：只有仓库用到的几样 */
  function fake() {
    const events = new Emitter<StrataEvents>()
    const s = {
      layers: LAYERS,
      hero: DUAL,
      expanded: [] as string[],
      focus: null,
      on: events.on.bind(events),
    }
    return { s: s as unknown as StrataSource, raw: s, events }
  }

  it('快照是缓存的；内容没变不换引用，变了才通知', () => {
    const { s, events } = fake()
    const store = createStateStore(s, 'layers')
    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)
    const cb = vi.fn()
    const off = store.subscribe(cb)
    events.emit('layers', LAYERS.map((l) => ({ ...l })))
    expect(cb).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toBe(first)
    const next = [{ ...LAYERS[0], visible: false }, LAYERS[1]]
    events.emit('layers', next)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe(next)
    off()
    events.emit('layers', LAYERS)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('订阅时补读一遍：创建仓库到订阅之间变了的也算', () => {
    const { s, raw } = fake()
    const store = createStateStore(s, 'expanded')
    raw.expanded = ['t1']
    const cb = vi.fn()
    store.subscribe(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual(['t1'])
  })

  it('focus 跟着事件带的值；没有实例时是空值', () => {
    const { s, events } = fake()
    const store = createStateStore(s, 'focus')
    store.subscribe(() => {})
    events.emit('focus', 'table')
    expect(store.getSnapshot()).toBe('table')
    expect(createStateStore(null, 'hero').getSnapshot()).toBe(null)
    expect(createStateStore(null, 'layers').getSnapshot()).toBe(EMPTY_STATE.layers)
  })

  it('结构相等、计数', () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameValue([1], { 0: 1 })).toBe(false)
    expect(sameValue(null, {})).toBe(false)
    expect(countBy(['x', 'y', 'x', 'z'], (v) => (v === 'z' ? undefined : v))).toEqual([
      ['x', 2],
      ['y', 1],
    ])
  })
})

describe('创建实例和事件', () => {
  const host = {} as HTMLElement
  const data = { version: 2, layers: [], nodes: [], relations: [] } as unknown as StrataData

  function fakeStrata() {
    const calls: string[] = []
    const events = new Emitter<StrataEvents>()
    const s = {
      use: (p: StrataPlugin<unknown>) => (calls.push(`use:${p.name}`), p.install({} as never)),
      setData: () => (calls.push('setData'), []),
      dispose: () => calls.push('dispose'),
      on: events.on.bind(events),
    }
    return { s: s as unknown as Strata, calls, events }
  }

  it('拿不到 WebGL：不抛，交回错误', () => {
    const err = new StrataError('webgl-unavailable', 'no gl')
    const res = mountStrata(
      host,
      () => {
        throw err
      },
      {},
      [],
      data,
    )
    expect(res).toEqual({ ok: false, error: err })
  })

  it('按顺序装插件，再 setData；插件的接口按顺序交回', () => {
    const { s, calls } = fakeStrata()
    const plugins = [
      { name: 'a', install: () => 'A' },
      { name: 'b', install: () => 'B' },
    ]
    const res = mountStrata(host, () => s, { locale: 'zh-CN' }, plugins, data)
    expect(calls).toEqual(['use:a', 'use:b', 'setData'])
    expect(res.ok && res.apis).toEqual(['A', 'B'])
    expect(res.ok && res.names).toEqual(['a', 'b'])
    expect(res.ok && res.issues).toEqual([])
    // 没给数据就不 setData
    const second = fakeStrata()
    expect(mountStrata(host, () => second.s, {}, [], null)).toMatchObject({ ok: true, issues: null })
    expect(second.calls).toEqual([])
  })

  it('装插件时抛了：已经造出来的销毁掉', () => {
    const { s, calls } = fakeStrata()
    const boom = new Error('boom')
    const res = mountStrata(host, () => s, {}, [{ name: 'x', install: () => { throw boom } }], data)
    expect(res).toEqual({ ok: false, error: boom })
    expect(calls).toEqual(['use:x', 'dispose'])
  })

  it('事件回调每次现取，摘掉以后不再调', () => {
    const { s, events } = fakeStrata()
    let props: { onFocus?: (v: string | null) => void } = {}
    const got: string[] = []
    const off = bindEvents(s, () => props)
    events.emit('focus', 'none') // 还没有回调：不报错
    props = { onFocus: (v) => got.push(`1:${v}`) }
    events.emit('focus', 'onto')
    props = { onFocus: (v) => got.push(`2:${v}`) }
    events.emit('focus', 'table')
    off()
    events.emit('focus', 'x')
    expect(got).toEqual(['1:onto', '2:table'])
  })
})

describe('<StrataCanvas>', () => {
  it('创建失败时的 fallback：缺省是按语言的一行说明；也可以给节点或函数', () => {
    const err = new StrataError('webgl-unavailable', 'x')
    expect(html(<>{canvasFallback(err, undefined, 'zh-CN')}</>)).toBe(`<div class="kgs-fallback" role="alert">${message('zh-CN', 'error.webgl-unavailable')}</div>`)
    expect(html(<>{canvasFallback(err, undefined)}</>)).toContain('WebGL is not available')
    expect(html(<>{canvasFallback(err, <p>no 3d</p>)}</>)).toBe('<p>no 3d</p>')
    expect(html(<>{canvasFallback(err, (e) => <p>{(e as StrataError).code}</p>)}</>)).toBe('<p>webgl-unavailable</p>')
  })

  it('服务端渲染：只出宿主元素和 children，不创建引擎（创建在 effect 里）', () => {
    const create = vi.fn()
    function Probe() {
      return <i>{useStrata() === null ? 'no-instance' : 'instance'}</i>
    }
    const out = html(
      <StrataCanvas data={null} className="stage" style={{ height: 300 }} create={create}>
        <Probe />
      </StrataCanvas>,
    )
    // 外层是定位容器：自带缺省规则（特异度 0 的 <style>），画布的宿主铺满它，children 在同一个容器里盖在画布上
    expect(out).toBe(
      `<div class="kgs-canvas stage" style="height:300px"><style>${CANVAS_CSS}</style><div class="kgs-canvas-host" style="position:absolute;inset:0"></div><i>no-instance</i></div>`,
    )
    expect(CANVAS_CSS).toBe(':where(.kgs-canvas){position:relative;width:100%;height:100%;min-height:320px}')
    expect(create).not.toHaveBeenCalled()
  })

  it('服务端渲染不打印警告（React 18 会为 useLayoutEffect 警告：服务端换成了 useEffect）', async () => {
    const { renderToString } = await import('react-dom/server')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = renderToString(
        <StrataCanvas data={null}>
          <LayerList />
          <NodeTip />
        </StrataCanvas>,
      )
      expect(out).toContain('kgs-canvas-host')
      expect(error).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
      warn.mockRestore()
    }
  })

  it('不给 style 时也有定位和尺寸（不靠 styles.css）', () => {
    const out = html(<StrataCanvas data={null}><i /></StrataCanvas>)
    expect(out.startsWith('<div class="kgs-canvas"><style>:where(.kgs-canvas){position:relative;')).toBe(true)
  })

  it('宿主高度为 0 时的提醒走语言表', () => {
    expect(zeroHeightWarning(0, textFor(null, 'en'))).toBe(message('en', 'warn.canvas-zero-height'))
    expect(zeroHeightWarning(0, textFor(null, 'zh-CN'))).toMatch(/高度是 0/)
    expect(zeroHeightWarning(480, textFor(null, 'en'))).toBe(null)
  })
})

describe('语言和文案覆盖', () => {
  it('跟着实例的语言时带上实例的覆盖；面板给了别的语言就不带', () => {
    const s = { locale: 'zh-CN', text: (k: string) => `override:${k}` }
    expect(textFor(s as never)('ui.layers')).toBe('override:ui.layers')
    expect(textFor(s as never, 'zh-CN')('ui.layers')).toBe('override:ui.layers')
    expect(textFor(s as never, 'en')('ui.layers')).toBe('Layers')
    expect(textFor(null)('ui.layers')).toBe('Layers')
  })

  it('locale 状态：语言和覆盖一起读，换了覆盖（语言没变）也通知', () => {
    const events = new Emitter<StrataEvents>()
    const raw = { locale: 'en', messages: {} as Record<string, string>, on: events.on.bind(events) }
    const store = createStateStore(raw as unknown as StrataSource, 'locale')
    const cb = vi.fn()
    store.subscribe(cb)
    expect(store.getSnapshot()).toEqual({ locale: 'en', messages: {} })
    raw.messages = { 'ui.layers': 'Strata' }
    events.emit('locale', 'en')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().messages).toEqual({ 'ui.layers': 'Strata' })
    raw.locale = 'zh-CN'
    events.emit('locale', 'zh-CN')
    expect(store.getSnapshot().locale).toBe('zh-CN')
    expect(createStateStore(null, 'locale').getSnapshot()).toEqual({ locale: 'en', messages: {} })
    expect(createStateStore(null, 'theme').getSnapshot()).toBe(null)
  })
})

describe('主题 → 面板的 CSS 变量', () => {
  it('只出和 DARK 不一样的变量：没改主题时一个都不出', () => {
    expect(themeVars(DARK)).toEqual({})
    expect(themeVars(createTheme())).toEqual({})
    expect(themeVars(null)).toEqual({})
  })

  it('换个背景色：面板的底子跟着变，文字的颜色不动', () => {
    const v = themeVars(createTheme({ background: '#ffffff' }))
    expect(v).toEqual({ '--kgs-bg': '#ffffff', '--kgs-overlay': 'rgba(255, 255, 255, 0.72)' })
    expect(themeVars(createTheme({ accent: '#ff0000', label: { primary: '#000' } }))).toMatchObject({
      '--kgs-accent': '#ff0000',
      '--kgs-accent-rgb': '255, 0, 0',
      '--kgs-text': '#000',
      '--kgs-border': 'rgba(0, 0, 0, 0.07)',
    })
  })

  it('写成特异度 0 的规则：容器上自己写的 class、style 盖得过它；值里不能混进别的规则', () => {
    expect(themeRule('[data-kgs-scope="a"]', { '--kgs-bg': '#fff' })).toBe(':where([data-kgs-scope="a"]){--kgs-bg:#fff}')
    expect(themeRule('.x', {})).toBe('')
    expect(themeRule('.x', { '--kgs-bg': 'red;}body{color:red' })).toBe(':where(.x){--kgs-bg:redbodycolor:red}')
  })
})
