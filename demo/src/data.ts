// 效果页的演示数据：一家网上商城。两张图加一个映射：上层是本体（顾客、商品、订单、支付、物流、库存、营销、售后 8 个领域），
// 下层是物理表（表之间是外键），中间是本体落在哪些表上。另有指标、看板两层，两版对比，几条查询路径和压力数据。
// 都是为演示编的，用大家都熟悉的电商概念。中英文两版：id 一样，只有给人看的字不同。

import type { GroupSpec, NodeSpec, RelationSpec, StrataData } from 'kgstrata'

/** 演示数据的语言 */
export type DemoLang = 'zh' | 'en'

/** 给人看的字：[中文, 英文] */
type Text = readonly [zh: string, en: string]
const say = (t: Text, lang: DemoLang) => (lang === 'zh' ? t[0] : t[1])

// 关系的类型是机器读的，两版一样；显示的字在 label 上
const REL: Record<string, Text> = {
  'maps-to': ['落地', 'maps to'],
  fk: ['外键', 'foreign key'],
  derives: ['派生', 'derives'],
  measures: ['口径', 'measures'],
  reads: ['取数', 'reads'],
}
const rel = (type: keyof typeof REL, lang: DemoLang) => ({ type, label: say(REL[type], lang) })

// ─── 领域 ────────────────────────────────────────────────────────────────────

const DOMAINS: { id: string; name: Text; color: string }[] = [
  { id: 'customer', name: ['顾客', 'Customers'], color: '#58c6ff' },
  { id: 'catalog', name: ['商品', 'Catalog'], color: '#46d8a8' },
  { id: 'order', name: ['订单', 'Orders'], color: '#a590ff' },
  { id: 'payment', name: ['支付', 'Payments'], color: '#ecb556' },
  { id: 'shipping', name: ['物流', 'Shipping'], color: '#ee9772' },
  { id: 'inventory', name: ['库存', 'Inventory'], color: '#dd94c2' },
  { id: 'marketing', name: ['营销', 'Marketing'], color: '#78dcec' },
  { id: 'service', name: ['售后', 'After-sales'], color: '#bfe86a' },
]

export function groups(lang: DemoLang = 'zh'): GroupSpec[] {
  return DOMAINS.map((d) => ({ id: d.id, name: say(d.name, lang), color: d.color }))
}
export const GROUPS: GroupSpec[] = groups('zh')

const LAYER_NAMES: Record<string, Text> = {
  board: ['看板', 'Dashboards'],
  metric: ['指标', 'Metrics'],
  onto: ['本体', 'Ontology'],
  table: ['物理表', 'Tables'],
}
const layerSpec = (id: string, lang: DemoLang) => ({ id, name: say(LAYER_NAMES[id], lang) })

// ─── 本体 ────────────────────────────────────────────────────────────────────

// [id, 名字, 领域, 是不是关系本体]。关系本体是把两个实体连起来的那种：收藏连着顾客和商品，订单明细连着订单和 SKU……
const CONCEPTS: [string, Text, string, boolean?][] = [
  ['customer', ['顾客', 'Customer'], 'customer'],
  ['member', ['会员', 'Member'], 'customer'],
  ['address', ['收货地址', 'Address'], 'customer'],
  ['membership_tier', ['会员等级', 'Membership tier'], 'customer'],
  ['favorite', ['收藏', 'Favorite'], 'customer', true],
  ['product', ['商品', 'Product'], 'catalog'],
  ['sku', ['SKU', 'SKU'], 'catalog'],
  ['category', ['类目', 'Category'], 'catalog'],
  ['brand', ['品牌', 'Brand'], 'catalog'],
  ['seller', ['店铺', 'Store'], 'catalog'],
  ['order', ['订单', 'Order'], 'order'],
  ['order_line', ['订单明细', 'Order line'], 'order', true],
  ['cart', ['购物车', 'Cart'], 'order'],
  ['cart_item', ['加购', 'Cart item'], 'order', true],
  ['invoice', ['发票', 'Invoice'], 'order'],
  ['payment', ['支付', 'Payment'], 'payment'],
  ['payment_method', ['支付方式', 'Payment method'], 'payment'],
  ['refund', ['退款', 'Refund'], 'payment'],
  ['shipment', ['包裹', 'Shipment'], 'shipping'],
  ['carrier', ['快递公司', 'Carrier'], 'shipping'],
  ['tracking_event', ['物流轨迹', 'Tracking event'], 'shipping'],
  ['warehouse', ['仓库', 'Warehouse'], 'inventory'],
  ['stock', ['库存', 'Stock'], 'inventory', true],
  ['supplier', ['供应商', 'Supplier'], 'inventory'],
  ['supply', ['供货', 'Supply'], 'inventory', true],
  ['purchase_order', ['采购单', 'Purchase order'], 'inventory'],
  ['coupon', ['优惠券', 'Coupon'], 'marketing'],
  ['coupon_claim', ['领券', 'Coupon claim'], 'marketing', true],
  ['promotion', ['促销活动', 'Promotion'], 'marketing'],
  ['channel', ['流量渠道', 'Traffic channel'], 'marketing'],
  ['review', ['评价', 'Review'], 'service', true],
  ['return_request', ['退货申请', 'Return request'], 'service'],
  ['ticket', ['客服工单', 'Support ticket'], 'service'],
]
const CONCEPT_GROUP = new Map(CONCEPTS.map(([id, , g]) => [id, g]))

// 本体之间的关系：[起点, 终点]
const LINKS: [string, string][] = [
  // 顾客
  ['member', 'customer'], ['customer', 'address'], ['member', 'membership_tier'], ['customer', 'favorite'], ['favorite', 'product'],
  // 商品
  ['sku', 'product'], ['product', 'category'], ['product', 'brand'], ['seller', 'product'],
  // 订单
  ['customer', 'order'], ['order', 'order_line'], ['order_line', 'sku'], ['order', 'address'], ['customer', 'cart'],
  ['cart', 'cart_item'], ['cart_item', 'sku'], ['order', 'invoice'], ['seller', 'order'],
  // 支付
  ['order', 'payment'], ['payment', 'payment_method'], ['refund', 'payment'], ['customer', 'payment_method'],
  // 物流
  ['order', 'shipment'], ['shipment', 'carrier'], ['shipment', 'tracking_event'], ['shipment', 'address'], ['warehouse', 'shipment'],
  // 库存
  ['sku', 'stock'], ['stock', 'warehouse'], ['supplier', 'supply'], ['supply', 'product'],
  ['purchase_order', 'supplier'], ['purchase_order', 'warehouse'], ['purchase_order', 'sku'],
  // 营销
  ['customer', 'coupon_claim'], ['coupon_claim', 'coupon'], ['coupon', 'order'], ['promotion', 'coupon'],
  ['promotion', 'product'], ['channel', 'order'], ['channel', 'customer'],
  // 售后
  ['customer', 'review'], ['review', 'product'], ['review', 'order'], ['return_request', 'order_line'],
  ['return_request', 'refund'], ['customer', 'ticket'], ['ticket', 'order'],
]

// ─── 物理表 ──────────────────────────────────────────────────────────────────

// [表名, 映射到的本体和分量（对上了几个字段）, 外键指向的表]。表名、字段名是代码里的名字，两版一样
const TABLES: [string, [string, number][], string[]][] = [
  ['customers', [['customer', 10], ['member', 4]], ['dim_region']],
  ['customer_addresses', [['address', 8]], ['customers', 'dim_region']],
  ['products', [['product', 9], ['brand', 3], ['category', 2]], ['sellers']],
  ['product_skus', [['sku', 7]], ['products']],
  ['sellers', [['seller', 6]], ['dim_region']],
  ['wishlists', [['favorite', 3]], ['customers', 'products']],
  ['orders', [['order', 11], ['address', 3]], ['customers', 'customer_addresses', 'sellers', 'dim_date']],
  ['order_items', [['order_line', 7]], ['orders', 'product_skus']],
  ['carts', [['cart', 3], ['cart_item', 4]], ['customers', 'product_skus']],
  ['payments', [['payment', 8], ['payment_method', 3]], ['orders']],
  ['refunds', [['refund', 6]], ['payments', 'returns']],
  ['shipments', [['shipment', 7], ['tracking_event', 3]], ['orders', 'warehouses']],
  ['warehouses', [['warehouse', 5]], ['dim_region']],
  ['inventory', [['stock', 6]], ['product_skus', 'warehouses']],
  ['suppliers', [['supplier', 5], ['supply', 2]], []],
  ['purchase_orders', [['purchase_order', 7], ['supply', 3]], ['suppliers', 'warehouses', 'product_skus']],
  ['coupons', [['coupon', 6], ['coupon_claim', 3]], []],
  ['reviews', [['review', 6]], ['customers', 'products', 'order_items']],
  ['returns', [['return_request', 6]], ['order_items']],
  ['support_tickets', [['ticket', 7]], ['customers', 'orders']],
  // 没人认领的表：维表、关系表、原始表、临时表
  ['dim_region', [], []],
  ['dim_date', [], []],
  ['order_tag_rel', [], ['orders']],
  ['ods_order_raw', [], []],
  ['tmp_order_dedup', [], ['ods_order_raw']],
]

// 字段：[表名, [本体, 落在这个本体上的字段][]]。写了字段的表，映射是字段级的——
// 平时字段收在表里，映射上卷成表级的（分量 = 对上了几个字段）；展开表才看到每个字段落在哪。
// 本体写成空串的是没对上任何本体的字段（审计字段，还有没人建模的渠道字段）。
const FIELDS: [string, [string, string[]][]][] = [
  ['customers', [
    ['customer', ['customer_id', 'email', 'phone', 'nickname', 'gender', 'birthday', 'register_time', 'region_code', 'status', 'last_login_at']],
    ['member', ['member_no', 'points', 'growth_value', 'member_since']],
    ['', ['created_at', 'updated_at']],
  ]],
  ['products', [
    ['product', ['product_id', 'title', 'subtitle', 'main_image', 'list_price', 'status', 'launch_date', 'description', 'seller_id']],
    ['brand', ['brand_id', 'brand_name', 'brand_logo']],
    ['category', ['category_id', 'category_path']],
    ['', ['etl_time']],
  ]],
  ['orders', [
    ['order', ['order_id', 'order_no', 'customer_id', 'seller_id', 'order_status', 'total_amount', 'discount_amount', 'freight', 'paid_amount', 'created_at', 'paid_at']],
    ['address', ['ship_name', 'ship_phone', 'ship_addr']],
    ['', ['src_channel', 'etl_time']],
  ]],
]
const FIELD_TABLES = new Set(FIELDS.map(([t]) => t))

// ─── 全景 ────────────────────────────────────────────────────────────────────

const cId = (name: string) => `c:${name}`
const tblId = (name: string) => `tbl:${name}`
const fldId = (table: string, field: string) => `fld:${table}.${field}`
/** 领域这个分组维度里属于哪个组 */
const dom = (g: string | undefined) => (g !== undefined ? { domain: g } : undefined)

const TITLE: Text = ['网上商城知识图谱', 'Online store knowledge graph']

function buildPanorama(lang: DemoLang): StrataData {
  const nodes: NodeSpec[] = [
    ...CONCEPTS.map(([id, name, g, isRel]): NodeSpec => ({ id: cId(id), layer: 'onto', label: say(name, lang), type: isRel ? 'relation' : 'entity', groups: dom(g) })),
    ...TABLES.map(([name, ents]): NodeSpec => {
      // 表跟着分量最大的那个本体的领域；没人认领的表没有领域
      const main = [...ents].sort((a, b) => b[1] - a[1])[0]
      return { id: tblId(name), layer: 'table', label: name, type: 'table', groups: dom(main ? CONCEPT_GROUP.get(main[0]) : undefined) }
    }),
    // 字段：收在表里
    ...FIELDS.flatMap(([table, byEnt]) =>
      byEnt.flatMap(([, fields]) => fields.map((f): NodeSpec => ({ id: fldId(table, f), layer: 'table', label: f, type: 'field', parent: tblId(table) }))),
    ),
  ]
  const relations: RelationSpec[] = [
    ...LINKS.map(([s, t]): RelationSpec => ({ source: cId(s), target: cId(t) })),
    ...TABLES.flatMap(([name, , fks]) => fks.map((t): RelationSpec => ({ source: tblId(name), target: tblId(t), ...rel('fk', lang) }))),
    // 映射：本体落在哪张表上，分量是对上了几个字段
    ...TABLES.flatMap(([name, ents]) => (FIELD_TABLES.has(name) ? [] : ents.map(([e, weight]): RelationSpec => ({ source: cId(e), target: tblId(name), ...rel('maps-to', lang), weight })))),
    // 写了字段的表：映射落在字段上
    ...FIELDS.flatMap(([table, byEnt]) =>
      byEnt.flatMap(([e, fields]) => (e === '' ? [] : fields.map((f): RelationSpec => ({ source: cId(e), target: fldId(table, f), ...rel('maps-to', lang) })))),
    ),
  ]
  return {
    version: 2,
    title: say(TITLE, lang),
    layers: [layerSpec('onto', lang), layerSpec('table', lang)],
    groupings: [{ id: 'domain', name: lang === 'zh' ? '领域' : 'Domain', groups: groups(lang) }],
    nodes,
    relations,
  }
}

/** 两层的全景：本体 / 物理表 */
export function panorama(lang: DemoLang = 'zh'): StrataData {
  return buildPanorama(lang)
}
export const PANORAMA: StrataData = buildPanorama('zh')

// ─── 多层 ────────────────────────────────────────────────────────────────────

// 指标：[id, 名字, 口径落在哪些本体上（第一个是主要的）, 由哪些指标算出来]
const METRICS: [string, Text, string[], string[]][] = [
  ['gmv', ['成交额', 'GMV'], ['order_line', 'order'], []],
  ['order_count', ['订单数', 'Order count'], ['order'], []],
  ['aov', ['客单价', 'Avg. order value'], ['order', 'customer'], ['gmv', 'order_count']],
  ['conversion', ['下单转化率', 'Conversion rate'], ['cart', 'order'], ['order_count']],
  ['active_customers', ['活跃顾客数', 'Active customers'], ['customer', 'member'], []],
  ['repurchase', ['复购率', 'Repeat purchase rate'], ['customer', 'order'], ['order_count', 'active_customers']],
  ['rating', ['平均评分', 'Avg. rating'], ['review', 'product'], []],
  ['refund_rate', ['退款率', 'Refund rate'], ['refund', 'payment'], ['gmv']],
  ['on_time', ['准时送达率', 'On-time delivery'], ['shipment', 'tracking_event'], []],
  ['stock_turnover', ['库存周转天数', 'Days of inventory'], ['stock', 'warehouse'], []],
]

// 看板：[id, 名字, 用到哪些指标]
const BOARDS: [string, Text, string[]][] = [
  ['sales', ['销售看板', 'Sales'], ['aov', 'gmv', 'order_count', 'conversion']],
  ['customers', ['用户看板', 'Customers'], ['active_customers', 'repurchase', 'rating']],
  ['fulfillment', ['履约看板', 'Fulfillment'], ['on_time', 'stock_turnover', 'refund_rate']],
]

/** 在本体、物理表上面再叠层：3 = 加指标层，4 = 再加看板层。从上到下：看板 / 指标 / 本体 / 物理表 */
export function layered(count: number, lang: DemoLang = 'zh'): StrataData {
  const d = buildPanorama(lang)
  if (count < 3) return d
  const metricGroup = new Map(METRICS.map(([id, , ents]) => [id, CONCEPT_GROUP.get(ents[0])]))
  d.layers.unshift(layerSpec('metric', lang))
  for (const [id, name, ents, from] of METRICS) {
    d.nodes.push({ id: `m:${id}`, layer: 'metric', label: say(name, lang), type: 'metric', groups: dom(metricGroup.get(id)) })
    for (const f of from) d.relations.push({ source: `m:${f}`, target: `m:${id}`, ...rel('derives', lang) })
    ents.forEach((e, k) => d.relations.push({ source: `m:${id}`, target: cId(e), ...rel('measures', lang), weight: k === 0 ? 3 : 1 }))
  }
  if (count >= 4) {
    d.layers.unshift(layerSpec('board', lang))
    for (const [id, name, ms] of BOARDS) {
      d.nodes.push({ id: `b:${id}`, layer: 'board', label: say(name, lang), type: 'board', groups: dom(metricGroup.get(ms[0])) })
      ms.forEach((m, k) => d.relations.push({ source: `b:${id}`, target: `m:${m}`, ...rel('reads', lang), weight: k === 0 ? 2 : 1 }))
    }
  }
  d.title = lang === 'zh' ? `${say(TITLE, lang)}（${d.layers.length} 层）` : `${say(TITLE, lang)} (${d.layers.length} layers)`
  return d
}

// ─── 对比 ────────────────────────────────────────────────────────────────────

export const DIFF_BEFORE: StrataData = PANORAMA

/** 两版之间哪些节点合并了：新节点 → 它吸收的旧节点。交给 showDiff，kgdiff 才认得出是合并 */
export const DIFF_REPLACES: Record<string, string[]> = { 'c:customer': ['c:member'] }

/** 在一份数据上做一组改动，得到“改了之后”的那一版。base 可以是两层的全景，也可以是叠了指标、看板的多层数据 */
export function diffAfter(base: StrataData, lang: DemoLang = 'zh'): StrataData {
  const d: StrataData = structuredClone(base)
  const dropNode = (id: string) => {
    d.nodes = d.nodes.filter((n) => n.id !== id)
    d.relations = d.relations.filter((r) => r.source !== id && r.target !== id)
  }

  // 新增：本体“订阅”（定期购），和它落地的新表
  const newEnt = cId('subscription')
  const newTbl = tblId('subscriptions')
  d.nodes.push({ id: newEnt, layer: 'onto', label: lang === 'zh' ? '订阅' : 'Subscription', type: 'entity', groups: dom('order') })
  d.nodes.push({ id: newTbl, layer: 'table', label: 'subscriptions', type: 'table', groups: dom('order') })
  d.relations.push(
    { source: cId('customer'), target: newEnt },
    { source: newEnt, target: cId('sku') },
    { source: newTbl, target: tblId('customers'), ...rel('fk', lang) },
    { source: newTbl, target: tblId('product_skus'), ...rel('fk', lang) },
    { source: newEnt, target: newTbl, ...rel('maps-to', lang), weight: 5 },
  )

  // 合并：会员并入顾客。连着它的关系改到顾客上（见 DIFF_REPLACES）
  const from = cId('member')
  const into = cId('customer')
  d.nodes = d.nodes.filter((n) => n.id !== from)
  d.relations = d.relations.map((r) => ({ ...r, source: r.source === from ? into : r.source, target: r.target === from ? into : r.target }))

  // 改名
  d.nodes.find((n) => n.id === cId('favorite'))!.label = lang === 'zh' ? '心愿单' : 'Wishlist'

  // 补映射：原来没落地的“促销活动”落到优惠券那张表上
  d.relations.push({ source: cId('promotion'), target: tblId('coupons'), ...rel('maps-to', lang), weight: 2 })

  // 删除：本体“发票”（不再单独建模），和下线的临时表
  dropNode(cId('invoice'))
  dropNode(tblId('tmp_order_dedup'))

  // 关系改向：评价 → 订单 改成 → 订单明细（评价挂到买的那件东西上）
  for (const r of d.relations) if (r.source === cId('review') && r.target === cId('order')) r.target = cId('order_line')

  // 字段级的改动：订单表加了一个字段，对上了“优惠券”。平时看到的是多了一条映射、表里多了东西；展开表能看到这个字段
  const couponField = fldId('orders', 'coupon_id')
  d.nodes.push({ id: couponField, layer: 'table', label: 'coupon_id', type: 'field', parent: tblId('orders') })
  d.relations.push({ source: cId('coupon'), target: couponField, ...rel('maps-to', lang) })

  // 改完以后两端一样的、重了的关系去掉
  const seen = new Set<string>()
  d.relations = d.relations.filter((r) => {
    const k = `${r.source}|${r.type ?? ''}|${r.target}`
    if (r.source === r.target || seen.has(k)) return false
    seen.add(k)
    return true
  })
  return d
}

export const DIFF_AFTER: StrataData = diffAfter(PANORAMA)

// ─── 查询路径 ────────────────────────────────────────────────────────────────

export interface DemoPath {
  id: string
  question: string
  nodes: string[]
}

// 先在本体上走，再落到表上顺着外键走
const PATH_DEFS: { id: string; question: Text; nodes: string[] }[] = [
  {
    id: 'order-to-door',
    question: ['一笔订单从下单、付款到发货，要走哪些本体、落到哪些表？', 'From checkout to payment to shipping: which concepts and tables does one order touch?'],
    nodes: ['c:customer', 'c:order', 'c:payment', 'tbl:payments', 'tbl:orders', 'tbl:shipments'],
  },
  {
    id: 'product-reviews',
    question: ['这个商品的评价来自哪些订单，要查哪几张表？', 'Which orders did this product’s reviews come from, and which tables hold them?'],
    nodes: ['c:product', 'c:review', 'tbl:reviews', 'tbl:order_items', 'tbl:orders'],
  },
  {
    id: 'restock',
    question: ['热销 SKU 还剩多少库存，补货单下给了哪家供应商？', 'How much stock is left for a best-selling SKU, and which supplier got the restock order?'],
    nodes: ['c:sku', 'c:stock', 'c:warehouse', 'c:purchase_order', 'c:supplier', 'tbl:suppliers', 'tbl:purchase_orders', 'tbl:product_skus', 'tbl:inventory'],
  },
  {
    id: 'return-refund',
    question: ['一次退货，从申请到退款，要走哪些本体、落到哪些表？', 'A return, from request to refund: which concepts and tables are involved?'],
    nodes: ['c:return_request', 'c:order_line', 'c:order', 'c:payment', 'c:refund', 'tbl:refunds', 'tbl:returns', 'tbl:order_items'],
  },
]

export function paths(lang: DemoLang = 'zh'): DemoPath[] {
  return PATH_DEFS.map((p) => ({ id: p.id, question: say(p.question, lang), nodes: [...p.nodes] }))
}
export const PATHS: DemoPath[] = paths('zh')

/** 多层数据才有的路径：从看板、指标出发，穿过本体，落到表上 */
export function layeredPaths(count: number, lang: DemoLang = 'zh'): DemoPath[] {
  if (count < 3) return []
  const top = count >= 4 ? ['b:sales'] : []
  const question: Text =
    count >= 4
      ? ['销售看板上的客单价是怎么算出来的，最后取的哪张表？', 'How is average order value on the Sales dashboard computed, and which table does it read?']
      : ['客单价这个指标是怎么算出来的，最后取的哪张表？', 'How is the average order value metric computed, and which table does it read?']
  return [{ id: 'aov-lineage', question: say(question, lang), nodes: [...top, 'm:aov', 'm:gmv', 'c:order', 'c:order_line', 'tbl:order_items'] }]
}

// ─── 压力数据 ────────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 确定性合成：本体 n 个（约 2n 条关系，领域内居多）；表 n/5 张，各映射 1～3 个本体，约一成没人认领，表之间约 1.5 倍的外键。 */
export function stress(n: number, lang: DemoLang = 'zh'): StrataData {
  const rnd = mulberry32(20260616)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const gs = groups(lang)
  const G = gs.length
  const nodes: NodeSpec[] = []
  const relations: RelationSpec[] = []

  // 本体：节点按领域分组，边 90% 在领域内
  const groupOf: number[] = []
  const byGroup: number[][] = gs.map(() => [])
  for (let i = 0; i < n; i++) {
    const gi = Math.floor(rnd() * G)
    byGroup[gi].push(i)
    groupOf.push(gi)
    nodes.push({ id: `n${i}`, layer: 'graph', label: lang === 'zh' ? `本体${i}` : `concept_${i}`, groups: dom(gs[gi].id), type: rnd() < 0.15 ? 'relation' : 'entity' })
  }
  const edgeSet = new Set<string>()
  const target = n * 2
  let made = 0
  let guard = 0
  while (made < target && guard++ < target * 20) {
    const a = Math.floor(rnd() * n)
    const pool = rnd() < 0.9 ? byGroup[groupOf[a]] : null
    const b = pool ? pick(pool) : Math.floor(rnd() * n)
    if (a === b || edgeSet.has(`${a}|${b}`) || edgeSet.has(`${b}|${a}`)) continue
    edgeSet.add(`${a}|${b}`)
    relations.push({ source: `n${a}`, target: `n${b}` })
    made++
  }

  // 表：先定它主要属于哪个本体，再在同领域里多映射几个
  const tableCount = Math.round(n / 5)
  const tablesByGroup: number[][] = gs.map(() => [])
  for (let i = 0; i < tableCount; i++) {
    const host = Math.floor(rnd() * n)
    const gi = groupOf[host]
    const orphan = rnd() < 0.1
    nodes.push({ id: `t${i}`, layer: 'tables', label: `tbl_${i}`, type: 'table', groups: dom(orphan ? undefined : gs[gi].id) })
    tablesByGroup[gi].push(i)
    if (orphan) continue
    const hosts = new Set([host])
    const extra = rnd() < 0.3 ? 1 + Math.floor(rnd() * 2) : 0
    for (let k = 0; k < extra; k++) hosts.add(pick(byGroup[gi]))
    let first = true
    for (const h of hosts) {
      relations.push({ source: `n${h}`, target: `t${i}`, ...rel('maps-to', lang), weight: first ? 4 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 3) })
      first = false
    }
  }
  const fkSet = new Set<string>()
  const fkTarget = Math.round(tableCount * 1.5)
  made = 0
  guard = 0
  while (made < fkTarget && guard++ < fkTarget * 20) {
    const gi = Math.floor(rnd() * G)
    const pool = tablesByGroup[gi]
    if (pool.length < 2) continue
    const a = pick(pool)
    const b = rnd() < 0.85 ? pick(pool) : Math.floor(rnd() * tableCount)
    if (a === b || fkSet.has(`${a}|${b}`) || fkSet.has(`${b}|${a}`)) continue
    fkSet.add(`${a}|${b}`)
    relations.push({ source: `t${a}`, target: `t${b}`, ...rel('fk', lang) })
    made++
  }

  return {
    version: 2,
    title: lang === 'zh' ? `压力数据 ${n}` : `Stress data ${n}`,
    layers: [
      { id: 'graph', name: say(LAYER_NAMES.onto, lang) },
      { id: 'tables', name: say(LAYER_NAMES.table, lang) },
    ],
    groupings: [{ id: 'domain', name: lang === 'zh' ? '领域' : 'Domain', groups: gs }],
    nodes,
    relations,
  }
}
