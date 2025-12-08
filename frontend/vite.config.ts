import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
const ReactCompilerConfig = { /* ... */ };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react({
    babel: {
      plugins: ["babel-plugin-react-compiler", ReactCompilerConfig],
    },
  }),],
  base: './',
  resolve: {
    alias: {
      '@comfyui-image-manager/shared': path.resolve(__dirname, '../shared/src/index.ts')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5555,
    proxy: {
      '/api': {
        target: 'http://localhost:1566',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('[Vite Proxy] Proxying:', req.method, req.url, '→', proxyReq.path);
          });
          proxy.on('error', (err, _req, _res) => {
            console.error('[Vite Proxy] Error:', err);
          });
        }
      },
      '/uploads': {
        target: 'http://localhost:1566',
        changeOrigin: true,
      }
    }
  }
})
