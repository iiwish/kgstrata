import { describe, expect, it } from 'vitest'

// 守住几个入口的引入闭包：只画 3D 图的人不该被迫带上 kgdiff（和它的 WebAssembly），
// 不带渲染的入口不该带上 three。读源码、顺着相对引入一路走下去（import type 也算：类型也会把声明拉进来）。

const SOURCES = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const ROOT = '../src/'
/** 效果页的源码：不在包里，单独看 */
const DEMO = import.meta.glob<string>('../demo/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

/** 去掉注释：注释里写的用法示例不算引入 */
function stripComments(code: string) {
  // 先去行注释：行注释里可能写着 @kgdiff/* 这样的字，先去块注释会把它当成块注释的开头
  return code.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 一个文件里所有 import … from '…'、export … from '…'、import '…' 的来源 */
function specifiersOf(code: string): string[] {
  const out: string[] = []
  const src = stripComments(code)
  for (const m of src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  for (const m of src.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  // 模块增强：declare module '../engine.js' 也是一条引入（类型声明里原样保留）
  for (const m of src.matchAll(/(?:^|[\s;])declare\s+module\s+['"](\.[^'"]*)['"]/g)) out.push(m[1])
  return out
}

function join(from: string, spec: string) {
  const parts = from.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else parts.push('..')
    } else parts.push(seg)
  }
  return parts.join('/')
}

/** 相对引入落到哪个文件上：补 .ts / .tsx，或者是目录下的 index.ts */
function resolveFile(from: string, spec: string): string {
  const base = join(from, spec)
  // 库的源码写的是 .js（发布的 .d.ts 原样保留，NodeNext 下才解析得了）；效果页和测试可以不写扩展名
  const stem = base.replace(/\.js$/, '')
  for (const c of [base, `${stem}.ts`, `${stem}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (c in SOURCES) return c
  throw new Error(`${from} 引入的 ${spec} 找不到`)
}

/** 从入口出发的闭包：走到的源文件，和碰到的外部包 */
function closure(entry: string) {
  const files = new Set<string>()
  const packages = new Set<string>()
  const walk = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    for (const spec of specifiersOf(SOURCES[file])) {
      if (spec.startsWith('.')) walk(resolveFile(file, spec))
      else packages.add(spec)
    }
  }
  walk(`${ROOT}${entry}`)
  return { files: [...files], packages: [...packages] }
}

describe('引入闭包', () => {
  it('抓得到各种写法', () => {
    const code = `
      import { a } from './a'
      import type { B } from "../b"
      import {
        c,
        type D,
      } from '@x/c'
      export { e } from './e'
      export type * from './f'
      import './side'
      // import { no } from './comment'
      /* export { no } from './block' */
    `
    expect(specifiersOf(code)).toEqual(['./a', '../b', '@x/c', './e', './f', './side'])
  })

  it('核心入口：没有 kgdiff，也没有路径回放和看变化的代码', () => {
    const { files, packages } = closure('index.ts')
    expect(files).toContain(`${ROOT}engine.ts`)
    expect(packages.filter((p) => p.startsWith('@kgdiff/'))).toEqual([])
    expect(files.filter((f) => f.startsWith(`${ROOT}path/`) || f.startsWith(`${ROOT}diff/`))).toEqual([])
  })

  it('不带渲染的入口：没有 three，也没有 kgdiff', () => {
    const { files, packages } = closure('headless.ts')
    expect(files).toContain(`${ROOT}layout.ts`)
    expect(packages.filter((p) => p === 'three' || p.startsWith('three/') || p.startsWith('@kgdiff/'))).toEqual([])
    expect(files.some((f) => f.startsWith(`${ROOT}renderer/`))).toBe(false)
  })

  it('路径回放的入口：不带 kgdiff', () => {
    const { files, packages } = closure('path/index.ts')
    expect(packages.filter((p) => p.startsWith('@kgdiff/'))).toEqual([])
    expect(files.filter((f) => f.startsWith(`${ROOT}diff/`))).toEqual([])
  })

  it('看变化的入口带着 kgdiff', () => {
    expect(closure('diff/index.ts').packages.some((p) => p.startsWith('@kgdiff/'))).toBe(true)
  })

  it('kgstrata 里只有 diff/ 目录引入 @kgdiff/*', () => {
    const offenders = Object.keys(SOURCES)
      .filter((f) => f.startsWith(ROOT) && !f.startsWith(`${ROOT}diff/`))
      .filter((f) => specifiersOf(SOURCES[f]).some((s) => s.startsWith('@kgdiff/')))
    expect(offenders).toEqual([])
  })
  const isReact = (p: string) => p === 'react' || p === 'react-dom' || p.startsWith('react/') || p.startsWith('react-dom/')

  it('核心的四个入口不带 react，也不碰 react/ 目录', () => {
    for (const entry of ['index.ts', 'headless.ts', 'path/index.ts', 'diff/index.ts']) {
      const { files, packages } = closure(entry)
      expect(packages.filter(isReact), entry).toEqual([])
      expect(files.filter((f) => f.startsWith(`${ROOT}react/`)), entry).toEqual([])
    }
  })

  it('React 入口：只依赖 react 和核心，没有 kgdiff，也没有路径回放和看变化的代码', () => {
    const { files, packages } = closure('react/index.ts')
    expect(files).toContain(`${ROOT}engine.ts`)
    expect(packages.filter((p) => p.startsWith('@kgdiff/'))).toEqual([])
    expect(files.filter((f) => f.startsWith(`${ROOT}path/`) || f.startsWith(`${ROOT}diff/`))).toEqual([])
    expect(files.filter((f) => f === `${ROOT}react/path.tsx` || f === `${ROOT}react/diff.tsx`)).toEqual([])
  })

  it('React 的路径面板：不带 kgdiff', () => {
    const { files, packages } = closure('react/path.tsx')
    expect(files).toContain(`${ROOT}path/index.ts`)
    expect(packages.filter((p) => p.startsWith('@kgdiff/'))).toEqual([])
    expect(files.filter((f) => f.startsWith(`${ROOT}diff/`) || f === `${ROOT}react/diff.tsx`)).toEqual([])
  })

  it('React 的变化面板经由看变化的入口带着 kgdiff，自己不直接引入', () => {
    const { files, packages } = closure('react/diff.tsx')
    expect(files).toContain(`${ROOT}diff/index.ts`)
    expect(packages.some((p) => p.startsWith('@kgdiff/'))).toBe(true)
    expect(specifiersOf(SOURCES[`${ROOT}react/diff.tsx`]).filter((s) => s.startsWith('@kgdiff/'))).toEqual([])
  })

  it('库里的相对引入都写全扩展名：发布的 .d.ts 原样保留它们，TypeScript 的 NodeNext 模式要求带 .js', () => {
    for (const f of Object.keys(SOURCES).filter((x) => x.startsWith(ROOT))) {
      const bad = specifiersOf(SOURCES[f]).filter((s) => s.startsWith('.') && !s.endsWith('.js') && !s.endsWith('.css'))
      expect(bad, f).toEqual([])
    }
  })

  it('效果页只按包名引入 kgstrata（和用的人一样），不碰库的源码，也不碰 kgdiff', () => {
    const ENTRIES = ['kgstrata', 'kgstrata/path', 'kgstrata/diff', 'kgstrata/react', 'kgstrata/react/path', 'kgstrata/react/diff', 'kgstrata/react/styles.css']
    const demo = Object.keys(DEMO)
    expect(demo).toContain('../demo/src/App.tsx')
    for (const f of demo) {
      const specs = specifiersOf(DEMO[f])
      expect(specs.filter((s) => s.startsWith('kgstrata') && !ENTRIES.includes(s)), f).toEqual([])
      // 相对引入只能在 demo/src 里面
      expect(specs.filter((s) => s.startsWith('.') && !join(f, s).startsWith('../demo/src/')), f).toEqual([])
    }
    // 变化的颜色、文字都交给 DiffPanel
    expect(specifiersOf(DEMO['../demo/src/App.tsx']).filter((s) => s.startsWith('@kgdiff/'))).toEqual([])
  })

})
