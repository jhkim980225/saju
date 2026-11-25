/**
 * 화면별 <title>·설명·canonical — SPA 라서 index.html 의 기본값을 화면이 열려 있는 동안만 바꾸고, 닫히면 되돌린다.
 * 검색 엔진이 JS 를 실행해 색인할 때 쓰인다(서버 렌더링·사전 렌더링은 없음 → docs/PRD.md 참고).
 */
import { useEffect, useLayoutEffect } from 'react';

function upsertMeta(attr: 'name' | 'property', key: string, content: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const created = !el;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  const prev = el.getAttribute('content');
  el.setAttribute('content', content);
  return () => {
    if (created) el!.remove();
    else if (prev !== null) el!.setAttribute('content', prev);
  };
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const created = !el;
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/** 색인하지 않을 화면(회원·개인 결과·결제·인증) — prerender.mts 의 robots.txt Disallow 와 같은 목록 */
const NOINDEX_PREFIXES = ['/my', '/payments/', '/auth/', '/reports/', '/confirm', '/result', '/saju', '/profiles/', '/yearly/', '/tarot/r/', '/tarot/history', '/taekil/r/', '/login', '/signup', '/password/'];

/**
 * 주소가 바뀔 때마다 canonical 을 지금 주소(쿼리 제외)로 맞추고, 개인 화면에는 noindex 를 단다.
 * 사전 렌더링하지 않은 화면은 SPA 대체 파일(홈 index.html)을 받아서 canonical 이 홈으로 남기 때문이다.
 * useLayoutEffect 라서 화면의 usePageMeta(useEffect)보다 먼저 실행된다 → 화면이 정한 값이 있으면 그 값이 이긴다.
 */
export function useRouteMeta(pathname: string) {
  useLayoutEffect(() => {
    upsertCanonical(`${window.location.origin}${pathname === '/' ? '/' : pathname.replace(/\/$/, '')}`);
    // '/yearly/' 처럼 / 로 끝나면 그 아래 주소만, 아니면 그 주소와 그 아래 주소 모두
    const noindex = NOINDEX_PREFIXES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (noindex && !robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      robots.content = 'noindex';
      document.head.appendChild(robots);
    } else if (!noindex && robots) robots.remove();
  }, [pathname]);
}

export function usePageMeta(meta: { title: string; description?: string; path?: string }) {
  const { title, description, path } = meta;
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;
    const undo = [
      upsertMeta('property', 'og:title', title),
      ...(description ? [upsertMeta('name', 'description', description), upsertMeta('property', 'og:description', description)] : []),
    ];
    // canonical 은 되돌리지 않는다 — 다음 화면의 값은 useRouteMeta 가 이미 넣었다
    if (path) upsertCanonical(`${window.location.origin}${path}`);
    return () => {
      document.title = prevTitle;
      undo.forEach((f) => f());
    };
  }, [title, description, path]);
}
