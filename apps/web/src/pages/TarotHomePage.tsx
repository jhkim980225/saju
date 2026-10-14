import { useQuery } from '@tanstack/react-query';
import { TAROT_SPREADS, TAROT_SPREAD_TOPICS, TAROT_TOPIC_KEYS, TAROT_TOPICS, TAROT_YESNO_DAILY_FREE, type TarotTopic } from '@saju/shared';
import { ChevronRight, History } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AskSegment } from '@/components/AskSegment';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { TarotCardBack, TarotCardFace } from '@/components/TarotCard';
import { Button, Card, IconButton, PageHeader } from '@/components/ui';
import { useProducts } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { todayKst, won } from '@/lib/format';
import { useSession } from '@/lib/session';

export const tarotHistoryKey = (uid?: string | null) => ['tarot', 'history', uid ?? 'anon'] as const;

const isSpreadTopic = (k: TarotTopic) => (TAROT_SPREAD_TOPICS as readonly TarotTopic[]).includes(k);

/** 펼침 방식으로 고르기 — 예·아니오(무료) · 양자택일 · 궁합 타로 · 켈틱 크로스 */
function SpreadList({ yesnoToday }: { yesnoToday?: string }) {
  const { data: products } = useProducts();
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{t('tarot.home.spreadsTitle')}</h2>
      <p className="mt-1 text-sm text-ink-3">{t('tarot.home.spreadsSubtitle')}</p>
      <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
        {TAROT_SPREAD_TOPICS.map((k) => {
          const spread = TAROT_SPREADS[TAROT_TOPICS[k].spread];
          const product = spread.productId ? products?.find((p) => p.id === spread.productId) : undefined;
          const price = spread.productId ? (product ? t('tarot.home.deepPrice', { price: won(product.price) }) : '') : t('tarot.home.freeDaily');
          const done = k === 'yesno' && yesnoToday;
          return (
            <li key={k}>
              <Link to={done ? `/tarot/r/${yesnoToday}` : `/tarot/ask?topic=${k}`} className="flex items-center gap-3 px-4 py-4">
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold">{t(`tarot.spreads.${k}.name`)}</span>
                    <span className="tabular text-xs text-ink-3">{t('tarot.spreads.cardCount', { count: spread.cards })}</span>
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-ink-2">{done ? t('tarot.home.yesnoDone') : t(`tarot.topics.${k}.title`)}</span>
                  {price && <span className="mt-1 block text-xs text-ink-3">{price}</span>}
                </span>
                <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 타로 홈 — 오늘의 카드 · 주제 고르기 · 최근 기록 */
export function TarotHomePage() {
  const navigate = useNavigate();
  const gate = useSessionGate();
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.accessToken);
  const [about, setAbout] = useState(false);
  const history = useQuery({ queryKey: tarotHistoryKey(user?.id), queryFn: api.tarotHistory, enabled: Boolean(token) });
  const today = todayKst().iso;
  const daily = history.data?.find((h) => h.spread === 'daily' && h.date === today);
  // 예·아니오 무료 횟수를 오늘 다 썼으면 새로 묻는 대신 오늘 본 카드로
  const yesnoUsed = (history.data ?? []).filter((h) => h.spread === 'yesno' && h.date === today);
  const yesnoToday = yesnoUsed.length >= TAROT_YESNO_DAILY_FREE ? yesnoUsed[0]!.id : undefined;
  const recent = (history.data ?? []).filter((h) => h.spread !== 'daily').slice(0, 3);

  return (
    <div className="min-h-page">
      <PageHeader
        title={t('tarot.meta.navLabel')}
        width="wide"
        right={
          <IconButton label={t('tarot.history.title')} onClick={() => navigate('/tarot/history')}>
            <History className="size-6" />
          </IconButton>
        }
      />
      <Page width="wide" className="pb-12">
        <div className="lg:hidden">
          <AskSegment />
        </div>
        {gate.failed && <SessionGateError onRetry={gate.retry} />}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start lg:gap-12">
          <div>
            <section className="pt-6 lg:pt-2">
              <p className="text-sm font-semibold text-ink-3">{t('tarot.home.eyebrow')}</p>
              <h2 className="mt-2 whitespace-pre-line font-serif text-[26px] font-semibold leading-snug lg:text-[34px]">{t('tarot.home.title')}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{t('tarot.home.subtitle')}</p>
            </section>

            <Card className="mt-6">
              <p className="text-sm font-semibold text-ink-3">{t('tarot.home.dailyCard.label')}</p>
              <div className="mt-3 flex gap-4">
                {daily ? <TarotCardFace card={{ ...daily.cards[0]!, imagery: '' }} className="w-24 shrink-0" /> : <TarotCardBack className="w-24 shrink-0" />}
                <div className="min-w-0">
                  <p className="font-serif text-lg font-semibold">{daily ? daily.cards[0]!.nameKo : t('tarot.home.dailyCard.title')}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">{daily ? t('tarot.home.dailyCard.oncePerDay') : t('tarot.home.dailyCard.desc')}</p>
                  <Button size="sm" className="mt-3" onClick={() => navigate(daily ? '/tarot/daily?open=1' : '/tarot/daily')}>
                    {daily ? t('tarot.home.dailyCard.viewCta') : t('tarot.home.dailyCard.cta')}
                  </Button>
                </div>
              </div>
            </Card>

            <ol className="mt-6 hidden gap-2 text-sm text-ink-2 lg:grid">
              {(['step1', 'step2', 'step3'] as const).map((k, i) => (
                <li key={k} className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full bg-subtle text-xs font-semibold">{i + 1}</span>
                  {t(`tarot.home.howItWorks.${k}`)}
                </li>
              ))}
            </ol>
          </div>

          <div>
            <section className="mt-10 lg:mt-2">
              <h2 className="text-lg font-semibold">{t('tarot.home.topicsTitle')}</h2>
              <p className="mt-1 text-sm text-ink-3">{t('tarot.home.topicsSubtitle')}</p>
              <ul className="mt-4 grid grid-cols-2 gap-2 lg:gap-3">
                {TAROT_TOPIC_KEYS.filter((k) => !isSpreadTopic(k)).map((k) => {
                  const spread = TAROT_SPREADS[TAROT_TOPICS[k].spread];
                  return (
                    <li key={k}>
                      <Link to={`/tarot/ask?topic=${k}`} className="flex h-full flex-col rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                        <span className="flex items-center justify-between text-xs text-ink-3">
                          {t(`tarot.topics.${k}.label`)}
                          <span className="tabular">{t('tarot.spreads.cardCount', { count: spread.cards })}</span>
                        </span>
                        <span className="mt-1.5 font-semibold leading-snug">{t(`tarot.topics.${k}.title`)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-3">{t('tarot.home.freeNote')}</p>
            </section>

            <SpreadList yesnoToday={yesnoToday} />

            {recent.length > 0 && (
              <section className="mt-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{t('tarot.home.historyLink')}</h2>
                  <Link to="/tarot/history" className="text-sm font-semibold text-info">
                    {t('tarot.history.title')}
                  </Link>
                </div>
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {recent.map((h) => (
                    <li key={h.id}>
                      <Link to={`/tarot/r/${h.id}`} className="flex items-center gap-3 py-3">
                        <span className="flex shrink-0 -space-x-3">
                          {h.cards.slice(0, 3).map((c) => (
                            <TarotCardFace key={c.id} card={{ ...c, imagery: '' }} className="w-9 rounded-md" />
                          ))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs text-ink-3">
                            {h.date.slice(5).replace('-', '.')} · {h.topic ? t(`tarot.topics.${h.topic}.label`) : h.spreadName}
                          </span>
                          <span className="block truncate text-[15px]">{h.question ?? t('tarot.history.item.noQuestion')}</span>
                        </span>
                        <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <button type="button" onClick={() => setAbout(true)} className="mt-8 flex w-full items-center justify-between rounded-2xl bg-subtle px-4 py-3.5 text-left text-[15px] font-medium">
              {t('tarot.home.aboutLink')}
              <ChevronRight className="size-5 text-ink-3" aria-hidden />
            </button>
            <p className="mt-6 text-xs leading-relaxed text-ink-3">{t('tarot.disclaimer.short')}</p>
          </div>
        </div>
      </Page>

      <BottomSheet open={about} onClose={() => setAbout(false)} title={t('tarot.about.title')}>
        <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
          {(['deck', 'art', 'random', 'saju', 'review', 'ai', 'notAffiliated', 'purpose'] as const).map((k) => (
            <li key={k}>{t(`tarot.about.${k}`)}</li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}
