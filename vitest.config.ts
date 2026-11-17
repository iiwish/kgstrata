import { defineConfig } from 'vitest/config'
import { KGSTRATA_ALIASES } from './demo/vite.config.ts'

// 测试：库的测试直接引 src/ 里的文件；效果页的数据测试经由它引到 kgstrata，按包名指到源码
export default defineConfig({
  resolve: { alias: KGSTRATA_ALIASES },
  test: { include: ['tests/**/*.test.{ts,tsx}'] },
})
