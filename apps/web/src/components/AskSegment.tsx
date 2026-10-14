import { NavLink } from 'react-router';
import { t } from '@/lib/copy';
import { cx } from './ui';

/** 물어보기 탭 상단 — 사주에게 묻기 | 타로로 묻기 */
export function AskSegment() {
  const item = ({ isActive }: { isActive: boolean }) =>
    cx('flex h-11 items-center justify-center rounded-lg text-[15px] font-medium transition-colors', isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-3');
  return (
    <nav aria-label="묻는 방식" className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1">
      <NavLink to="/ask" className={item}>
        {t('ask.segmentSaju')}
      </NavLink>
      <NavLink to="/tarot" end className={item}>
        {t('tarot.meta.askSegment')}
      </NavLink>
    </nav>
  );
}
