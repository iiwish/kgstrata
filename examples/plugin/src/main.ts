import { Strata } from 'kgstrata'
import { data } from './data'
import { highlightTypePlugin } from './highlight-type'

// Plugins that register a view slot can add its type to StrataView.
// (See docs/plugins.md, "Registering view state", for the limits of this.)
declare module 'kgstrata' {
  interface StrataView {
    highlight?: string | null
  }
}

const strata = new Strata(document.getElementById('app')!, { hero: 'onto' })
const highlight = strata.use(highlightTypePlugin({ badge: '◆' }))
strata.setData(data)

const bar = document.getElementById('types')!
for (const type of [null, 'relation', 'table', 'field']) {
  const button = document.createElement('button')
  button.textContent = type ?? 'none'
  button.addEventListener('click', () => {
    highlight.set(type)
    console.log(`${type}: ${highlight.count} nodes lit`, strata.getView().highlight)
  })
  bar.append(button)
}

import.meta.hot?.dispose(() => strata.dispose())
