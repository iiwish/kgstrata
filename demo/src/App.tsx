import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Strata, StrataOptions } from 'kgstrata'
import { diffPlugin, type DiffApi, type StrataDiff } from 'kgstrata/diff'
import { pathPlugin, type PathApi } from 'kgstrata/path'
import { FollowToggle, HeroMixSlider, LayerList, NodeTip, SpreadSlider, StrataCanvas, ViewButtons, useStrataState } from 'kgstrata/react'
import { DiffPanel, changesByLayer } from 'kgstrata/react/diff'
import { PathList } from 'kgstrata/react/path'
import { DIFF_REPLACES, diffAfter, groups, layered, layeredPaths, panorama, paths, stress, type DemoLang } from './data'

type Mode = 'panorama' | 'path' | 'diff'
/** 引擎和装上的两个插件：只画 3D 图的话只要 strata */
type Engine = { strata: Strata; path: PathApi; diff: DiffApi }

// 地址里带 ?stress=3000 时换成合成的大图，看性能
const QUERY = new URLSearchParams(location.search)
const STRESS = Number(QUERY.get('stress')) || 0
// ?hero=table 让物理表当主角；?follow=1 让主角跟着选中和路径走
// ?hidden=onto 一开始就隐藏本体层（多个用逗号隔开）
// 默认三层：指标 / 本体 / 物理表。?layers=2 只留本体和物理表，?layers=4 再加一层看板
const LAYERS = Math.min(4, Math.max(2, Number(QUERY.get('layers')) || 3))
// ?lang=en / ?lang=zh 选演示数据和界面的语言；不写就跟浏览器
const LANG: DemoLang = (QUERY.get('lang') ?? navigator.language).toLowerCase().startsWith('zh') ? 'zh' : 'en'
const ZH = LANG === 'zh'
document.documentElement.lang = ZH ? 'zh-CN' : 'en'
const GROUPS = groups(LANG)
// 多层数据多一条从指标出发的路径
const ALL_PATHS = STRESS ? paths(LANG) : [...layeredPaths(LAYERS, LANG), ...paths(LANG)]
/** 换语言：带着别的参数重新打开 */
function langHref(lang: DemoLang) {
  const q = new URLSearchParams(location.search)
  q.set('lang', lang)
  return `?${q}`
}
// 节点画成什么样按类型配：数据里只写 type。内置了 relation、table、metric 等几种，这里补上看板
const OPTIONS: StrataOptions = {
  hero: QUERY.get('hero') ?? undefined,
  followHero: QUERY.get('follow') === '1',
  hidden: (QUERY.get('hidden') ?? '').split(',').filter(Boolean),
  nodeStyles: { board: { shape: 'page' } },
  locale: ZH ? 'zh-CN' : 'en',
}
// 路径回放、看变化是插件：不装就只是一张 3D 图
const PLUGINS = [pathPlugin(), diffPlugin()] as const

export function App() {
  const [kit, setKit] = useState<Engine | null>(null)
  const engine = kit?.strata ?? null
  const [mode, setModeState] = useState<Mode>('panorama')
  const [diff, setDiff] = useState<StrataDiff | null>(null)
  const data = useMemo(() => (STRESS ? stress(STRESS, LANG) : layered(LAYERS, LANG)), [])
  // 看变化：在当前这份数据上做一组改动（大图用两层的那份演示）
  const versions = useMemo(() => {
    const base = STRESS ? panorama(LANG) : data
    return [base, diffAfter(base, LANG)] as const
  }, [data])

  const onReady = useCallback((e: Strata, [p, d]: [PathApi, DiffApi]) => {
    setKit({ strata: e, path: p, diff: d })
    // 看变化时展开、收起会重新比一遍：差异换成新的
    const offEnter = d.on('enter', setDiff)
    const offExit = d.on('exit', () => setDiff(null))
    // 开发时：控制台里能拿到引擎和两个插件；也能用 strata-debug 事件在页面里求值（s 引擎、p 路径、d 变化），结果写到 body 的 data-debug 上
    let offDebug = () => {}
    if (import.meta.env.DEV) {
      Object.assign(window as unknown as Record<string, unknown>, { strata: e, strataPath: p, strataDiff: d })
      const onDebug = (ev: Event) => {
        try {
          document.body.dataset.debug = JSON.stringify(new Function('s', 'p', 'd', String((ev as CustomEvent).detail))(e, p, d))
        } catch (err) {
          document.body.dataset.debug = `ERR ${String(err)}`
        }
      }
      document.addEventListener('strata-debug', onDebug)
      offDebug = () => document.removeEventListener('strata-debug', onDebug)
    }
    return () => {
      offEnter()
      offExit()
      offDebug()
      setKit(null)
      setDiff(null)
    }
  }, [])

  const setMode = async (m: Mode) => {
    if (!kit || m === mode) return
    setModeState(m)
    if (m === 'diff') {
      kit.path.clear()
      const d = await kit.diff.show(versions[0], versions[1], { replaces: DIFF_REPLACES })
      // 等的时候切走了：插件已经作废这次请求
      if (!d) return
      kit.diff.setView({ layer: 'union', selectedHunk: -1, t: 0 })
      kit.strata.shot('overview')
      return
    }
    // 离开变化：在看就交还给全景；还在等 kgdiff 的那次也作废
    kit.diff.exit()
    if (m === 'panorama') kit.path.clear()
  }

  // 右侧面板挡住的宽度：路径、变化模式有宽面板，全景只有窄图例
  useEffect(() => {
    if (!engine) return
    const wide = window.innerWidth > 760
    engine.setInset(!wide ? 0 : mode === 'panorama' ? (STRESS ? 0 : 200) : 350)
  }, [engine, mode])

  // 每层的节点数从数据里数，只数顶层的（表里收着的字段不算，和画出来的对得上）；看变化时，隐藏的层里有几处变化标在徽标上（层的列表以引擎为准：两版合起来可能多出层）
  const layers = useStrataState(engine, 'layers')
  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const n of data.nodes) if (n.parent === undefined) out.set(n.layer, (out.get(n.layer) ?? 0) + 1)
    return out
  }, [data])
  const badges = useMemo(() => (mode === 'diff' && diff ? changesByLayer(diff, layers) : undefined), [mode, diff, layers])

  return (
    <div className="app">
      <StrataCanvas className="stage" data={data} options={OPTIONS} plugins={PLUGINS} onReady={onReady}>
        <header className="brand">
          <span className="mark">kgstrata</span>
          <span className="sub">
            {STRESS ? (ZH ? `合成数据 · ${STRESS} 个本体` : `Synthetic data · ${STRESS} concepts`) : `${data.layers.map((l) => l.name).join(' × ')} · ${ZH ? '演示数据' : 'demo data'}`}
          </span>
        </header>

        <nav className="langs" aria-label={ZH ? '语言' : 'Language'}>
          <a href={langHref('zh')} aria-current={ZH ? 'true' : undefined}>中文</a>
          <a href={langHref('en')} aria-current={ZH ? undefined : 'true'}>EN</a>
        </nav>

        <nav className="modes" role="tablist">
          {(
            [
              ['panorama', ZH ? '全景' : 'Overview'],
              ['path', ZH ? '路径' : 'Paths'],
              ['diff', ZH ? '变化' : 'Changes'],
            ] as const
          ).map(([m, word]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
              {word}
            </button>
          ))}
        </nav>

        <aside className="layers kgs-panel">
          <LayerList counts={counts} badges={badges} />
          <FollowToggle />
          {/* 正好两张图时，「主次」滑杆演示连续过渡：左头第一张图当主角，右头第二张，中间两层一样大 */}
          <HeroMixSlider />
          <SpreadSlider />
        </aside>

        <ViewButtons className="cams" />

        {mode === 'panorama' && !STRESS && (
          <aside className="side kgs-panel legend">
            <ul>
              {GROUPS.map((g) => (
                <li key={g.id} onMouseEnter={() => engine?.highlightGroup(g.id)} onMouseLeave={() => engine?.highlightGroup(null)}>
                  <i style={{ background: g.color, boxShadow: `0 0 10px ${g.color}` }} />
                  {g.name}
                </li>
              ))}
            </ul>
          </aside>
        )}

        {mode === 'path' && (
          <aside className="side kgs-panel">
            <PathList paths={ALL_PATHS} />
          </aside>
        )}

        {mode === 'diff' && diff && (
          <aside className="side kgs-panel">
            <DiffPanel />
          </aside>
        )}

        <NodeTip />
      </StrataCanvas>
    </div>
  )
}
