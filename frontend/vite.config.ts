import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function resolveFrontendPort(frontendUrl?: string): number {
  if (frontendUrl) {
    try {
      const port = Number(new URL(frontendUrl).port)
      if (Number.isInteger(port) && port > 0) {
        return port
      }
    } catch {
      // Fallback to default below when FRONTEND_URL is malformed
    }
  }

  return 1677
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, '..')
  const env = loadEnv(mode, envDir, '')
  const frontendPort = resolveFrontendPort(env.FRONTEND_URL)

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    base: './',
    resolve: {
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@conai/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      },
      dedupe: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
    },
    server: {
      host: '0.0.0.0',
      port: frontendPort,
      strictPort: true,
      fs: {
        allow: [
          path.resolve(__dirname, '.'),
          path.resolve(__dirname, '../shared/src'),
        ],
      },
      proxy: {
        '/api': {
          target: 'http://localhost:1666',
          changeOrigin: true,
        },
        '/uploads': {
          target: 'http://localhost:1666',
          changeOrigin: true,
        },
        '/temp': {
          target: 'http://localhost:1666',
          changeOrigin: true,
        },
      },
    },
  }
})
