import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
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
    port: 5666,
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
})
