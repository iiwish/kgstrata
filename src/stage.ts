// 多层的比例：谁多大、多亮、层和层隔多远。纯计算，不碰渲染。
//
// 三条规则：
// 1. 离主角越远越小、越暗。主角原大；紧挨着的一层是主角的 0.56；再往外每层再乘 0.72。
//    亮度同理：紧挨着的是 0.5，再往外每层乘 0.8。这样一摞层像透视一样往两头收，主次一眼看得出。
//    大小是相对主角说的，不是相对各层自己：各层本身有大有小（十个指标的盘比三十个本体的盘小），
//    如果各缩各的 0.56，大层当配角时会和小层当主角时差不多大，主次就乱了。
// 2. 相邻两层在屏幕上“搭一点边”。层距不是固定值，而是按两层缩放后的半径之和来定：
//    层大，隔得开；层小，靠得拢。配角之间不会互相压住，一摞小层也不会拖得很长。
// 3. 整摞的宽高比有个预算。放得下时相邻两层搭边少一点（松），放不下时让配角往主角身后多收一点（紧），
//    保证主角始终能占住画面的大部分宽度，而不是为了装下所有层把镜头拉得很远。

/** 镜头的设计俯角（弧度）：比例是按这个角度看过去的样子定的 */
const ELEVATION = 0.5
/** 紧挨主角的那层之后，每远一层再缩多少 */
const SCALE_FALLOFF = 0.72
const MIN_SCALE = 0.24
/** 紧挨主角的那层有多亮，以及每远一层再暗多少 */
const SIDE_LEVEL = 0.5
const LEVEL_FALLOFF = 0.8
const MIN_LEVEL = 0.25
/** 整摞在屏幕上的宽高比不低于这个数（宽 : 高） */
const ASPECT = 1.45
/** 相邻两层搭边的松紧：1 = 刚好碰上，越小叠得越多 */
const LOOSEST = 0.85
const TIGHTEST = 0.5

export interface StageInput {
  /** 每层盘面的半径（世界单位，没缩放的） */
  radii: number[]
  /** 每层当主角的分量 0..1。全是 0 时当作不分主次 */
  mix: number[]
  /** 紧挨主角的那层缩到多大，缺省 0.56 */
  secondaryScale?: number
  /** 层距的倍数，缺省 1 */
  spread?: number
}

export interface Stage {
  /** 每层的缩放：主角 1；配角 = 主角半径的几成 ÷ 自己的半径 */
  scales: number[]
  /** 每层的亮度 0..1：主角 1 */
  levels: number[]
  /** 每层有多“配角”：主角 0，紧挨着的 1，更远的大于 1。名字出多少、字号多大按它来 */
  sides: number[]
  /** 每层的高度（世界单位），整摞上下居中 */
  heights: number[]
  /** 这一摞用的松紧（见规则 3），调试和测试用 */
  tightness: number
}

/** 离主角 d 层远的层缩到多大 */
export function scaleAt(d: number, secondaryScale = 0.56): number {
  return d <= 0 ? 1 : Math.max(MIN_SCALE, secondaryScale * Math.pow(SCALE_FALLOFF, d - 1))
}

/** 离主角 d 层远的层有多亮 */
export function levelAt(d: number): number {
  return d <= 0 ? 1 : Math.max(MIN_LEVEL, SIDE_LEVEL * Math.pow(LEVEL_FALLOFF, d - 1))
}

export function stageOf(input: StageInput): Stage {
  const n = input.radii.length
  const s1 = input.secondaryScale ?? 0.56
  const spread = input.spread ?? 1
  const W = input.radii.map((_, i) => Math.min(1, Math.max(0, input.mix[i] ?? 0)))
  const total = W.reduce((a, b) => a + b, 0)
  const scales: number[] = []
  const levels: number[] = []
  // 主角有多大：各层半径按分量取平均。配角的大小是它的几成
  let heroRadius = 0
  for (let i = 0; i < n; i++) heroRadius += W[i] * input.radii[i]
  if (total > 0) heroRadius /= total
  for (let i = 0; i < n; i++) {
    const R = input.radii[i]
    if (total <= 0 || R <= 0) {
      scales.push(1)
      levels.push(1)
      continue
    }
    // 这一层“当配角时”的大小和亮度：按离各个主角的距离取，分量大的主角说了算得多
    let others = 0
    let bs = 0
    let bl = 0
    for (let j = 0; j < n; j++) {
      if (j === i || W[j] <= 0) continue
      others += W[j]
      bs += W[j] * scaleAt(Math.abs(i - j), s1)
      bl += W[j] * levelAt(Math.abs(i - j))
    }
    const baseScale = others > 0 ? bs / others : s1
    const baseLevel = others > 0 ? bl / others : SIDE_LEVEL
    // 当配角时画多大：主角的几成；但不放大——本来就小的层不会因为当了配角反而变大
    const asSide = Math.min(R, heroRadius * baseScale)
    // 自己的分量把它从配角的样子往主角的样子拉：分量连续变，大小和亮度也连续变
    scales.push((asSide + (R - asSide) * W[i]) / R)
    levels.push(baseLevel + (1 - baseLevel) * W[i])
  }
  const sides = levels.map((l) => (1 - l) / (1 - SIDE_LEVEL))

  // 层距：相邻两层缩放后的半径之和 × 松紧 × tan(俯角)。松紧按整摞的宽高比预算来定
  const r = input.radii.map((R, i) => R * scales[i])
  let pairs = 0
  for (let i = 0; i + 1 < n; i++) pairs += r[i] + r[i + 1]
  let tightness = LOOSEST
  if (n >= 2 && pairs > 0) {
    const widest = Math.max(...r)
    const room = (2 * widest) / (ASPECT * Math.sin(ELEVATION)) - r[0] - r[n - 1]
    tightness = Math.min(LOOSEST, Math.max(TIGHTEST, room / pairs))
  }
  const heights = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) heights[i] = heights[i - 1] - tightness * Math.tan(ELEVATION) * (r[i - 1] + r[i]) * spread
  const mid = n > 0 ? (heights[0] + heights[n - 1]) / 2 : 0
  return { scales, levels, sides, heights: heights.map((y) => y - mid), tightness }
}
