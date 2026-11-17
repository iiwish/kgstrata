// 库的测试用的小数据：手写、固定，不跟着效果页的演示数据变。
// 三层（指标 / 本体 / 物理表），两个组（一个带颜色、一个不带），一张表带字段，映射有表级的也有字段级的。

import type { StrataData } from '../../src/types'

const LAYERS: StrataData['layers'] = [
  { id: 'metric', name: '指标' },
  { id: 'onto', name: '本体' },
  { id: 'table', name: '物理表' },
]

const BASE: StrataData = {
  version: 2,
  title: '测试用的小图',
  layers: LAYERS.slice(1),
  groupings: [
    {
      id: 'domain',
      groups: [
        { id: 'sales', name: '销售', color: '#58c6ff' },
        // 不带颜色：从主题的色板里取
        { id: 'people', name: '顾客' },
      ],
    },
  ],
  nodes: [
    { id: 'c:customer', layer: 'onto', label: '顾客', type: 'entity', groups: { domain: 'people' } },
    { id: 'c:order', layer: 'onto', label: '订单', type: 'entity', groups: { domain: 'sales' } },
    { id: 'c:order_line', layer: 'onto', label: '订单明细', type: 'relation', groups: { domain: 'sales' } },
    { id: 'c:product', layer: 'onto', label: '商品', type: 'entity', groups: { domain: 'sales' } },
    { id: 'tbl:customers', layer: 'table', label: 'customers', type: 'table', groups: { domain: 'people' } },
    { id: 'tbl:orders', layer: 'table', label: 'orders', type: 'table', groups: { domain: 'sales' } },
    { id: 'fld:orders.id', layer: 'table', label: 'id', type: 'field', parent: 'tbl:orders' },
    { id: 'fld:orders.customer_id', layer: 'table', label: 'customer_id', type: 'field', parent: 'tbl:orders' },
    { id: 'tbl:order_items', layer: 'table', label: 'order_items', type: 'table', groups: { domain: 'sales' } },
    { id: 'tbl:products', layer: 'table', label: 'products', type: 'table', groups: { domain: 'sales' } },
  ],
  relations: [
    { source: 'c:customer', target: 'c:order' },
    { source: 'c:order', target: 'c:order_line' },
    { source: 'c:order_line', target: 'c:product' },
    { source: 'tbl:orders', target: 'tbl:customers', type: 'fk' },
    { source: 'tbl:order_items', target: 'tbl:orders', type: 'fk' },
    { source: 'tbl:order_items', target: 'tbl:products', type: 'fk' },
    { source: 'c:customer', target: 'tbl:customers', type: 'maps-to', weight: 3 },
    { source: 'c:order', target: 'fld:orders.id', type: 'maps-to' },
    { source: 'c:order', target: 'fld:orders.customer_id', type: 'maps-to' },
    { source: 'c:order_line', target: 'tbl:order_items', type: 'maps-to', weight: 4 },
    { source: 'c:product', target: 'tbl:products', type: 'maps-to', weight: 5 },
  ],
}

/** 2 = 本体 / 物理表；3 = 上面再加一层指标 */
export function small(layers: 2 | 3): StrataData {
  const d = structuredClone(BASE)
  if (layers === 2) return d
  d.layers = structuredClone(LAYERS)
  d.nodes.push(
    { id: 'm:gmv', layer: 'metric', label: '成交额', type: 'metric', groups: { domain: 'sales' } },
    { id: 'm:aov', layer: 'metric', label: '客单价', type: 'metric', groups: { domain: 'sales' } },
  )
  d.relations.push(
    { source: 'm:gmv', target: 'm:aov', type: 'derives' },
    { source: 'm:gmv', target: 'c:order_line', type: 'measures', weight: 3 },
    { source: 'm:gmv', target: 'c:order', type: 'measures' },
    { source: 'm:aov', target: 'c:order', type: 'measures', weight: 3 },
  )
  return d
}

/** 三层数据上的一条路径：从指标出发，穿过本体，落到表上。相邻的都连着，都是画出来的节点 */
export const SMALL_PATH = ['m:aov', 'm:gmv', 'c:order_line', 'tbl:order_items', 'tbl:products']
