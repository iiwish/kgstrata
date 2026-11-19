import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// 库的构建（效果页的配置在 demo/vite.config.ts）。八个入口各出一个 ESM 文件到 dist/，共用的代码落到 dist/chunks/。
// 核心五个（index、headless、internals、path、diff），React 的三个（react/index、react/path、react/diff）。
// 类型声明另由 tsc -p tsconfig.build.json 输出（逐文件，保证模块增强成立）。
const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

/** 这些都不打进来：three、kgdiff、react 是 peer，d3-force 是依赖（react/jsx-runtime 也算在 react 里） */
const EXTERNAL = /^(three|d3-force|@kgdiff\/[^/]+|react|react-dom)(\/.*)?$/

/** React 面板的样式表原样拷到 dist/react/styles.css（再配一个空的类型声明）：js 不引入它（可选），由用的人自己 import */
function copyStyles(): Plugin {
  return {
    name: 'kgstrata:react-styles',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'react/styles.css', source: readFileSync(src('react/styles.css'), 'utf8') })
      // 给 TypeScript 看的空声明：import 'kgstrata/react/styles.css' 在没配 vite/client 的项目里也不报“找不到模块”
      this.emitFile({ type: 'asset', fileName: 'react/styles.d.ts', source: '// kgstrata/react/styles.css: styles only, no exports\nexport {}\n' })
    },
  }
}

export default defineConfig({
  publicDir: false,
  plugins: [copyStyles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2023',
    minify: false,
    sourcemap: false,
    lib: {
      entry: {
        index: src('index.ts'),
        headless: src('headless.ts'),
        internals: src('internals.ts'),
        'path/index': src('path/index.ts'),
        'diff/index': src('diff/index.ts'),
        'react/index': src('react/index.ts'),
        'react/path': src('react/path.tsx'),
        'react/diff': src('react/diff.tsx'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      external: (id) => EXTERNAL.test(id),
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
})
