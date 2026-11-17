import { type BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial } from 'three'
import { rgb } from '../color.js'
import type { Fog } from './fog.js'
import type { BaseNode, NodeLook, NodeShape } from '../types.js'

// 节点：面向镜头的光点。形状在片元里按距离场画（圆、菱形、六边形、扁板、四芒星），
// 一颗发柔光的珠子：芯略亮；外面一小圈淡淡的晕由标记层画。全部节点一次绘制，按透明度盖在线和星云上面。
const SHAPE: Record<NodeShape, number> = { bead: 0, octa: 1, prism: 2, tablet: 3, page: 4 }

/** 星等 → 光点半径相对节点半径的比例：越暗的越小 */
const SIZE = [0.7, 0.72, 0.75, 0.79, 0.83, 0.86]
/** 节点画出来的半径（世界单位）：标签、外环、光晕都按它来定位，不然会压在色点上 */
export function drawnRadius(n: BaseNode): number {
  return n.r * SIZE[n.mag]
}

/** 配角那一层缩小时，节点跟着小，但小得慢一点：缩得和盘一样多就看不清了 */
export function shrink(layerScale: number): number {
  return Math.pow(layerScale, 0.7)
}

/** 四边形要盖住最宽的形状和边缘的一点余晖 */
const EXTENT = 1.75
/** 再小也留这么多像素，远处的节点不至于闪没 */
const MIN_PX = 1.0

const vertex = /* glsl */ `
  attribute vec3 iCenter;
  attribute vec3 iColor;
  attribute vec4 iParams; // 亮度、透明度、幽灵、形状
  attribute float iSize;  // 光点半径（世界单位）
  uniform float uViewHeight;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vParams;
  varying float vDepth;
  void main() {
    vec4 mv = viewMatrix * vec4(iCenter, 1.0);
    vDepth = -mv.z;
    float px = iSize * projectionMatrix[1][1] / max(vDepth, 0.001) * uViewHeight * 0.5;
    float k = iSize > 0.0 ? max(1.0, ${MIN_PX.toFixed(1)} / max(px, 1e-4)) : 0.0;
    mv.xy += position.xy * iSize * k * ${EXTENT.toFixed(2)};
    vUv = position.xy * ${EXTENT.toFixed(2)};
    vColor = iColor;
    vParams = iParams;
    gl_Position = projectionMatrix * mv;
  }`

const fragment = /* glsl */ `
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vParams;
  varying float vDepth;
  void main() {
    vec2 p = vUv;
    vec2 q = abs(p);
    int shape = int(vParams.w + 0.5);
    float d;
    if (shape == 0) d = length(p) - 1.0;
    else if (shape == 1) d = (q.x + q.y) * 0.7071 - 0.88;
    else if (shape == 2) d = max(q.x * 0.866025 + q.y * 0.5, q.y) - 0.94;
    else if (shape == 3) {
      vec2 b = q - vec2(1.22, 0.62);
      d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - 0.1;
    } else d = pow(pow(q.x, 0.62) + pow(q.y, 0.62), 1.0 / 0.62) - 1.5;
    float aa = max(fwidth(d), 1e-4);
    float core = 1.0 - smoothstep(-aa, aa, d);
    float hot = exp(-dot(p, p) * 1.5);
    // 一颗珠子：芯略亮，边上留一圈很窄的柔边。被点亮（亮度超过 1）时芯才发白
    vec3 c = mix(vColor, vec3(1.0), 0.1 + 0.16 * hot + 0.3 * hot * clamp(vParams.x - 0.95, 0.0, 1.0)) * vParams.x;
    float rim = exp(-max(d, 0.0) * 6.0) * 0.26 * (1.0 - core);
    float a = (core + rim) * vParams.y;
    if (shape == 3) {
      // 扁板（表）：暗底亮边，像一块标牌，和发光的圆点一眼分得开
      float border = 1.0 - smoothstep(aa, aa * 2.0 + 0.07, abs(d + 0.14));
      c = vColor * vParams.x * (0.2 + 0.72 * border);
      a = max(core * 0.92, rim) * vParams.y;
    }
    if (vParams.z > 0.5) {
      // 幽灵：只剩一圈细边（虚线圈由标记层画）
      c = mix(vColor, vec3(1.0), 0.2);
      a = (1.0 - smoothstep(0.0, aa * 1.5 + 0.05, abs(d + 0.08))) * 0.45 * vParams.y;
    }
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    // 不用叠加混合：几千个节点挤在一起时前面的盖住后面的，不会加成一片白
    gl_FragColor = vec4(c * (1.0 - fog * 0.8), a);
  }`

export class Nodes {
  readonly mesh: Mesh
  private center: InstancedBufferAttribute
  private color: InstancedBufferAttribute
  private params: InstancedBufferAttribute
  private size: InstancedBufferAttribute
  private capacity = 0
  private material: ShaderMaterial
  private geo = new InstancedBufferGeometry()

  /** fog：渲染器那一份雾，材质直接挂它的 uniform */
  constructor(fog: Fog) {
    this.material = new ShaderMaterial({
      uniforms: { uViewHeight: { value: 1 }, uFogNear: fog.uFogNear, uFogFar: fog.uFogFar },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
    })
    const quad = new PlaneGeometry(2, 2)
    this.geo.setAttribute('position', quad.getAttribute('position'))
    this.geo.setIndex(quad.getIndex())
    this.center = this.color = this.params = this.size = undefined as never
    this.mesh = new Mesh(this.geo as unknown as BufferGeometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.ensure(256)
  }

  private ensure(n: number) {
    if (n <= this.capacity) return
    const cap = Math.max(n, this.capacity * 2)
    // 换实例缓冲之前让渲染器放掉旧的 GL 缓冲
    if (this.capacity > 0) this.geo.dispose()
    const mk = (size: number) => new InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(DynamicDrawUsage)
    this.center = mk(3)
    this.color = mk(3)
    this.params = mk(4)
    this.size = mk(1)
    this.geo.setAttribute('iCenter', this.center)
    this.geo.setAttribute('iColor', this.color)
    this.geo.setAttribute('iParams', this.params)
    this.geo.setAttribute('iSize', this.size)
    this.capacity = cap
  }

  build(base: BaseNode[]) {
    this.ensure(base.length)
    this.geo.instanceCount = base.length
  }

  /** world：节点的世界坐标（由渲染器按层高算好），每个节点 3 个数；viewHeight：画布高（CSS 像素） */
  update(base: BaseNode[], looks: NodeLook[], world: Float32Array, viewHeight: number, layerScales: number[]) {
    this.material.uniforms.uViewHeight.value = viewHeight
    for (let i = 0; i < base.length; i++) {
      const n = base[i]
      const l = looks[i]
      const on = !!l && l.visible
      this.center.setXYZ(i, world[i * 3], world[i * 3 + 1], world[i * 3 + 2])
      this.size.setX(i, on ? n.r * Math.max(l.scale, 0) * SIZE[n.mag] * shrink(layerScales[l.layer] ?? 1) : 0)
      if (!l) continue
      const c = rgb(l.color)
      this.color.setXYZ(i, c[0], c[1], c[2])
      this.params.setXYZW(i, l.intensity, l.alpha, l.ghost ? 1 : 0, SHAPE[n.shape])
    }
    this.center.needsUpdate = true
    this.color.needsUpdate = true
    this.params.needsUpdate = true
    this.size.needsUpdate = true
  }

  dispose() {
    this.geo.dispose()
    this.material.dispose()
  }
}
