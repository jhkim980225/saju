/**
 * 화면별 <title>·설명·canonical — SPA 라서 index.html 의 기본값을 화면이 열려 있는 동안만 바꾸고, 닫히면 되돌린다.
 * JS 를 실행하는 크롤러(구글)가 색인할 때 쓰인다. JS 를 실행하지 않는 크롤러는 빌드 때 사전 렌더링한
 * dist/<경로>/index.html(scripts/prerender.mts)의 값을 본다. 두 값이 같도록 canonical 은 www 없는 대표 주소로 쓴다(docs/features/seo.md).
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

/**
 * canonical 에 쓰는 대표 출처 — 지금 주소에서 앞의 www. 만 뗀다.
 * www.daldalsaju.com 도 같은 Worker 가 같은 화면을 내므로, www 로 들어와도 사전 렌더링한 HTML 과 같은 www 없는 주소를 가리켜야
 * 한 화면이 두 주소로 색인되지 않는다. 로컬·스테이징 주소는 그대로 둔다.
 */
export function canonicalOrigin(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${location.protocol}//${location.host.replace(/^www\./i, '')}`;
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

/**
 * 색인하지 않을 화면(회원·개인 결과·결제·인증) — prerender.mts 의 robots.txt Disallow 와 같은 목록.
 * 끝이 / 인 항목은 그 아래 주소만, 아니면 그 주소와 그 아래 주소를 모두 막는다(robots.txt 의 접두어 규칙과 같다)
 */
export const NOINDEX_PREFIXES = ['/my', '/payments/', '/auth/', '/reports/', '/confirm', '/result', '/saju', '/profiles/', '/yearly/', '/tarot/r/', '/tarot/history', '/taekil/r/', '/login', '/signup', '/password/'];

/**
 * 주소가 바뀔 때마다 canonical 을 지금 주소(쿼리 제외)로 맞추고, 개인 화면에는 noindex 를 단다.
 * 사전 렌더링하지 않은 화면은 SPA 대체 파일(홈 index.html)을 받아서 canonical 이 홈으로 남기 때문이다.
 * useLayoutEffect 라서 화면의 usePageMeta(useEffect)보다 먼저 실행된다 → 화면이 정한 값이 있으면 그 값이 이긴다.
 */
export function useRouteMeta(pathname: string) {
  useLayoutEffect(() => {
    upsertCanonical(`${canonicalOrigin()}${pathname === '/' ? '/' : pathname.replace(/\/$/, '')}`);
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
    if (path) upsertCanonical(`${canonicalOrigin()}${path}`);
    return () => {
      document.title = prevTitle;
      undo.forEach((f) => f());
    };
  }, [title, description, path]);
}
