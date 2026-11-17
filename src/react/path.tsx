// 路径回放的面板 kgstrata/react/path：<PathList> 列出几个问题，点一个就走那条路径，展开看走到第几步。
// 只引入核心和路径回放的入口，不带 kgdiff。

import { useEffect, useState } from 'react'
import type { Strata } from '../engine.js'
import { message } from '../locale.js'
import { DIGITS, type PathApi, type PathProgress } from '../path/index.js'
import type { StrataData } from '../types.js'
import { useLocale, usePlugin, useStrataOr } from './context.js'
import type { PanelProps } from './panels.js'
import { cx, stepStatus } from './store.js'

/** 一个问题：问的什么、走哪些节点（id，按顺序） */
export interface PathItem {
  id: string
  question: string
  nodes: string[]
}

export interface PathListProps extends PanelProps {
  paths: readonly PathItem[]
  /** 路径插件的接口；不给就用 <StrataCanvas plugins> 里装的那个（名字 'path'） */
  path?: PathApi | null
  /** 每一步显示的名字和所在的层；缺省从实例的数据（strata.data）里查 */
  nodeInfo?: (id: string) => { label: string; layer: string }
  /** 正在看哪个问题。给了就是受控的：配合 onActiveChange */
  active?: string | null
  onActiveChange?: (id: string | null) => void
  /** 不看插件，直接给走到哪儿了（服务端渲染、测试） */
  live?: PathProgress
}

const NO_LIVE: PathProgress = { ids: [], reached: 0 }

/** 从数据里查节点的名字和层名；没有这个节点就原样显示 id */
export function nodeInfoFrom(data: StrataData | null | undefined): (id: string) => { label: string; layer: string } {
  return (id) => {
    const n = data?.nodes.find((x) => x.id === id)
    return n ? { label: n.label ?? n.id, layer: data!.layers.find((l) => l.id === n.layer)?.name ?? '' } : { label: id, layer: '' }
  }
}

/** 路径插件的进度当 React 状态：step 事件来了才变；clear 以后（ids 为 null）通知一次 */
function usePathProgress(api: PathApi | null, fixed: PathProgress | undefined) {
  const [live, setLive] = useState<{ api: PathApi | null; v: PathProgress; cleared: boolean }>(() => ({ api, v: api?.live ?? NO_LIVE, cleared: false }))
  useEffect(() => {
    if (!api || fixed) return
    setLive({ api, v: api.live, cleared: false })
    return api.on('step', (v) => setLive({ api, v, cleared: api.ids === null }))
  }, [api, fixed])
  if (fixed) return { v: fixed, cleared: false }
  return live.api === api ? live : { v: NO_LIVE, cleared: false }
}

/**
 * 问题列表：点一个问题，路径插件走它（play），下面列出每一步，点亮了的高亮，隐藏层里被跳过的划掉。
 */
export function PathList(props: PathListProps) {
  const strata: Strata | null = useStrataOr(props.strata)
  const locale = useLocale(strata, props.locale)
  const fromContext = usePlugin<PathApi>('path')
  const api = props.path !== undefined ? props.path : fromContext
  const progress = usePathProgress(api, props.live)
  const [own, setOwn] = useState<string | null>(null)
  const controlled = props.active !== undefined
  // 路径被别处清掉了（换数据、进看变化）：不受控时这边也收起
  useEffect(() => {
    if (progress.cleared && !controlled) setOwn(null)
  }, [progress.cleared, controlled])
  const active = controlled ? props.active! : own
  const info = props.nodeInfo ?? nodeInfoFrom(strata?.data)
  const live = progress.v

  const choose = (p: PathItem) => {
    if (!controlled) setOwn(p.id)
    props.onActiveChange?.(p.id)
    api?.play(p.nodes)
  }

  return (
    <div className={cx('kgs-paths', props.className)} style={props.style} role="list" aria-label={message(locale, 'ui.paths')}>
      {props.paths.map((p) => {
        const on = active === p.id
        return (
          <section key={p.id} className={cx('kgs-path', on && 'kgs-on')} role="listitem">
            <button type="button" className="kgs-path-question" aria-expanded={on} onClick={() => choose(p)}>
              {p.question}
            </button>
            {on && (
              <ol className="kgs-steps">
                {p.nodes.map((id, k) => {
                  const n = info(id)
                  const status = stepStatus(id, live)
                  return (
                    <li key={id} className={cx('kgs-step', status === 'lit' && 'kgs-lit', status === 'skipped' && 'kgs-skipped')} title={status === 'skipped' ? message(locale, 'ui.step-skipped') : undefined}>
                      <b>{DIGITS[k] ?? k + 1}</b>
                      <span>{n.label}</span>
                      <em>{n.layer}</em>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}
