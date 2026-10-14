/**
 * 화면별 <title>·설명·canonical — SPA 라서 index.html 의 기본값을 화면이 열려 있는 동안만 바꾸고, 닫히면 되돌린다.
 * 검색 엔진이 JS 를 실행해 색인할 때 쓰인다(서버 렌더링·사전 렌더링은 없음 → docs/PRD.md 참고).
 */
import { useEffect } from 'react';

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

function upsertCanonical(href: string): () => void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const created = !el;
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  const prev = el.getAttribute('href');
  el.setAttribute('href', href);
  return () => {
    if (created) el!.remove();
    else if (prev !== null) el!.setAttribute('href', prev);
  };
}

export function usePageMeta(meta: { title: string; description: string; path?: string }) {
  const { title, description, path } = meta;
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;
    const undo = [
      upsertMeta('name', 'description', description),
      upsertMeta('property', 'og:title', title),
      upsertMeta('property', 'og:description', description),
      ...(path ? [upsertCanonical(`${window.location.origin}${path}`)] : []),
    ];
    return () => {
      document.title = prevTitle;
      undo.forEach((f) => f());
    };
  }, [title, description, path]);
}
