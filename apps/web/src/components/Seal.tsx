/** 낙관(도장) 로고 — 테두리 안에 초승달. 인주색은 로고에만 사용 */
export const CRESCENT_PATH = 'M14.84 8.08 A8.4 8.4 0 1 0 23.93 19.17 A7.2 7.2 0 0 1 14.84 8.08 Z';

export function Seal({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="달빛사주">
      <rect x="1.5" y="1.5" width="29" height="29" rx="5" fill="none" stroke="var(--seal)" strokeWidth="2.5" />
      <path d={CRESCENT_PATH} fill="var(--seal)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <Seal size={26} />
      <span className="font-serif text-lg font-semibold tracking-tight">달빛사주</span>
    </span>
  );
}
