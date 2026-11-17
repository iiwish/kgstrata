import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LayerList, NodeTip, StrataCanvas } from 'kgstrata/react'
import 'kgstrata/react/styles.css'
import { data } from './data'

function App() {
  return (
    // <StrataCanvas> renders the canvas element and its children as siblings,
    // so the positioning context is this wrapper, not the canvas.
    <div style={{ position: 'fixed', inset: 0 }}>
      <StrataCanvas
        data={data}
        options={{ hero: 'onto' }}
        style={{ position: 'absolute', inset: 0 }}
        onIssues={(issues) => issues.forEach((i) => console.warn(`[${i.code}] ${i.message}`))}
        onSelect={(info) => console.log('selected', info?.id ?? null)}
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
