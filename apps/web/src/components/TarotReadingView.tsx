import type { ReadingSection, TarotPlacedCardDto, TarotReadingDto } from '@saju/shared';
import { Check, Lock } from 'lucide-react';
import { useConfig, useProducts } from '@/hooks/queries';
import { t } from '@/lib/copy';
import { won } from '@/lib/format';
import { AdSlot } from './AdSlot';
import { TarotCardFace, orientationLabel } from './TarotCard';
import { Badge, Button, Card, cx } from './ui';

/** 무거운 카드 — 블록 위에 안내 상자 (공포 조장 금지의 화면 버전) */
const HEAVY: Record<string, string> = { 'major-13': 'death', 'major-15': 'devil', 'major-16': 'tower', 'swords-10': 'tenOfSwords' };

const dateLabel = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}월 ${d}일`;
};

function Paragraphs({ section }: { section: ReadingSection }) {
  return (
    <>
      <div className={cx('prose-reading', section.locked && 'fade-out-bottom max-h-32 overflow-hidden')}>
        {section.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {section.locked && (
        <p className="flex items-center gap-1.5 text-sm text-gold">
          <Lock className="size-3.5" aria-hidden />
          {t('tarot.paywall.lockTitle')}
        </p>
      )}
    </>
  );
}

function CardBlock({ card, section, id }: { card: TarotPlacedCardDto; section: ReadingSection | undefined; id: string }) {
  const heavy = HEAVY[card.id];
  return (
    <section id={id} className="scroll-mt-28 border-t border-line py-8">
      <div className="flex gap-4">
        <TarotCardFace card={card} className="w-20 shrink-0 lg:w-24" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-3">{t('tarot.result.positionLabel', { position: card.position.label })}</p>
          <h3 className="mt-1 font-serif text-[22px] font-semibold leading-snug">
            {card.nameKo} <span className="text-base font-normal text-ink-3">· {orientationLabel(card.orientation)}</span>
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('tarot.result.keywordsLabel')}>
            {card.keywords.slice(0, 3).map((k) => (
              <li key={k} className="rounded-full bg-subtle px-2.5 py-0.5 text-sm text-ink-2">
                {k}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {heavy && <p className="mt-4 rounded-xl bg-subtle p-3 text-sm leading-relaxed text-ink-2">{t(`tarot.result.heavyCards.${heavy}`)}</p>}
      <h4 className="mt-5 text-sm font-semibold text-ink-3">{t('tarot.result.meaningTitle')}</h4>
      <p className="mt-1 text-[17px] font-medium leading-relaxed">{card.meaning}</p>
      <details className="group mt-2 text-sm text-ink-3">
        <summary className="cursor-pointer list-none underline underline-offset-4">{t('tarot.result.imageryLabel')}</summary>
        <p className="mt-2 leading-relaxed">{card.imagery}</p>
        <p className="mt-1 text-xs">{t('tarot.result.imageryNote')}</p>
      </details>
      {section && (
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-ink-3">{t('tarot.result.inPositionTitle')}</h4>
          <Paragraphs section={section} />
        </div>
      )}
    </section>
  );
}

/** 타로 결과 본문 — 결과 화면·오늘의 카드 공용 */
export function TarotReadingView({ reading, onUnlock }: { reading: TarotReadingDto; onUnlock?: () => void }) {
  const { data: products } = useProducts();
  const { data: config } = useConfig();
  const product = products?.find((p) => p.id === reading.productId);
  const price = product?.purchasable ? won(product.price) : undefined;
  const sec = (key: string) => reading.sections.find((s) => s.key === key);
  const daily = reading.spread === 'daily';
  const single = reading.cards.length === 1;
  const story = sec('story');
  const actions = sec('actions');
  const saju = sec('saju');
  const hasReversed = reading.cards.some((c) => c.orientation === 'reversed');
  const topic = reading.topic;

  return (
    <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-x-12 lg:pt-6 xl:grid-cols-[380px_minmax(0,1fr)] xl:gap-x-16">
      {/* 질문 + 펼친 카드 (데스크톱: 왼쪽 고정) */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        {!daily && (
          <div className="pt-4 lg:pt-0">
            <p className="text-sm font-semibold text-ink-3">{t('tarot.result.questionLabel')}</p>
            <p className="mt-1 font-serif text-lg leading-snug">{reading.question ? `“${reading.question}”` : t('tarot.result.noQuestion')}</p>
          </div>
        )}
        <p className="mt-2 text-sm text-ink-3">
          {reading.spreadName} · {dateLabel(reading.date)}
        </p>
        <ol className={cx('mt-4 grid gap-2', single ? 'mx-auto max-w-[220px] grid-cols-1' : reading.cards.length === 3 ? 'grid-cols-3' : 'grid-cols-5')} aria-label={t('tarot.result.cardsTitle')}>
          {reading.cards.map((c, i) => (
            <li key={c.id}>
              <a href={single ? undefined : `#card-${i}`} className="block">
                <TarotCardFace card={c} eager />
              </a>
              <p className="mt-1.5 text-center text-xs leading-tight text-ink-2">{c.position.label}</p>
              {single && (
                <p className="mt-1 text-center font-serif text-lg">
                  {c.nameKo} <span className="text-sm text-ink-3">· {orientationLabel(c.orientation)}</span>
                </p>
              )}
            </li>
          ))}
        </ol>
      </aside>

      <div>
        <section className="pt-8 lg:pt-0">
          <p className="text-sm font-semibold text-ink-3">{t('tarot.result.headlineLabel')}</p>
          <h1 className="mt-2 font-serif text-[24px] font-semibold leading-snug lg:text-[30px]">{reading.headline}</h1>
          {reading.generator === 'ai' && (
            <div className="mt-3">
              <Badge tone="gold">{t('tarot.result.aiBadge')}</Badge>
            </div>
          )}
          {hasReversed && <p className="mt-4 text-sm leading-relaxed text-ink-3">{t('tarot.result.reversedNote')}</p>}
        </section>

        {daily ? (
          <>
            {sec('today') && (
              <section className="mt-6 border-t border-line pt-6">
                <h2 className="text-sm font-semibold text-ink-3">{t('tarot.result.synthesisTitleOne')}</h2>
                <div className="prose-reading mt-2">
                  {sec('today')!.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            {sec('overview') && (
              <section className="mt-6 border-t border-line pt-6">
                <p className="text-sm font-semibold text-ink-3">{t('tarot.result.synthesisLabel')}</p>
                <h2 className="mt-1 font-serif text-[22px] font-semibold">{t('tarot.result.synthesisTitle')}</h2>
                <div className="prose-reading mt-3">
                  {sec('overview')!.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </section>
            )}

            {reading.locked && (
              <Card className="mt-4 border-gold/40">
                <p className="flex items-center gap-2 font-semibold text-gold">
                  <Lock className="size-4" aria-hidden />
                  {t('tarot.paywall.lockTitle')}
                </p>
                <p className="mt-2 text-sm text-ink-2">{t('tarot.paywall.lockBody', { count: reading.cards.length })}</p>
                <p className="mt-4 text-xs font-semibold text-ink-3">{t('tarot.paywall.tocTitle')}</p>
                <ul className="mt-2 space-y-1.5 text-[15px]">
                  {[t('tarot.paywall.toc.position'), t('tarot.paywall.toc.flow'), t('tarot.paywall.toc.advice'), ...(saju ? ['사주로 본 근거 (일간·용신과 카드 원소)'] : [])].map((x) => (
                    <li key={x} className="flex items-start gap-2">
                      <Check className="mt-1 size-4 shrink-0 text-ink-3" aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-ink-3">{t('tarot.paywall.sameCards')}</p>
                {config?.ai.enabled && <p className="mt-1 text-xs text-ink-3">{t('tarot.paywall.aiNotice')}</p>}
                {onUnlock && (
                  <Button block className="mt-4" onClick={onUnlock}>
                    {price ? t('tarot.paywall.cta', { price }) : t('tarot.paywall.ctaNoPrice')}
                  </Button>
                )}
                <p className="mt-2 text-center text-xs text-ink-3">{t('tarot.paywall.previewKept')}</p>
              </Card>
            )}

            {reading.cards.map((c, i) => (
              <CardBlock key={c.id} id={`card-${i}`} card={c} section={sec(`pos-${c.position.key}`)} />
            ))}

            {story && (
              <section className="border-t border-line py-8">
                <h2 className="font-serif text-[22px] font-semibold">{story.title}</h2>
                {reading.generator === 'ai' && !story.locked && (
                  <div className="mt-2">
                    <Badge tone="gold">{t('tarot.result.aiBadge')}</Badge>
                  </div>
                )}
                <div className="mt-3">
                  <Paragraphs section={story} />
                </div>
              </section>
            )}
            {actions && (
              <section className="border-t border-line py-8">
                <h2 className="font-serif text-[22px] font-semibold">{t('tarot.result.adviceTitle')}</h2>
                {actions.locked ? (
                  <div className="mt-3">
                    <Paragraphs section={actions} />
                  </div>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {actions.paragraphs.map((p, i) => (
                      <li key={i} className="flex gap-3 text-[17px] leading-relaxed">
                        <span className="tabular font-serif text-ink-3">{i + 1}</span>
                        {p}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </>
        )}

        {saju && (
          <section className="border-t border-line py-8">
            <h2 className="font-serif text-[22px] font-semibold">{saju.title}</h2>
            <p className="mt-1 text-sm text-ink-3">
              {reading.profileName ? `${reading.profileName}님 · ` : ''}
              {saju.summary}
            </p>
            <div className="mt-3">
              <Paragraphs section={saju} />
            </div>
          </section>
        )}

        {(reading.locked || daily) && (
          <div className="mt-6">
            <AdSlot placement="result_bottom" />
          </div>
        )}

        <div className="mt-8 space-y-1.5 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
          <p>{t('tarot.result.basisNote')}</p>
          {topic === 'money' && <p>{t('tarot.disclaimer.expert')}</p>}
          {(topic === 'feelings' || topic === 'reunion') && <p>{t('tarot.disclaimer.thirdParty')}</p>}
          <p>{reading.disclaimer}</p>
          {reading.generator === 'ai' && <p>{t('tarot.disclaimer.ai')}</p>}
        </div>
      </div>
    </div>
  );
}
