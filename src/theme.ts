// 主题：所有颜色、字体、雾的远近都在这里，组件不写死色值。
// 主题按实例给：new Strata(host, { theme: { accent: '#ffd27a' } })，没给的项用夜景主题（DARK）的。
// 纯数据，不引入 three：不带渲染的入口（normalize 用色板）也用它。

/** 一个主题的全部项 */
export interface Theme {
  readonly background: string
  /** 色板：没写颜色的组按顺序从这里取 */
  readonly palette: readonly string[]
  /** 背景：中间略亮，四周暗下去 */
  readonly backdrop: { readonly center: string; readonly mid: string; readonly edge: string }
  // 雾：远处的东西更暗，和背景融在一起
  readonly fogNear: number
  readonly fogFar: number
  readonly plate: {
    // 没有领域时的中性色；看变化时盘面退成的灰
    readonly dot: string
    readonly neutral: string
    // 平铺在盘边的层名
    readonly caption: string
  }
  readonly label: {
    readonly primary: string
    readonly secondary: string
    readonly muted: string
    readonly halo: string
  }
  // 选中、路径的强调色
  readonly accent: string
  readonly root: string
  /**
   * 星等 0..5 的亮度。节点是饱和的平涂色点，各档差得不多：重要的靠大小和字号显出来，不靠更亮。
   * 都不超过 1：泛光留给“你正在问的东西”（悬停、选中、路径、变化）。
   */
  readonly magnitude: readonly number[]
  /** 节点外面那圈小柔光的浓度，按星等。很淡：像珠子自己发的光，不是一团雾 */
  readonly haloAlpha: readonly number[]
  /** 光晕的大小（节点半径的倍数），按星等。光晕只在节点被点亮时出现，平时没有 */
  readonly haloSize: readonly number[]
  /** 点阵的颜色：主图层和对齐过来的图层 */
  readonly tone: { readonly primary: string; readonly aligned: string }
  /** 节点的本色：领域色往白里兑多少 */
  readonly starWhite: number
  /** 线的中性色：层内的弧线、映射线都往它上面靠。颜色只留给节点，线不抢 */
  readonly line: string
  /** 层内的弧线带多少两端节点的颜色（其余是中性色） */
  readonly lineTint: number
  /** 没有领域的节点的本色（中性的浅蓝灰） */
  readonly ungrouped: string
  /** 看变化时交给 kgdiff 的底色方案：变化的五类颜色、底子退成的灰由 kgdiff 按它出 */
  readonly diffScheme: 'dark' | 'light'
  readonly font: string
  readonly mono: string
}

/** 每一项都可以不写；数组（色板、按星等的几档）整个替换，不按下标合并 */
export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { -readonly [K in keyof T]?: DeepPartial<T[K]> } : T

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x)
    Object.freeze(v)
  }
  return v
}

/** 夜景主题，缺省就是它。冻住的：要改用 createTheme */
export const DARK: Theme = deepFreeze({
  background: '#070a13',
  palette: ['#58c6ff', '#46d8a8', '#a590ff', '#ecb556', '#ee9772', '#dd94c2', '#78dcec', '#bfe86a', '#8fa8ff', '#e3c08a'],
  backdrop: { center: '#0e1526', mid: '#080b15', edge: '#030408' },
  fogNear: 70,
  fogFar: 190,
  plate: {
    dot: '#c3cdf0',
    neutral: '#5c6680',
    caption: '#8f9bbd',
  },
  label: {
    primary: '#f2f4f9',
    secondary: '#d5dbe8',
    muted: '#a5aec0',
    halo: '#04060a',
  },
  // 冰蓝白光
  accent: '#9fe6ff',
  root: '#e7eaf0',
  magnitude: [1.0, 1.0, 0.98, 0.95, 0.92, 0.88],
  haloAlpha: [0.17, 0.15, 0.13, 0.11, 0.1, 0.09],
  haloSize: [3.0, 3.0, 2.9, 2.8, 2.7, 2.6],
  // 一种蓝紫，两层一样。点阵是地面，不参与表达
  tone: { primary: '#7888f0', aligned: '#7888f0' },
  starWhite: 0.06,
  line: '#8b96b4',
  // 几乎全是节点的颜色，线是饱和的渐变
  lineTint: 0.92,
  ungrouped: '#aab6d6',
  diffScheme: 'dark',
  font: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
})

/** 深拷贝一份，再把 overrides 一项项盖上去：对象逐层合并，数组和基本值整个替换。结果和 DARK、和别的 createTheme 的结果互不相干 */
function merge(base: unknown, over: unknown): unknown {
  if (Array.isArray(over)) return [...over]
  if (over !== null && typeof over === 'object' && base !== null && typeof base === 'object' && !Array.isArray(base)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(base)) out[k] = merge(v, undefined)
    for (const [k, v] of Object.entries(over)) if (v !== undefined) out[k] = merge((base as Record<string, unknown>)[k], v)
    return out
  }
  if (over !== undefined) return over
  // 没有覆盖：把缺省值也拷一份，不和 DARK 共用对象
  if (Array.isArray(base)) return [...base]
  if (base !== null && typeof base === 'object') return merge(base, {})
  return base
}

/** 在夜景主题上改几项，得到一个新主题。不写就是 DARK 的一份拷贝 */
export function createTheme(overrides: DeepPartial<Theme> = {}): Theme {
  return merge(DARK, overrides) as Theme
}

/** 层间距（世界单位）：和盘面半径差不多大，斜着看时两层在屏幕上不叠在一起；映射线是垂直的，长一点不会乱 */
export const LAYER_GAP = 20
