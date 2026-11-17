// 看变化插件：两版之间的差异由 kgdiff 算，画在两版合起来的那张图上，可以逐段回放。
// 它是一个模式：看变化时底子和每帧的样子都换成它的；exit() 交还给核心的全景。
// 整个 kgstrata 只有这个目录引入 @kgdiff/*：只画 3D 图的人不用带上它（和它的 WebAssembly）。
//
//   const diff = strata.use(diffPlugin({ locale: 'zh-CN' }))
//   await diff.show(before, after, { replaces: { 'c:customer': ['c:member'] } })

import { getTheme } from '@kgdiff/scene'
import { placeChildren, unionData } from '../layout.js'
import type { Locale } from '../locale.js'
import { buildModel, type Model } from '../model.js'
import { Emitter, type ModeHandle, type StrataContext, type StrataMode, type StrataPlugin } from '../plugin.js'
import type { RendererBase } from '../renderer/index.js'
import { project } from '../resolve.js'
import type { Looks, StrataData, StrataLayout } from '../types.js'
import { buildStrataDiff, createDiffLooks, type ChangeFamily, type DiffView, type StrataDiff } from './adapter.js'

export { ATTR, HIERARCHY_PREDICATE, buildStrataDiff, createDiffLooks, toKgdiffGraph, type ChangeFamily, type DiffHunk, type DiffView, type StrataDiff } from './adapter.js'

/** 一类变化在面板上用的颜色：base 画点、条，text 写字 */
export interface FamilyColor {
  base: string
  text: string
}

/**
 * 五类变化的颜色，和 3D 里 kgdiff 画的一致（夜景主题）。面板（比如 kgstrata/react/diff 的 DiffPanel）按它上色。
 * 是函数不是常量：不引入就不算，模块没有副作用。
 */
export function familyColors(): Record<ChangeFamily, FamilyColor> {
  const fam = getTheme('dark').family
  const out = {} as Record<ChangeFamily, FamilyColor>
  for (const k of Object.keys(fam) as ChangeFamily[]) out[k] = { base: fam[k].base, text: fam[k].text }
  return out
}

export interface DiffOptions {
  /**
   * kgdiff 写变化说明用的语言，也是没写类型的关系、包含关系显示成什么字。
   * 不写就跟核心的语言（StrataOptions.locale，缺省 'en'）
   */
  locale?: Locale
}

export interface DiffShowOptions {
  /** 新节点 id → 它吸收了哪些旧节点。两版之间有节点合并时告诉它，kgdiff 才认得出是合并而不是一删一增 */
  replaces?: Record<string, string[]>
}

export interface DiffEvents {
  /** 进了看变化（展开、收起以后重新比了一遍也算） */
  enter: StrataDiff
  /** 回到了全景 */
  exit: null
}

export interface DiffApi {
  /**
   * 进入看变化：两版合起来布局一次，位置不动；变化由 kgdiff 算。是异步的：只认最后一次请求，
   * 等的时候退出了、换了数据、引擎销毁了，返回 null。
   */
  show(before: StrataData, after: StrataData, opts?: DiffShowOptions): Promise<StrataDiff | null>
  /** 回到全景（不重新布局）；也作废还没回来的 show */
  exit(): void
  /** 正在看变化 */
  readonly active: boolean
  /** 正在看的这份差异；没在看是 null */
  readonly current: StrataDiff | null
  /** 现在的回放状态（只读：改用 setView、play、selectHunk） */
  readonly view: Readonly<DiffView> | null
  readonly playing: boolean
  setView(patch: Partial<DiffView>): void
  /** 从头（或停下的地方）回放，false 暂停 */
  play(on: boolean): void
  /** 选中一处变化（-1 清掉）：镜头框住它，跟随开着时主角换到它所在的那一层 */
  selectHunk(i: number): void
  /** 镜头框住第 i 处变化 */
  shot(hunk: number): void
  on<K extends keyof DiffEvents>(event: K, cb: (v: DiffEvents[K]) => void): () => void
}

export function diffPlugin(options: DiffOptions = {}): StrataPlugin<DiffApi> {
  return { name: 'diff', install: (ctx) => install(ctx, options) }
}

interface DiffState {
  diff: StrataDiff
  model: Model
  looks: { resolve(view: DiffView, out?: Looks): Looks }
  view: DiffView
  playing: boolean
  speed: number
  out?: Looks
  quiet: DiffQuiet
}

/**
 * kgdiff 的规则：背景安静、变化响亮。没变的节点只留主图层枢纽的名字，没变的边再压暗（跨层的几乎看不见）。
 * 这是看变化自己的样子，在它产出 Looks 的那一步做完，核心不管。
 */
export interface DiffQuiet {
  /** 没变的节点里，哪些不出名字 */
  labels: Uint8Array
  /** 每条边的亮度再乘多少 */
  edges: Float32Array
}

export function quietOf(diff: StrataDiff, layout: StrataLayout): DiffQuiet {
  const labels = new Uint8Array(diff.base.nodes.length)
  diff.base.nodes.forEach((n, i) => {
    const hub = n.layer === layout.primary && (layout.nodes.get(n.id)?.importance ?? 0) >= 0.8
    labels[i] = diff.scene.nodes[i].family === 'neutral' && !hub ? 1 : 0
  })
  const edges = new Float32Array(diff.base.edges.length)
  diff.base.edges.forEach((e, i) => {
    edges[i] = diff.scene.edges[i].family !== 'neutral' ? 1 : e.kind === 'cross' ? 0.16 : 0.5
  })
  return { labels, edges }
}

/** 把安静的规则叠到 kgdiff 出的 Looks 上；指着的那个节点照样出名字 */
export function applyQuiet(looks: Looks, q: DiffQuiet, hovered: number) {
  for (let i = 0; i < q.labels.length; i++) {
    const lb = looks.nodes[i].label
    if (q.labels[i] && lb && i !== hovered) lb.alpha = 0
  }
  for (let i = 0; i < q.edges.length; i++) looks.edges[i].alpha *= q.edges[i]
}

function install(ctx: StrataContext, options: DiffOptions): DiffApi {
  const events = new Emitter<DiffEvents>()
  /** 正在看的两版：展开、收起时要重新比。show 一调就记下（还没比完也算） */
  let input: { before: StrataData; after: StrataData; replaces?: Record<string, string[]> } | null = null
  let state: DiffState | null = null
  let handle: ModeHandle | null = null
  /** show 是异步的：只认最后一次请求 */
  let request = 0

  const drop = () => {
    const was = state !== null
    state = null
    handle = null
    input = null
    if (was) events.emit('exit', null)
  }

  const show = async (before: StrataData, after: StrataData, opts: DiffShowOptions = {}): Promise<StrataDiff | null> => {
    const ticket = ++request
    input = { before, after, replaces: opts.replaces }
    const nb = ctx.normalize(before)
    const na = ctx.normalize(after)
    // 布局用两版都收起时的合集：展开、收起不让图重新洗牌。对比用现在展开的样子
    const flat = unionData(project(nb), project(na))
    const open = ctx.expanded
    const b = project(nb, open)
    const a = project(na, open)
    const union = unionData(b, a)
    const layout = placeChildren(ctx.layoutOf(flat), union)
    const model = buildModel(union, layout, ctx.theme)
    const diff = await buildStrataDiff(b, a, layout, { locale: options.locale ?? ctx.locale, replaces: opts.replaces, theme: ctx.theme })
    // 等 kgdiff 的时候用户可能已经切走、换了数据、或者组件已经卸载
    if (ctx.disposed || ticket !== request) return null
    const base: RendererBase = { ...model.renderer, nodes: diff.base.nodes, edges: diff.base.edges }
    const st: DiffState = {
      diff,
      model,
      quiet: quietOf(diff, layout),
      looks: createDiffLooks(diff),
      view: { layer: 'union', t: 0, selectedHunk: -1, hoveredNode: -1, selectedNode: -1, reducedMotion: ctx.reducedMotion, emphasis: 1 },
      playing: false,
      speed: 1,
    }
    const mode: StrataMode = {
      model,
      base,
      looks: (frame) => {
        if (st.playing) {
          st.view.t = Math.min(st.diff.duration, st.view.t + frame.dt * 1000 * st.speed)
          if (st.view.t >= st.diff.duration) st.playing = false
        }
        st.out = st.looks.resolve(st.view, st.out)
        applyQuiet(st.out, st.quiet, st.view.hoveredNode)
        return st.out
      },
      hover: (i) => (st.view.hoveredNode = i),
      select: (i) => (st.view.selectedNode = i),
      // 被核心收回（换了数据、别的模式接管）：这边的状态都作废
      released: () => {
        if (state === st) drop()
      },
    }
    state = st
    handle = ctx.takeOver(mode)
    events.emit('enter', diff)
    return diff
  }

  const exit = () => {
    // 也作废还没回来的 show
    request++
    const had = input !== null
    const h = handle
    const was = state !== null
    state = null
    handle = null
    input = null
    // 看变化的时候可能展开、收起过：全景按现在的展开状态重新生成
    if (h?.active) h.release({ rebuild: had })
    else if (had) ctx.rebuild()
    if (was) events.emit('exit', null)
  }

  const shot = (i: number) => {
    const d = state
    const h = d?.diff.hunks[i]
    if (!d || !h) return
    // 镜头只框住这处变化本身：上下文（尤其跨层的）会把镜头拉得很远
    const ids = h.nodes.length ? h.nodes : h.context
    ctx.fit(
      ids.map((k) => {
        const n = d.diff.base.nodes[k]
        const p = d.model.layout.nodes.get(n.id)
        return { layer: n.layer, x: p?.x ?? 0, z: p?.z ?? 0 }
      }),
      { elevation: 0.62, margin: 3.2 },
    )
  }

  ctx.onChange((change) => {
    // 换了数据：还没回来的 show 也作废
    if (change === 'data') {
      request++
      drop()
    }
  })
  // 看变化时展开、收起：两版按新的展开状态重新比一遍
  ctx.onExpand(() => {
    if (!input) return false
    void show(input.before, input.after, { replaces: input.replaces })
    return true
  })
  ctx.onDispose(() => events.clear())

  return {
    show,
    exit,
    get active() {
      return !!handle?.active
    },
    get current() {
      return state?.diff ?? null
    },
    get view() {
      return state?.view ?? null
    },
    get playing() {
      return state?.playing ?? false
    },
    setView: (patch) => {
      if (state) Object.assign(state.view, patch)
    },
    play: (on) => {
      const d = state
      if (!d) return
      if (on && d.view.t >= d.diff.duration) d.view.t = 0
      d.view.layer = 'replay'
      d.view.selectedHunk = -1
      d.playing = on
    },
    selectHunk: (i) => {
      const d = state
      if (!d) return
      d.playing = false
      d.view.layer = 'union'
      d.view.selectedHunk = i
      if (i >= 0) {
        // 跟随：这处变化主要落在哪一层，哪一层当主角
        const h = d.diff.hunks[i]
        const first = h ? (h.nodes.length ? h.nodes : h.context)[0] : undefined
        if (first !== undefined) ctx.followTo(d.diff.base.nodes[first].layer, 'none')
        shot(i)
      }
    },
    shot,
    on: (event, cb) => events.on(event, cb),
  }
}
