/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // lunar-javascript(CJS) 를 사전 번들링해 ESM named import 를 지원
  optimizeDeps: { include: ['lunar-javascript', 'korean-lunar-calendar'] },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // 로컬 개발: VITE_API_BASE_URL 을 비워 두면 /api 로 프록시
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    // 앱(Capacitor) 번들에는 소스맵을 넣지 않는다(용량·코드 노출)
    sourcemap: mode !== 'app',
    commonjsOptions: { include: [/lunar-javascript/, /korean-lunar-calendar/, /node_modules/] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
}));
