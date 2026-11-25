import { usePageMeta as usePageMetaBase } from '@/lib/pageMeta';

/**
 * 화면별 <title>·설명·대표 주소 — 꿈해몽 화면이 쓰는 이름.
 * 구현은 lib/pageMeta 하나로 합쳤다(canonical 을 주소가 바뀔 때 RootLayout 의 useRouteMeta 와 같은 규칙으로 다루기 위해).
 */
export function usePageMeta({ title, description, canonicalPath }: { title: string; description?: string; canonicalPath?: string }) {
  usePageMetaBase({ title, description, path: canonicalPath });
}
