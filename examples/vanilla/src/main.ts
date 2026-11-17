import { Strata, StrataError } from 'kgstrata'
import { data } from './data'

const host = document.getElementById('app')!

try {
  const strata = new Strata(host, { hero: 'onto' })

  // setData drops broken items, draws the rest, and returns what it found.
  const issues = strata.setData(data)
  for (const issue of issues) console.warn(`[${issue.code}] ${issue.message}`)

  // Click a node to select it; double-click a table to show its fields.
  strata.on('select', (info) => console.log('selected', info?.id ?? null))
  strata.on('expand', (ids) => console.log('expanded', ids))

  // Free the WebGL context when Vite hot-reloads this module.
  import.meta.hot?.dispose(() => strata.dispose())
} catch (error) {
  // Thrown before anything is attached to the page.
  if (error instanceof StrataError && error.code === 'webgl-unavailable') host.textContent = error.message
  else throw error
}
