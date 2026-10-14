import { CalendarCheck } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '@/lib/copy';
import { Card } from './ui';

/** 택일 진입 카드 — 오늘 탭·만세력에서 '좋은 날 고르기'로 안내 */
export function TaekilEntryCard({ date, className }: { date?: string; className?: string }) {
  const to = date ? `/taekil?date=${date}` : '/taekil';
  return (
    <Card className={className ?? 'mt-4'}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-3">
        <CalendarCheck className="size-4" aria-hidden />
        {t('taekil.entry.eyebrow')}
      </p>
      <p className="mt-2 font-serif text-lg font-semibold">{date ? t('taekil.fromManse.title') : t('taekil.entry.title')}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{date ? t('taekil.fromManse.body') : t('taekil.entry.body')}</p>
      <Link to={to} className="mt-3 inline-flex h-10 items-center rounded-full bg-action-2 px-4 text-sm font-semibold">
        {t('taekil.entry.cta')}
      </Link>
    </Card>
  );
}
