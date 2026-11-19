// 指针：画布上的移动、点击、双击 → 指着第几个节点、点了第几个、双击了第几个（-1 = 空白处）。
// 拖动镜头不算点击。哪个节点、接下来做什么（悬停提示、选中、展开）由引擎决定；这里还管节点信息怎么组装。

import { pickText } from '../locale.js'
import { DEFAULT_NODE_STYLES } from '../resolve.js'
import type { Looks, NodeStyle } from '../types.js'
import { emit, type Core } from './core.js'
import type { HoverInfo, NodeInfo } from './types.js'

/** 画布：只用到监听和位置 */
type Surface = Pick<HTMLElement, 'addEventListener' | 'removeEventListener' | 'getBoundingClientRect'>

export interface PointerActions {
  /** 指着第 i 个节点（-1 = 没有） */
  hover(i: number): void
  /** 点了一下（没有拖动），点中第 i 个节点（-1 = 空白处） */
  click(i: number): void
  /** 双击了第 i 个节点（空白处不报） */
  double(i: number): void
}

export class Pointer {
  /** 指针现在的位置（CSS 像素，相对画布） */
  x = -1
  y = -1
  private down = { x: 0, y: 0 }
  private moved = false

  constructor(
    private readonly el: Surface,
    private readonly pick: (x: number, y: number, looks: Looks) => number,
    private readonly looks: () => Looks | null,
    private readonly actions: PointerActions,
  ) {
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointerleave', this.onLeave)
    el.addEventListener('dblclick', this.onDouble)
  }

  detach() {
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerdown', this.onDown)
    this.el.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('pointerleave', this.onLeave)
    this.el.removeEventListener('dblclick', this.onDouble)
  }

  private at(e: MouseEvent) {
    const rect = this.el.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private onMove = (e: PointerEvent) => {
    const p = this.at(e)
    this.x = p.x
    this.y = p.y
    if (e.buttons && Math.hypot(this.x - this.down.x, this.y - this.down.y) > 4) this.moved = true
    const looks = this.looks()
    if (!looks || e.buttons) return
    this.actions.hover(this.pick(this.x, this.y, looks))
  }

  private onDown = (e: PointerEvent) => {
    this.down = this.at(e)
    // 触屏轻点往往没有 pointermove：位置以按下 / 抬起时为准
    this.x = this.down.x
    this.y = this.down.y
    this.moved = false
  }

  private onUp = (e: PointerEvent) => {
    const p = this.at(e)
    this.x = p.x
    this.y = p.y
    const looks = this.looks()
    if (this.moved || !looks) return
    this.actions.click(this.pick(this.x, this.y, looks))
  }

  private onLeave = () => this.actions.hover(-1)

  private onDouble = (e: MouseEvent) => {
    const looks = this.looks()
    if (!looks) return
    const p = this.at(e)
    const i = this.pick(p.x, p.y, looks)
    if (i >= 0) this.actions.double(i)
  }
}

/** 节点类型 → 收着的子节点叫什么（按现在的语言） */
function childNounOf(c: Core, type: string | undefined): string | null {
  if (type === undefined) return null
  const own = c.options.nodeStyles
  const style: NodeStyle | undefined = own && Object.hasOwn(own, type) ? own[type] : Object.hasOwn(DEFAULT_NODE_STYLES, type) ? DEFAULT_NODE_STYLES[type] : undefined
  return pickText(style?.childNoun, c.locale)
}

/** 第 i 个节点的信息。inMode：i 是接管的模式的下标（指针指着的），否则是全景的 */
export function nodeInfo(c: Core, i: number, inMode: boolean): NodeInfo {
  const a = inMode ? c.active : null
  const model = a ? a.mode.model : c.model!
  const n = (a ? a.mode.base : model.base).nodes[i]
  const look = a ? c.looks?.nodes[i] : undefined
  const spec = model.specs[model.index.get(n.id) ?? -1]
  const layer = model.data.layers[n.layer]
  const group = n.group >= 0 ? model.data.groups[n.group] : undefined
  return {
    id: n.id,
    // 全景里名字就是数据里的；模式画的名字可能不一样（kgdiff 给改名的节点出新名字），按它画的来
    label: look?.label?.text ?? spec?.label ?? n.id,
    layer: layer?.id ?? '',
    layerName: layer?.name ?? '',
    group: group?.id ?? null,
    groupName: group?.name ?? null,
    folds: spec?.folds?.length ?? 0,
    childNoun: childNounOf(c, spec?.type),
    expanded: c.expansion.ids.has(n.id) && model.specs.some((x) => x.parent === n.id),
  }
}

/** 指着第 i 个节点：接管的模式自己记它指着谁，全景记在样式状态里；发 hover（指着同一个节点移动也发，位置变了） */
export function hoverAt(c: Core, i: number, at: { x: number; y: number }) {
  const a = c.active
  const prev = a ? c.modeHover : c.state.hover
  if (a) {
    c.modeHover = i
    a.mode.hover?.(i)
  } else c.state.hover = i
  c.renderer.gl.domElement.style.cursor = i >= 0 ? 'pointer' : ''
  if (prev === i && i < 0) return
  emit(c, 'hover', i >= 0 ? ({ ...nodeInfo(c, i, !!a), pointer: { x: at.x, y: at.y } } satisfies HoverInfo) : null)
}
