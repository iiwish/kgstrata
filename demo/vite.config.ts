import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Alias } from 'vite'

// 效果页：和用的人一样按包名引入 kgstrata，这里把包名指到 src/ 的源码上（改了库立刻生效，不用先构建）。
// tsconfig.json 的 paths 是同一张表，给类型检查用。
const lib = (p: string) => fileURLToPath(new URL(`../src/${p}`, import.meta.url))

/** 包名 → 源码。和 package.json 的 exports 一一对应 */
export const KGSTRATA_ALIASES: Alias[] = [
  { find: /^kgstrata$/, replacement: lib('index.ts') },
  { find: /^kgstrata\/headless$/, replacement: lib('headless.ts') },
  { find: /^kgstrata\/internals$/, replacement: lib('internals.ts') },
  { find: /^kgstrata\/path$/, replacement: lib('path/index.ts') },
  { find: /^kgstrata\/diff$/, replacement: lib('diff/index.ts') },
  { find: /^kgstrata\/audit$/, replacement: lib('audit/index.ts') },
  { find: /^kgstrata\/react$/, replacement: lib('react/index.ts') },
  { find: /^kgstrata\/react\/path$/, replacement: lib('react/path.tsx') },
  { find: /^kgstrata\/react\/diff$/, replacement: lib('react/diff.tsx') },
  { find: /^kgstrata\/react\/audit$/, replacement: lib('react/audit.tsx') },
  { find: /^kgstrata\/react\/styles\.css$/, replacement: lib('react/styles.css') },
]

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: { alias: KGSTRATA_ALIASES },
  // 产物里的资源路径用相对的：在线演示部署在 GitHub Pages 的子路径（/kgstrata/）下，放在别的路径下也能用
  base: './',
  server: { port: 5207, strictPort: true },
  // 产物在 demo/dist/；根目录的 dist/ 是库的
  build: { outDir: 'dist', emptyOutDir: true },
  // kgdiff 的 WebAssembly 用 new URL(..., import.meta.url) 定位，预构建会把它挪走
  optimizeDeps: { exclude: ['@kgdiff/compute', '@kgdiff/core', '@kgdiff/layout', '@kgdiff/scene'] },
})
