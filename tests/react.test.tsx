import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { HeroInfo, HoverInfo, LayerInfo, Strata } from '../src/engine'
import { StrataError, message } from '../src/locale'
import { Emitter, type StrataEvents, type StrataPlugin } from '../src/plugin'
import { StrataCanvas, canvasFallback } from '../src/react/canvas'
import { useStrata } from '../src/react/context'
import { DiffPanel, changesByLayer } from '../src/react/diff'
import { FollowToggle, HeroMixSlider, LayerList, NodeTip, SpreadSlider, ViewButtons } from '../src/react/panels'
import { PathList, nodeInfoFrom } from '../src/react/path'
import {
  EMPTY_STATE,
  bindEvents,
  countBy,
  createStateStore,
  heroPair,
  layerClickTarget,
  layerMarkOpacity,
  layerPressed,
  mountStrata,
  sameValue,
  stepStatus,
  type StrataSource,
} from '../src/react/store'
import type { StrataDiff } from '../src/diff'
import type { StrataData } from '../src/types'

// kgstrata/react 里不需要 WebGL 的部分：面板的结构、中英文、aria；hook 背后的纯函数；创建失败时的 fallback。
// <StrataCanvas> 真正创建引擎、换数据、销毁要 WebGL 和 DOM，这里没测（在效果页里手动过）。

const LAYERS: LayerInfo[] = [
  { id: 'onto', name: '本体', visible: true },
  { id: 'table', name: '物理表', visible: false },
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
    expect(heroPair(DUAL, [...LAYERS, { id: 'm', name: 'm', visible: true }])).toBe(null)
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

  it('悬停提示：名字、层 · 组、能展开的写字段数', () => {
    const info: HoverInfo = { id: 't', label: 'orders', layer: '物理表', group: '订单', folds: 12, expanded: false, x: 100, y: 50 }
    expect(html(<NodeTip info={null} />)).toBe('')
    const zh = html(<NodeTip info={info} locale="zh-CN" />)
    expect(zh).toContain('role="tooltip"')
    expect(zh).toContain('left:116px;top:64px')
    expect(zh).toContain('<b>orders</b><span>物理表 · 订单</span><span>12 个字段 · 双击展开</span>')
    expect(html(<NodeTip info={{ ...info, expanded: true }} locale="zh-CN" />)).toContain('<span>双击收起</span>')
    expect(html(<NodeTip info={info} locale="en" />)).toContain('12 fields · double-click to expand')
    // 没有可展开的：不出第三行
    expect(html(<NodeTip info={{ ...info, folds: 0, group: null }} locale="zh-CN" />)).toContain('<span>物理表</span></div>')
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
    const out = html(<PathList paths={paths} path={null} active="p1" live={{ ids: ['a', 'c'], reached: 1 }} nodeInfo={nodeInfoFrom(data)} locale="zh-CN" />)
    expect(out).toContain('aria-label="问题"')
    expect(out).toContain('class="kgs-path kgs-on"')
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('<li class="kgs-step kgs-lit"><b>①</b><span>顾客</span><em>本体</em></li>')
    expect(out).toContain('<li class="kgs-step kgs-skipped" title="这一步在隐藏的层里，跳过了"><b>②</b><span>订单</span>')
    expect(out).toContain('<li class="kgs-step"><b>③</b><span>orders</span><em>物理表</em></li>')
    // 没展开的问题不列步骤
    expect(out.match(/kgs-steps/g)?.length).toBe(1)
    expect(html(<PathList paths={paths} path={null} active="p1" live={{ ids: ['a'], reached: 0 }} nodeInfo={nodeInfoFrom(data)} locale="en" />)).toContain(
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
  const hunk = (index: number, family: string, nodes: number[], start: number, end: number) => ({
    index,
    id: `h${index}`,
    kind: 'k',
    family,
    title: `变化 ${index}`,
    subtitle: index === 0 ? '说明' : '',
    nodes,
    context: [],
    center: [0, 0],
    layer: 0,
    radius: 1,
    start,
    end,
  })
  const diff = {
    base: { nodes: [{ layer: 0 }, { layer: 1 }, { layer: 1 }], edges: [] },
    hunks: [hunk(0, 'added', [0], 0, 100), hunk(1, 'added', [1], 100, 200), hunk(2, 'removed', [2], 200, 300)],
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

  it('每层有几处变化：算在第一个节点所在的层', () => {
    expect(changesByLayer(diff, [{ id: 'onto' }, { id: 'table' }])).toEqual({ onto: 1, table: 2 })
    expect(changesByLayer(null, [])).toEqual({})
  })
})

describe('状态仓库', () => {
  /** 假的引擎：只有仓库用到的几样 */
  function fake() {
    const events = new Emitter<StrataEvents>()
    const s = {
      layers: LAYERS,
      heroInfo: DUAL,
      expanded: [] as string[],
      getView: () => ({ focus: null }),
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
    expect(out).toBe('<div class="kgs-canvas stage" style="height:300px"></div><i>no-instance</i>')
    expect(create).not.toHaveBeenCalled()
  })
})
