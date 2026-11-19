import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Camera,
  type Texture,
} from 'three'
import { rgb } from '../color.js'
import type { Theme } from '../theme.js'
import type { Fog } from './fog.js'
import type { Looks } from '../types.js'
import { textTexture } from './text.js'

// 盘面：一片均匀的点阵，是这一层的“地面”。同心圆上等距的小方点，一种颜色，铺满整个盘，近大远小。
// 没有边线：最外两圈的点略亮，盘的轮廓是点出来的。离节点近的点略亮、略带一点那个领域的颜色。
// 点阵下面还有一层极淡的领域底色（烘成一张贴图），幅度很低、很宽，只够让颜色成片的地方有一点呼应。
// 涟漪（路径走到哪、哪里变了）画在点上。
const MAX_RIPPLES = 6

export interface PlateInput {
  index: number
  radius: number
  name: string
  count: number
  /** 点阵的颜色，#rrggbb */
  tone: string
  nodes: { x: number; z: number; group: number; weight: number }[]
}

export interface PlatesInput {
  plates: PlateInput[]
  groups: { color: string; name: string; angle: number }[]
  /** 基准层的下标：领域名写在它的盘上 */
  anchor: number
}

interface Plate {
  index: number
  root: Group
  dots: Points
  dotMat: ShaderMaterial
  /** 点阵当前的整体亮度（缓动中） */
  ground: number
  wash: Mesh | null
  washMat: ShaderMaterial | null
  engraving: Mesh
  engraveMat: MeshBasicMaterial
  names: { yaw: Object3D; mat: MeshBasicMaterial; group: number; color: Color }[]
}

const dotVertex = (MAX_GROUPS: number) => /* glsl */ `
  attribute vec3 aDot; // 领域下标、靠近节点的程度、径向位置
  uniform vec3 uGroupColor[${MAX_GROUPS}];
  uniform float uGroupEmph[${MAX_GROUPS}];
  uniform vec3 uTone;
  uniform vec3 uNeutralColor;
  uniform float uNeutral;
  uniform float uLayer;
  uniform float uGround;
  uniform float uShrink;
  uniform float uPixel;
  uniform vec4 uRipple[${MAX_RIPPLES}];
  uniform vec3 uRippleColor[${MAX_RIPPLES}];
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vColor;
  void main() {
    int g = int(aDot.x + 0.5);
    float near = aDot.y;
    vec3 c = uTone;
    float emph = 0.0;
    if (aDot.x > -0.5) {
      // 离节点近的点带一点点那个领域的颜色；悬停这个领域时更明显
      emph = uGroupEmph[g];
      c = mix(uTone, uGroupColor[g], near * (0.28 + 0.55 * emph));
    }
    c = mix(c, uNeutralColor, uNeutral);
    // 最外两圈略亮：盘的轮廓是点出来的
    float rimDots = aDot.z > 0.955 ? 1.45 : 1.0;
    float b = (0.5 + 0.3 * near + 0.5 * emph * near) * (1.0 - 0.2 * aDot.z * aDot.z) * rimDots * mix(0.3, 1.0, uLayer) * mix(0.62, 1.0, uShrink) * smoothstep(0.12, 0.45, uShrink) * uGround;
    c *= b;
    // 涟漪：一圈从那一点往外扩
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRipple[i];
      if (r.w > 0.0) {
        float d = distance(position.xz, r.xy);
        float amp = (1.0 - r.z) * exp(-pow((d - r.z * 10.0) / 0.9, 2.0));
        c += uRippleColor[i] * amp * 1.3 * r.w;
      }
    }
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float fog = 1.0 - smoothstep(uFogNear, uFogFar, -mv.z) * 0.85;
    vColor = c * fog;
    gl_Position = projectionMatrix * mv;
    // 近大远小。盘被缩小时（配角那一层）点也跟着小一点，不然显得密
    gl_PointSize = clamp((1.7 + 0.7 * near) * uPixel * 100.0 / -mv.z, 1.2 * uPixel, 4.6 * uPixel) * mix(0.72, 1.0, uShrink);
  }`

const dotFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // 小方点，边上收一点
    vec2 q = abs(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.3, 0.5, max(q.x, q.y));
    gl_FragColor = vec4(vColor * a, 1.0);
  }`

const washVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`

const washFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uNeutralColor;
  uniform float uNeutral;
  uniform float uLayer;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vec3 c = texture2D(uMap, vUv).rgb;
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(c, uNeutralColor * l, uNeutral);
    // 朝贴图边缘淡出，看不到方形的边
    c *= 1.0 - smoothstep(0.34, 0.5, length(vUv - 0.5));
    float fog = 1.0 - smoothstep(uFogNear, uFogFar, vDepth) * 0.8;
    gl_FragColor = vec4(c * 0.2 * mix(0.2, 1.0, uLayer) * fog, 1.0);
  }`

export class Plates {
  // 显式标注不带泛型的 Group：见 renderer/index.ts 的 scene
  readonly group: Group = new Group()
  private plates: Plate[] = []
  private textures: Texture[] = []
  /** 每份盘面输入建一次：全景 ↔ 变化来回切时直接换，不再重算点阵 */
  private cache = new Map<PlatesInput, { plates: Plate[]; textures: Texture[] }>()
  private pixel = 1
  private readonly tmp = new Vector3()
  /** 看变化时盘面退成的灰：每帧都要，先建好 */
  private readonly grey: Color

  /** theme、fog：渲染器那一份 */
  constructor(
    private theme: Theme,
    private readonly fog: Fog,
  ) {
    this.grey = new Color(theme.plate.neutral)
  }

  /** 换主题：缓存的盘面全部作废（下一次 build 按新主题重建），中性灰换掉 */
  setTheme(theme: Theme) {
    this.dispose()
    this.theme = theme
    this.grey.set(theme.plate.neutral)
  }

  build(input: PlatesInput, pixel: number) {
    this.pixel = pixel
    for (const p of this.plates) this.group.remove(p.root)
    let hit = this.cache.get(input)
    if (!hit) {
      this.textures = []
      const plates = input.plates.map((p) => this.buildPlate(p, input))
      hit = { plates, textures: this.textures }
      this.cache.set(input, hit)
    }
    this.plates = hit.plates
    this.textures = hit.textures
    for (const p of this.plates) {
      this.group.add(p.root)
      p.dotMat.uniforms.uPixel.value = pixel
    }
  }

  setPixel(pixel: number) {
    this.pixel = pixel
    for (const p of this.plates) p.dotMat.uniforms.uPixel.value = pixel
  }

  private buildPlate(p: PlateInput, input: PlatesInput): Plate {
    const root = new Group()
    const R = p.radius
    // 大盘面上点距跟着放大，点数不至于爆炸
    const sp = Math.max(1, R / 40)

    // 最近节点用网格查：几千个节点时逐个比会卡住构建
    const CELL = 6 * sp
    const grid = new Map<string, number[]>()
    p.nodes.forEach((nd, k) => {
      const key = `${Math.floor(nd.x / CELL)},${Math.floor(nd.z / CELL)}`
      const list = grid.get(key)
      if (list) list.push(k)
      else grid.set(key, [k])
    })
    const sigma = 3.3 * sp
    const pos: number[] = []
    const dat: number[] = []
    for (let r = 1.0 * sp; r <= R; r += 1.15 * sp) {
      const n = Math.round((2 * Math.PI * r) / (1.05 * sp))
      const off = (r * 7.31) % 1
      for (let i = 0; i < n; i++) {
        const a = ((i + off) / n) * Math.PI * 2
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        let best = Infinity
        let bestG = -1
        const cx = Math.floor(x / CELL)
        const cz = Math.floor(z / CELL)
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gz = cz - 1; gz <= cz + 1; gz++) {
            const list = grid.get(`${gx},${gz}`)
            if (!list) continue
            for (const k of list) {
              const nd = p.nodes[k]
              const d = Math.hypot(nd.x - x, nd.z - z)
              if (d < best) {
                best = d
                bestG = nd.group
              }
            }
          }
        }
        const near = best < Infinity ? Math.exp(-(best * best) / (2 * sigma * sigma)) : 0
        pos.push(x, 0, z)
        dat.push(bestG, near, r / R)
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geo.setAttribute('aDot', new Float32BufferAttribute(dat, 3))
    // 领域数不设上限：着色器里的数组按领域数生成
    const MAX_GROUPS = Math.max(1, input.groups.length)
    const dotMat = new ShaderMaterial({
      uniforms: {
        uGroupColor: { value: Array.from({ length: MAX_GROUPS }, (_, i) => new Color(input.groups[i]?.color ?? p.tone)) },
        uGroupEmph: { value: new Array(MAX_GROUPS).fill(0) },
        uTone: { value: new Color(p.tone) },
        uNeutralColor: { value: new Color(this.theme.plate.neutral) },
        uNeutral: { value: 0 },
        uLayer: { value: 1 },
        uGround: { value: 1 },
        uShrink: { value: 1 },
        uPixel: { value: this.pixel },
        uRipple: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()) },
        uRippleColor: { value: Array.from({ length: MAX_RIPPLES }, () => new Color()) },
        uFogNear: this.fog.uFogNear,
        uFogFar: this.fog.uFogFar,
      },
      vertexShader: dotVertex(MAX_GROUPS),
      fragmentShader: dotFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const dots = new Points(geo, dotMat)
    dots.frustumCulled = false
    dots.renderOrder = -1
    root.add(dots)

    const wash = p.nodes.length > 0 ? this.buildWash(p, input) : null
    if (wash) root.add(wash.mesh)

    // 层名：平铺在盘的前左侧，顺着弧排
    const { texture, aspect } = textTexture(`${p.name}  ·  ${p.count}`, { font: this.theme.font, px: 64, weight: 400, spacing: 14 })
    this.textures.push(texture)
    const h = 1.35 * sp
    const r0 = R + 1.5 * sp
    const span = (h * aspect) / r0
    const thc = Math.PI * 0.64
    const strip = arcStrip(r0, r0 + h, thc + span / 2, thc - span / 2, 48)
    const engraveMat = new MeshBasicMaterial({ map: texture, color: this.theme.plate.caption, transparent: true, opacity: 0.5, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })
    const engraving = new Mesh(strip, engraveMat)
    root.add(engraving)

    // 主图层：领域名平铺在疆域外缘，像地图上的地名
    const names: Plate['names'] = []
    if (p.index === input.anchor) {
      input.groups.forEach((g, gi) => {
        if (!p.nodes.some((n) => n.group === gi)) return
        const t = textTexture(g.name, { font: this.theme.font, px: 72, weight: 400, spacing: 26 })
        this.textures.push(t.texture)
        const hh = 1.55 * sp
        const mat = new MeshBasicMaterial({ map: t.texture, color: g.color, transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })
        const plane = new Mesh(new PlaneGeometry(hh * t.aspect, hh), mat)
        plane.rotation.x = -Math.PI / 2
        const yaw = new Object3D()
        const rr = R * 0.9
        yaw.position.set(Math.cos(g.angle) * rr, 0.02, Math.sin(g.angle) * rr)
        yaw.add(plane)
        root.add(yaw)
        names.push({ yaw, mat, group: gi, color: new Color(g.color).lerp(new Color('#ffffff'), 0.2) })
      })
    }
    return { index: p.index, root, dots, dotMat, ground: 1, wash: wash?.mesh ?? null, washMat: wash?.mat ?? null, engraving, engraveMat, names }
  }

  /** 领域底色：每个节点一团很宽的柔光，按领域着色，叠加着画进一张贴图 */
  private buildWash(p: PlateInput, input: PlatesInput): { mesh: Mesh; mat: ShaderMaterial } {
    const S = 512
    // 贴图比盘大出一圈：光团的边缘落在贴图里面
    const half = p.radius * 1.45
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, S, S)
    ctx.globalCompositeOperation = 'lighter'
    const toPx = (v: number) => ((v + half) / (2 * half)) * S
    // 光团的大小不跟盘面放大：节点多了盘面也大了，单位面积上的节点数差不多。再按实际密度把浓度校一下
    const density = p.nodes.length / (Math.PI * p.radius * p.radius)
    const alpha = 0.11 * Math.min(1.2, Math.max(0.18, 0.0155 / Math.max(density, 1e-6)))
    for (const n of p.nodes) {
      if (n.group < 0) continue
      const hex = new Color(input.groups[n.group]?.color ?? p.tone).getHexString()
      const rgba = (a: number) => `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${a})`
      const px = toPx(n.x)
      const py = toPx(n.z)
      const rr = ((11 * (0.8 + 0.5 * n.weight)) / (2 * half)) * S
      const grad = ctx.createRadialGradient(px, py, 0, px, py, rr)
      // 近似高斯的几级
      grad.addColorStop(0, rgba(alpha))
      grad.addColorStop(0.25, rgba(alpha * 0.66))
      grad.addColorStop(0.5, rgba(alpha * 0.26))
      grad.addColorStop(0.75, rgba(alpha * 0.06))
      grad.addColorStop(1, rgba(0))
      ctx.fillStyle = grad
      ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2)
    }
    const texture = new CanvasTexture(canvas)
    // 当线性数据用：按 sRGB 解码的话，淡的地方会被压到看不见
    texture.colorSpace = NoColorSpace
    texture.minFilter = LinearFilter
    texture.generateMipmaps = false
    this.textures.push(texture)
    const mat = new ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uNeutralColor: { value: new Color(this.theme.plate.neutral) },
        uNeutral: { value: 0 },
        uLayer: { value: 1 },
        uFogNear: this.fog.uFogNear,
        uFogFar: this.fog.uFogFar,
      },
      vertexShader: washVertex,
      fragmentShader: washFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    const mesh = new Mesh(new PlaneGeometry(half * 2, half * 2), mat)
    // 平面躺下后 +y 朝 -z，贴图的 v 又是从下往上：两次反向正好和画布的 z 对上
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = -0.04
    mesh.frustumCulled = false
    mesh.renderOrder = -2
    return { mesh, mat }
  }

  /** 上下文丢了又还回来：缓存里所有的画布贴图标成要重新上传 */
  touch() {
    for (const { textures } of this.cache.values()) for (const t of textures) t.needsUpdate = true
  }

  /** 每层的高度和缩放（配角那一层缩小） */
  setPose(heights: number[], scales: number[]) {
    for (const p of this.plates) {
      const s = scales[p.index] ?? 1
      p.root.position.y = heights[p.index] ?? 0
      p.root.scale.set(s, 1, s)
      p.dotMat.uniforms.uShrink.value = s
    }
  }

  update(looks: Looks, camera: Camera) {
    const neutral = looks.neutral
    const grey = this.grey
    // 平铺的领域名统一朝镜头的前方转：斜看时正着读，俯视时都朝上
    camera.getWorldDirection(this.tmp)
    const yaw = Math.atan2(-this.tmp.x, -this.tmp.z)
    // 平铺在盘面上的字斜着看是压扁的、认不出来：只在从上往下看的时候显出来
    const above = Math.min(1, Math.max(0, (-this.tmp.y - 0.62) / 0.25))
    for (const p of this.plates) {
      const u = p.dotMat.uniforms
      u.uNeutral.value = neutral
      // 隐藏的层：整个盘淡出，淡完就不画了
      const here = looks.presence?.[p.index] ?? 1
      p.root.visible = here > 0.005
      const lay = (looks.layers[p.index] ?? 1) * here
      // 点阵的亮度缓一缓再跟上，不闪
      p.ground += ((looks.ground ?? 1) - p.ground) * 0.12
      u.uLayer.value = looks.layers[p.index] ?? 1
      u.uGround.value = p.ground * here
      const emph = u.uGroupEmph.value as number[]
      for (let i = 0; i < emph.length; i++) emph[i] = looks.groups[i] ?? 0
      const rip = u.uRipple.value as Vector4[]
      const ripC = u.uRippleColor.value as Color[]
      let k = 0
      for (const r of looks.ripples) {
        if (r.layer !== p.index || k >= MAX_RIPPLES) continue
        rip[k].x = r.x
        rip[k].y = r.z
        rip[k].z = r.p
        rip[k].w = 1
        const c = rgb(r.color)
        ripC[k].setRGB(c[0], c[1], c[2])
        k++
      }
      for (; k < MAX_RIPPLES; k++) rip[k].w = 0
      if (p.washMat) {
        p.washMat.uniforms.uNeutral.value = neutral
        p.washMat.uniforms.uLayer.value = (looks.layers[p.index] ?? 1) * here * here
      }
      // 层名只在这层有分量时显出来，聚焦别的层时压得几乎看不见
      p.engraveMat.opacity = 0.5 * Math.pow(lay, 1.5) * above
      for (const n of p.names) {
        n.yaw.rotation.y = yaw
        const e = looks.groups[n.group] ?? 0
        n.mat.opacity = (0.3 + 0.5 * e) * (1 - neutral * 0.55) * lay * above
        n.mat.color.copy(n.color).lerp(grey, neutral)
      }
    }
  }

  dispose() {
    for (const { plates, textures } of this.cache.values()) {
      for (const p of plates) {
        p.dots.geometry.dispose()
        p.dotMat.dispose()
        p.wash?.geometry.dispose()
        p.washMat?.dispose()
        p.engraving.geometry.dispose()
        p.engraveMat.dispose()
        for (const n of p.names) {
          ;(n.yaw.children[0] as Mesh).geometry.dispose()
          n.mat.dispose()
        }
        this.group.remove(p.root)
      }
      for (const t of textures) t.dispose()
    }
    this.cache.clear()
    this.plates = []
    this.textures = []
  }
}

// 沿圆弧的一条带子：u 从 th0 到 th1，v 从内圈到外圈（字的上方朝盘心）
function arcStrip(r0: number, r1: number, th0: number, th1: number, n: number): BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = th0 + (th1 - th0) * t
    pos.push(Math.cos(a) * r0, 0.02, Math.sin(a) * r0, Math.cos(a) * r1, 0.02, Math.sin(a) * r1)
    uv.push(t, 1, t, 0)
    if (i < n) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}
