import type { StrataData } from 'kgstrata'
import { data as before } from './data'

// The next version of the same model:
// - the "Legal representative" concept is renamed,
// - a shareholder table appears and Investment maps onto it,
// - the mapping onto investment.amount is dropped.
export { before }

export const after: StrataData = {
  ...before,
  nodes: [
    ...before.nodes.map((n) => (n.id === 'onto:legal-rep' ? { ...n, label: 'Legal person' } : n)),
    { id: 'tbl:shareholder', layer: 'table', label: 'shareholder', type: 'table', groups: { domain: 'equity' } },
    { id: 'tbl:shareholder.person_id', layer: 'table', label: 'person_id', type: 'field', parent: 'tbl:shareholder' },
  ],
  relations: [
    ...before.relations.filter((r) => r.target !== 'tbl:investment.amount'),
    { source: 'tbl:shareholder.person_id', target: 'tbl:person.id', type: 'fk' },
    { source: 'onto:investment', target: 'tbl:shareholder.person_id', type: 'maps-to' },
  ],
}
