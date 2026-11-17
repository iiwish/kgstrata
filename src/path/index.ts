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
declare module '../engine.js' {
  interface StrataView {
    /** 正在走的路径（节点的 id，按顺序）。恢复时从头走。装了路径插件才有这一项 */
    path?: string[] | null
  }
}

/** 现在这条路径实际走的节点（隐藏层里的被跳过了），以及已经点亮了几个 */
export interface PathProgress {
  ids: string[]
  reached: number
}

export interface PathEvents {
  /** 实际走的节点变了，或者又点亮了一个 */
  step: PathProgress
}

export interface PathApi {
  /** 走一条路径（节点的 id，按顺序）。收在父节点里的那一步算在父节点头上，隐藏层里的跳过 */
  play(ids: string[]): void
  clear(): void
  /** play 给的那串 id；没有是 null */
  readonly ids: string[] | null
  /** 点亮到第几个节点了 */
  readonly reached: number
  /** 实际走的节点和点亮了几个 */
  readonly live: PathProgress
  /** 镜头框住整条路径 */
  shot(): void
  on<K extends keyof PathEvents>(event: K, cb: (v: PathEvents[K]) => void): () => void
}

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
  const live = (): PathProgress => {
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

  const shot = () => {
    const m = ctx.model
    if (!run || !m || ctx.mode) return
    ctx.fit(
      run.nodes.map((i) => {
        const n = m.base.nodes[i]
        const p = m.layout.nodes.get(n.id)!
        return { layer: n.layer, x: p.x, z: p.z }
      }),
      { elevation: 0.46, margin: 1.5 },
    )
  }

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
    if (nodes.length) ctx.followTo(m.base.nodes[nodes[0]].layer, 'none')
    shot()
  }

  const clear = () => {
    ids = null
    run = null
  }

  ctx.onChange((change) => {
    if (change === 'data' || change === 'mode') clear()
    else rebuild()
  })
  // 点在空白处：这一趟停下
  ctx.on('select', (info) => {
    if (info === null) run = null
  })
  ctx.onFrame(() => {
    // 跟随：路径走到另一层，主角跟过去，镜头按新的大小重新框住整条路径
    const m = ctx.model
    if (run && m && !ctx.mode) {
      const k = reached()
      if (k > 0) ctx.followTo(m.base.nodes[run.nodes[k - 1]].layer, shot)
    }
    const now = live()
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
    set: (v) => (v ? play(v) : clear()),
  })
  ctx.onDispose(() => events.clear())

  return {
    play,
    clear,
    get ids() {
      return ids ? [...ids] : null
    },
    get reached() {
      return reached()
    },
    get live() {
      return live()
    },
    shot,
    on: (event, cb) => events.on(event, cb),
  }
}
