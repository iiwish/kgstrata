import { describe, expect, it } from 'vitest'
import { adoptMix, carryOver, heroInfoOf, heroOnLoad, NO_HERO, oneHot, shouldFollow, switchHero, yieldHero, type HeroState } from '../src/engine/hero'
import { HiddenLayers, stageFor } from '../src/engine/layers'
import { nodePoints, overviewPoints, rimPoints, topPose, worldPoints, type Goals } from '../src/engine/shots'
import { applyView, type ViewTarget } from '../src/engine/view'
import { insetView } from '../src/renderer/index'
import type { StrataView } from '../src/engine/types'

// 引擎拆出来的纯逻辑：主次的状态机、隐藏层、取景的点、视图恢复的顺序。都不碰渲染器。

const none = new Set<number>()
const ids = ['metric', 'onto', 'table']

describe('主次的状态机', () => {
  it('换了数据：指定的那层（不写是基准层）独当主角；一张图不分主次', () => {
    expect(heroOnLoad(3, -1, 1)).toEqual({ hero: 1, home: 1, mix: [0, 1, 0] })
    expect(heroOnLoad(3, 2, 1)).toEqual({ hero: 2, home: 2, mix: [0, 0, 1] })
    expect(heroOnLoad(1, 0, 0)).toBe(NO_HERO)
    expect(oneHot(2, 1)).toEqual([0, 1])
  })

  it('收分量：夹到 0..1、没写到和隐藏的按 0、最大的当主角；全是 0 等于没给', () => {
    const s = heroOnLoad(3, -1, 1)
    expect(adoptMix(s, ids, { onto: 0.4, table: 2, metric: -1 }, none)).toEqual({ hero: 2, home: 1, mix: [0, 0.4, 1] })
    // 一样大不换主角
    expect(adoptMix(s, ids, { onto: 0.5, table: 0.5 }, none).hero).toBe(1)
    expect(adoptMix(s, ids, { table: 1 }, new Set([2]))).toEqual({ hero: 1, home: 1, mix: [0, 1, 0] })
    expect(adoptMix(s, ids, { nope: 1, table: Number.NaN }, none).mix).toEqual([0, 1, 0])
    // 原型上的名字不当成层
    expect(adoptMix(s, ['constructor', 'onto'], {}, none).mix).toEqual([0, 1])
    expect(adoptMix(NO_HERO, ids, { onto: 1 }, none)).toBe(NO_HERO)
  })

  it('隐藏层让位：分量清零，主角和家都让给最近的可见层', () => {
    const s: HeroState = { hero: 1, home: 1, mix: [0, 1, 0] }
    expect(yieldHero(s, new Set([1]))).toEqual({ hero: 0, home: 0, mix: [1, 0, 0] })
    // 主角没被藏：只把隐藏层的分量清掉
    expect(yieldHero({ hero: 1, home: 2, mix: [0.3, 1, 0.5] }, new Set([2]))).toEqual({ hero: 1, home: 1, mix: [0.3, 1, 0] })
    // 分量全在隐藏层上：回到主角那层独当主角
    expect(yieldHero({ hero: 0, home: 0, mix: [0, 0, 1] }, new Set([2]))).toEqual({ hero: 0, home: 0, mix: [1, 0, 0] })
    expect(yieldHero(NO_HERO, new Set([0]))).toBe(NO_HERO)
  })

  it('换主角：分量或者主角真的变了才算变了', () => {
    const s: HeroState = { hero: 1, home: 1, mix: [0, 1, 0] }
    expect(switchHero(s, 1).changed).toBe(false)
    expect(switchHero(s, 2)).toEqual({ state: { hero: 2, home: 1, mix: [0, 0, 1] }, changed: true })
    expect(switchHero({ ...s, mix: [0, 0.5, 0.5] }, 1).changed).toBe(true)
    expect(switchHero(NO_HERO, 0).changed).toBe(false)
  })

  it('跟随：已经独当主角、被隐藏了都不换；分量混着的要换过去', () => {
    const s: HeroState = { hero: 1, home: 1, mix: [0, 1, 0] }
    expect(shouldFollow(s, 1, none)).toBe(false)
    expect(shouldFollow(s, 2, none)).toBe(true)
    expect(shouldFollow(s, 2, new Set([2]))).toBe(false)
    expect(shouldFollow({ ...s, mix: [0, 0.6, 0.6] }, 1, none)).toBe(true)
    expect(shouldFollow(NO_HERO, 0, none)).toBe(false)
  })

  it('模式接管：分量按层的 id 对过去；一层都对不上回到模式的基准层', () => {
    const s: HeroState = { hero: 2, home: 1, mix: [0, 0.3, 1] }
    expect(carryOver(s, ids, ['table', 'onto'], 0, none)).toEqual({ hero: 0, home: 1, mix: [1, 0.3] })
    expect(carryOver(s, ids, ['x', 'y'], 1, none)).toEqual({ hero: 1, home: 1, mix: [0, 1] })
    // 对过去的主角在模式里被藏了：让位
    expect(carryOver(s, ids, ['onto', 'table'], 0, new Set([1])).hero).toBe(0)
  })

  it('对外的样子用层的 id', () => {
    const info = heroInfoOf({ hero: 2, home: 1, mix: [0, 0.3, 1] }, ids, true)
    expect(info).toEqual({ id: 'table', follow: true, mix: { metric: 0, onto: 0.3, table: 1 } })
    expect(Object.getPrototypeOf(info.mix)).toBe(null)
    expect(heroInfoOf(NO_HERO, ['onto'], false)).toEqual({ id: null, follow: false, mix: {} })
  })
})

describe('隐藏层', () => {
  const layers = ids.map((id) => ({ id }))

  it('开关：没有这层、本来就是、最后一张可见的不能藏', () => {
    const h = new HiddenLayers(['metric'])
    expect(h.set(layers, 'nope', false)).toBe('unknown')
    expect(h.set(layers, 'metric', false)).toBe('same')
    expect(h.set(layers, 'onto', false)).toBe('changed')
    expect(h.set(layers, 'table', false)).toBe('last')
    expect(h.indexes(layers)).toEqual(new Set([0, 1]))
    expect(h.set(layers, 'onto', true)).toBe('changed')
    expect(h.list(layers)).toEqual(['metric'])
    // 数据里已经没有的层不算
    expect(h.list([{ id: 'onto' }])).toEqual([])
  })

  it('全藏了就放出一层', () => {
    const h = new HiddenLayers(ids)
    h.keepOne(layers, 1)
    expect(h.list(layers)).toEqual(['metric', 'table'])
  })

  it('比例只拿可见的层去算；隐藏的层停在上下两层中间，大小跟小的那个', () => {
    const radii = [20, 30, 40]
    const all = stageFor(radii, none, [0, 1, 0], 0.56, 1)
    const hid = stageFor(radii, new Set([1]), [1, 0, 0], 0.56, 1)
    expect(all.scales[1]).toBe(1)
    expect(hid.scales[0]).toBe(1)
    expect(hid.heights[1]).toBeCloseTo((hid.heights[0] + hid.heights[2]) / 2)
    expect(hid.scales[1]).toBe(Math.min(hid.scales[0], hid.scales[2]))
    expect(hid.levels[1]).toBe(0)
  })
})

describe('取景的点', () => {
  // 第 i 层在 y = -10i，缩到 1 - 0.1i
  const g: Goals = { goalY: (l) => -l * 10, goalScale: (l) => 1 - l * 0.1 }

  it('盘边四个点按缩放之后的半径；不知道半径按 20', () => {
    expect(rimPoints(10, 1, g)).toEqual([
      [9, -10, 0],
      [-9, -10, 0],
      [0, -10, 9],
      [0, -10, -9],
    ])
    expect(rimPoints(undefined, 0, g)[0]).toEqual([20, -0, 0])
  })

  it('总览只框可见的层', () => {
    const pts = overviewPoints([10, 10, 10], new Set([1]), g)
    expect(pts).toHaveLength(8)
    expect(new Set(pts.map((p) => p[1]))).toEqual(new Set([-0, -20]))
  })

  it('从正上方看：高出最大的盘 6.2 倍', () => {
    expect(topPose(10, -5)).toEqual({ pos: [0, 57, 0.01], target: [0, -5, 0], fov: 21 })
  })

  it('盘面的点 → 世界坐标：按层的目标缩放和高度，浮在盘面上', () => {
    expect(worldPoints([{ layer: 2, x: 10, z: -5 }], g)).toEqual([[8, -20 + 0.45, -4]])
  })

  it('节点（id）→ 盘面的点：收起的算祖先，找不到的跳过', () => {
    const m = {
      base: { nodes: [{ id: 'a', layer: 0 }, { id: 'b', layer: 1 }] },
      layout: { nodes: new Map([['a', { x: 1, z: 2 }], ['b', { x: 3, z: 4 }]]) },
    } as unknown as Parameters<typeof nodePoints>[0]
    const index = new Map([['a', 0], ['b', 1], ['b.child', 1]])
    expect(nodePoints(m, ['b.child', 'nope', 'a'], (id) => index.get(id) ?? -1)).toEqual([
      { layer: 1, x: 3, z: 4 },
      { layer: 0, x: 1, z: 2 },
    ])
  })
})

describe('视图恢复的顺序', () => {
  function recorder(hasHero = true) {
    const calls: string[] = []
    const t: ViewTarget = {
      layers: () => ['onto', 'table', 'metric'],
      hasHero: () => hasHero,
      setFollow: (on) => calls.push(`follow ${on}`),
      setSpread: (s) => calls.push(`spread ${s}`),
      setExpanded: (x) => calls.push(`expanded ${x}`),
      setLayerVisible: (id, v) => calls.push(`${v ? 'show' : 'hide'} ${id}`),
      setHeroMix: (m) => calls.push(`hero ${Object.keys(m)}`),
      arrange: () => calls.push('arrange'),
      focusLayer: (id) => calls.push(`focus ${id}`),
      highlightGroup: (id) => calls.push(`group ${id}`),
      applySlots: () => calls.push('slots'),
      restoreSelected: (id) => calls.push(`selected ${id}`),
      flyTo: () => calls.push('camera'),
      reframe: () => calls.push('reframe'),
      done: () => calls.push('done'),
    }
    return { calls, t }
  }
  const full: StrataView = {
    heroMix: { table: 1 },
    follow: true,
    hidden: ['onto', 'metric'],
    expanded: ['x'],
    selected: 'n',
    group: 'g',
    focus: 'onto',
    spread: 2,
    camera: { position: [0, 0, 1], target: [0, 0, 0] },
  }

  it('全给：先显示再隐藏，插件的段在选中之前，镜头最后', () => {
    const { calls, t } = recorder()
    applyView(full, t)
    expect(calls).toEqual(['follow true', 'spread 2', 'expanded x', 'show table', 'hide onto', 'hide metric', 'hero table', 'group g', 'slots', 'selected n', 'camera', 'done'])
  })

  it('只给一部分：没给主次也重排，没给镜头就重新取景；聚焦只在一张图时', () => {
    const one = recorder(false)
    applyView({ focus: 'onto', selected: null }, one.t)
    expect(one.calls).toEqual(['arrange', 'focus onto', 'slots', 'selected null', 'reframe', 'done'])
    const many = recorder(true)
    applyView({ focus: 'onto' }, many.t)
    expect(many.calls).toEqual(['arrange', 'slots', 'reframe', 'done'])
  })
})

describe('四边的 inset', () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 }
  it('没挡着：不偏移', () => {
    expect(insetView(800, 600, none)).toEqual({ offset: null, fitAspect: 800 / 600, fitHeight: 1 })
  })
  it('右边挡着：虚拟画布往左多出来，轴线落在左边那块的正中', () => {
    const v = insetView(800, 600, { ...none, right: 200 })
    expect(v.offset).toEqual({ fullW: 1000, fullH: 600, x: 200, y: 0 })
    // 轴线在可见画面里的横坐标：虚拟画布的中点减去偏移
    expect(v.offset!.fullW / 2 - v.offset!.x).toBe((800 - 200) / 2)
    expect(v.fitAspect).toBe(600 / 600)
    expect(v.fitHeight).toBe(1)
  })
  it('左边、上边挡着：轴线往右下挪；竖直视角按剩下的高度收窄', () => {
    const v = insetView(800, 600, { top: 100, right: 0, bottom: 0, left: 200 })
    expect(v.offset).toEqual({ fullW: 1000, fullH: 700, x: 0, y: 0 })
    expect(v.offset!.fullW / 2 - v.offset!.x).toBe(200 + (800 - 200) / 2)
    expect(v.offset!.fullH / 2 - v.offset!.y).toBe(100 + (600 - 100) / 2)
    expect(v.fitAspect).toBe(600 / 500)
    expect(v.fitHeight).toBe(500 / 700)
  })
  it('两边一样宽：不偏移，只算取景的比例', () => {
    const v = insetView(800, 600, { top: 0, right: 100, bottom: 0, left: 100 })
    expect(v.offset).toEqual({ fullW: 800, fullH: 600, x: 0, y: 0 })
    expect(v.fitAspect).toBe(600 / 600)
  })
  it('一个方向挡掉六成以上就不管那个方向', () => {
    expect(insetView(800, 600, { ...none, right: 500 }).offset).toBeNull()
    expect(insetView(800, 600, { ...none, right: 500, bottom: 100 }).offset).toEqual({ fullW: 800, fullH: 700, x: 0, y: 100 })
  })
})
