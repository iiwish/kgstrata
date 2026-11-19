import { Emitter, type ModeHandle, type StrataPlugin } from 'kgstrata'
import type { Resolved } from 'kgstrata/headless'
// Taking over the frame needs the low-level entry. Nothing in it is covered by semver:
// minor versions may change it, so check the changelog when you upgrade.
import { buildModel, Styler, type StyleState } from 'kgstrata/internals'

/** What the plugin hands back from `strata.use(...)`. */
export interface NeighbourhoodApi {
  /** Take over the view and draw only this node and its direct neighbours (on every layer), laid out afresh. */
  show(id: string): boolean
  /** Hand the frame back to the normal view. */
  exit(): void
  /** The node in the middle, or `null` when the normal view is drawn. */
  readonly center: string | null
  on(event: 'change', cb: (center: string | null) => void): () => void
}

/**
 * A mode plugin: while active it replaces what is drawn.
 * 1. Build a smaller `Resolved` graph from the drawn one (`ctx.model.data`).
 * 2. Lay it out with the engine's rules (`ctx.layoutOf`) and build a `Model` from it (`buildModel`).
 * 3. Style it with the core `Styler` and hand the core a `StrataMode` (`ctx.takeOver`).
 * Hidden layers, hero proportions and the camera keep working: the core applies them to modes too.
 */
export function neighbourhoodPlugin(): StrataPlugin<NeighbourhoodApi> {
  return {
    name: 'neighbourhood',
    install(ctx) {
      const events = new Emitter<{ change: string | null }>()
      let center: string | null = null
      let handle: ModeHandle | null = null

      const set = (next: string | null) => {
        if (next === center) return
        center = next
        events.emit('change', center)
      }

      const show = (id: string): boolean => {
        const m = ctx.model
        const at = m?.index.get(id)
        if (!m || at === undefined) return false
        // Keep the node, its neighbours (`adj` covers edges inside a layer and mappings across layers).
        const keep = new Set([id, ...m.adj[at].map((j) => m.base.nodes[j].id)])
        const data: Resolved = {
          groups: m.data.groups,
          // Every layer stays, so layer indexes, the hero and hidden layers still line up with the normal view.
          layers: m.data.layers.map((l) => ({
            ...l,
            // Drop `parent`: an expanded field may be kept without its table, so everything is laid out as top level.
            nodes: l.nodes.filter((n) => keep.has(n.id)).map(({ parent: _parent, ...n }) => n),
            edges: (l.edges ?? []).filter((e) => keep.has(e.source) && keep.has(e.target)),
          })),
          links: m.data.links.filter((k) => keep.has(k.source) && keep.has(k.target)),
        }
        const model = buildModel(data, ctx.layoutOf(data), ctx.theme)
        const styler = new Styler(model)
        // The node in the middle stays selected; hovering lights neighbours as usual.
        const state: StyleState = { hover: -1, selected: model.index.get(id) ?? -1, focusLayer: null, stage: null, spot: null, group: -1, time: 0 }
        handle = ctx.takeOver({
          model,
          base: model.renderer,
          looks: (frame) => {
            state.time = frame.time
            return styler.resolve(state)
          },
          hover: (i) => (state.hover = i),
          // Clicking another node re-centres on it; clicking empty space goes back.
          select: (i) => {
            if (i < 0) exit()
            else show(model.base.nodes[i].id)
          },
          // The core took the frame back (new data, or another plugin's mode).
          released: () => {
            handle = null
            set(null)
          },
        })
        set(id)
        return true
      }

      const exit = () => {
        const h = handle
        handle = null
        h?.release()
        set(null)
      }

      ctx.onDispose(() => events.clear())

      return {
        show,
        exit,
        get center() {
          return center
        },
        on: (event, cb) => events.on(event, cb),
      }
    },
  }
}
