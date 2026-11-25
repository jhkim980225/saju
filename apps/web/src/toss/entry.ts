/**
 * 미니앱 진입 경로 — 콘솔 '주요 기능'과 공유 링크가 여는 화면을 고른다.
 *  - intoss://daldal-saju/zodiac 처럼 경로가 붙은 스킴, 또는 intoss://daldal-saju?tab=saju 같은 쿼리를 모두 받는다.
 *  - 토스 첫 버전에 없는 화면이나 모르는 경로면 오늘의 운세로 보낸다.
 */
export const TOSS_HOME = '/today';

const TAB_PATHS: Record<string, string> = {
  today: '/today',
  saju: '/saju',
  compatibility: '/compatibility',
  my: '/my',
  tojeong: '/tojeong',
  zodiac: '/zodiac',
  horoscope: '/horoscope',
  dream: '/dream',
  taekil: '/taekil',
  yearly: '/yearly',
  store: '/store',
  manse: '/manse',
};

/** 스킴으로 바로 열 수 있는 화면(첫 경로 조각 기준) */
const ENTRY_PREFIXES = ['/today', '/saju', '/compatibility', '/my', '/tojeong', '/zodiac', '/horoscope', '/dream', '/taekil', '/yearly', '/store', '/manse', '/basics', '/input', '/menu'];
const BLOCKED = ['/dream/ask'];

export function isTossEntryPath(path: string): boolean {
  if (BLOCKED.some((b) => path === b || path.startsWith(`${b}/`) || path.startsWith(`${b}?`))) return false;
  return ENTRY_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
}

/** 진입 주소(스킴 또는 웹 주소)에서 앱 안 경로를 고른다 */
export function resolveTossEntry(initialUrl: string | undefined, search = ''): string {
  let path = '';
  let query = new URLSearchParams(search);
  if (initialUrl) {
    try {
      // intoss://daldal-saju/zodiac?x=1 → host=daldal-saju, pathname=/zodiac
      const u = new URL(initialUrl.replace(/^intoss(-private)?:\/\//, 'https://'));
      path = `${u.pathname}${u.search}`;
      if ([...u.searchParams.keys()].length > 0) query = u.searchParams;
    } catch {
      path = '';
    }
  }
  if (path && path !== '/' && isTossEntryPath(path)) return path;
  const tab = query.get('tab');
  if (tab && TAB_PATHS[tab]) return TAB_PATHS[tab]!;
  return TOSS_HOME;
}
