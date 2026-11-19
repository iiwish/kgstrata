// 路径回放插件：一个问题先在本体上走，再落到表上顺着外键走，按顺序点亮、标序号。
// 它是叠加在全景上的：交给样式一串要强调的节点（其余的压暗），再往 Looks 里叠序号、路径段和笔尖的涟漪。
//
//   const path = strata.use(pathPlugin())
//   path.play(['c:order', 'tbl:orders'])

import { Emitter, type StrataContext, type StrataPlugin } from '../plugin.js'
import { nodeColor, type Model } from '../model.js'
import { STEP, paintPath, rankOf, reachedAt, stepsOf, type PathPaintModel, type PathRun } from './steps.js'

export { DIGITS, STEP, paintPath, rankOf, reachedAt, segmentProgress, stepsOf, type PathPaintModel, type PathRun } from './steps.js'

// 装了路径插件，视图状态里多一项 path
declare module '../engine/types.js' {
  interface StrataView {
    /** The path being replayed (node ids, in order); replay restarts from the beginning when restored. Only with the path plugin installed. */
    path?: string[] | null
  }
}

/** The nodes the path actually visits (steps in hidden layers are skipped), and how many are lit so far. */
export interface PathProgress {
  ids: string[]
  reached: number
}

export interface PathEvents {
  /** The visited nodes changed, or one more was lit. */
  step: PathProgress
}

export interface PathApi {
  /** Replays a path (node ids, in order). A folded step counts as its drawn ancestor; steps in hidden layers are skipped. */
  play(ids: string[]): void
  /** Stops and removes the path. If the path framed the camera and the user has not moved it since, the camera returns to the overview. */
  clear(): void
  /** The ids given to `play`; `null` when there is no path. */
  readonly ids: string[] | null
  /** The visited nodes and how many are lit (what the `step` event carries). */
  readonly progress: PathProgress
  /** Frames the whole path. `opts.duration` in seconds (default 1.2; `0` jumps). */
  shot(opts?: PathShotOptions): void
  /** Subscribes to a path event. Returns the unsubscribe function. */
  on<K extends keyof PathEvents>(event: K, cb: (v: PathEvents[K]) => void): () => void
}

/** Options of `path.shot()`. */
export interface PathShotOptions {
  /** Seconds; `0` jumps. Default `1.2`. */
  duration?: number
}

/** The path replay plugin: `const path = strata.use(pathPlugin())`. Registers `path` in the view state. */
export function pathPlugin(): StrataPlugin<PathApi> {
  return { name: 'path', install }
}

function install(ctx: StrataContext): PathApi {
  const events = new Emitter<PathEvents>()
  /** play 给的原样；隐藏、显示层、展开以后按它重新跳步 */
  let ids: string[] | null = null
  /** 正在走的这一趟。点在空白处只停下这一趟，ids 还留着（视图状态里还在） */
  let run: PathRun | null = null
  let rank = new Int32Array(0)
  // 画路径段要的每个节点的本色、名字：模型换了才重算
  let painted: { model: Model; paint: PathPaintModel } | null = null
  const paintModel = (m: Model) => {
    if (painted?.model !== m) {
      painted = {
        model: m,
        paint: { labels: m.specs.map((s) => s.label), ids: m.base.nodes.map((n) => n.id), layout: m.layout, colors: m.base.nodes.map((_, i) => nodeColor(m, i)), accent: m.theme.accent },
      }
    }
    return painted.paint
  }
  let lastIds: string[] = []
  let lastReached = 0

  const reached = () => (run ? Math.max(0, reachedAt(ctx.time - run.start, run.nodes.length)) : 0)
  const progress = (): PathProgress => {
    const m = ctx.model
    if (!run || !m) return { ids: [], reached: 0 }
    return { ids: run.nodes.map((i) => m.base.nodes[i].id), reached: reached() }
  }

  /** 按现在隐藏的层、展开的节点重新跳步 */
  const rebuild = () => {
    const m = ctx.model
    if (!m || !run || !ids) return
    const { nodes, dashed } = stepsOf(
      ids.map((id) => ctx.indexOf(id)),
      (i) => m.base.nodes[i].layer,
      ctx.hidden,
    )
    run.nodes = nodes
    run.dashed = dashed
  }

  const shot = (opts: PathShotOptions = {}) => {
    const m = ctx.model
    if (!run || !m || ctx.mode) return
    ctx.fit(
      run.nodes.map((i) => m.base.nodes[i].id),
      { elevation: 0.46, margin: 1.5, duration: opts.duration },
    )
  }

  /** 第 i 个节点所在的层（id） */
  const layerOf = (m: Model, i: number) => m.data.layers[m.base.nodes[i].layer].id

  const play = (next: string[]) => {
    const m = ctx.model
    if (!m) return
    ids = next
    const nodes = next.map((id) => ctx.indexOf(id)).filter((i) => i >= 0)
    // 路径跨层：先把聚焦的层放开
    ctx.releaseFocus()
    run = { nodes, dashed: [], start: ctx.time + 0.35 }
    rebuild()
    ctx.select(null)
    if (ctx.reducedMotion) run.start = ctx.time - STEP * nodes.length
    // 跟随：路径从哪一层起步，哪一层先当主角；走到另一层时在每帧里换
    if (nodes.length) ctx.followTo(layerOf(m, nodes[0]), 'none')
    shot()
  }

  // 忘掉路径；镜头归谁由调用的地方定
  const forget = () => {
    ids = null
    run = null
  }
  // 对外的 clear：路径框过的镜头交还给总览（用户动过镜头就不动）
  const clear = () => {
    const had = ids !== null
    forget()
    if (had && !ctx.mode) ctx.releaseCamera()
  }

  ctx.onChange((change) => {
    if (change === 'data' || change === 'mode') forget()
    else rebuild()
  })
  // 点在空白处：这一趟停下。再点一次选中的节点（放开选中）不算，程序清掉选中也不算：play 自己就会清
  ctx.on('select', (e) => {
    if (e.source === 'pointer' && e.pointer?.hit === null) run = null
  })
  ctx.onFrame(() => {
    // 跟随：路径走到另一层，主角跟过去，镜头按新的大小重新框住整条路径
    const m = ctx.model
    if (run && m && !ctx.mode) {
      const k = reached()
      if (k > 0) ctx.followTo(layerOf(m, run.nodes[k - 1]), () => shot())
    }
    const now = progress()
    if (now.reached !== lastReached || now.ids.length !== lastIds.length || now.ids.some((id, k) => id !== lastIds[k])) {
      lastIds = now.ids
      lastReached = now.reached
      events.emit('step', now)
    }
  })
  ctx.overlay({
    spotlight: () => {
      const m = ctx.model
      if (!run || !m) return null
      if (rank.length !== m.base.nodes.length) rank = new Int32Array(m.base.nodes.length)
      return { rank: rankOf(run.nodes, reachedAt(ctx.time - run.start, run.nodes.length), rank) }
    },
    paint: (looks, frame) => {
      const m = ctx.model
      if (!m) return
      paintPath(looks, paintModel(m), run, frame.time)
    },
  })
  ctx.registerView<string[] | null>('path', {
    get: () => (ids ? [...ids] : null),
    // 恢复视图时镜头由视图状态自己定
    set: (v) => (v ? play(v) : forget()),
  })
  ctx.onDispose(() => events.clear())

  return {
    play,
    clear,
    get ids() {
      return ids ? [...ids] : null
    },
    get progress() {
      return progress()
    },
    shot,
    on: (event, cb) => events.on(event, cb),
  }
}
