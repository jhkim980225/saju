// 랜딩(첫 번들)에서도 쓰므로 zod 스키마가 든 '@saju/shared' 대신 가벼운 하위 경로에서 가져온다
import { TOJEONG_DEFAULT_YEAR } from '@saju/shared/tojeong';
import { ChevronRight, ScrollText } from 'lucide-react';
import { Link } from 'react-router';
import { cx } from './ui';

/** 토정비결(무료) 바로가기 — 오늘 탭·랜딩에 둔다 */
export function TojeongEntryCard({ className }: { className?: string }) {
  return (
    <Link to="/tojeong" className={cx('flex items-center gap-4 rounded-2xl border border-line bg-surface p-5', className)}>
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-subtle" aria-hidden>
        <ScrollText className="size-6 text-ink-2" strokeWidth={1.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-3">무료</span>
        <span className="block font-serif text-lg font-semibold">{TOJEONG_DEFAULT_YEAR} 토정비결</span>
        <span className="mt-0.5 block text-sm text-ink-2">생년월일로 보는 한 해 운세와 열두 달 흐름</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
