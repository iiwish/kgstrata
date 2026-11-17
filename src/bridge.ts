// 穿透：隐藏了中间的层以后，被它隔开的两层之间的关系。
//
// 例：指标 → 本体 → 表，隐藏本体层。指标和表之间本来没有直接的线，全靠本体中转；
// 把“指标到本体”和“本体到表”接起来，就是“这个指标最终落在哪些表上”。
//
// 规则：
// - 只接跨层的线（映射），不走隐藏层里层内的关系——那是另一回事（“相关的概念”），接进来就不是映射了。
// - 一路往下走：从上面的可见层出发，经过的隐藏节点一层比一层靠下，直到落在下面的可见层上。
//   这样不会绕回同一层（两个指标都落在同一个本体上，不算它们之间有关系）。
// - 连着隐藏好几层也能接：一层一层往下传。
// - 同一对节点之间有几条路，分量就是几（经过了几个中间节点）。

export interface Bridge {
  /** 上面那层的节点下标 */
  s: number
  /** 下面那层的节点下标 */
  t: number
  /** 有几条路（经过几个不同的中间节点串起来） */
  weight: number
}

/**
 * layerOf：每个节点在哪一层；cross：跨层的线（两端的节点下标，方向不论）；hidden：哪些层被隐藏了。
 * 返回被隐藏层隔开的可见节点之间的穿透关系，按 (s, t) 排好序。
 */
export function bridgesOf(layerOf: number[], cross: [number, number][], hidden: ReadonlySet<number>): Bridge[] {
  if (hidden.size === 0) return []
  // 每个节点往下（层号更大）连着谁
  const down: number[][] = layerOf.map(() => [])
  for (const [a, b] of cross) {
    const la = layerOf[a]
    const lb = layerOf[b]
    if (la === undefined || lb === undefined || la === lb) continue
    if (la < lb) down[a].push(b)
    else down[b].push(a)
  }
  // 隐藏节点往下最终落到哪些可见节点上、各有几条路。记下来，同一个隐藏节点只算一次
  const memo = new Map<number, Map<number, number>>()
  const reach = (h: number): Map<number, number> => {
    const hit = memo.get(h)
    if (hit) return hit
    const out = new Map<number, number>()
    memo.set(h, out)
    for (const n of down[h]) {
      if (hidden.has(layerOf[n])) for (const [t, c] of reach(n)) out.set(t, (out.get(t) ?? 0) + c)
      else out.set(n, (out.get(n) ?? 0) + 1)
    }
    return out
  }
  const bridges: Bridge[] = []
  for (let s = 0; s < layerOf.length; s++) {
    if (hidden.has(layerOf[s])) continue
    const total = new Map<number, number>()
    for (const n of down[s]) {
      if (!hidden.has(layerOf[n])) continue
      for (const [t, c] of reach(n)) total.set(t, (total.get(t) ?? 0) + c)
    }
    for (const [t, weight] of [...total].sort((a, b) => a[0] - b[0])) bridges.push({ s, t, weight })
  }
  return bridges
}
