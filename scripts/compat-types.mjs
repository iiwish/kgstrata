#!/usr/bin/env node
// 类型声明的兼容矩阵（先跑 pnpm build）：把打出来的包装进临时目录，在几个 TypeScript × @types/three 的版本组合、
// 两种 moduleResolution（bundler、nodenext）下，skipLibCheck: false 引入全部入口做类型检查。
// 要联网装包，比较慢，不进 CI 的必跑步骤：pnpm check:types-compat
//
// 每个组合另跑一个只引 three 的对照文件：对照也失败，说明是 @types/three 自己在这个 TS 版本下过不了（比如它引用了这个版本的
// lib 里没有的全局类型），和 kgstrata 无关，单独标出来。
//
// 参数：--ts 5.2,5.6,latest  --three 0.160,0.170,0.187  --keep（留下临时目录）
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1].split(',') : def
}
const TS = arg('ts', ['5.2', '5.6', 'latest'])
const THREE = arg('three', ['0.160', '0.170', '0.187'])
const MODES = ['bundler', 'nodenext']
const keep = process.argv.includes('--keep')

const work = mkdtempSync(join(tmpdir(), 'kgstrata-compat-'))
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })

// 1. 打包：和发出去的一样
run('pnpm', ['pack', '--pack-destination', work], ROOT)
const tgz = join(work, readdirSync(work).find((f) => f.endsWith('.tgz')))

// 检查文件：引入全部入口（check:pack 用的那一份），外加只引 three 的对照
const CHECK = join(ROOT, 'scripts/pack-types/check.ts')
const CONTROL = `import type { Scene, Group, WebGLRenderer } from 'three'\nexport type T = [Scene, Group, WebGLRenderer]\n`

const tsconfig = (mode, file) => ({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: mode === 'bundler' ? 'ESNext' : 'NodeNext',
    moduleResolution: mode === 'bundler' ? 'bundler' : 'NodeNext',
    jsx: 'react-jsx',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
  },
  files: [file],
})

/** 一条输出里最有用的那几行 */
const firstErrors = (out) =>
  out
    .split('\n')
    .filter((l) => /error TS\d+/.test(l))
    .slice(0, 3)
    .map((l) => l.replace(/^.*node_modules\//, 'node_modules/').trim())

const results = []
for (const three of THREE) {
  // 2. 每个 @types/three 版本装一次：几个 TypeScript 版本用别名装在一起
  const dir = join(work, `three-${three}`)
  mkdirSync(dir)
  const deps = {
    kgstrata: `file:${tgz}`,
    '@types/three': `~${three}.0`,
    three: `~${three}.0`,
    '@types/react': '^19.0.0',
    react: '^19.0.0',
    'react-dom': '^19.0.0',
    '@kgdiff/core': '^0.12.3',
    '@kgdiff/layout': '^0.12.3',
    '@kgdiff/scene': '^0.12.3',
    '@kgdiff/compute': '^0.12.3',
  }
  for (const ts of TS) deps[`ts-${ts}`] = `npm:typescript@${ts === 'latest' ? 'latest' : `~${ts}.0`}`
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'compat', private: true, type: 'module', dependencies: deps }, null, 2))
  process.stdout.write(`安装 @types/three ${three} …`)
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps'], dir)
  console.log(' 好了')
  copyFileSync(CHECK, join(dir, 'check.ts'))
  writeFileSync(join(dir, 'control.ts'), CONTROL)
  const threeVersion = JSON.parse(run('node', ['-p', 'JSON.stringify(require("@types/three/package.json").version)'], dir))
  for (const ts of TS) {
    const tsc = join(dir, 'node_modules', `ts-${ts}`, 'bin', 'tsc')
    const tsVersion = run('node', [tsc, '-v'], dir).trim().replace('Version ', '')
    for (const mode of MODES) {
      const check = (file) => {
        const cfg = join(dir, `tsconfig.${file}.${ts}.${mode}.json`)
        writeFileSync(cfg, JSON.stringify(tsconfig(mode, `${file}.ts`), null, 2))
        const r = spawnSync(process.execPath, [tsc, '-p', cfg], { cwd: dir, encoding: 'utf8' })
        return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') }
      }
      const main = check('check')
      const control = main.ok ? { ok: true, out: '' } : check('control')
      results.push({ ts: tsVersion, three: threeVersion, mode, ok: main.ok, threeItself: !main.ok && !control.ok, errors: main.ok ? [] : firstErrors(main.out) })
      console.log(`  TS ${tsVersion.padEnd(7)} @types/three ${threeVersion.padEnd(8)} ${mode.padEnd(9)} ${main.ok ? '通过' : !control.ok ? '失败（@types/three 自身）' : '失败'}`)
    }
  }
}

// 3. 汇总
console.log('\n| TypeScript | @types/three | bundler | nodenext |\n|---|---|---|---|')
const cell = (r) => (r.ok ? 'pass' : r.threeItself ? 'fail (@types/three itself)' : 'FAIL')
for (const three of [...new Set(results.map((r) => r.three))])
  for (const ts of [...new Set(results.map((r) => r.ts))]) {
    const row = results.filter((r) => r.ts === ts && r.three === three)
    if (row.length) console.log(`| ${ts} | ${three} | ${cell(row.find((r) => r.mode === 'bundler'))} | ${cell(row.find((r) => r.mode === 'nodenext'))} |`)
  }
const failed = results.filter((r) => !r.ok)
for (const r of failed) {
  console.log(`\nTS ${r.ts} × @types/three ${r.three} × ${r.mode}${r.threeItself ? '（对照文件也失败：@types/three 自身的问题）' : ''}：`)
  for (const e of r.errors) console.log(`  ${e}`)
}
if (keep) console.log(`\n临时目录留着：${work}`)
else rmSync(work, { recursive: true, force: true })
// 只有 kgstrata 自己的问题算失败；@types/three 自身过不了的组合如实列出来，不算
process.exit(failed.some((r) => !r.threeItself) ? 1 : 0)
