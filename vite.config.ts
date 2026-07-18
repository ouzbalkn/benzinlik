import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'es2022' }, // top-level await (model preload) için
  esbuild: { target: 'es2022' },
  server: {
    proxy: { '/api': 'http://localhost:8787' }, // lokal API testi: PORT=8787 node server/index.js
  },
})
