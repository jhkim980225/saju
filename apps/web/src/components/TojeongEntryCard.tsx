// 랜딩(첫 번들)에서도 쓰므로 zod 스키마가 든 '@saju/shared' 대신 가벼운 하위 경로에서 가져온다
import { TOJEONG_DEFAULT_YEAR } from '@saju/shared/tojeong';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cx } from './ui';

/** 토정비결(무료) 바로가기 — 오늘 탭·랜딩에 둔다 */
export function TojeongEntryCard({ className }: { className?: string }) {
  return (
    <Link to="/tojeong" className={cx('flex items-center gap-4 rounded-2xl border border-line bg-surface p-5', className)}>
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-subtle font-serif text-lg font-semibold" aria-hidden>
        卦
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-3">무료</span>
        <span className="block font-serif text-lg font-semibold">{TOJEONG_DEFAULT_YEAR} 토정비결</span>
        <span className="mt-0.5 block text-sm text-ink-2">144괘로 보는 한 해와 음력 열두 달의 흐름</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
