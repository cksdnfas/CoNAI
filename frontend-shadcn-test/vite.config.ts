import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5666,
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
    },
  },
})
