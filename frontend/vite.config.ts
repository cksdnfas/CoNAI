import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react({
    babel: {
      plugins: ['babel-plugin-react-compiler'],
    },
  }),],
  base: './',
  resolve: {
    alias: {
      '@comfyui-image-manager/shared': path.resolve(__dirname, '../shared/src/index.ts')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:1566',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:1566',
        changeOrigin: true,
      }
    }
  }
})
