import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three'
import { rgb } from '../color.js'
import type { Fog } from './fog.js'
import type { EdgeLook } from '../types.js'

// 边：实例化的带子。弧线在顶点着色器里按二次贝塞尔算，宽度按屏幕像素；
// 彗星、虚线、长出 / 收回都在着色器里做，全部边一次绘制
const SEGMENTS = 24

const vertex = /* glsl */ `
  attribute vec2 aT;            // t、哪一侧
  attribute vec3 iA;
  attribute vec3 iB;
  attribute vec3 iColorA;
  attribute vec3 iColorB;
  attribute vec4 iStyle;        // 透明度、宽度(px)、虚线、亮度
  attribute vec4 iFlow;         // 进度、从终点算、彗星强度、相位
  attribute float iArc;
  uniform vec2 uResolution;
  varying float vT;
  varying float vSide;
  varying vec3 vColor;
  varying vec4 vStyle;
  varying vec4 vFlow;
  varying float vLen;
  varying float vDepth;
  vec3 bez(float t, vec3 a, vec3 m, vec3 b) {
    float u = 1.0 - t;
    return u * u * a + 2.0 * u * t * m + t * t * b;
  }
  void main() {
    float t = aT.x;
    vec3 mid = (iA + iB) * 0.5 + vec3(0.0, iArc, 0.0);
    vec3 p = bez(t, iA, mid, iB);
    vec3 q = bez(min(t + 0.01, 1.0), iA, mid, iB);
    vec3 q0 = bez(max(t - 0.01, 0.0), iA, mid, iB);
    vec4 cp = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vec4 cq = projectionMatrix * viewMatrix * vec4(q, 1.0);
    vec4 c0 = projectionMatrix * viewMatrix * vec4(q0, 1.0);
    vec2 sp = cp.xy / cp.w * uResolution;
    vec2 dir = normalize((cq.xy / cq.w - c0.xy / c0.w) * uResolution + vec2(1e-6));
    vec2 nrm = vec2(-dir.y, dir.x);
    float w = iStyle.y + 1.0; // 多留 1px 做抗锯齿：芯是 iStyle.y 宽，两边各半个像素的过渡
    cp.xy += nrm * aT.y * w / uResolution * cp.w;
    gl_Position = cp;
    vT = t;
    vSide = aT.y;
    vColor = mix(iColorA, iColorB, t);
    vStyle = iStyle;
    vFlow = iFlow;
    vLen = distance(iA, iB) + abs(iArc);
    vDepth = cp.w;
  }`

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vT;
  varying float vSide;
  varying vec3 vColor;
  varying vec4 vStyle;
  varying vec4 vFlow;
  varying float vLen;
  varying float vDepth;
  void main() {
    float prog = vFlow.x;
    float t = vFlow.y > 0.5 ? 1.0 - vT : vT;
    if (t > prog) discard;
    if (vStyle.z > 0.5 && fract(vT * vLen / 0.7) > 0.55) discard;
    // 芯占 width / (width + 1)，外面半个像素过渡到 0：细线就是细线，不会被过渡带撑粗
    float core = vStyle.y / (vStyle.y + 1.0);
    float edge = 1.0 - smoothstep(core, 1.0, abs(vSide));
    float a = vStyle.x * edge;
    vec3 c = vColor * vStyle.w;
    // 彗星：大部分时间不在边上，所以是“偶尔滑过一颗”；头亮、尾巴拖在后面
    if (vFlow.z > 0.0) {
      float period = 6.0 + fract(vFlow.w * 7.3) * 5.0;
      float head = fract(uTime / period + vFlow.w) * 3.0 - 1.0;
      float d = vT - head;
      float k = d > 0.0 ? exp(-d * d / 0.0006) : exp(d / 0.09) * 0.75;
      k *= vFlow.z;
      c += mix(vColor, vec3(1.0), 0.55) * k * 2.4;
      a = max(a, k * edge);
    }
    // 长到一半时，笔尖亮一点
    if (prog < 0.999) {
      float tip = exp(-pow((t - prog) / 0.025, 2.0));
      c += mix(vColor, vec3(1.0), 0.6) * tip * 2.0;
      a = max(a, tip * edge);
    }
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(c * a * (1.0 - fog * 0.75), 1.0);
  }`

export class Edges {
  readonly mesh: Mesh
  private geo: InstancedBufferGeometry
  private a: InstancedBufferAttribute
  private b: InstancedBufferAttribute
  private ca: InstancedBufferAttribute
  private cb: InstancedBufferAttribute
  private style: InstancedBufferAttribute
  private flow: InstancedBufferAttribute
  private arc: InstancedBufferAttribute
  private capacity = 0
  readonly material: ShaderMaterial

  /** fog：渲染器那一份雾，材质直接挂它的 uniform */
  constructor(fog: Fog) {
    this.geo = new InstancedBufferGeometry()
    const ts: number[] = []
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS
      ts.push(t, -1, t, 1)
      pos.push(0, 0, 0, 0, 0, 0)
      if (i < SEGMENTS) {
        const k = i * 2
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
      }
    }
    this.geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    this.geo.setAttribute('aT', new Float32BufferAttribute(ts, 2))
    this.geo.setIndex(idx)
    this.material = new ShaderMaterial({
      uniforms: {
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uFogNear: fog.uFogNear,
        uFogFar: fog.uFogFar,
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // 带子在屏幕空间里展开，绕向随方向变，两面都画
      side: DoubleSide,
    })
    this.a = this.b = this.ca = this.cb = this.style = this.flow = this.arc = undefined as never
    this.ensure(256)
    this.mesh = new Mesh(this.geo as unknown as BufferGeometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  private ensure(n: number) {
    if (n <= this.capacity) return
    const cap = Math.max(n, this.capacity * 2)
    // 换实例缓冲之前让渲染器放掉旧的 GL 缓冲（替换属性不会自动释放）
    if (this.capacity > 0) this.geo.dispose()
    const mk = (size: number) => new InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(DynamicDrawUsage)
    this.a = mk(3)
    this.b = mk(3)
    this.ca = mk(3)
    this.cb = mk(3)
    this.style = mk(4)
    this.flow = mk(4)
    this.arc = mk(1)
    this.geo.setAttribute('iA', this.a)
    this.geo.setAttribute('iB', this.b)
    this.geo.setAttribute('iColorA', this.ca)
    this.geo.setAttribute('iColorB', this.cb)
    this.geo.setAttribute('iStyle', this.style)
    this.geo.setAttribute('iFlow', this.flow)
    this.geo.setAttribute('iArc', this.arc)
    this.capacity = cap
  }

  setResolution(w: number, h: number) {
    ;(this.material.uniforms.uResolution.value as Vector2).set(w, h)
  }

  /** ends：每条边两端的世界坐标（6 个数），由渲染器按层高和抬升算好 */
  update(looks: EdgeLook[], ends: Float32Array, time: number) {
    this.ensure(looks.length)
    let k = 0
    for (let i = 0; i < looks.length; i++) {
      const l = looks[i]
      if (!l.visible || l.alpha <= 0.003) continue
      this.a.setXYZ(k, ends[i * 6], ends[i * 6 + 1], ends[i * 6 + 2])
      this.b.setXYZ(k, ends[i * 6 + 3], ends[i * 6 + 4], ends[i * 6 + 5])
      const ca = rgb(l.colorA)
      const cb = rgb(l.colorB)
      this.ca.setXYZ(k, ca[0], ca[1], ca[2])
      this.cb.setXYZ(k, cb[0], cb[1], cb[2])
      this.style.setXYZW(k, l.alpha, l.width, l.dash ? 1 : 0, l.intensity)
      this.flow.setXYZW(k, l.progress, l.fromTarget ? 1 : 0, l.flow, l.phase)
      this.arc.setX(k, l.arc)
      k++
    }
    this.geo.instanceCount = k
    for (const attr of [this.a, this.b, this.ca, this.cb, this.style, this.flow, this.arc]) attr.needsUpdate = true
    this.material.uniforms.uTime.value = time
  }

  dispose() {
    this.geo.dispose()
    this.material.dispose()
  }
}
