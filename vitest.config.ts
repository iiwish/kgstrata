import { defineConfig } from 'vitest/config'
import { KGSTRATA_ALIASES } from './demo/vite.config.ts'

// 测试：库的测试直接引 src/ 里的文件；效果页的数据测试经由它引到 kgstrata，按包名指到源码
export default defineConfig({
  resolve: { alias: KGSTRATA_ALIASES },
  // 回放的测试要扫完整条时间轴，机器忙的时候 5 秒不够：放宽到 20 秒，免得偶发超时
  test: { include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 20_000 },
})
