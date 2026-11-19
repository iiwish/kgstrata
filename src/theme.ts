// 主题：所有颜色、字体、雾的远近都在这里，组件不写死色值。
// 主题按实例给：new Strata(host, { theme: { accent: '#ffd27a' } })，没给的项用夜景主题（DARK）的；创建后用 strata.setTheme 换。
// 纯数据，不引入 three：不带渲染的入口（normalize 用色板）也用它。

/** All fields of a theme. */
export interface Theme {
  /** Background colour: the canvas clear colour and the base of the `backdrop` gradient. When `createTheme` gets `background` without `backdrop`, the gradient is derived from it, so a new background is one line. */
  readonly background: string
  /** Palette: groups without a colour take colours from it in order. */
  readonly palette: readonly string[]
  /** The radial backdrop gradient (lighter centre, darker edges), drawn over the clear colour. */
  readonly backdrop: { readonly center: string; readonly mid: string; readonly edge: string }
  /** Fog: far things get darker and blend into the background. Measured behind the camera target: starts at `near`, densest at `far` (world units, follows the camera every frame). */
  readonly fog: { readonly near: number; readonly far: number }
  readonly plate: {
    // 看变化时盘面退成的灰
    readonly neutral: string
    // 平铺在盘边的层名
    readonly caption: string
  }
  readonly label: {
    readonly primary: string
    readonly secondary: string
    readonly halo: string
  }
  // 选中、路径的强调色
  readonly accent: string
  /** Brightness per magnitude 0..5. Nodes are saturated flat dots and the steps are close; importance shows through size and label size. None above 1: glow is kept for what you are asking about (hover, selection, path, changes). */
  readonly magnitude: readonly number[]
  /** Opacity of the soft glow around a node, per magnitude. Very faint. */
  readonly haloAlpha: readonly number[]
  /** Halo size (factor on the node radius), per magnitude. Halos appear only on lit nodes. */
  readonly haloSize: readonly number[]
  /** Dot grid colours: the anchor layer and aligned layers. */
  readonly tone: { readonly primary: string; readonly aligned: string }
  /** How much white is mixed into a node's group colour. */
  readonly starWhite: number
  /** Neutral line colour that relations and mappings lean towards; colour is kept for nodes. */
  readonly line: string
  /** How much of the end nodes' colour relations within a layer take (the rest is neutral). */
  readonly lineTint: number
  /** Colour of nodes without a group (a neutral light blue-grey). */
  readonly ungrouped: string
  /** The scheme given to kgdiff while comparing: the five change colours and the grey of the background follow it. */
  readonly diffScheme: 'dark' | 'light'
  readonly font: string
  readonly mono: string
}

/** Every field optional; arrays (palette, per-magnitude steps) replace as a whole, they are not merged by index. */
export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { -readonly [K in keyof T]?: DeepPartial<T[K]> } : T

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x)
    Object.freeze(v)
  }
  return v
}

/** The dark theme, the default. Frozen: change it with `createTheme`. */
export const DARK: Theme = deepFreeze({
  background: '#070a13',
  palette: ['#58c6ff', '#46d8a8', '#a590ff', '#ecb556', '#ee9772', '#dd94c2', '#78dcec', '#bfe86a', '#8fa8ff', '#e3c08a'],
  backdrop: { center: '#0e1526', mid: '#080b15', edge: '#030408' },
  fog: { near: 12, far: 125 },
  plate: {
    neutral: '#5c6680',
    caption: '#8f9bbd',
  },
  label: {
    primary: '#f2f4f9',
    secondary: '#d5dbe8',
    halo: '#04060a',
  },
  // 冰蓝白光
  accent: '#9fe6ff',
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

/** A new theme from overrides on `DARK` (a copy of `DARK` without them). With `background` and no `backdrop`, the gradient is derived from `background` (`backdropOf`) instead of keeping DARK's. */
export function createTheme(overrides: DeepPartial<Theme> = {}): Theme {
  const theme = merge(DARK, overrides) as Theme
  if (overrides.background === undefined || overrides.backdrop !== undefined) return theme
  return { ...theme, backdrop: backdropOf(theme.background) }
}

/** #rgb / #rrggbb → [r, g, b] 0..255；认不得是 null */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** 往 to 兑 t（0..1），写回 #rrggbb */
function mixRgb(a: [number, number, number], to: number, t: number): string {
  return '#' + a.map((v) => Math.round(v + (to - v) * t).toString(16).padStart(2, '0')).join('')
}

/** Derives a backdrop gradient from a background colour: a little lighter in the centre, darker at the edges (depth, not a glow). Unknown colours (not `#rgb` / `#rrggbb`) give DARK's. */
export function backdropOf(background: string): Theme['backdrop'] {
  const c = parseHex(background)
  if (!c) return { ...DARK.backdrop }
  const dark = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.5
  return { center: mixRgb(c, 255, dark ? 0.04 : 0.5), mid: mixRgb(c, 0, 0), edge: mixRgb(c, 0, dark ? 0.55 : 0.06) }
}

/** Distance between layers in world units. */
export const LAYER_GAP = 20
