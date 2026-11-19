import { Strata } from 'kgstrata'
import { diffPlugin } from 'kgstrata/diff'
import { after, before } from './versions'

const strata = new Strata(document.getElementById('app')!, { hero: 'onto' })
const diff = strata.use(diffPlugin())
strata.setData(after)

// kgdiff computes the semantic changes (it loads WebAssembly, so this is async).
// The result is null if another show/exit/setData happened while it was running.
const result = await diff.show(before, after)

if (result) {
  const { added, removed, changed } = result.stats
  document.getElementById('stats')!.textContent = `${added} added · ${removed} removed · ${changed} changed`
  const list = document.getElementById('hunks')!
  for (const hunk of result.hunks) {
    const li = document.createElement('li')
    li.innerHTML = `<span></span><small></small>`
    li.querySelector('span')!.textContent = hunk.title
    li.querySelector('small')!.textContent = hunk.subtitle
    // Select a change by its id: the camera frames it.
    li.addEventListener('click', () => diff.selectHunk(hunk.id))
    list.append(li)
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-layer]')) {
  const layer = button.dataset.layer as 'union' | 'before' | 'after'
  button.addEventListener('click', () => {
    diff.play(false)
    diff.update({ layer, t: 0, selectedHunk: null })
  })
}
document.getElementById('play')!.addEventListener('click', () => diff.play(!diff.playing))

import.meta.hot?.dispose(() => strata.dispose())
