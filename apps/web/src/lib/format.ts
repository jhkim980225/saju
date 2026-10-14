import type { Element } from '@saju/core';

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 신년운세·"올해 운세"의 대상 연도 (KST 기준 10월부터는 다음 해) — 서버 reading.ts 와 같은 규칙 */
export function targetFortuneYear(now = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return kst.getUTCFullYear() + (kst.getUTCMonth() >= 9 ? 1 : 0);
}

export const ELEMENT_META: Record<Element, { name: string; hanja: string; label: string; cls: { solid: string; soft: string; ink: string; bg: string } }> = {
  wood: { name: '목', hanja: '木', label: '나무', cls: { solid: 'text-wood', soft: 'bg-wood-soft', ink: 'text-wood-ink', bg: 'bg-wood' } },
  fire: { name: '화', hanja: '火', label: '불', cls: { solid: 'text-fire', soft: 'bg-fire-soft', ink: 'text-fire-ink', bg: 'bg-fire' } },
  earth: { name: '토', hanja: '土', label: '흙', cls: { solid: 'text-earth', soft: 'bg-earth-soft', ink: 'text-earth-ink', bg: 'bg-earth' } },
  metal: { name: '금', hanja: '金', label: '쇠', cls: { solid: 'text-metal', soft: 'bg-metal-soft', ink: 'text-metal-ink', bg: 'bg-metal' } },
  water: { name: '수', hanja: '水', label: '물', cls: { solid: 'text-water', soft: 'bg-water-soft', ink: 'text-water-ink', bg: 'bg-water' } },
};

export const ELEMENT_ORDER: Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

export function todayKst(): { year: number; month: number; day: number; weekday: string; iso: string } {
  const now = new Date(Date.now() + 9 * 3_600_000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  return { year, month, day, weekday: WEEKDAYS[now.getUTCDay()]!, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekdayOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

export const formatDateKo = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

export const POSITION_LABEL = { hour: '시', day: '일', month: '월', year: '년' } as const;

/** 점수 → 상태 라벨 */
export const scoreLabel = (s: number) => (s >= 85 ? '아주 좋음' : s >= 70 ? '좋음' : s >= 50 ? '보통' : s >= 35 ? '주의' : '조심');
