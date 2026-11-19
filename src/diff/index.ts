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
import type { Theme } from '../theme.js'
import type { Looks, StrataData, StrataLayout } from '../types.js'
import { buildStrataDiff, createDiffLooks, hunkIndex, type ChangeFamily, type DiffFrameState, type DiffView, type StrataDiff } from './adapter.js'

export {
  ATTR,
  HIERARCHY_PREDICATE,
  buildStrataDiff,
  createDiffLooks,
  hunkIndex,
  toKgdiffGraph,
  type ChangeFamily,
  type DiffFrameState,
  type DiffHunk,
  type DiffView,
  type HunkIndex,
  type StrataDiff,
} from './adapter.js'

// 装了看变化插件，视图状态里多一项 diff
declare module '../engine/types.js' {
  interface StrataView {
    /**
     * While comparing: union / before / after / replay, the replay position and the selected change;
     * `null` when not comparing. Only with the diff plugin installed. `setView` applies it only while
     * comparing (the two versions are not part of the view: call `diff.show` first); `null` is ignored.
     */
    diff?: DiffView | null
  }
}

/** Colours of one change family for panels: `base` for dots and bars, `text` for text. */
export interface FamilyColor {
  base: string
  text: string
}

/**
 * The five change families' colours, as kgdiff draws them in 3D. Pass a theme (`strata.theme`, which
 * carries `diffScheme`) or `'dark'` / `'light'`; default `'dark'`. Panels such as `DiffPanel` use it.
 */
export function familyColors(scheme: Pick<Theme, 'diffScheme'> | Theme['diffScheme'] = 'dark'): Record<ChangeFamily, FamilyColor> {
  const fam = getTheme(typeof scheme === 'string' ? scheme : scheme.diffScheme).family
  const out = {} as Record<ChangeFamily, FamilyColor>
  for (const k of Object.keys(fam) as ChangeFamily[]) out[k] = { base: fam[k].base, text: fam[k].text }
  return out
}

/** Where kgdiff's WebAssembly modules come from, per module: a URL or path to fetch. */
export interface DiffWasmSources {
  /** `@kgdiff/compute/compute.wasm`: diff and matching. */
  compute?: string | URL
  /** `@kgdiff/compute/layout.wasm`: layout. */
  layout?: string | URL
  /** `@kgdiff/compute/formats.wasm`: parsers. */
  formats?: string | URL
}

/** Options of `diffPlugin()`. */
export interface DiffOptions {
  /**
   * Language of kgdiff's change descriptions, and the display names of untyped and containment relations.
   * Default: the core's language (`StrataOptions.locale`; after `setLocale` an open comparison is computed again).
   * kgdiff only knows `'en'` and `'zh-CN'`: other languages fall back along their chain (usually to `'en'`)
   * for the descriptions; relation names still use the language itself.
   */
  locale?: Locale
  /**
   * Where kgdiff's WebAssembly modules are loaded from, for bundlers that do not handle
   * `new URL('…', import.meta.url)` (esbuild, Rollup without a plugin). Passed to `init({ sources })` of
   * `@kgdiff/compute` before the first comparison. Without it kgdiff finds the files next to its own code.
   */
  wasm?: DiffWasmSources
}

/** Options of `diff.show()`. */
export interface DiffShowOptions {
  /** New node id → the old nodes it absorbs. Tell kgdiff about merges, or it reports a removal and an addition. */
  replaces?: Record<string, string[]>
}

/** Options of `diff.shot()`. */
export interface DiffShotOptions {
  /** Seconds; `0` jumps. Default `1.2`. */
  duration?: number
}

/** The diff plugin's events. */
export interface DiffEvents {
  /** A comparison is on screen (also after it was computed again: expand, collapse, language, theme). */
  enter: StrataDiff
  /** Back to the normal view. */
  exit: null
}

/** What `strata.use(diffPlugin())` returns. */
export interface DiffApi {
  /**
   * Shows the comparison of two versions: laid out once on their union, positions do not move; kgdiff
   * computes the changes. Asynchronous: only the last call counts; resolves `null` if it was superseded,
   * `exit` was called, the data changed or the instance was disposed meanwhile.
   */
  show(before: StrataData, after: StrataData, opts?: DiffShowOptions): Promise<StrataDiff | null>
  /** Returns to the normal view (no re-layout); also cancels a pending `show`. The camera returns to the overview unless the user moved it while comparing. */
  exit(): void
  /** Whether a comparison is on screen. */
  readonly active: boolean
  /** The comparison on screen, or `null`. */
  readonly current: StrataDiff | null
  /** The current view (a copy: change it with `update`, `play`, `selectHunk`), or `null` when not comparing. */
  readonly view: Readonly<DiffView> | null
  /** Whether the replay is running. */
  readonly playing: boolean
  /** Changes the view: `{ layer: 'after' }`, `{ layer: 'replay', t: 1200 }`… Unknown change ids clear the selection. Does not stop the replay (`play(false)` does); no-op when not comparing. */
  update(patch: Partial<DiffView>): void
  /** Replays from the start (or where it paused); `false` pauses. */
  play(on: boolean): void
  /** Selects a change (`DiffHunk.id`; `null` clears): frames it, and with `follow` on its layer becomes the hero. */
  selectHunk(id: string | null): void
  /** Frames this change (`DiffHunk.id`). `opts.duration` in seconds (default 1.2; `0` jumps). */
  shot(hunk: string, opts?: DiffShotOptions): void
  /** Subscribes to a diff event. Returns the unsubscribe function. */
  on<K extends keyof DiffEvents>(event: K, cb: (v: DiffEvents[K]) => void): () => void
}

/** The version comparison plugin: `const diff = strata.use(diffPlugin())`. Registers `diff` in the view state. */
export function diffPlugin(options: DiffOptions = {}): StrataPlugin<DiffApi> {
  return { name: 'diff', install: (ctx) => install(ctx, options) }
}

interface DiffState {
  diff: StrataDiff
  model: Model
  looks: { resolve(view: DiffFrameState, out?: Looks): Looks }
  view: DiffFrameState
  /** 变化的 id → 下标 */
  byId: Map<string, number>
  playing: boolean
  speed: number
  out?: Looks
  quiet: DiffQuiet
}

/**
 * Low level: kgdiff's rule "quiet background, loud changes". Unchanged nodes keep a label only when they
 * are hubs of the anchor layer; unchanged edges are dimmed further (cross-layer ones almost hidden).
 */
export interface DiffQuiet {
  /** Per node: 1 = unchanged and unlabelled. */
  labels: Uint8Array
  /** Per edge: brightness factor. */
  edges: Float32Array
}

/** Low level: computes `DiffQuiet` for a comparison. */
export function quietOf(diff: StrataDiff, layout: StrataLayout): DiffQuiet {
  const labels = new Uint8Array(diff.base.nodes.length)
  diff.base.nodes.forEach((n, i) => {
    const hub = n.layer === layout.anchor && (layout.nodes.get(n.id)?.importance ?? 0) >= 0.8
    labels[i] = diff.scene.nodes[i].family === 'neutral' && !hub ? 1 : 0
  })
  const edges = new Float32Array(diff.base.edges.length)
  diff.base.edges.forEach((e, i) => {
    edges[i] = diff.scene.edges[i].family !== 'neutral' ? 1 : e.kind === 'cross' ? 0.16 : 0.5
  })
  return { labels, edges }
}

/** Low level: applies `DiffQuiet` to kgdiff's looks; the hovered node keeps its label. */
export function applyQuiet(looks: Looks, q: DiffQuiet, hovered: number) {
  for (let i = 0; i < q.labels.length; i++) {
    const lb = looks.nodes[i].label
    if (q.labels[i] && lb && i !== hovered) lb.alpha = 0
  }
  for (let i = 0; i < q.edges.length; i++) looks.edges[i].alpha *= q.edges[i]
}

// 给了 wasm 的位置：第一次比之前交给 @kgdiff/compute 的 init({ sources })。只在给了的时候才引入它，
// 不给时和以前一样由 kgdiff 自己按 new URL(…, import.meta.url) 找。init 是幂等的，同一页上几个实例共用一份
let wasmReady: Promise<void> | null = null
function loadWasm(wasm: DiffWasmSources): Promise<void> {
  wasmReady ??= import('@kgdiff/compute')
    .then(({ init }) => {
      // 只加载给了位置的模块：没给的那几个还是 kgdiff 用到时按缺省的位置自己加载
      const sources: Partial<Record<'compute' | 'layout' | 'formats', string | URL>> = {}
      for (const k of ['compute', 'layout', 'formats'] as const) if (wasm[k] !== undefined) sources[k] = wasm[k]
      const modules = Object.keys(sources) as ('compute' | 'layout' | 'formats')[]
      return modules.length ? init({ modules, sources }) : undefined
    })
    .catch((error: unknown) => {
      // 失败了下次再试（比如地址写错、网络断了）
      wasmReady = null
      throw error
    })
  return wasmReady
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
    if (options.wasm) await loadWasm(options.wasm)
    const diff = await buildStrataDiff(b, a, layout, { locale: options.locale ?? ctx.locale, replaces: opts.replaces, theme: ctx.theme })
    // 等 kgdiff 的时候用户可能已经切走、换了数据、或者组件已经卸载
    if (ctx.disposed || ticket !== request) return null
    const base: RendererBase = { ...model.renderer, nodes: diff.base.nodes, edges: diff.base.edges }
    const { byId } = hunkIndex(diff)
    // 重新比了一遍（展开、换语言、换主题）：看的版本、回放到哪儿、选中的那处变化接着用（变化的 id 还认得的话）
    const prev = state?.view
    const st: DiffState = {
      diff,
      model,
      byId,
      quiet: quietOf(diff, layout),
      looks: createDiffLooks(diff),
      view: {
        layer: prev?.layer ?? 'union',
        t: Math.min(prev?.t ?? 0, diff.duration),
        selectedHunk: prev?.selectedHunk != null && byId.has(prev.selectedHunk) ? prev.selectedHunk : null,
        hoveredNode: -1,
        selectedNode: -1,
        reducedMotion: ctx.reducedMotion,
        emphasis: 1,
      },
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

  const shot = (id: string, opts: DiffShotOptions = {}) => {
    const d = state
    const k = d?.byId.get(id)
    if (!d || k === undefined) return
    // 镜头只框住这处变化本身：上下文（尤其跨层的）会把镜头拉得很远
    const hunk = d.diff.hunks[k]
    ctx.fit(hunk.nodes.length ? hunk.nodes : hunk.context, { elevation: 0.62, margin: 3.2, duration: opts.duration })
  }

  /** 正在看（或者正在等）的两版按现在的展开状态、语言、主题重新比一遍 */
  const again = () => {
    if (!input) return false
    void show(input.before, input.after, { replaces: input.replaces })
    return true
  }

  ctx.onChange((change) => {
    // 换了数据：还没回来的 show 也作废
    if (change === 'data') {
      request++
      drop()
    }
    // 换了主题：两版的模型、kgdiff 的配色都按新主题重来
    if (change === 'theme') again()
  })
  // 换了语言：没指定语言时，kgdiff 的变化说明按新语言重写
  ctx.on('locale', () => {
    if (options.locale === undefined) again()
  })
  // 看变化时展开、收起：两版按新的展开状态重新比一遍
  ctx.onExpand(again)
  ctx.onDispose(() => events.clear())

  /** 改视图：只收使用者该碰的三项，变化的 id 认不得就当没选 */
  const update = (patch: Partial<DiffView>) => {
    const d = state
    if (!d) return
    if (patch.layer !== undefined) d.view.layer = patch.layer
    if (patch.t !== undefined && Number.isFinite(patch.t)) d.view.t = Math.min(Math.max(0, patch.t), d.diff.duration)
    if (patch.selectedHunk !== undefined) d.view.selectedHunk = patch.selectedHunk !== null && d.byId.has(patch.selectedHunk) ? patch.selectedHunk : null
  }

  const selectHunk = (id: string | null) => {
    const d = state
    if (!d) return
    d.playing = false
    d.view.layer = 'union'
    const k = id !== null ? d.byId.get(id) : undefined
    d.view.selectedHunk = k !== undefined ? id : null
    if (k === undefined) return
    // 跟随：这处变化主要落在哪一层，哪一层当主角
    ctx.followTo(d.diff.hunks[k].layer, 'none')
    shot(id!)
  }

  // 视图状态：正在看变化时带上看的版本、回放位置和选中的那处变化（两版数据不在视图里：没在看时是 null，恢复时也不会开始看）
  ctx.registerView<DiffView | null>('diff', {
    get: () => (state && handle?.active ? { layer: state.view.layer, t: state.view.t, selectedHunk: state.view.selectedHunk } : null),
    set: (v) => {
      if (!v || !state || !handle?.active) return
      state.playing = false
      update(v)
      if (v.selectedHunk) selectHunk(v.selectedHunk)
    },
  })

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
      return state ? { layer: state.view.layer, t: state.view.t, selectedHunk: state.view.selectedHunk } : null
    },
    get playing() {
      return state?.playing ?? false
    },
    update,
    play: (on) => {
      const d = state
      if (!d) return
      if (on && d.view.t >= d.diff.duration) d.view.t = 0
      d.view.layer = 'replay'
      d.view.selectedHunk = null
      d.playing = on
    },
    selectHunk,
    shot,
    on: (event, cb) => events.on(event, cb),
  }
}
