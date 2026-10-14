import { useEffect } from 'react';

/**
 * 화면별 <title>·설명·대표 주소 — 검색 유입용 콘텐츠 페이지(꿈해몽 등)에서 쓴다.
 * 화면을 떠나면 index.html 의 기본값으로 되돌린다.
 */
export function usePageMeta({ title, description, canonicalPath }: { title: string; description?: string; canonicalPath?: string }) {
  useEffect(() => {
    const prevTitle = document.title;
    const restore: (() => void)[] = [];
    const put = (selector: string, create: () => HTMLElement, attr: 'content' | 'href', value: string) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      if (!el) {
        el = create();
        document.head.appendChild(el);
        const made = el;
        restore.push(() => made.remove());
      } else {
        const prev = el.getAttribute(attr);
        const kept = el;
        restore.push(() => (prev === null ? kept.removeAttribute(attr) : kept.setAttribute(attr, prev)));
      }
      el.setAttribute(attr, value);
    };
    const meta = (key: 'name' | 'property', value: string) => () => {
      const m = document.createElement('meta');
      m.setAttribute(key, value);
      return m;
    };

    document.title = title;
    put('meta[property="og:title"]', meta('property', 'og:title'), 'content', title);
    if (description) {
      put('meta[name="description"]', meta('name', 'description'), 'content', description);
      put('meta[property="og:description"]', meta('property', 'og:description'), 'content', description);
    }
    if (canonicalPath) {
      const href = `${window.location.origin}${canonicalPath}`;
      put(
        'link[rel="canonical"]',
        () => {
          const l = document.createElement('link');
          l.setAttribute('rel', 'canonical');
          return l;
        },
        'href',
        href,
      );
    }
    return () => {
      document.title = prevTitle;
      for (const r of restore.reverse()) r();
    };
  }, [title, description, canonicalPath]);
}
