import type { Bridge } from './bridge.js'
import { mixHex } from './color.js'
import { nodeColor, type Model } from './model.js'
import type { Theme } from './theme.js'
import type { EdgeLook, LabelLook, Looks, NodeLook } from './types.js'

// 平时的样子：星等亮度、悬停点亮邻居、聚焦一层，以及叠加层插件要的“强调一串节点”
export interface StyleState {
  hover: number
  selected: number
  focusLayer: number | null
  /** 分主次时每层的亮度和“配角程度”（见 stage.ts）。null = 不分主次 */
  stage: { levels: number[]; sides: number[] } | null
  /** 叠加层插件要强调的一串节点（见 Spotlight）。null = 没有 */
  spot: Spotlight | null
  /** 穿透：被隐藏的层隔开的节点之间的关系（见 bridge.ts），以及它们现在显出来多少 0..1 */
  bridges?: Bridge[]
  bridgeIn?: number
  /** 悬停在领域图例上：这个领域的灯和疆域亮起来 */
  group: number
  time: number
}

// 它只管“谁亮谁暗”，这一步要和聚焦、主次的压暗按顺序叠，所以放在样式里算；
// 序号、额外的线、涟漪这些属于用它的插件，插件在样式之后自己叠上去（路径回放就是这么用的）。
/**
 * An ordered sequence of nodes to emphasize: `rank[i]` is node i's position (from 1), 0 = not in it;
 * as long as the base's node list. It overrides hover and groups: its nodes light up with the accent
 * ring, everything else steps back. Step numbers, extra lines and ripples are drawn by the plugin itself.
 */
export interface Spotlight {
  rank: ArrayLike<number>
}

const hash = (i: number) => {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

function label(): LabelLook {
  return { text: '', color: '#ffffff', alpha: 0, size: 12, weight: 400, strike: false, priority: 0 }
}

function nodeLook(): NodeLook {
  return { visible: true, x: 0, z: 0, layer: 0, lift: 0, scale: 1, color: '#ffffff', intensity: 1, alpha: 1, ghost: false, ring: null, halo: null, pulse: 0, label: label(), label2: null, badge: null, step: 0 }
}

function edgeLook(): EdgeLook {
  return {
    visible: true,
    a: { x: 0, z: 0, layer: 0, lift: 0 },
    b: { x: 0, z: 0, layer: 0, lift: 0 },
    arc: 0,
    colorA: '#ffffff',
    colorB: '#ffffff',
    alpha: 0,
    width: 1,
    dash: false,
    progress: 1,
    fromTarget: false,
    flow: 0,
    phase: 0,
    intensity: 1,
  }
}

/** 节点的静态样子（档位、颜色、标签），算一次 */
interface Rest {
  color: string
  /** 光晕用的颜色：比芯更靠近领域色，白芯外面一圈带色的晕 */
  glow: string
  /** 层内连线在这一端的颜色 */
  edge: string
  /** 映射线在这一端的颜色：更靠近中性 */
  map: string
  /** 选中、强调时的外环色、点亮色：先算好，帧里不分配 */
  ringColor: string
  litColor: string
  intensity: number
  labelSize: number
  labelWeight: 400 | 500 | 600
  labelColor: string
  priority: number
  /** 平时就显示标签 */
  showLabel: boolean
  /** 平时的不透明度：大图里长尾的节点淡下去，亮的少、暗的多 */
  alpha: number
}

export class Styler {
  private rest: Rest[]
  private looks: Looks
  private halos: { color: string; alpha: number; size: number }[]
  private rings: { color: string; alpha: number }[]
  /** 每层的密度系数：节点、边越多，光晕和边越淡，不然几千个节点叠加起来是一团白 */
  private nodeK: number[]
  private edgeK: number[]
  private counts: number[]
  /** 弧线拱起的上限：再长的线也不该拱到另一层去 */
  private arcCap: number
  /** 大图里长线淡下去：0 = 不淡（小图），1 = 全力（上千条边）；以及多长算长 */
  private longFade: number
  private longLen: number
  /** 跨层线多的时候整体再淡一点 */
  private crossK: number
  /** 每帧复用的缓冲 */
  private lit: Uint8Array
  /** 和被指着的节点同在一个对应块里 */
  private inFocus: Uint8Array
  /** 没有强调的串时用的全零排名 */
  private none: Int32Array

  /** 主题跟着模型走（buildModel 时给的） */
  private readonly theme: Theme

  constructor(private readonly m: Model) {
    const { base } = m
    const theme = (this.theme = m.theme)
    this.counts = m.data.layers.map((_, li) => base.nodes.filter((n) => n.layer === li).length)
    this.lit = new Uint8Array(base.nodes.length)
    this.inFocus = new Uint8Array(base.nodes.length)
    this.none = new Int32Array(base.nodes.length)
    const edgeCounts = m.data.layers.map((_, li) => base.edges.filter((e) => e.kind !== 'cross' && base.nodes[e.s].layer === li).length)
    const reach = Math.max(30, ...m.layout.radii)
    this.arcCap = 14 * Math.pow(reach / 30, 0.6)
    this.longFade = Math.min(1, Math.max(0, (base.edges.length - 200) / 800))
    this.longLen = 0.22 * reach
    this.crossK = Math.min(1, Math.max(0.15, Math.sqrt(90 / Math.max(base.edges.filter((e) => e.kind === 'cross').length, 1))))
    this.nodeK = this.counts.map((c) => Math.min(1, Math.max(0.12, Math.sqrt(50 / Math.max(c, 1)))))
    this.edgeK = edgeCounts.map((c) => Math.min(1, Math.max(0.1, Math.sqrt(70 / Math.max(c, 1)))))
    this.rest = base.nodes.map((n, i) => {
      const color = nodeColor(m, i)
      const rest = this.restOf(i)
      const gc = n.group >= 0 ? m.groupColors[n.group] : color
      const k = this.nodeK[n.layer]
      const alpha = n.mag <= 1 ? 1 : n.mag === 2 ? Math.max(0.7, Math.pow(k, 0.25)) : Math.max(0.42, Math.sqrt(k))
      return { ...rest, alpha, color, edge: mixHex(theme.line, color, theme.lineTint), map: mixHex(theme.line, color, 0.55), glow: mixHex(gc, color, 0.25), ringColor: mixHex(color, '#ffffff', 0.4), litColor: mixHex(color, '#ffffff', 0.18) }
    })
    this.halos = base.nodes.map((n) => ({ color: '#ffffff', alpha: 0, size: theme.haloSize[n.mag] }))
    this.rings = base.nodes.map(() => ({ color: theme.accent, alpha: 0 }))
    this.looks = {
      nodes: base.nodes.map(() => nodeLook()),
      edges: base.edges.map(() => edgeLook()),
      // extra.path 归路径插件：这里只留一个空的，没装插件时它一直是空的
      extra: { bridges: [], path: [], marks: [] },
      groups: m.data.groups.map(() => 0),
      neutral: 0,
      layers: m.data.layers.map(() => 1),
      ripples: [],
    }
  }

  // 亮度、光晕跟星等走；标签的档位跟着星等分三级。只有 0、1 等星亮度 > 1（会泛光）
  private restOf(i: number): Omit<Rest, 'color' | 'glow' | 'edge' | 'map' | 'ringColor' | 'litColor' | 'alpha'> {
    const { layout, base } = this.m
    const theme = this.theme
    const n = base.nodes[i]
    const p = layout.nodes.get(n.id)!
    const imp = p.importance
    const intensity = theme.magnitude[n.mag]
    // 展开出来的子节点（字段）：小一号的灰字，父节点展开着就一直出
    if (p.depth > 0) return { intensity, labelSize: 11, labelWeight: 400, labelColor: theme.label.secondary, priority: 0.5 + imp * 0.1, showLabel: true }
    // 名字分三档：枢纽是大一号的白字，中间一档是灰字，长尾平时不出（悬停或聚焦这一层时才出）
    // 字号是在镜头对准的距离上的大小；渲染时近处的字放大、远处的缩小
    if (n.mag <= 1) return { intensity, labelSize: n.mag === 0 ? 15 : 14, labelWeight: 400, labelColor: theme.label.primary, priority: 0.9 + imp * 0.05, showLabel: true }
    if (n.mag === 2) return { intensity, labelSize: 13, labelWeight: 400, labelColor: theme.label.primary, priority: 0.55 + imp * 0.2, showLabel: true }
    return { intensity, labelSize: 12.5, labelWeight: 400, labelColor: theme.label.secondary, priority: 0.3 + imp * 0.2, showLabel: false }
  }

  resolve(s: StyleState): Looks {
    const { m, looks } = this
    const { base, layout } = m
    const theme = this.theme
    const L = looks
    const focus = s.hover >= 0 ? s.hover : s.selected
    const lit = this.lit
    lit.fill(0)
    // 指着一个节点：它自己、它的邻居亮起来；同一个对应块里的节点也算（这张表还落着谁、这个本体还落在哪）
    // 夹在中间的层的节点同时在上、下两个块里：两个块都带出来
    const inFocus = this.inFocus
    inFocus.fill(0)
    if (focus >= 0) {
      lit[focus] = 2
      for (const j of m.adj[focus]) lit[j] = Math.max(lit[j], 1)
      // 穿透过去的那一头也算邻居
      for (const b of s.bridges ?? []) {
        if (b.s === focus) lit[b.t] = Math.max(lit[b.t], 1)
        else if (b.t === focus) lit[b.s] = Math.max(lit[b.s], 1)
      }
      const mine = m.blocksOf[focus]
      if (mine.length > 0) {
        for (let i = 0; i < base.nodes.length; i++) {
          if (!m.blocksOf[i].some((b) => mine.includes(b))) continue
          inFocus[i] = 1
          if (lit[i] === 0) lit[i] = 1
        }
      }
    }
    // 强调的串：排第几（0 = 不在里面）
    const spotOn = !!s.spot
    const order = s.spot ? s.spot.rank : this.none
    // 领域强调：指着一个节点，它的疆域微亮
    for (let g = 0; g < L.groups.length; g++) L.groups[g] = 0
    if (focus >= 0) {
      const n = base.nodes[focus]
      if (n.group >= 0) L.groups[n.group] = n.layer === layout.anchor ? 0.45 : 0.3
    }
    if (s.group >= 0 && s.group < L.groups.length) L.groups[s.group] = 1
    if (spotOn) {
      for (let i = 0; i < base.nodes.length; i++) {
        const g = base.nodes[i].group
        if (order[i] > 0 && g >= 0) L.groups[g] = Math.max(L.groups[g], 0.6)
      }
    }
    // 层的分量：分主次时按主次来；聚焦一层时其余压到很暗
    for (let li = 0; li < L.layers.length; li++) {
      const w = s.stage ? (s.stage.levels[li] ?? 1) : 1
      L.layers[li] = s.focusLayer === null ? w : s.focusLayer === li ? 1 : 0.18
    }
    L.neutral = 0
    L.ripples.length = 0
    // 指着某样东西、强调一串节点时，地面退后一步：对比来自压暗别的
    L.ground = spotOn || focus >= 0 ? 0.55 : 1

    // 节点
    for (let i = 0; i < base.nodes.length; i++) {
      const n = base.nodes[i]
      const p = layout.nodes.get(n.id)!
      const r = this.rest[i]
      const o = L.nodes[i]
      o.visible = true
      o.x = p.x
      o.z = p.z
      o.layer = n.layer
      o.lift = 0
      o.scale = 1
      o.color = r.color
      o.ghost = false
      o.pulse = 0
      o.badge = null
      o.label2 = null
      // 序号归用强调串的插件（路径回放），这里一律清掉
      o.step = 0
      let intensity = r.intensity
      let alpha = order[i] > 0 || lit[i] ? 1 : r.alpha
      // 一小圈很淡的柔光：珠子自己发的光。大图里再淡一些，不然叠成一片
      let halo = theme.haloAlpha[n.mag] * this.nodeK[n.layer]
      // 配角程度：主角 0，紧挨主角的层 1，更远的大于 1。越靠配角：名字越少、越小、越淡
      const side = s.stage ? (s.stage.sides[n.layer] ?? 0) : 0
      let lab = r.showLabel || s.focusLayer === n.layer ? 1 : 0
      let prio = r.priority
      let ring = 0
      const layerOn = L.layers[n.layer]
      if (spotOn) {
        if (order[i] > 0) {
          intensity = 1.22
          halo = 0.26
          lab = 1
          prio = 3 - order[i] * 0.01
          ring = 0.85
          o.color = r.litColor
        } else {
          intensity *= 0.32
          alpha *= 0.45
          halo *= 0.25
          lab = 0
        }
      } else if (s.group >= 0 && focus < 0) {
        if (n.group === s.group) {
          intensity *= 1.2
          prio += 1
        } else {
          intensity *= 0.5
          alpha *= 0.6
          halo *= 0.4
          lab *= 0.35
        }
      } else if (focus >= 0) {
        if (lit[i] === 2) {
          // 被指着的那个：略微发亮、一圈外环、一点点晕。不靠一大团光
          intensity = 1.25
          halo = 0.3
          ring = 0.8
          prio = 3
          lab = 1
        } else if (lit[i] === 1) {
          // 邻居：保持本色、出名字
          intensity = 1.0
          halo = Math.max(halo, 0.16)
          prio += 1.5
          lab = 1
        } else {
          intensity *= 0.42
          alpha *= 0.55
          halo *= 0.35
          lab *= 0.3
        }
      }
      if (s.focusLayer !== null && s.focusLayer !== n.layer) {
        intensity *= 0.45
        alpha *= 0.4
        halo *= 0.2
        lab = 0
      } else if (layerOn < 1) {
        intensity *= 0.6 + 0.4 * layerOn
        halo *= layerOn
      }
      if (side > 0 && !lit[i] && order[i] === 0) {
        alpha *= 1 - 0.2 * Math.min(side, 1)
        // 最主要的几个名字只是淡一点，隔了一层以上的配角连它们也收掉；其余的在分量过半之前就收掉
        lab *= n.mag <= 1 ? Math.max(0, 1 - 0.3 * side - Math.max(0, side - 1) * 4) : Math.max(0, 1 - side * 2)
      }
      o.intensity = intensity
      o.alpha = alpha
      const h = this.halos[i]
      h.color = order[i] > 0 ? o.color : r.glow
      h.alpha = halo
      o.halo = halo > 0.01 ? h : null
      const rg = this.rings[i]
      rg.alpha = ring
      rg.color = order[i] > 0 ? theme.accent : r.ringColor
      o.ring = ring > 0 ? rg : null
      const lb = o.label!
      lb.text = m.specs[i].label
      lb.color = order[i] > 0 || lit[i] === 2 ? '#ffffff' : lit[i] === 1 ? theme.label.primary : r.labelColor
      lb.alpha = lab
      // 字号按半号取整：连续变化时不会每一帧都重新排字
      lb.size = r.labelSize - Math.round(Math.min(side, 1) * 3) / 2
      lb.weight = order[i] > 0 || lit[i] === 2 ? 600 : r.labelWeight
      lb.priority = prio
      lb.mono = n.mono
    }

    // 边
    for (let i = 0; i < base.edges.length; i++) {
      const e = base.edges[i]
      const o = L.edges[i]
      const a = L.nodes[e.s]
      const b = L.nodes[e.t]
      setEnd(o.a, a)
      setEnd(o.b, b)
      const len = Math.hypot(a.x - b.x, a.z - b.z)
      o.visible = true
      o.dash = false
      o.progress = 1
      o.fromTarget = false
      o.phase = hash(i)
      // 平时线靠近中性色；被点亮的线（悬停节点的那几条）用回节点的本色
      const hot = focus >= 0 && (e.s === focus || e.t === focus)
      o.colorA = hot ? this.rest[e.s].color : e.kind === 'cross' ? this.rest[e.s].map : this.rest[e.s].edge
      o.colorB = hot ? this.rest[e.t].color : e.kind === 'cross' ? this.rest[e.t].map : this.rest[e.t].edge
      let alpha: number
      let width: number
      let intensity: number
      let flow = 0
      if (e.kind === 'cross') {
        o.arc = 0
        const cls = m.edgeClass[i]
        // 映射线是发丝：比层内的弧线细一档、淡一档。它们又长又多，粗了就成了栅栏
        if (cls === 'primary') {
          alpha = 0.13 * this.crossK
          width = 0.5
          intensity = 1
        } else if (cls === 'inner') {
          alpha = 0.09 * this.crossK
          width = 0.5
          intensity = 1
        } else if (cls === 'outer') {
          // 跨块的次映射：更淡的虚线
          alpha = 0.05 * this.crossK
          width = 0.5
          intensity = 1
          o.dash = true
        } else {
          // 没归上类的跨层线：几乎不画
          alpha = 0.006 * this.crossK
          width = 1
          intensity = 0.6
        }
      } else if (e.kind === 'contain') {
        // 父节点到展开出来的子节点：直的、细的短线
        o.arc = 0
        alpha = 0.3
        width = 0.6
        intensity = 0.8
      } else {
        // 层内的关系：一道拱起来的弧，两端各取节点的颜色。越长拱得越高
        o.arc = Math.min(len * 0.3 + 0.4, this.arcCap)
        const k = this.edgeK[base.nodes[e.s].layer]
        alpha = 0.46 * k
        // 大图里横跨半个盘的长线最乱、信息也最少：越长越淡
        alpha *= 1 - this.longFade * (1 - 1 / (1 + (len / this.longLen) ** 2))
        width = 0.9
        intensity = 1
        // 平时不放彗星：方向只在悬停时才交代（强调串的方向由用它的插件自己画）
      }
      const inc = focus >= 0 && (e.s === focus || e.t === focus)
      if (spotOn) {
        alpha *= 0.22
        flow = 0
      } else if (focus >= 0) {
        if (inc) {
          // 被指着的节点的那几条线：用回本色、实一点，但不加粗到发光
          alpha = e.kind === 'cross' ? 0.42 : 0.55
          intensity = 1
          width = e.kind === 'cross' ? 0.8 : 1.1
          flow = e.kind === 'cross' ? 0 : 0.5
        } else if (e.kind === 'cross' && inFocus[e.s] && inFocus[e.t] && m.blocksOf[e.s].some((b) => m.blocksOf[e.t].includes(b) && m.blocksOf[focus].includes(b))) {
          // 同一个对应块里的其余映射线：跟着显出来
          alpha = 0.26
          width = 0.7
        } else {
          alpha *= 0.3
          flow = 0
        }
      } else if (s.group >= 0) {
        // 悬停领域：两端都不在这个领域的边退下去
        if (base.nodes[e.s].group !== s.group && base.nodes[e.t].group !== s.group) {
          alpha *= 0.25
          flow = 0
        }
      }
      const la = Math.min(L.layers[a.layer], L.layers[b.layer])
      if (s.focusLayer !== null && (a.layer !== s.focusLayer || b.layer !== s.focusLayer)) {
        alpha *= 0.15
        flow = 0
      } else if (la < 1) alpha *= e.kind === 'cross' ? 1 : la
      o.alpha = alpha
      o.width = width
      o.intensity = intensity
      o.flow = flow
    }
    // 穿透线：额外的边。细的虚线，分量大的（经过的中间节点多）实一点
    const bridges = s.bridges ?? []
    const bridgeIn = s.bridgeIn ?? 1
    for (let k = 0; k < bridges.length; k++) {
      const br = bridges[k]
      const o = (L.extra.bridges[k] ??= edgeLook())
      const a = L.nodes[br.s]
      const b = L.nodes[br.t]
      setEnd(o.a, a)
      setEnd(o.b, b)
      o.visible = bridgeIn > 0.01
      o.arc = 0
      o.dash = true
      o.progress = 1
      o.fromTarget = false
      o.flow = 0
      o.phase = 0
      o.intensity = 1
      const inc = focus >= 0 && (br.s === focus || br.t === focus)
      o.colorA = inc ? this.rest[br.s].color : this.rest[br.s].map
      o.colorB = inc ? this.rest[br.t].color : this.rest[br.t].map
      // 隐藏了中间层以后，它们是两层之间唯一的线：比平时的映射线实一些
      let alpha = Math.min(0.42, 0.2 + 0.07 * br.weight) * this.crossK
      if (spotOn) alpha *= 0.22
      else if (focus >= 0) alpha = inc ? 0.5 : alpha * 0.3
      o.alpha = alpha * bridgeIn
      o.width = inc ? 1 : 0.7
    }
    L.extra.bridges.length = bridges.length
    return L
  }
}

function setEnd(end: EdgeLook['a'], n: NodeLook) {
  end.x = n.x
  end.z = n.z
  end.layer = n.layer
  end.lift = n.lift
}
