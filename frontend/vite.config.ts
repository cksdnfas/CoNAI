import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, loadEnv } from 'vite'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version?: string }
const appVersion = typeof packageJson.version === 'string' && packageJson.version.trim().length > 0 ? packageJson.version : '0.0.0'

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

  if (/[/\\]node_modules[/\\]react(?:-dom)?[/\\]/.test(id)) {
    return 'react-vendor'
  }

  if (id.includes('@xyflow/react')) {
    return 'xyflow'
  }

  // react-router-dom only re-exports react-router (v7), so the core package has to match as well.
  if (/[/\\]node_modules[/\\]react-router(?:-dom)?[/\\]/.test(id)) {
    return 'router'
  }

  if (id.includes('@tanstack/react-query')) {
    return 'react-query'
  }

  return undefined
}

export default defineConfig(({ command, mode }) => {
  const envDir = path.resolve(__dirname, '..')
  const env = loadEnv(mode, envDir, '')
  const frontendPort = resolveFrontendPort(env.FRONTEND_URL)
  const reactCompilerEnabled = env.CONAI_REACT_COMPILER === 'true'
  const backendTarget = env.VITE_API_BASE_URL || 'http://localhost:1666'

  return {
    envDir,
    // Separate caches keep an isolated local test server from reusing another server's shared bundle.
    cacheDir: env.CONAI_VITE_CACHE_DIR || undefined,
    plugins: [
      react(),
      ...(reactCompilerEnabled
        ? [babel({ presets: [reactCompilerPreset()] })]
        : []),
      tailwindcss(),
    ],
    base: '/',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@pdfjs': path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
        // Bundle the shared workspace from source: no separate CommonJS build to keep in step, and unused exports shake out.
        '@conai/shared': path.resolve(__dirname, '../shared/src/index.ts'),
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
      headers: { 'Content-Security-Policy': "frame-src 'self'" },
      port: frontendPort,
      strictPort: true,
      proxy: {
        // Preserve the browser host used by the extension document's path-scoped CSP.
        '/api/plugin-assets': {
          target: backendTarget,
          changeOrigin: false,
        },
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/temp': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/save': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
    preview: { headers: { 'Content-Security-Policy': "frame-src 'self'" } },
  }
})
