import type { StrataData } from 'kgstrata'

// A small two-layer graph: four ontology concepts above three tables.
// Mappings are written at field level; while a table is collapsed they roll up
// into one table-level mapping whose weight is the number of fields.
export const data: StrataData = {
  version: 2,
  layers: [
    { id: 'onto', name: 'Ontology' },
    { id: 'table', name: 'Tables' },
  ],
  groupings: [
    {
      id: 'domain',
      groups: [
        { id: 'party', name: 'Parties' },
        { id: 'equity', name: 'Equity' },
      ],
    },
  ],
  nodes: [
    // Ontology layer
    { id: 'onto:company', layer: 'onto', label: 'Company', groups: { domain: 'party' } },
    { id: 'onto:person', layer: 'onto', label: 'Person', groups: { domain: 'party' } },
    { id: 'onto:investment', layer: 'onto', label: 'Investment', type: 'relation', groups: { domain: 'equity' } },
    { id: 'onto:legal-rep', layer: 'onto', label: 'Legal representative', type: 'relation', groups: { domain: 'party' } },
    // Physical layer: tables and their fields (`parent` = contained in)
    { id: 'tbl:company', layer: 'table', label: 'company', type: 'table', groups: { domain: 'party' } },
    { id: 'tbl:company.id', layer: 'table', label: 'id', type: 'field', parent: 'tbl:company' },
    { id: 'tbl:company.legal_rep_id', layer: 'table', label: 'legal_rep_id', type: 'field', parent: 'tbl:company' },
    { id: 'tbl:person', layer: 'table', label: 'person', type: 'table', groups: { domain: 'party' } },
    { id: 'tbl:person.id', layer: 'table', label: 'id', type: 'field', parent: 'tbl:person' },
    { id: 'tbl:investment', layer: 'table', label: 'investment', type: 'table', groups: { domain: 'equity' } },
    { id: 'tbl:investment.company_id', layer: 'table', label: 'company_id', type: 'field', parent: 'tbl:investment' },
    { id: 'tbl:investment.person_id', layer: 'table', label: 'person_id', type: 'field', parent: 'tbl:investment' },
    { id: 'tbl:investment.amount', layer: 'table', label: 'amount', type: 'field', parent: 'tbl:investment' },
  ],
  relations: [
    // Inside the ontology layer
    { source: 'onto:person', target: 'onto:investment', type: 'investor' },
    { source: 'onto:investment', target: 'onto:company', type: 'investee' },
    { source: 'onto:person', target: 'onto:legal-rep', type: 'holder' },
    { source: 'onto:legal-rep', target: 'onto:company', type: 'of' },
    // Inside the physical layer: foreign keys between fields
    { source: 'tbl:investment.company_id', target: 'tbl:company.id', type: 'fk' },
    { source: 'tbl:investment.person_id', target: 'tbl:person.id', type: 'fk' },
    { source: 'tbl:company.legal_rep_id', target: 'tbl:person.id', type: 'fk' },
    // Across layers: where each concept lands
    { source: 'onto:company', target: 'tbl:company.id', type: 'maps-to' },
    { source: 'onto:person', target: 'tbl:person.id', type: 'maps-to' },
    { source: 'onto:investment', target: 'tbl:investment.company_id', type: 'maps-to' },
    { source: 'onto:investment', target: 'tbl:investment.person_id', type: 'maps-to' },
    { source: 'onto:investment', target: 'tbl:investment.amount', type: 'maps-to', attrs: { filter: 'amount > 0' } },
    { source: 'onto:legal-rep', target: 'tbl:company.legal_rep_id', type: 'maps-to' },
  ],
}
