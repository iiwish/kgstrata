import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

// 画在盘面上的大字（层名、领域名）：一张字一张贴图，白字，颜色在材质里乘
export function textTexture(text: string, opts: { font: string; px: number; weight?: number; spacing?: number }): { texture: CanvasTexture; aspect: number } {
  const px = opts.px
  const font = `${opts.weight ?? 500} ${px}px ${opts.font}`
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = font
  const spacing = opts.spacing ?? 0
  const chars = [...text]
  const widths = chars.map((ch) => g.measureText(ch).width)
  const w = Math.ceil(widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1) + px * 0.6)
  const h = Math.ceil(px * 1.5)
  c.width = w
  c.height = h
  g.font = font
  g.fillStyle = '#ffffff'
  g.textBaseline = 'middle'
  let x = px * 0.3
  chars.forEach((ch, i) => {
    g.fillText(ch, x, h / 2)
    x += widths[i] + spacing
  })
  const texture = new CanvasTexture(c)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  return { texture, aspect: w / h }
}
