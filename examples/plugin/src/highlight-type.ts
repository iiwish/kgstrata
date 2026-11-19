import { Emitter, type StrataPlugin } from 'kgstrata'
// The Model type lives in the low-level entry (not covered by semver); an overlay only reads it.
import type { Model } from 'kgstrata/internals'

/** What the plugin hands back from `strata.use(...)`. */
export interface HighlightTypeApi {
  /** Light up every node of this `type` (as written in the data). `null` turns it off. */
  set(type: string | null): void
  readonly type: string | null
  /** How many drawn nodes are lit. Fields folded inside a collapsed table are not drawn, so they do not count. */
  readonly count: number
  on(event: 'change', cb: (type: string | null) => void): () => void
}

/**
 * An overlay plugin: it never takes over the frame. Each frame it
 * 1. hands the core styler a spotlight (lit nodes stay bright, the rest dim), and
 * 2. paints a small badge next to each lit node's label.
 * It also stores its state in the view (`strata.view.highlight`).
 */
export function highlightTypePlugin(options: { badge?: string } = {}): StrataPlugin<HighlightTypeApi> {
  const badge = options.badge ?? '●'
  return {
    name: 'highlight-type',
    install(ctx) {
      const events = new Emitter<{ change: string | null }>()
      let type: string | null = null
      // Cache per model: the core rebuilds the model on setData and on expand/collapse.
      let cached: { model: Model; type: string | null; rank: Int32Array; count: number } | null = null

      const rankFor = (m: Model) => {
        if (cached && cached.model === m && cached.type === type) return cached
        // rank[i] > 0 marks node i as lit. Order does not matter here, so every match gets 1.
        const rank = new Int32Array(m.base.nodes.length)
        let count = 0
        m.specs.forEach((spec, i) => {
          if (type !== null && spec.type === type) {
            rank[i] = 1
            count++
          }
        })
        cached = { model: m, type, rank, count }
        return cached
      }

      ctx.overlay({
        // ① Asked before the core styles the frame. Return null to stay out of the way.
        spotlight: () => {
          const m = ctx.model
          if (type === null || !m || ctx.mode !== null) return null
          return { rank: rankFor(m).rank }
        },
        // ② Called after styling, only while no mode has taken over.
        paint: (looks) => {
          const m = ctx.model
          if (type === null || !m) return
          const { rank } = rankFor(m)
          for (let i = 0; i < rank.length; i++) if (rank[i] > 0) looks.nodes[i].badge = badge
        },
      })

      const set = (next: string | null) => {
        if (next === type) return
        type = next
        events.emit('change', type)
      }

      // Save and restore with strata.view / setView().
      ctx.registerView<string | null>('highlight', { get: () => type, set })
      // New data: keep the type, the cache is keyed by model and refreshes by itself.
      ctx.onDispose(() => events.clear())

      return {
        set,
        get type() {
          return type
        },
        get count() {
          const m = ctx.model
          return m && type !== null ? rankFor(m).count : 0
        },
        on: (event, cb) => events.on(event, cb),
      }
    },
  }
}
