#!/usr/bin/env node
// 构建后检查库的产物（先跑 pnpm build）：
// - 七个入口的 js 和 d.ts 都在（核心四个，React 三个），React 面板的样式表在
// - 核心、路径回放、不带渲染的入口、React 入口和 React 的路径面板（连同它们引入的共用块）里没有 @kgdiff/；不带渲染的入口里没有 three
// - 核心的四个入口里没有 react；React 的入口引着 react（作为外部包），没把它打进来
// - three 没被打进来；没有 .wasm
// - 类型声明按包名能解析（bundler 和 NodeNext 两种模式），path 插件的模块增强仍然成立
// - pnpm pack 要打进包里的只有 dist（js、d.ts、React 面板的 css）、README（英文和中文）、LICENSE、CHANGELOG、package.json
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const CORE_ENTRIES = ['index', 'headless', 'path/index', 'diff/index']
const REACT_ENTRIES = ['react/index', 'react/path', 'react/diff']
const ENTRIES = [...CORE_ENTRIES, ...REACT_ENTRIES]
const STYLES = 'react/styles.css'
/** 所有 js 加起来的上限。three 本身未压缩一百多万字节，打进来一定超 */
const MAX_JS_BYTES = 400_000

const failures = []
const fail = (msg) => failures.push(msg)
const read = (p) => readFileSync(p, 'utf8')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
}

if (!existsSync(DIST)) {
  console.error('dist/ 不存在：先跑 pnpm build')
  process.exit(1)
}

// 1. 入口都在
for (const e of ENTRIES) {
  for (const ext of ['.js', '.d.ts']) if (!existsSync(join(DIST, e + ext))) fail(`缺 dist/${e}${ext}`)
}
if (!existsSync(join(DIST, STYLES))) fail(`缺 dist/${STYLES}`)

/** 去掉注释：注释里的用法示例不算 */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

/** 一个文件里静态和动态引入的来源 */
function specifiersOf(code) {
  const src = stripComments(code)
  const out = []
  for (const m of src.matchAll(/(?:^|[\s;}])(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  for (const m of src.matchAll(/(?:^|[\s;])import\s*\(?\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  return out
}

/** 从一个产物文件出发，顺着相对引入走到的所有文件 */
function closure(file, ext) {
  const seen = new Set()
  const visit = (f) => {
    if (seen.has(f)) return
    seen.add(f)
    for (const spec of specifiersOf(read(f))) {
      if (!spec.startsWith('.')) continue
      const base = resolve(dirname(f), spec)
      const cand = [base, base.replace(/\.js$/, ext), `${base}${ext}`, join(base, `index${ext}`)].find((c) => existsSync(c) && statSync(c).isFile())
      if (!cand) fail(`${relative(ROOT, f)} 引入的 ${spec} 在 dist 里找不到`)
      else visit(cand)
    }
  }
  visit(file)
  return [...seen]
}

const textOf = (files) => files.map(read).join('\n')

// 2. 引入闭包的边界（js 和 d.ts 都看：类型也会把声明拉进来）
for (const e of ['index', 'headless', 'path/index', 'react/index', 'react/path']) {
  for (const ext of ['.js', '.d.ts']) {
    const f = join(DIST, e + ext)
    if (!existsSync(f)) continue
    const files = closure(f, ext)
    const bad = files.filter((x) => read(x).includes('@kgdiff/'))
    if (bad.length) fail(`dist/${e}${ext} 的引入闭包里有 @kgdiff/：${bad.map((x) => relative(DIST, x)).join(', ')}`)
  }
}
for (const ext of ['.js', '.d.ts']) {
  const f = join(DIST, `headless${ext}`)
  if (!existsSync(f)) continue
  for (const x of closure(f, ext)) {
    if (specifiersOf(read(x)).some((s) => s === 'three' || s.startsWith('three/')))
      fail(`dist/headless${ext} 的引入闭包里引入了 three：${relative(DIST, x)}`)
  }
}
// 核心的四个入口不带 react（js 和 d.ts 都看）
const isReact = (s) => /^(react|react-dom)(\/|$)/.test(s)
for (const e of CORE_ENTRIES) {
  for (const ext of ['.js', '.d.ts']) {
    const f = join(DIST, e + ext)
    if (!existsSync(f)) continue
    for (const x of closure(f, ext)) {
      if (specifiersOf(read(x)).some(isReact)) fail(`dist/${e}${ext} 的引入闭包里引入了 react：${relative(DIST, x)}`)
    }
  }
}
// React 的入口确实引着 react（作为外部包）
for (const e of REACT_ENTRIES) {
  const f = join(DIST, `${e}.js`)
  if (existsSync(f) && !closure(f, '.js').some((x) => specifiersOf(read(x)).some(isReact))) fail(`dist/${e}.js 没有引入 react：是不是被打进来了？`)
}
// 看变化的入口确实还引着 kgdiff（作为外部包，不是打进来的）
// （看闭包：react/diff 也用到看变化的代码时，它会落进共用块，入口文件只是转出）
for (const e of ['diff/index', 'react/diff'])
  if (existsSync(join(DIST, `${e}.js`)) && !closure(join(DIST, `${e}.js`), '.js').some((x) => specifiersOf(read(x)).some((s) => s.startsWith('@kgdiff/'))))
    fail(`dist/${e}.js 没有引入 @kgdiff/*：是不是被打进来了？`)

// 3. three、kgdiff 没被打进来，没有 wasm
const all = walk(DIST)
const js = all.filter((f) => f.endsWith('.js'))
const jsBytes = js.reduce((n, f) => n + statSync(f).size, 0)
if (jsBytes > MAX_JS_BYTES) fail(`dist 里的 js 共 ${jsBytes} 字节，超过上限 ${MAX_JS_BYTES}：是不是把依赖打进来了？`)
const THREE_IMPL = [/class\s+WebGLRenderer\b/, /function\s+WebGLRenderer\s*\(/, /\bREVISION\s*=\s*['"]\d+/, /class\s+OrbitControls\b/, /class\s+EffectComposer\b/]
const KGDIFF_IMPL = [/WebAssembly\.(instantiate|compile)/]
const REACT_IMPL = [/__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE/, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/, /Symbol\.for\(['"]react\.element['"]\)/]
for (const f of js) {
  const code = read(f)
  for (const re of [...THREE_IMPL, ...KGDIFF_IMPL, ...REACT_IMPL]) if (re.test(code)) fail(`${relative(ROOT, f)} 里有外部包的实现代码（${re}）`)
}
const wasm = all.filter((f) => f.endsWith('.wasm'))
if (wasm.length) fail(`dist 里有 wasm：${wasm.map((f) => relative(ROOT, f)).join(', ')}`)

// 4. 类型按包名解析，模块增强成立。两种解析方式都查：打包工具（bundler）和 Node 的 ESM（NodeNext，要求相对引入带扩展名）
for (const [mode, config] of [
  ['bundler', 'tsconfig.json'],
  ['NodeNext', 'tsconfig.nodenext.json'],
]) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'scripts/pack-types', config)], {
      cwd: ROOT,
      stdio: 'pipe',
    })
  } catch (e) {
    fail(`按包名检查类型失败（moduleResolution: ${mode}）：\n${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`)
  }
}

// 5. 包里只有该有的东西
// README.zh-CN.md 是中文版的 README：pnpm pack 按 README* 自动带上它
const ALLOWED = [/^package\.json$/, /^README(\.zh-CN)?\.md$/, /^LICENSE$/, /^CHANGELOG\.md$/, /^dist\/.+\.(js|d\.ts)$/, /^dist\/react\/styles\.css$/]
const REQUIRED = ['package.json', 'README.md', 'LICENSE', `dist/${STYLES}`, 'dist/react/styles.d.ts', ...ENTRIES.flatMap((e) => [`dist/${e}.js`, `dist/${e}.d.ts`])]
let packed = []
try {
  const out = execFileSync('pnpm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  packed = JSON.parse(out.slice(out.indexOf('{'))).files.map((f) => f.path.split('\\').join(posix.sep))
} catch (e) {
  fail(`pnpm pack --dry-run 失败：${e.message}`)
}
const stray = packed.filter((p) => !ALLOWED.some((re) => re.test(p)))
if (stray.length) fail(`包里有不该有的文件：${stray.join(', ')}`)
for (const r of REQUIRED) if (packed.length && !packed.includes(r)) fail(`包里缺 ${r}`)

// 报告
console.log(`dist 里的 js 共 ${(jsBytes / 1024).toFixed(1)} KiB，包里 ${packed.length} 个文件`)
for (const e of ENTRIES) {
  const f = join(DIST, `${e}.js`)
  if (!existsSync(f)) continue
  const files = closure(f, '.js')
  const bytes = files.reduce((n, x) => n + statSync(x).size, 0)
  console.log(`  ${`${e}.js`.padEnd(18)} 连同共用块 ${(bytes / 1024).toFixed(1).padStart(6)} KiB`)
}
if (failures.length) {
  console.error(`\ncheck:pack 失败（${failures.length} 处）：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('check:pack 通过')
