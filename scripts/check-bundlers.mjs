#!/usr/bin/env node
// 打包器验收（先跑 pnpm build）：把打出来的包装进临时目录里的几个最小项目，各用一种打包器构建，
// 核心、路径、headless、看变化（kgdiff 的三个 .wasm）都走一遍。要联网装包，比较慢，不进 CI；发版前跑。
//
// 两步：
// 1. 构建：每个项目 pnpm install（严格模式，和用户用 pnpm 时一样）、构建，检查产物里有没有 kgdiff 的三个 .wasm。
//    构建失败或者 .wasm 不齐就算没过。
// 2. 运行（--serve）：起一个静态服务器，汇总页用 iframe 逐个打开构建出来的页面，页面跑完把结果写在 body 的
//    data-result 上（"ok …" 或 "err …"），汇总页列成表。wasm 找不到、路径不对这类问题只有在浏览器里才看得出来。
//
// Next.js 用静态导出（output: 'export'）：构建时会做一遍服务端预渲染，导出的页面和别的放在同一个服务器下。
// 不测的：Vite 的开发服务器（Vite 6 要 optimizeDeps.exclude，见 docs/getting-started.md）、Next.js 的 next start。
//
// 参数：--only vite8,webpack5  --keep（留下临时目录）  --serve [端口，缺省 5237]  --dir <目录>（用这个目录，不建临时的）
//       --skip-build（和 --dir、--serve 一起用：不重新构建，直接跑上次构建好的）
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
}
const keep = flag('keep') || flag('serve') || !!value('dir')
const port = Number(value('serve') ?? 5237)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const peer = (name) => pkg.peerDependencies[name]

// ─── 共用的应用代码 ──────────────────────────────────────────────────────────

const DATA = `// 两层的小图：after 多一张表、一条映射，改了一个名字
export const before = {
  version: 2,
  layers: [{ id: 'onto', name: 'Ontology' }, { id: 'table', name: 'Tables' }],
  nodes: [
    { id: 'onto:person', layer: 'onto', label: 'Person', type: 'entity' },
    { id: 'onto:company', layer: 'onto', label: 'Company', type: 'entity' },
    { id: 'onto:investment', layer: 'onto', label: 'Investment', type: 'relation' },
    { id: 'tbl:person', layer: 'table', label: 'person', type: 'table' },
    { id: 'tbl:company', layer: 'table', label: 'company', type: 'table' },
    { id: 'tbl:investment', layer: 'table', label: 'investment', type: 'table' },
  ],
  relations: [
    { source: 'onto:person', target: 'onto:investment' },
    { source: 'onto:investment', target: 'onto:company' },
    { source: 'tbl:investment', target: 'tbl:person', type: 'fk' },
    { source: 'tbl:investment', target: 'tbl:company', type: 'fk' },
    { source: 'onto:person', target: 'tbl:person', type: 'maps-to' },
    { source: 'onto:company', target: 'tbl:company', type: 'maps-to' },
    { source: 'onto:investment', target: 'tbl:investment', type: 'maps-to' },
  ],
}
export const after = {
  ...before,
  nodes: [
    ...before.nodes.map((n) => (n.id === 'onto:company' ? { ...n, label: 'Enterprise' } : n)),
    { id: 'tbl:shareholder', layer: 'table', label: 'shareholder', type: 'table' },
  ],
  relations: [
    ...before.relations,
    { source: 'tbl:shareholder', target: 'tbl:person', type: 'fk' },
    { source: 'onto:investment', target: 'tbl:shareholder', type: 'maps-to' },
  ],
}
`

const RUN = `// 核心、路径、headless、看变化都走一遍；结果写到 body 的 data-result 上
import { Strata } from 'kgstrata'
import { pathPlugin } from 'kgstrata/path'
import { validate } from 'kgstrata/headless'
import { diffPlugin } from 'kgstrata/diff'
import { after, before } from './data.js'

export async function run(diffOptions) {
  const out = document.body.dataset
  try {
    const errors = validate(after).filter((i) => i.level === 'error')
    if (errors.length) throw new Error('validate: ' + errors.map((i) => i.code).join(','))
    const strata = new Strata(document.getElementById('app'), { hero: 'onto' })
    const path = strata.use(pathPlugin())
    const diff = strata.use(diffPlugin(diffOptions))
    strata.setData(after)
    path.play(['onto:investment', 'tbl:shareholder'])
    path.clear()
    const result = await diff.show(before, after)
    if (!result) throw new Error('show returned null')
    out.result = 'ok ' + result.hunks.length + ' changes'
  } catch (e) {
    out.result = 'err ' + (e && e.message ? e.message : String(e))
    console.error(e)
  }
}
`

const MAIN = `import { run } from './run.js'\nrun()\n`
const HTML = (src) => `<!doctype html>
<html><head><meta charset="utf-8"><title>kgstrata bundler check</title>
<style>html,body,#app{margin:0;width:100%;height:100%}</style></head>
<body><div id="app"></div><script type="module" src="${src}"></script></body></html>
`

// ─── 各打包器 ────────────────────────────────────────────────────────────────

/**
 * name：目录名；deps：打包器自己的依赖；files：项目里的文件；build：构建命令（在项目目录里跑）；
 * out：产物目录（相对项目）；extra：package.json 里另加的字段
 */
const TARGETS = [
  {
    name: 'vite8',
    deps: { vite: '^8' },
    files: { 'index.html': HTML('./src/main.js'), 'src/main.js': MAIN },
    build: [['pnpm', ['exec', 'vite', 'build', '--base', './']]],
    out: 'dist',
  },
  {
    name: 'vite6',
    deps: { vite: '^6' },
    files: { 'index.html': HTML('./src/main.js'), 'src/main.js': MAIN },
    build: [['pnpm', ['exec', 'vite', 'build', '--base', './']]],
    out: 'dist',
  },
  {
    name: 'webpack5',
    deps: { webpack: '^5', 'webpack-cli': '^6', 'html-webpack-plugin': '^5' },
    files: {
      'src/main.js': MAIN,
      'webpack.config.js': `import HtmlWebpackPlugin from 'html-webpack-plugin'
export default {
  mode: 'production',
  entry: './src/main.js',
  output: { path: new URL('./dist', import.meta.url).pathname, clean: true },
  plugins: [new HtmlWebpackPlugin({ templateContent: ${JSON.stringify(HTML('').replace('<script type="module" src=""></script>', ''))} })],
  // kgdiff 的 compute 里有一处只在 Node 里走的 import()：无害，见 docs/getting-started.md
  ignoreWarnings: [{ module: /@kgdiff[\\\\/]compute/, message: /Critical dependency/ }],
}
`,
    },
    build: [['pnpm', ['exec', 'webpack']]],
    out: 'dist',
  },
  {
    name: 'rollup',
    deps: { rollup: '^4', '@rollup/plugin-node-resolve': '^16', '@web/rollup-plugin-import-meta-assets': '^2' },
    files: {
      'src/main.js': MAIN,
      'public/index.html': HTML('./main.js'),
      'rollup.config.js': `import { nodeResolve } from '@rollup/plugin-node-resolve'
import { importMetaAssets } from '@web/rollup-plugin-import-meta-assets'
export default { input: 'src/main.js', output: { dir: 'dist', format: 'es' }, plugins: [nodeResolve({ browser: true }), importMetaAssets()] }
`,
    },
    build: [['pnpm', ['exec', 'rollup', '-c']], ['node', ['-e', "require('fs').cpSync('public/index.html','dist/index.html')"]]],
    out: 'dist',
  },
  {
    name: 'esbuild',
    deps: { esbuild: '^0.25' },
    files: {
      // esbuild 不处理 new URL(…, import.meta.url)：用 file 加载器拿到 .wasm 的路径，交给 wasm 选项
      'src/main.js': `import { run } from './run.js'
import compute from '@kgdiff/compute/compute.wasm'
import layout from '@kgdiff/compute/layout.wasm'
import formats from '@kgdiff/compute/formats.wasm'
run({ wasm: { compute, layout, formats } })
`,
      'public/index.html': HTML('./main.js'),
      // 用 JS 接口：pnpm 给原生二进制做的 bin 垫片在有的机器上跑不起来
      'build.mjs': `import { build } from 'esbuild'
import { cpSync } from 'node:fs'
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', outdir: 'dist', loader: { '.wasm': 'file' } })
cpSync('public/index.html', 'dist/index.html')
`,
    },
    build: [['node', ['build.mjs']]],
    out: 'dist',
  },
  {
    name: 'parcel',
    deps: { parcel: '^2' },
    extra: { '@parcel/resolver-default': { packageExports: true } },
    files: { 'index.html': HTML('./src/main.js'), 'src/main.js': MAIN },
    build: [['pnpm', ['exec', 'parcel', 'build', 'index.html', '--no-cache', '--dist-dir', 'dist', '--public-url', './']]],
    out: 'dist',
  },
  ...['turbopack', 'webpack'].map((bundler) => ({
    name: `next16-${bundler}`,
    deps: { next: '^16', react: '^19', 'react-dom': '^19' },
    files: {
      'next.config.mjs': `export default { output: 'export', basePath: '/next16-${bundler}' }\n`,
      'app/layout.js': `export default function RootLayout({ children }) {
  return <html lang="en"><body style={{ margin: 0, height: '100vh' }}>{children}</body></html>
}
`,
      'app/page.js': `import { Viewer } from './viewer.js'
export default function Page() {
  return <main style={{ height: '100vh' }}><Viewer /></main>
}
`,
      // React 入口：StrataCanvas 在服务端渲染一个空容器，到浏览器里再建实例
      'app/viewer.js': `'use client'
import { useCallback } from 'react'
import { StrataCanvas, LayerList } from 'kgstrata/react'
import { diffPlugin } from 'kgstrata/diff'
import { pathPlugin } from 'kgstrata/path'
import { after, before } from '../src/data.js'

const PLUGINS = [pathPlugin(), diffPlugin()]

export function Viewer() {
  const onReady = useCallback((strata, [path, diff]) => {
    path.play(['onto:investment', 'tbl:shareholder'])
    path.clear()
    diff.show(before, after).then(
      (r) => (document.body.dataset.result = r ? 'ok ' + r.hunks.length + ' changes' : 'err show returned null'),
      (e) => (document.body.dataset.result = 'err ' + e.message),
    )
  }, [])
  return (
    <StrataCanvas data={after} plugins={PLUGINS} options={{ hero: 'onto' }} onReady={onReady}>
      <LayerList />
    </StrataCanvas>
  )
}
`,
    },
    build: [['pnpm', ['exec', 'next', 'build', ...(bundler === 'webpack' ? ['--webpack'] : [])]]],
    out: 'out',
  })),
]

const only = value('only')?.split(',')
const targets = only ? TARGETS.filter((t) => only.includes(t.name)) : TARGETS
if (!targets.length) {
  console.error(`没有这些打包器：${only}。有：${TARGETS.map((t) => t.name).join(', ')}`)
  process.exit(1)
}

// ─── 构建 ────────────────────────────────────────────────────────────────────

const work = value('dir') ? resolve(value('dir')) : mkdtempSync(join(tmpdir(), 'kgstrata-bundlers-'))
mkdirSync(work, { recursive: true })
const site = join(work, 'site')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 << 20 })
const tail = (err) => String(err.stdout ?? '') + String(err.stderr ?? '')

if (!existsSync(join(ROOT, 'dist/index.js'))) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
if (!flag('skip-build')) {
  for (const f of readdirSync(work)) if (f.endsWith('.tgz')) rmSync(join(work, f))
  run('pnpm', ['pack', '--pack-destination', work], ROOT)
}
const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'))
console.log(`${tgz} → ${work}\n`)

/** 目录里所有文件（相对路径） */
const walk = (dir, base = dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p, base) : [p.slice(base.length + 1)]
  })

const results = []
const skipBuild = flag('skip-build')
if (skipBuild) {
  for (const t of targets) {
    const ok = existsSync(join(site, t.name, 'index.html'))
    results.push({ name: t.name, status: ok ? 'pass' : 'fail', note: ok ? '上次构建的' : '没有上次构建的产物' })
  }
}
for (const t of skipBuild ? [] : targets) {
  const dir = join(work, t.name)
  rmSync(dir, { recursive: true, force: true })
  const files = { 'src/data.js': DATA, 'src/run.js': RUN, ...t.files }
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), text)
  }
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `check-${t.name}`,
        private: true,
        type: 'module',
        dependencies: {
          kgstrata: `file:../${tgz}`,
          three: pkg.devDependencies.three,
          '@kgdiff/core': peer('@kgdiff/core'),
          '@kgdiff/scene': peer('@kgdiff/scene'),
          '@kgdiff/compute': peer('@kgdiff/compute'),
          ...t.deps,
        },
        ...t.extra,
      },
      null,
      2,
    ),
  )
  // 一个个单独的项目（不归仓库的 workspace 管）；放行打包器自己的安装脚本；刚发布的 kgdiff 也装（只是验收用的临时项目）
  writeFileSync(
    join(dir, 'pnpm-workspace.yaml'),
    `minimumReleaseAge: 0\nallowBuilds:\n${['esbuild', '@parcel/watcher', '@swc/core', 'lmdb', 'msgpackr-extract', 'sharp', 'unrs-resolver'].map((n) => `  '${n}': true\n`).join('')}`,
  )
  cpSync(join(ROOT, '.npmrc'), join(dir, '.npmrc'))

  const t0 = Date.now()
  let status = 'pass'
  let note = ''
  process.stdout.write(`${t.name.padEnd(18)}`)
  try {
    run('pnpm', ['install', '--fetch-timeout=600000'], dir)
  } catch (err) {
    status = 'fail'
    note = `安装失败：${tail(err).trim().split('\n').slice(-3).join(' ')}`
  }
  if (status === 'pass') {
    try {
      for (const [cmd, args] of t.build) run(cmd, args, dir)
    } catch (err) {
      status = 'fail'
      note = `构建失败：${tail(err).trim().split('\n').slice(-5).join(' ')}`
    }
  }
  if (status === 'pass') {
    const out = join(dir, t.out)
    const all = existsSync(out) ? walk(out) : []
    const wasm = all.filter((f) => f.endsWith('.wasm'))
    if (!all.includes('index.html')) {
      status = 'fail'
      note = '产物里没有 index.html'
    } else if (wasm.length !== 3) {
      status = 'fail'
      note = `产物里 .wasm 有 ${wasm.length} 个，应该是 3 个`
    } else note = `${wasm.length} 个 .wasm`
    if (status === 'pass') cpSync(out, join(site, t.name), { recursive: true })
  }
  const s = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`${status === 'pass' ? '构建通过' : '没过'}  ${s}s  ${note}`)
  results.push({ name: t.name, status, note })
}

console.log('\n| 打包器 | 构建 | 说明 |\n|---|---|---|')
for (const r of results) console.log(`| ${r.name} | ${r.status} | ${r.note.replace(/\|/g, '\\|')} |`)
const failed = results.filter((r) => r.status !== 'pass')

if (!flag('serve')) {
  if (!keep) rmSync(work, { recursive: true, force: true })
  else console.log(`\n临时目录留着：${work}`)
  if (!failed.length) console.log('\n只查了构建。要在浏览器里跑一遍：pnpm check:bundlers --serve，打开它给的地址')
  process.exit(failed.length ? 1 : 0)
}

// ─── 运行：静态服务器 + 汇总页 ──────────────────────────────────────────────

const passed = results.filter((r) => r.status === 'pass').map((r) => r.name)
writeFileSync(
  join(site, 'index.html'),
  `<!doctype html>
<html><head><meta charset="utf-8"><title>kgstrata bundler check</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; background: #fff; color: #111 }
  table { border-collapse: collapse; margin-bottom: 16px } td, th { border: 1px solid #ccc; padding: 4px 10px; text-align: left }
  .ok { color: #08752e } .err { color: #b00020 } .wait { color: #777 }
  iframe { width: 320px; height: 220px; border: 1px solid #ccc; margin: 0 8px 8px 0 }
</style></head>
<body>
<h1>kgstrata bundler check</h1>
<table><thead><tr><th>bundler</th><th>result</th></tr></thead><tbody id="rows"></tbody></table>
<div id="frames"></div>
<script>
  const names = ${JSON.stringify(passed)}
  const rows = document.getElementById('rows')
  const frames = document.getElementById('frames')
  // 结果：每一行是 "名字 结果"；全部有了结果，body 上写 data-done
  for (const name of names) {
    const tr = document.createElement('tr')
    tr.innerHTML = '<td></td><td class="wait">running…</td>'
    tr.firstChild.textContent = name
    rows.append(tr)
    const f = document.createElement('iframe')
    f.src = './' + name + '/'
    frames.append(f)
    const started = Date.now()
    const poll = setInterval(() => {
      let r
      try { r = f.contentDocument && f.contentDocument.body && f.contentDocument.body.dataset.result } catch (e) { r = 'err ' + e.message }
      if (!r && Date.now() - started > 60000) r = 'err no result after 60 s'
      if (!r) return
      clearInterval(poll)
      tr.lastChild.textContent = r
      tr.lastChild.className = r.startsWith('ok') ? 'ok' : 'err'
      if ([...rows.children].every((x) => x.lastChild.className !== 'wait')) {
        document.body.dataset.done = [...rows.children].every((x) => x.lastChild.className === 'ok') ? 'ok' : 'err'
      }
    }, 300)
  }
</script>
</body></html>
`,
)

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' }
createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = join(site, p)
  if (!file.startsWith(site)) return res.writeHead(403).end()
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  // Next.js 的静态导出：/next16-x/ 下的页面是 index.html，别的路由是 名字.html
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`
  if (!existsSync(file)) return res.writeHead(404).end('not found')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(port, () => {
  console.log(`\n打开 http://localhost:${port}/ ，每个打包器一行结果；全部是 ok 才算过（页面 body 上的 data-done 是 ok / err）`)
  console.log(`临时目录：${work}（Ctrl+C 停下，目录留着）`)
  if (failed.length) console.log(`构建没过的不在页面上：${failed.map((r) => r.name).join(', ')}`)
})
