// @vitest-environment node
/**
 * 사전 렌더링·sitemap·robots — 검색 엔진이 받는 값의 회귀 테스트(docs/features/seo.md).
 */
import { describe, expect, it } from 'vitest';
import { canonicalOrigin, NOINDEX_PREFIXES } from '../../src/lib/pageMeta';
import { render, robotsTxt, routes, sitemapXml, SITEMAP_NS } from '../prerender.mts';

const TEMPLATE = `<head>
    <meta name="description" content="기본" />
    <meta property="og:title" content="기본" />
    <meta property="og:description" content="기본" />
    <meta property="og:image" content="/og-image.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>기본</title>
</head>`;

describe('sitemap', () => {
  it('표준 네임스페이스를 쓴다', () => {
    expect(SITEMAP_NS).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
    expect(sitemapXml(routes())).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it('쿼리 주소(꿈해몽 분류)는 넣지 않는다 — 모든 주소가 사전 렌더링되고 canonical 이 자기 자신이다', () => {
    const all = routes();
    expect(all.some((r) => r.path.includes('?'))).toBe(false);
    for (const r of all.slice(0, 30)) expect(render(TEMPLATE, r)).toContain(`<link rel="canonical" href="https://daldalsaju.com${r.path}" />`);
    expect(all.map((r) => r.path)).toContain('/legal/disclaimer');
  });
});

describe('robots.txt', () => {
  it('화면의 noindex 목록과 같은 목록을 막고, /saju 자체도 막는다', () => {
    const txt = robotsTxt();
    for (const p of NOINDEX_PREFIXES) expect(txt).toContain(`Disallow: ${p}\n`);
    expect(txt).toContain('Disallow: /saju\n');
    expect(txt).toContain('Disallow: /api/\n');
    expect(txt).toContain('Sitemap: https://daldalsaju.com/sitemap.xml');
  });
});

describe('canonical 출처', () => {
  it('www 로 들어와도 www 없는 대표 주소를 쓴다', () => {
    expect(canonicalOrigin({ protocol: 'https:', host: 'www.daldalsaju.com' })).toBe('https://daldalsaju.com');
    expect(canonicalOrigin({ protocol: 'https:', host: 'daldalsaju.com' })).toBe('https://daldalsaju.com');
    expect(canonicalOrigin({ protocol: 'http:', host: 'localhost:5173' })).toBe('http://localhost:5173');
  });
});
