import { useQuery } from '@tanstack/react-query';
import type { TarotHistoryItemDto } from '@saju/shared';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { TarotCardFace } from '@/components/TarotCard';
import { Badge, Button, Chip, EmptyState, ErrorState, IconButton, PageHeader, Spinner } from '@/components/ui';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { isMember, useSession } from '@/lib/session';
import { isPaidSpread } from '@/lib/tarot';
import { tarotHistoryKey } from './TarotHomePage';

/** 깊은 풀이를 연 리딩 — 무료 펼침(오늘의 카드·예·아니오)은 잠금이 없어도 깊은 풀이가 아니다 */
const isDeep = (h: TarotHistoryItemDto) => isPaidSpread(h.spread) && !h.locked;

const FILTERS = {
  all: () => true,
  daily: (h: TarotHistoryItemDto) => h.spread === 'daily',
  spread: (h: TarotHistoryItemDto) => h.spread !== 'daily',
  deep: isDeep,
} as const;
type Filter = keyof typeof FILTERS;

/** 이번 달 오늘의 카드 중 가장 자주 나온 카드 (3회 이상일 때만) */
function frequentCard(items: TarotHistoryItemDto[], month: string): string | null {
  const counts = new Map<string, { name: string; n: number }>();
  for (const h of items) {
    if (h.spread !== 'daily' || !h.date.startsWith(month)) continue;
    const c = h.cards[0]!;
    counts.set(c.id, { name: c.nameKo, n: (counts.get(c.id)?.n ?? 0) + 1 });
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return top && top.n >= 3 ? top.name : null;
}

/** 타로 기록 (/tarot/history) */
export function TarotHistoryPage() {
  const navigate = useNavigate();
  const gate = useSessionGate();
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.accessToken);
  const [filter, setFilter] = useState<Filter>('all');
  const q = useQuery({ queryKey: tarotHistoryKey(user?.id), queryFn: api.tarotHistory, enabled: Boolean(token) });
  const all = q.data ?? [];
  const items = all.filter(FILTERS[filter]);
  const month = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7);
  const frequent = frequentCard(all, month);

  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={t('tarot.history.title')}
        width="medium"
      />
      <Page width="medium" className="pb-12">
        <p className="mt-2 text-[15px] text-ink-2">{t('tarot.history.subtitle')}</p>
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:px-0">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {t(`tarot.history.filters.${f}`)}
            </Chip>
          ))}
        </div>
        {frequent && <p className="mt-4 rounded-xl bg-subtle p-3 text-sm text-ink-2">{t('tarot.history.frequentCard', { card: frequent })}</p>}

        {(q.isLoading || (!token && !q.error)) && <Spinner />}
        {q.error && <ErrorState title={t('tarot.error.reading.title')} onRetry={() => q.refetch()} />}
        {q.data && all.length === 0 && (
          <EmptyState title={t('tarot.empty.history.title')} body={t('tarot.empty.history.body')} action={<Button onClick={() => navigate('/tarot/daily')}>{t('tarot.empty.history.cta')}</Button>} />
        )}
        {q.data && all.length > 0 && items.length === 0 && <EmptyState title={t('tarot.empty.historyFiltered.title')} body={t('tarot.empty.historyFiltered.body')} />}

        <ul className="mt-4 divide-y divide-line">
          {items.map((h) => (
            <li key={h.id}>
              <Link to={`/tarot/r/${h.id}`} className="flex items-center gap-4 py-4">
                <span className="flex shrink-0 -space-x-4">
                  {h.cards.slice(0, 5).map((c) => (
                    <TarotCardFace key={c.id} card={{ ...c, imagery: '' }} className="w-11 rounded-md" />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink-3">
                    {Number(h.date.slice(5, 7))}월 {Number(h.date.slice(8))}일 · {h.topic ? t(`tarot.topics.${h.topic}.label`) : h.spreadName}
                  </span>
                  <span className="mt-0.5 block truncate text-[15px]">{h.spread === 'daily' ? h.cards[0]!.nameKo : (h.question ?? t('tarot.history.item.noQuestion'))}</span>
                  <span className="mt-1 flex gap-1.5">
                    <span className="text-xs text-ink-3">{t('tarot.history.item.cardCount', { count: h.cards.length })}</span>
                    {isDeep(h) && <Badge tone="gold">{t('tarot.history.item.deep')}</Badge>}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>

        {!isMember(user) && all.length > 0 && (
          <div className="mt-6 rounded-2xl bg-subtle p-4 text-sm text-ink-2">
            <p>{t('tarot.history.guestNote')}</p>
            <Link to="/login?next=/tarot/history" className="mt-2 inline-block font-semibold text-info underline">
              {t('tarot.history.loginCta')}
            </Link>
          </div>
        )}
      </Page>
    </div>
  );
}
