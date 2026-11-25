/**
 * 토스 미니앱(앱인토스) 빌드 전용 Vite 플러그인 — `vite build --mode toss | toss-qa | toss-dev` 에서만 쓰인다.
 * 웹·Capacitor 빌드에는 들어가지 않는다(vite.config.ts 가 모드로 가른다).
 *
 *  1) 모듈 바꿔치기: 웹·앱 전용 구현(Capacitor, 카카오, 애드센스, 결제창 SDK)을 src/toss/replace/* 로 바꾼다.
 *     기존 파일을 고치지 않고도 토스 번들에서 그 코드가 통째로 빠진다.
 *  2) 제외 화면 비우기: 토스 첫 버전에 넣지 않는 화면 모듈(타로·AI 상담·로그인 등)은 같은 이름의 빈 컴포넌트로 바꾼다.
 *  3) index.html: 밝은 화면 고정, 핀치 줌 금지, og·manifest·외부 폰트 CDN 태그 제거.
 *  4) 빌드 뒤: 토스에서 안 쓰는 공개 자산(타로 그림·og 이미지·manifest 등)을 출력 폴더에서 지운다.
 */
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\?.*$/, '');

/** src 기준 경로 → 바꿔 끼울 src 기준 경로 */
export const TOSS_REPLACE: Record<string, string> = {
  'native/index.ts': 'toss/replace/native.ts',
  'lib/share.ts': 'toss/replace/share.ts',
  'lib/analytics.ts': 'toss/replace/analytics.ts',
  'lib/payments/providers.ts': 'toss/replace/paymentProviders.ts',
  'components/AdSlot.tsx': 'toss/replace/AdSlot.tsx',
  'components/RewardedAdCard.tsx': 'toss/replace/RewardedAdCard.tsx',
  'components/ShareSheet.tsx': 'toss/replace/ShareSheet.tsx',
};

/** 토스 첫 버전에서 뺀 화면 — 내보낸 컴포넌트를 모두 빈 컴포넌트로 바꾼다(라우트도 src/toss/routes.tsx 가 뺀다) */
export const TOSS_EXCLUDED_PAGES = [
  'pages/AskPage.tsx',
  'pages/AuthPages.tsx',
  'pages/PasswordPages.tsx',
  'pages/LandingPage.tsx',
  'pages/PaymentResultPages.tsx',
  'pages/TarotAskPage.tsx',
  'pages/TarotDrawPage.tsx',
  'pages/TarotHistoryPage.tsx',
  'pages/TarotHomePage.tsx',
  'pages/TarotResultPage.tsx',
];

/** 토스 번들에 넣지 않는 공개 자산(출력 폴더 기준) */
const REMOVE_FROM_DIST = ['tarot', 'og-image.png', 'manifest.webmanifest', '_headers', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];

/** 모듈이 내보내는 이름을 그대로 두고 내용만 빈 컴포넌트로 바꾼 소스 */
export function stubSource(source: string): string {
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]!);
  return [...names].map((n) => `export const ${n} = () => null;`).join('\n') + '\n';
}

export function tossPlugin(root: string, outDir: string): Plugin {
  const src = norm(resolve(root, 'src'));
  const replace = new Map(Object.entries(TOSS_REPLACE).map(([from, to]) => [`${src}/${from}`, `${src}/${to}`]));
  const excluded = new Set(TOSS_EXCLUDED_PAGES.map((p) => `${src}/${p}`));
  return {
    name: 'daldal-toss',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const to = replace.get(norm(resolved.id));
      // 바꿔 끼운 파일이 원본을 다시 가져오는 경우(원본의 일부를 재사용)는 그대로 둔다
      if (to && norm(importer) !== to) return to;
      return null;
    },
    load(id) {
      if (!excluded.has(norm(id))) return null;
      return stubSource(readFileSync(norm(id), 'utf8'));
    },
    transformIndexHtml(html) {
      return html
        .replace('data-theme="dark"', 'data-theme="light"')
        .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />')
        .replace(/<meta name="theme-color"[^>]*>/, '<meta name="theme-color" content="#FFFFFF" />')
        .replace(/\s*<meta property="og:[^>]*>/g, '')
        .replace(/\s*<link rel="manifest"[^>]*>/, '')
        .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
        .replace(/\s*<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"[^>]*>/, '')
        .replace(/\s*<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net[^>]*>/, '')
        .replace(/<title>[^<]*<\/title>/, '<title>달달사주</title>');
    },
    closeBundle() {
      for (const name of REMOVE_FROM_DIST) rmSync(resolve(root, outDir, name), { recursive: true, force: true });
    },
  };
}
