import { BookOpen, CalendarCheck, CalendarDays, ChevronRight, CloudMoon, GalleryVerticalEnd, GraduationCap, HeartHandshake, ScrollText, Star, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { targetFortuneYear } from '@/lib/format';
import { cx } from './ui';

/** 다른 운세 바로가기 — 첫 화면·오늘 탭에서 같은 버튼 묶음을 쓴다 */
const ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/today', label: '오늘의 운세', icon: CalendarDays },
  { to: '/yearly', label: `${targetFortuneYear()} 신년운세`, icon: Sun },
  { to: '/compatibility', label: '궁합', icon: HeartHandshake },
  { to: '/tarot', label: '타로', icon: GalleryVerticalEnd },
  { to: '/tojeong', label: '토정비결', icon: ScrollText },
  { to: '/dream', label: '꿈해몽', icon: CloudMoon },
  { to: '/zodiac', label: '띠·별자리', icon: Star },
  { to: '/taekil', label: '좋은 날 고르기', icon: CalendarCheck },
  { to: '/manse', label: '만세력', icon: BookOpen },
];

/** 사주가 처음인 사람을 위한 안내 화면(/basics) 바로가기 */
export function BasicsLink({ className }: { className?: string }) {
  return (
    <Link to="/basics" className={cx('flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-strong', className)}>
      <GraduationCap className="size-6 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">사주 기초</span>
        <span className="block text-sm text-ink-2">사주가 처음이라면 여기부터 읽어 보세요</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

export function MoreMenu({ title = '다른 운세 보기', exclude, className }: { title?: string; exclude?: string; className?: string }) {
  const titleId = useId();
  const items = ITEMS.filter((i) => i.to !== exclude);
  return (
    <section className={className} aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <ul className={cx('mt-3 grid gap-2', items.length % 3 === 0 ? 'grid-cols-3' : 'grid-cols-4 lg:grid-cols-8')}>
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex h-full flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-2 py-4 text-center transition-colors hover:border-line-strong">
              <Icon className="size-6 text-gold" strokeWidth={1.5} aria-hidden />
              <span className="text-[13px] font-medium leading-tight break-keep">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
