import { Strata } from 'kgstrata'
import { data } from './data'
import { highlightTypePlugin } from './highlight-type'
import { neighbourhoodPlugin } from './neighbourhood'

// Plugins that register a view slot can add its type to StrataView.
// (See docs/plugins.md, "Registering view state", for the limits of this.)
declare module 'kgstrata' {
  interface StrataView {
    highlight?: string | null
  }
}

const strata = new Strata(document.getElementById('app')!, { hero: 'onto' })
const highlight = strata.use(highlightTypePlugin({ badge: '◆' }))
const neighbourhood = strata.use(neighbourhoodPlugin())
strata.setData(data)

const bar = document.getElementById('types')!
for (const type of [null, 'relation', 'table', 'field']) {
  const button = document.createElement('button')
  button.textContent = type ?? 'none'
  button.addEventListener('click', () => {
    highlight.set(type)
    console.log(`${type}: ${highlight.count} nodes lit`, strata.view.highlight)
  })
  bar.append(button)
}

// The mode plugin: select a node, then draw only it and its neighbours.
let selected: string | null = null
strata.on('select', ({ node }) => (selected = node?.id ?? selected))
const solo = document.createElement('button')
solo.textContent = 'neighbourhood'
solo.addEventListener('click', () => {
  if (neighbourhood.center) neighbourhood.exit()
  else neighbourhood.show(selected ?? 'onto:investment')
})
neighbourhood.on('change', (center) => (solo.textContent = center ? `back (${center})` : 'neighbourhood'))
bar.append(solo)

import.meta.hot?.dispose(() => strata.dispose())
