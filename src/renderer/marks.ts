import { AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, ShaderMaterial } from 'three'
import { rgb } from '../color.js'
import type { Fog } from './fog.js'

// 面向镜头的标记：光晕、外环、幽灵虚线圈、外扩的脉冲。一个实例化网格画完
export const MARK = { halo: 0, ring: 1, ghost: 2, pulse: 3 } as const

const vertex = /* glsl */ `
  attribute vec3 iCenter;
  attribute vec3 iColor;
  attribute vec4 iMark; // 尺寸（世界单位）、透明度、种类、参数
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vMark;
  varying float vDepth;
  void main() {
    vec4 mv = viewMatrix * vec4(iCenter, 1.0);
    mv.xy += position.xy * iMark.x;
    vDepth = -mv.z;
    vUv = position.xy * 2.0;
    vColor = iColor;
    vMark = iMark;
    gl_Position = projectionMatrix * mv;
  }`

const fragment = /* glsl */ `
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vMark;
  varying float vDepth;
  void main() {
    float d = length(vUv);
    float a = 0.0;
    int kind = int(vMark.z + 0.5);
    if (kind == 0) {
      a = exp(-d * d * 5.5) * 0.9 + exp(-d * d * 22.0) * 0.4;
    } else if (kind == 1) {
      a = (1.0 - smoothstep(0.0, 0.06, abs(d - 0.78)));
    } else if (kind == 2) {
      float ang = atan(vUv.y, vUv.x);
      float dash = step(0.45, fract(ang / 6.2831853 * 14.0));
      a = (1.0 - smoothstep(0.0, 0.07, abs(d - 0.74))) * dash;
    } else {
      float r = 0.25 + vMark.w * 0.75;
      a = (1.0 - smoothstep(0.0, 0.06, abs(d - r))) * (1.0 - vMark.w);
    }
    if (d > 1.0) discard;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(vColor * a * vMark.y * (1.0 - fog * 0.7), 1.0);
  }`

export class Marks {
  readonly mesh: InstancedMesh
  private center: InstancedBufferAttribute
  private color: InstancedBufferAttribute
  private mark: InstancedBufferAttribute
  private n = 0

  /** fog：渲染器那一份雾，材质直接挂它的 uniform */
  constructor(
    fog: Fog,
    readonly capacity = 4096,
  ) {
    const geo = new PlaneGeometry(1, 1)
    this.center = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage)
    this.color = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage)
    this.mark = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage)
    geo.setAttribute('iCenter', this.center)
    geo.setAttribute('iColor', this.color)
    geo.setAttribute('iMark', this.mark)
    const mat = new ShaderMaterial({
      uniforms: { uFogNear: fog.uFogNear, uFogFar: fog.uFogFar },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.mesh = new InstancedMesh(geo, mat, capacity)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.renderOrder = 2
  }

  begin() {
    this.n = 0
  }

  push(x: number, y: number, z: number, size: number, color: string, alpha: number, kind: number, param = 0) {
    if (this.n >= this.capacity || alpha <= 0.002 || size <= 0) return
    const k = this.n++
    const c = rgb(color)
    this.center.setXYZ(k, x, y, z)
    this.color.setXYZ(k, c[0], c[1], c[2])
    this.mark.setXYZW(k, size, alpha, kind, param)
  }

  end() {
    this.mesh.count = this.n
    this.center.needsUpdate = true
    this.color.needsUpdate = true
    this.mark.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
  }
}
