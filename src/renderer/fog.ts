// 雾按镜头到目标的距离算（每帧更新）。一个渲染器一份：它的所有材质共用这两个 uniform（同一个对象），
// 拉远看全景时不会整片被雾吃掉。不放在模块里：一页上两个实例各管各的雾。
// 不引入 three：只是 uniform 的形状，单独可测。

export interface Fog {
  readonly uFogNear: { value: number }
  readonly uFogFar: { value: number }
}

/** 新的一份雾，初值是主题里的远近 */
export function createFog(near: number, far: number): Fog {
  return { uFogNear: { value: near }, uFogFar: { value: far } }
}

/** 按镜头到目标的距离摆雾：目标前面一点开始，往后一段全进雾里 */
export function placeFog(fog: Fog, focusDist: number) {
  fog.uFogNear.value = focusDist + 12
  fog.uFogFar.value = focusDist + 125
}
