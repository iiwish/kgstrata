// 映射审计的面板 kgstrata/react/audit：<AuditPanel> 两行总数，再按缺口分组列出每一项，点一条就在图上框住它。
// 只引入核心和审计插件的入口，不带 kgdiff。

import { useEffect, useMemo, useState } from 'react'
import { auditColors, type AuditApi, type AuditColors, type AuditTarget, type MappingAudit } from '../audit/index.js'
import type { Strata } from '../engine/index.js'
import { DEFAULT_LOCALE, message, type MessageKey } from '../locale.js'
import type { StrataData } from '../types.js'
import { usePlugin, useStrataOr, useStrataState, useText } from './context.js'
import type { PanelProps } from './panels.js'
import { cx, type TextFn } from './store.js'

export interface AuditPanelProps extends PanelProps {
  /** The audit plugin's API; default: the one installed through `<StrataCanvas plugins>` (name `'audit'`). */
  audit?: AuditApi | null
  /** Colours of the gaps; default as the audit draws them in 3D (`auditColors(strata.theme)`). */
  colors?: Partial<AuditColors>
  /** Items shown per group before "N more"; default 40. */
  limit?: number
  /** Give the audit directly instead of reading the plugin (server rendering, tests). */
  current?: MappingAudit | null
}

/** The gap groups, in the order the panel lists them. */
export type AuditGroup = 'broken' | 'unmapped-upper' | 'unmapped-lower' | 'unused' | 'via-path'

/** One line of the panel: what it points at, its title and why it is a gap. */
export interface AuditItem {
  group: AuditGroup
  target: AuditTarget
  title: string
  detail?: string
}

const GROUP_KEYS: Record<AuditGroup, MessageKey> = {
  broken: 'ui.audit-group.broken',
  'unmapped-upper': 'ui.audit-group.unmapped-upper',
  'unmapped-lower': 'ui.audit-group.unmapped-lower',
  unused: 'ui.audit-group.unused',
  'via-path': 'ui.audit-group.via-path',
}
const ORDER: AuditGroup[] = ['broken', 'unmapped-upper', 'unmapped-lower', 'unused', 'via-path']

/**
 * The gaps of an audit as panel lines, grouped in display order. `label` gives a node's name (default: its id);
 * `t` the texts (default: English). Joined relations and joins a relation matches directly are not gaps and are left out.
 */
export function auditItems(audit: MappingAudit, label: (id: string) => string = (id) => id, t?: TextFn): AuditItem[] {
  const tx: TextFn = t ?? ((key, vars) => message(DEFAULT_LOCALE, key, vars))
  const pair = (a: string, b: string) => `${label(a)} — ${label(b)}`
  const relName = new Map(audit.relations.map((r) => [r.id, pair(r.source, r.target)]))
  const unmappedUpper = new Set(audit.unmappedUpper)
  const unmappedLower = new Set(audit.unmappedLower)
  const out: AuditItem[] = []
  // 一端没映射的关系不单列：缺口在那个节点上，列在“没映射”那一组，说明里带着它挡住了几条关系
  for (const r of audit.relations) {
    if (r.status !== 'unreachable') continue
    out.push({ group: 'broken', target: { kind: 'relation', id: r.id }, title: pair(r.source, r.target), detail: tx('ui.audit-unreachable', { n: audit.maxHops }) })
  }
  for (const id of audit.unmappedUpper) {
    const n = audit.relations.filter((r) => r.status === 'unmapped' && (r.source === id || r.target === id)).length
    out.push({ group: 'unmapped-upper', target: { kind: 'node', id }, title: label(id), detail: n ? tx('ui.audit-blocks', { n }) : undefined })
  }
  for (const id of audit.unmappedLower) out.push({ group: 'unmapped-lower', target: { kind: 'node', id }, title: label(id) })
  for (const j of audit.joins) {
    if (j.coverage === 'direct') continue
    const title = pair(j.source, j.target)
    if (j.coverage === 'unused') {
      const bare = unmappedLower.has(j.source) || unmappedLower.has(j.target) || unmappedUpper.has(j.source) || unmappedUpper.has(j.target)
      out.push({ group: 'unused', target: { kind: 'join', id: j.id }, title, detail: tx(bare ? 'ui.audit-unused-unmapped' : 'ui.audit-unused-relation') })
    } else {
      const first = relName.get(j.usedBy[0]) ?? j.usedBy[0]
      const detail = j.usedBy.length > 1 ? tx('ui.audit-used-by-more', { relation: first, n: j.usedBy.length - 1, total: j.usedBy.length }) : tx('ui.audit-used-by', { relation: first })
      out.push({ group: 'via-path', target: { kind: 'join', id: j.id }, title, detail })
    }
  }
  return ORDER.flatMap((g) => out.filter((x) => x.group === g))
}

/** 节点 id → 名字、层 id → 层名（按实例的数据） */
function namesOf(data: StrataData | null | undefined) {
  const nodes = new Map((data?.nodes ?? []).map((n) => [n.id, n.label ?? n.id]))
  const layers = new Map((data?.layers ?? []).map((l) => [l.id, l.name]))
  return { node: (id: string) => nodes.get(id) ?? id, layer: (id: string) => layers.get(id) ?? id }
}

/** 插件的审计结果和选中项当 React 状态 */
function useAudit(api: AuditApi | null) {
  const [st, setSt] = useState(() => ({ api, audit: api?.current ?? null, selected: api?.selected ?? null }))
  useEffect(() => {
    if (!api) return
    setSt({ api, audit: api.current, selected: api.selected })
    const offs = [
      api.on('enter', (audit) => setSt({ api, audit, selected: api.selected })),
      api.on('exit', () => setSt({ api, audit: null, selected: null })),
      api.on('select', (selected) => setSt((s) => ({ ...s, selected }))),
    ]
    return () => offs.forEach((off) => off())
  }, [api])
  return st.api === api ? st : { api, audit: null, selected: null }
}

/** Mapping audit panel: two totals, then the gaps grouped by kind. Clicking a line selects it on the map (and frames it); clicking it again lets go. */
export function AuditPanel(props: AuditPanelProps) {
  const strata: Strata | null = useStrataOr(props.strata)
  const t = useText(strata, props.locale)
  const theme = useStrataState(strata, 'theme')
  const fromContext = usePlugin<AuditApi>('audit')
  const api = props.audit !== undefined ? props.audit : fromContext
  const live = useAudit(api)
  const audit = props.current !== undefined ? props.current : live.audit
  const selected = live.selected
  const names = useMemo(() => namesOf(strata?.data), [strata, audit])
  const items = useMemo(() => (audit ? auditItems(audit, names.node, t) : []), [audit, names, t])
  const [open, setOpen] = useState<Partial<Record<AuditGroup, boolean>>>({})
  if (!audit) return null
  const colors = { ...auditColors(theme?.diffScheme ?? 'dark'), ...props.colors }
  const limit = props.limit ?? 40
  const ok = audit.relations.filter((r) => r.status === 'joined').length
  const direct = audit.joins.filter((j) => j.coverage === 'direct').length
  const vars = { upper: names.layer(audit.upper), lower: names.layer(audit.lower) }

  return (
    <div className={cx('kgs-audit', props.className)} style={props.style}>
      <div className="kgs-audit-totals">
        <span>{t('ui.audit-relations', { n: audit.relations.length, ok })}</span>
        <span>{t('ui.audit-joins', { n: audit.joins.length, ok: direct })}</span>
      </div>
      {!items.length && <p className="kgs-audit-clean">{t('ui.audit-clean')}</p>}
      {ORDER.map((g) => {
        const list = items.filter((x) => x.group === g)
        if (!list.length) return null
        const color = g === 'via-path' ? colors.weak : colors.gap
        const shown = open[g] ? list : list.slice(0, limit)
        return (
          <section key={g} className="kgs-audit-group" data-group={g}>
            <h3>
              <i style={{ background: color }} />
              <span>{t(GROUP_KEYS[g], vars)}</span>
              <b>{list.length}</b>
            </h3>
            <ul>
              {shown.map((x) => {
                const on = !!selected && selected.kind === x.target.kind && selected.id === x.target.id
                return (
                  <li key={`${x.target.kind}:${x.target.id}`}>
                    <button type="button" aria-pressed={on} onClick={() => api?.select(on ? null : x.target)}>
                      <span>{x.title}</span>
                      {x.detail && <em>{x.detail}</em>}
                    </button>
                  </li>
                )
              })}
            </ul>
            {list.length > shown.length && (
              <button type="button" className="kgs-audit-more" onClick={() => setOpen((o) => ({ ...o, [g]: true }))}>
                {t('ui.audit-more', { n: list.length - shown.length })}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}
