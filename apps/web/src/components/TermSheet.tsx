import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Term } from '@/lib/sajuBasics';
import { BottomSheet } from './BottomSheet';
import { cx } from './ui';

/** 용어 설명 시트 — '전문가 보기' 표에서 줄 이름이나 값을 누르면 뜬다 */
export function TermSheet({ term, extra, onClose }: { term: Term | null; extra?: Term[]; onClose: () => void }) {
  return (
    <BottomSheet
      open={Boolean(term)}
      onClose={onClose}
      title={term?.name}
      footer={
        <Link to="/basics" onClick={onClose} className="block text-center text-sm font-semibold text-gold underline underline-offset-4">
          사주 기초 전체 보기
        </Link>
      }
    >
      {term && (
        <div className="space-y-3">
          <p className="font-semibold">{term.short}</p>
          <p className="text-[15px] leading-relaxed text-ink-2">{term.body}</p>
          {extra && extra.length > 0 && (
            <dl className="space-y-2 rounded-xl bg-subtle p-3 text-sm">
              {extra.map((e) => (
                <div key={e.name}>
                  <dt className="font-semibold">
                    {e.name} <span className="font-normal text-ink-3">· {e.short}</span>
                  </dt>
                  <dd className="mt-0.5 leading-relaxed text-ink-2">{e.body}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

/** 누르면 설명이 뜨는 용어 — 점선 밑줄로 '누를 수 있다'를 알린다 */
export function TermButton({ children, onClick, label, className, icon = false }: { children: ReactNode; onClick: () => void; label: string; className?: string; icon?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} 설명 보기`}
      className={cx('inline-flex items-center gap-0.5 underline decoration-dotted decoration-from-font underline-offset-[3px] hover:text-ink', className)}
    >
      {children}
      {icon && <CircleHelp className="size-3 shrink-0 opacity-70" aria-hidden />}
    </button>
  );
}
