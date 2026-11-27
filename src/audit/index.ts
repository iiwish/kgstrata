// 映射审计插件 kgstrata/audit：把 auditMappings 算出的缺口画在图上。
// 它是一个模式：审计时底子换成全部收起的那张图（审计就是按收起来算的），每帧的样子由它出；exit() 交还给全景。
//
// 画法守两条规矩：底子是中性的，颜色只给节点；光只给回答。
// - 平时：没有缺口的节点退成灰、名字收起；关系、外键、映射线都是淡的中性色。
// - 缺口：没映射的节点保留本色、出名字、套一圈缺口色的环；走不通的本体关系画成缺口色的虚线，
//   完全没用到的外键画成缺口色的实线，只被路径用到的外键用弱一档的颜色。走不通的关系两端也保留本色、出名字。
// - 选中一项（清单里点一条，或者在图上点一个节点）：它和它牵涉的节点、关系、外键路径、映射线亮起来（会泛光），
//   镜头把上下两层里牵涉的部分一起框住；其余的再退一步。
//
//   const audit = strata.use(auditPlugin())
//   audit.show()                                   // 审计 strata 现在的数据
//   audit.select({ kind: 'relation', id: 'c:customer|claims|c:coupon' })

import { mixHex } from '../color.js'
import { buildModel, nodeColor, type Model } from '../model.js'
import { Emitter, type ModeHandle, type StrataContext, type StrataMode, type StrataPlugin } from '../plugin.js'
import { project } from '../resolve.js'
import { Styler, type StyleState } from '../styler.js'
import type { Theme } from '../theme.js'
import type { EdgeLook, Looks, StrataLayout } from '../types.js'
import { auditMappings, type AuditOptions, type JoinAudit, type MappingAudit, type RelationAudit } from './compute.js'

export { auditMappings, type AuditOptions, type JoinAudit, type JoinPath, type MappingAudit, type RelationAudit } from './compute.js'

// 装了审计插件，视图状态里多一项 audit
declare module '../engine/types.js' {
  interface StrataView {
    /** While auditing: the selected item; `null` when not auditing. Only with the audit plugin installed. `setView` applies it only while auditing (call `audit.show` first). */
    audit?: { selected: AuditTarget | null } | null
  }
}

/** Something the audit reports: an upper relation, a lower join, or a node (`id` as in `MappingAudit`). */
export interface AuditTarget {
  kind: 'relation' | 'join' | 'node'
  id: string
}

/** Options of `audit.show()`: those of `auditMappings` (the language follows the instance). */
export type AuditShowOptions = Omit<AuditOptions, 'locale'>

/** Options of `audit.shot()`. */
export interface AuditShotOptions {
  /** Seconds; `0` jumps. Default `1.2`. */
  duration?: number
}

/** The audit plugin's events. */
export interface AuditEvents {
  /** An audit is on screen (also after it was computed again for a new theme). */
  enter: MappingAudit
  /** Back to the normal view. */
  exit: null
  /** The selected item changed (the list, a click on the map, or `select`). */
  select: AuditTarget | null
}

/** What `strata.use(auditPlugin())` returns. */
export interface AuditApi {
  /**
   * Audits the data on screen (`strata.data`) and shows the gaps: takes over the frame with everything
   * collapsed (positions do not move). Returns the audit, or `null` without data. Throws
   * `StrataError('audit-layers')` for unknown layers, like `auditMappings`.
   */
  show(opts?: AuditShowOptions): MappingAudit | null
  /** Returns to the normal view. The camera returns to the overview unless the user moved it while auditing. */
  exit(): void
  /** Whether an audit is on screen. */
  readonly active: boolean
  /** The audit on screen, or `null`. */
  readonly current: MappingAudit | null
  /** The selected item, or `null`. */
  readonly selected: AuditTarget | null
  /** Selects an item (`null` clears) and frames it with what it involves on both layers. Unknown items clear the selection. No-op when not auditing. */
  select(target: AuditTarget | null): void
  /** Frames an item without selecting it. `opts.duration` in seconds (default 1.2; `0` jumps). */
  shot(target: AuditTarget, opts?: AuditShotOptions): void
  /** Subscribes to an audit event. Returns the unsubscribe function. */
  on<K extends keyof AuditEvents>(event: K, cb: (v: AuditEvents[K]) => void): () => void
}

/** Colours of the gaps, as the audit draws them in 3D: `gap` for what is broken, `weak` for joins only a path uses. */
export interface AuditColors {
  gap: string
  weak: string
}

/** The gap colours for a theme (`strata.theme`, following its `diffScheme`) or `'dark'` / `'light'`; default `'dark'`. Panels such as `AuditPanel` use it. */
export function auditColors(scheme: Pick<Theme, 'diffScheme'> | Theme['diffScheme'] = 'dark'): AuditColors {
  const s = typeof scheme === 'string' ? scheme : scheme.diffScheme
  return s === 'light' ? { gap: '#d4503c', weak: '#a8741a' } : { gap: '#ff7a63', weak: '#e2b45a' }
}

/** The audit plugin: `const audit = strata.use(auditPlugin())`. Registers `audit` in the view state. */
export function auditPlugin(): StrataPlugin<AuditApi> {
  return { name: 'audit', install }
}

/** 节点在审计里的处境 */
const enum Part {
  /** 没缺口：退成灰 */
  Quiet = 0,
  /** 不在审计的两层里 */
  Outside = 1,
  /** 缺口牵涉到的（走不通的关系的两端、没用到的外键的两张表）：保留本色、出名字 */
  Touched = 2,
  /** 自己就是缺口（没映射）：本色、名字、缺口色的环 */
  Gap = 3,
}

/** 边在审计里的处境 */
const enum Line {
  Quiet = 0,
  Outside = 1,
  /** 只被路径用到的外键 */
  Weak = 2,
  /** 走不通的本体关系（虚线）、完全没用到的外键（实线） */
  Gap = 3,
}

/** 选中一项时亮起来的东西：节点、边（下标），以及哪些边是走的路径 */
interface Lit {
  nodes: Set<number>
  edges: Set<number>
  path: Set<number>
  /** 被选中的“那一个”：选关系时是它的两端，选外键时是它的两张表，选节点时是它自己 */
  core: Set<number>
}

interface AuditState {
  audit: MappingAudit
  opts: AuditShowOptions
  model: Model
  styler: Styler
  style: StyleState
  /** 上层、下层的下标 */
  upper: number
  lower: number
  part: Uint8Array
  line: Uint8Array
  /** 每层缺口线的密度系数：缺口线多了每条就淡一些，不然连成一片墙 */
  gapK: number[]
  /** 关系 id → 底子里的边的下标 */
  edgeOf: Map<string, number>
  relations: Map<string, RelationAudit>
  joins: Map<string, JoinAudit>
  hovered: number
  selected: AuditTarget | null
  lit: Lit | null
  colors: AuditColors
  /** 退成灰的节点用的颜色（每个节点一份，换主题时重算） */
  grey: string[]
  /** 平时的中性线色 */
  line0: string
}

function install(ctx: StrataContext): AuditApi {
  const events = new Emitter<AuditEvents>()
  let state: AuditState | null = null
  let handle: ModeHandle | null = null

  const drop = () => {
    const was = state !== null
    state = null
    handle = null
    if (was) events.emit('exit', null)
  }

  /** 全部收起时的布局：从全景的布局里去掉展开出来的子节点（顶层节点的位置不随展开变） */
  const collapsedLayout = (m: Model): StrataLayout => ({ ...m.layout, nodes: new Map([...m.layout.nodes].filter(([, p]) => p.depth === 0)) })

  const show = (opts: AuditShowOptions = {}): MappingAudit | null => {
    const data = ctx.data
    const m0 = ctx.model
    if (!data || !m0 || ctx.disposed) return null
    const audit = auditMappings(data, { ...opts, locale: ctx.locale })
    const flat = project(ctx.normalize(data))
    const model = buildModel(flat, collapsedLayout(m0), ctx.theme)
    const prev = state
    const st = build(audit, opts, model)
    // 重新算了一遍（换主题）：选中的那一项还认得就接着用
    if (prev?.selected && known(st, prev.selected)) {
      st.selected = prev.selected
      st.lit = litOf(st, prev.selected)
    }
    const mode: StrataMode = {
      model,
      base: model.renderer,
      looks: (frame) => looksOf(st, frame.time),
      hover: (i) => (st.hovered = i),
      select: (i) => {
        if (state !== st) return
        const id = i >= 0 ? st.model.base.nodes[i].id : null
        // 在图上点：点节点选它（再点一次放开），点空白处放开
        const next: AuditTarget | null = id && !(st.selected?.kind === 'node' && st.selected.id === id) ? { kind: 'node', id } : null
        choose(next, true)
      },
      released: () => {
        if (state === st) drop()
      },
    }
    state = st
    handle = ctx.takeOver(mode)
    events.emit('enter', audit)
    return audit
  }

  const exit = () => {
    const h = handle
    const was = state !== null
    state = null
    handle = null
    // 审计时展开、收起过的话，核心交还时自己按新的展开状态重建全景
    if (h?.active) h.release()
    if (was) events.emit('exit', null)
  }

  const shot = (target: AuditTarget, opts: AuditShotOptions = {}) => {
    const st = state
    if (!st) return
    const lit = st.selected && same(st.selected, target) && st.lit ? st.lit : litOf(st, target)
    if (!lit) return
    const ids = [...lit.nodes].map((i) => st.model.base.nodes[i].id)
    // 节点少时按它们自己的范围框会贴得太近：边距放宽，周围留出上下文
    ctx.fit(ids, { elevation: 0.58, margin: ids.length > 3 ? 1.8 : ids.length > 1 ? 3.2 : 6, duration: opts.duration })
  }

  /** 选中一项：frame 为 true 时镜头框住它 */
  const choose = (target: AuditTarget | null, frame: boolean) => {
    const st = state
    if (!st) return
    const next = target && known(st, target) ? target : null
    if (same(st.selected, next)) return
    st.selected = next
    st.lit = next ? litOf(st, next) : null
    events.emit('select', next)
    if (next && frame) shot(next)
    else if (!next) ctx.releaseCamera()
  }

  ctx.onChange((change) => {
    if (change === 'data') drop()
    // 换了主题：模型、颜色按新主题重来
    if (change === 'theme' && state) show(state.opts)
  })
  // 审计按全部收起来算、也这么画：审计时展开、收起不改画面，交还时全景再按新的展开状态重建
  ctx.onExpand(() => !!state && !!handle?.active)
  ctx.registerView<{ selected: AuditTarget | null } | null>('audit', {
    get: () => (state && handle?.active ? { selected: state.selected ? { ...state.selected } : null } : null),
    set: (v) => {
      if (v && state && handle?.active) choose(v.selected, true)
    },
  })
  ctx.onDispose(() => events.clear())

  return {
    show,
    exit,
    get active() {
      return !!handle?.active
    },
    get current() {
      return state?.audit ?? null
    },
    get selected() {
      return state?.selected ? { ...state.selected } : null
    },
    select: (target) => choose(target, true),
    shot,
    on: (event, cb) => events.on(event, cb),
  }

  function build(audit: MappingAudit, opts: AuditShowOptions, model: Model): AuditState {
    const layers = model.data.layers.map((l) => l.id)
    const upper = layers.indexOf(audit.upper)
    const lower = layers.indexOf(audit.lower)
    const { nodes, edges } = model.base
    const part = new Uint8Array(nodes.length)
    const line = new Uint8Array(edges.length)
    const edgeOf = new Map<string, number>()
    model.edgeId.forEach((id, i) => id && edgeOf.set(id, i))
    nodes.forEach((n, i) => (part[i] = n.layer === upper || n.layer === lower ? Part.Quiet : Part.Outside))
    edges.forEach((e, i) => {
      const a = nodes[e.s].layer
      const b = nodes[e.t].layer
      const inside = (a === upper || a === lower) && (b === upper || b === lower)
      line[i] = inside ? Line.Quiet : Line.Outside
    })
    const touch = (id: string) => {
      const i = model.index.get(id)
      if (i !== undefined && part[i] < Part.Touched) part[i] = Part.Touched
    }
    // 一端没映射的关系不另外标：缺口在那个节点上（它套着环），选中它时它的关系一起亮
    for (const r of audit.relations) {
      if (r.status !== 'unreachable') continue
      const e = edgeOf.get(r.id)
      if (e !== undefined) line[e] = Line.Gap
      touch(r.source)
      touch(r.target)
    }
    for (const j of audit.joins) {
      if (j.coverage === 'direct') continue
      const e = edgeOf.get(j.id)
      if (e !== undefined) line[e] = j.coverage === 'unused' ? Line.Gap : Line.Weak
      if (j.coverage === 'unused') {
        touch(j.source)
        touch(j.target)
      }
    }
    for (const id of [...audit.unmappedUpper, ...audit.unmappedLower]) {
      const i = model.index.get(id)
      if (i !== undefined) part[i] = Part.Gap
    }
    const gaps = model.data.layers.map(() => 0)
    line.forEach((k, i) => {
      if (k === Line.Gap || k === Line.Weak) gaps[nodes[edges[i].s].layer]++
    })
    const gapK = gaps.map((n) => Math.min(1, Math.max(0.12, Math.sqrt(24 / Math.max(n, 1)))))
    const theme = model.theme
    const grey = nodes.map((_, i) => mixHex(nodeColor(model, i), theme.plate.neutral, 0.72))
    return {
      audit,
      opts,
      model,
      styler: new Styler(model),
      style: { hover: -1, selected: -1, focusLayer: null, stage: null, spot: null, group: -1, time: 0 },
      upper,
      lower,
      part,
      line,
      gapK,
      edgeOf,
      relations: new Map(audit.relations.map((r) => [r.id, r])),
      joins: new Map(audit.joins.map((j) => [j.id, j])),
      hovered: -1,
      selected: null,
      lit: null,
      colors: auditColors(theme),
      grey,
      line0: theme.line,
    }
  }
}

const same = (a: AuditTarget | null, b: AuditTarget | null) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id)

function known(st: AuditState, t: AuditTarget): boolean {
  if (t.kind === 'relation') return st.relations.has(t.id)
  if (t.kind === 'join') return st.joins.has(t.id)
  const i = st.model.index.get(t.id)
  return i !== undefined && st.part[i] !== Part.Outside
}

/** 选中一项时牵涉到的节点和边 */
function litOf(st: AuditState, t: AuditTarget): Lit | null {
  const m = st.model
  const lit: Lit = { nodes: new Set(), edges: new Set(), path: new Set(), core: new Set() }
  const node = (id: string, core = false) => {
    const i = m.index.get(id)
    if (i === undefined) return -1
    lit.nodes.add(i)
    if (core) lit.core.add(i)
    return i
  }
  const edge = (id: string, path = false) => {
    const e = st.edgeOf.get(id)
    if (e === undefined) return
    lit.edges.add(e)
    if (path) lit.path.add(e)
  }
  /** a、b 之间的映射线 */
  const mapping = (a: number, b: number) => {
    const e = m.edgeAt.get(`${a},${b}`)
    if (e !== undefined && m.base.edges[e].kind === 'cross') lit.edges.add(e)
  }
  /** 节点和它在另一层（审计的两层里）的映射对象 */
  const counterparts = (i: number) => {
    const other = m.base.nodes[i].layer === st.upper ? st.lower : st.upper
    for (const k of m.incident[i]) {
      const e = m.base.edges[k]
      if (e.kind !== 'cross') continue
      const j = e.s === i ? e.t : e.s
      if (m.base.nodes[j].layer !== other) continue
      lit.nodes.add(j)
      lit.edges.add(k)
    }
  }

  if (t.kind === 'relation') {
    const r = st.relations.get(t.id)
    if (!r) return null
    const a = node(r.source, true)
    const b = node(r.target, true)
    edge(r.id)
    // 两端落在哪些表上：映射线带上
    for (const id of r.sourceNodes) mapping(a, node(id))
    for (const id of r.targetNodes) mapping(b, node(id))
    for (const p of r.paths) {
      for (const id of p.nodes) node(id)
      for (const id of p.joins) edge(id, true)
    }
    return lit
  }
  if (t.kind === 'join') {
    const j = st.joins.get(t.id)
    if (!j) return null
    const a = node(j.source, true)
    const b = node(j.target, true)
    edge(j.id, true)
    if (a >= 0) counterparts(a)
    if (b >= 0) counterparts(b)
    // 对应它的、用到它的本体关系
    for (const id of [...j.direct, ...j.usedBy]) {
      const r = st.relations.get(id)
      if (!r) continue
      edge(id)
      node(r.source)
      node(r.target)
    }
    return lit
  }
  const i = node(t.id, true)
  if (i < 0) return null
  counterparts(i)
  // 同一层里和它有关系的节点
  for (const k of m.incident[i]) {
    if (st.line[k] === Line.Outside || m.base.edges[k].kind === 'cross') continue
    const e = m.base.edges[k]
    lit.edges.add(k)
    lit.nodes.add(e.s === i ? e.t : e.s)
  }
  return lit
}

function looksOf(st: AuditState, time: number): Looks {
  const { model: m, colors, part, line, lit } = st
  st.style.time = time
  const L = st.styler.resolve(st.style)
  const theme = m.theme
  const any = lit !== null
  // 底子中性：领域的疆域、灯都退成灰
  L.neutral = 1
  for (let g = 0; g < L.groups.length; g++) L.groups[g] = 0
  L.ground = any ? 0.5 : 0.8

  for (let i = 0; i < L.nodes.length; i++) {
    const o = L.nodes[i]
    const p = part[i]
    const on = lit?.nodes.has(i) ?? false
    const core = lit?.core.has(i) ?? false
    const lb = o.label!
    const hub = m.base.nodes[i].mag <= 1
    o.ring = null
    o.halo = null
    if (p === Part.Outside) {
      o.color = st.grey[i]
      o.intensity *= 0.4
      o.alpha *= 0.3
      lb.alpha = 0
      continue
    }
    if (any && on) {
      // 回答：本色，亮一档（会泛光），名字出全；选中的那一个再套一圈环
      o.intensity = core ? 1.3 : 1.12
      o.alpha = 1
      lb.alpha = 1
      lb.color = '#ffffff'
      lb.weight = core ? 600 : 500
      lb.priority = core ? 4 : 3
      o.halo = { color: o.color, alpha: core ? 0.3 : 0.18, size: theme.haloSize[m.base.nodes[i].mag] }
      if (core) o.ring = { color: theme.accent, alpha: 0.85 }
      else if (p === Part.Gap) o.ring = { color: colors.gap, alpha: 0.7 }
      continue
    }
    if (p === Part.Gap || p === Part.Touched) {
      // 缺口：保留本色、出名字；没映射的节点再套一圈缺口色的环
      lb.alpha = any ? 0.45 : 1
      lb.priority = p === Part.Gap ? 2.5 : 2
      o.alpha *= any ? 0.6 : 1
      o.intensity *= any ? 0.6 : 1
      if (p === Part.Gap) o.ring = { color: colors.gap, alpha: any ? 0.35 : 0.75 }
    } else {
      // 没缺口：退成灰，名字只留枢纽的
      o.color = st.grey[i]
      o.intensity *= any ? 0.45 : 0.7
      o.alpha *= any ? 0.45 : 0.75
      lb.alpha = hub && !any ? 0.55 : 0
      lb.color = theme.label.secondary
    }
    if (i === st.hovered) {
      lb.alpha = 1
      o.ring = o.ring ?? { color: theme.label.secondary, alpha: 0.5 }
    }
  }

  for (let i = 0; i < L.edges.length; i++) {
    const o = L.edges[i]
    const k = line[i]
    const e = m.base.edges[i]
    const on = lit?.edges.has(i) ?? false
    o.flow = 0
    if (k === Line.Outside) {
      o.alpha *= 0.15
      continue
    }
    if (any && on) {
      const path = lit!.path.has(i)
      if (e.kind === 'cross') paint(o, theme.accent, 0.42, 0.9, false)
      else if (k === Line.Gap || k === Line.Weak) paint(o, k === Line.Gap ? colors.gap : colors.weak, 0.95, 1.6, k === Line.Gap && e.kind === 'intra' && m.base.nodes[e.s].layer === st.upper)
      else paint(o, theme.accent, path ? 0.9 : 0.7, path ? 1.6 : 1.2, false)
      o.intensity = 1.3
      // 走的路径：顺着外键放彗星
      if (path) o.flow = 0.8
      continue
    }
    const dim = any ? 0.35 : 1
    const gk = st.gapK[m.base.nodes[e.s].layer]
    if (k === Line.Gap) {
      // 走不通的本体关系是虚线：断着的；完全没用到的外键是实线：有这条线，上面没对应
      paint(o, colors.gap, 0.85 * dim * gk, gk < 0.5 ? 0.9 : 1.3, m.base.nodes[e.s].layer === st.upper)
    } else if (k === Line.Weak) {
      paint(o, colors.weak, 0.6 * dim * gk, gk < 0.5 ? 0.8 : 1.05, false)
    } else {
      o.colorA = o.colorB = st.line0
      o.alpha *= e.kind === 'cross' ? 0.5 * dim : 0.45 * dim
    }
  }
  return L
}

function paint(o: EdgeLook, color: string, alpha: number, width: number, dash: boolean) {
  o.colorA = o.colorB = color
  o.alpha = alpha
  o.width = width
  o.dash = dash
  o.intensity = 1
}
