import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
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

/** Keep the heaviest feature dependencies in dedicated chunks. */
function manualChunks(id: string) {
  if (!id.includes('node_modules')) {
    return undefined
  }

  if (id.includes('@xyflow/react')) {
    return 'xyflow'
  }

  if (id.includes('react-konva') || id.includes(`${path.sep}konva${path.sep}`) || id.includes('/konva/')) {
    return 'konva'
  }

  if (id.includes('react-router-dom')) {
    return 'router'
  }

  if (id.includes('@tanstack/react-query')) {
    return 'react-query'
  }

  if (id.includes('react-virtuoso') || id.includes('@virtuoso.dev/masonry') || id.includes('@viselect/vanilla')) {
    return 'image-list-vendor'
  }

  return undefined
}

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, '..')
  const env = loadEnv(mode, envDir, '')
  const frontendPort = resolveFrontendPort(env.FRONTEND_URL)

  return {
    envDir,
    plugins: [
      react(),
      babel({
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
    ],
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    build: {
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: frontendPort,
      strictPort: true,
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
        '/save': {
          target: 'http://localhost:1666',
          changeOrigin: true,
        },
      },
    },
  }
})
