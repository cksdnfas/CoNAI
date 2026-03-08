import path from 'node:path'

export default {
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend/src'),
      '@conai/shared': path.resolve(__dirname, './shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./frontend/tests/setup/vitest.setup.ts'],
    include: ['frontend/tests/unit/**/*.test.{ts,tsx}'],
  },
}
