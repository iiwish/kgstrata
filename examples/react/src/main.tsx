import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LayerList, NodeTip, StrataCanvas } from 'kgstrata/react'
import 'kgstrata/react/styles.css'
import { data } from './data'

function App() {
  return (
    // <StrataCanvas> is its own positioning context and fills its parent (min-height 320px):
    // children are drawn over the canvas, so panels just use position: absolute.
    <div style={{ position: 'fixed', inset: 0 }}>
      <StrataCanvas
        data={data}
        options={{ hero: 'onto' }}
        onIssues={(issues) => issues.forEach((i) => console.warn(`[${i.code}] ${i.message}`))}
        onSelect={({ node, source }) => console.log('selected', node?.id ?? null, `(${source})`)}
      >
        <aside className="kgs-panel" style={{ position: 'absolute', left: 16, top: 16, width: 200, padding: 8 }}>
          <LayerList />
        </aside>
        <NodeTip />
      </StrataCanvas>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
