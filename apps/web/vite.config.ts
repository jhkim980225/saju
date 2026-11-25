/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import { tossPlugin } from './toss/vite-plugin';

/** 토스 미니앱(앱인토스) 빌드 모드 — toss(제출용) · toss-qa(QR 테스트용, 테스트 광고 ID) · toss-dev(브라우저 확인용, SDK mock) */
const isTossMode = (mode: string) => mode === 'toss' || mode.startsWith('toss-');

export default defineConfig(async ({ mode }) => {
  const toss = isTossMode(mode);
  const root = fileURLToPath(new URL('.', import.meta.url));
  const outDir = !toss ? 'dist' : mode === 'toss-dev' ? 'dist-toss-dev' : 'dist-toss';
  const tossPlugins: PluginOption[] = [];
  if (toss) {
    tossPlugins.push(tossPlugin(root, outDir));
    // 토스앱 밖(브라우저)에서는 SDK 가 동작하지 않으므로 toss-dev 에서만 브라우저용 mock 으로 바꾼다
    if (mode === 'toss-dev') {
      const { default: aitDevtools } = await import('@apps-in-toss/devtools/unplugin');
      tossPlugins.push(aitDevtools.vite({ forceEnable: true, mock: true, panel: false }));
    }
  }
  return {
    plugins: [...tossPlugins, react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // 빌드 시점 상수 — 웹·앱 빌드에서는 false 라서 토스 분기가 번들에서 빠진다(src/lib/platform.ts 의 IS_TOSS)
    define: { __TOSS__: JSON.stringify(toss) },
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
      outDir,
      target: 'es2022',
      // 소스맵은 만들지 않는다 — dist 가 그대로 공개 정적 파일이 되므로 .map 이 있으면 원본 코드가 노출되고 배포 용량만 커진다
      sourcemap: false,
      commonjsOptions: { include: [/lunar-javascript/, /korean-lunar-calendar/, /node_modules/] },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      css: false,
    },
  };
});
