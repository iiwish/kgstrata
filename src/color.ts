import { Color } from 'three'

// 每帧要把几百个十六进制色换成线性 RGB：缓存起来，不在热路径上分配
const cache = new Map<string, [number, number, number]>()
const tmp = new Color()

export function rgb(hex: string): [number, number, number] {
  let v = cache.get(hex)
  if (!v) {
    tmp.set(hex)
    v = [tmp.r, tmp.g, tmp.b]
    cache.set(hex, v)
  }
  return v
}

export function mixHex(a: string, b: string, t: number): string {
  return '#' + new Color(a).lerp(new Color(b), t).getHexString()
}

/** 降饱和：t = 1 时完全变灰（保持亮度） */
export function desaturate(hex: string, t: number): string {
  const c = new Color(hex)
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  c.r += (l - c.r) * t
  c.g += (l - c.g) * t
  c.b += (l - c.b) * t
  return '#' + c.getHexString()
}
