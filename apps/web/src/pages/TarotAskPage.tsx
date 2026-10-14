import { TAROT_QUESTION_MAX, TAROT_SPREADS, TAROT_TOPICS, type TarotTopic } from '@saju/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { TarotCardBack } from '@/components/TarotCard';
import { Button, Chip, IconButton, PageHeader, cx } from '@/components/ui';
import { t } from '@/lib/copy';
import { storage } from '@/lib/storage';

export const TAROT_DRAFT_KEY = 'yd.tarotDraft';
export interface TarotDraft {
  topic: TarotTopic;
  question: string;
}

const EXPERT = /병원|아프|건강|수술|임신|소송|재판|법적|투자|주식|코인|대출|부동산/;
const CRISIS = /죽고\s*싶|자살|자해|살기\s*싫|사라지고\s*싶/;

/** 질문 입력 — 펼침 방식은 주제에 따라 정해진다 */
export function TarotAskPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const topic = params.get('topic') as TarotTopic | null;
  const [question, setQuestion] = useState('');
  if (!topic || !(topic in TAROT_TOPICS)) return <Navigate to="/tarot" replace />;
  const spread = TAROT_SPREADS[TAROT_TOPICS[topic].spread];
  // t() 는 없는 키를 그대로 돌려준다
  const examples = [0, 1, 2].map((i) => t(`tarot.question.examples.${topic}.${i}`)).filter((x) => !x.startsWith('tarot.'));
  const notes = [
    CRISIS.test(question) && t('tarot.question.sensitive.crisis'),
    EXPERT.test(question) && t('tarot.question.sensitive.expert'),
    (topic === 'feelings' || topic === 'reunion') && t('tarot.question.sensitive.thirdParty'),
  ].filter(Boolean) as string[];

  const go = (q: string) => {
    storage.setJSON(TAROT_DRAFT_KEY, { topic, question: q.trim() } satisfies TarotDraft);
    navigate('/tarot/draw');
  };

  return (
    <div className="min-h-page pb-40 lg:pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={t(`tarot.topics.${topic}.label`)}
      />
      <Page>
        <h2 className="mt-4 font-serif text-[22px] font-semibold">{t('tarot.question.title')}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{t('tarot.question.subtitle')}</p>

        <div className="mt-6">
          <label htmlFor="tarot-question" className="flex items-center justify-between text-[15px] font-semibold">
            <span>
              {t('tarot.question.label')} <span className="text-sm font-normal text-ink-3">({t('tarot.question.optional')})</span>
            </span>
            <span className="tabular text-sm font-normal text-ink-3">{t('tarot.question.counter', { count: question.length, max: TAROT_QUESTION_MAX })}</span>
          </label>
          <textarea
            id="tarot-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, TAROT_QUESTION_MAX))}
            rows={3}
            placeholder={t('tarot.question.placeholder')}
            className="mt-2 w-full resize-none rounded-xl border border-line-strong bg-surface px-4 py-3 text-base leading-relaxed outline-none placeholder:text-ink-3 focus:border-ink"
          />
        </div>

        {examples.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-ink-2">{t('tarot.question.examplesTitle')}</p>
            <div className="mt-2 flex flex-col items-start gap-2">
              {examples.map((x) => (
                <Chip key={x} onClick={() => setQuestion(x)} className="h-auto min-h-10 whitespace-normal py-2 text-left">
                  {x}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {notes.map((n) => (
          <p key={n} role="note" className="mt-4 rounded-xl bg-subtle p-3 text-sm leading-relaxed text-ink-2">
            {n}
          </p>
        ))}

        <section className="mt-8">
          <p className="flex items-baseline justify-between text-[15px] font-semibold">
            {t('tarot.question.spreadLabel')}
            <span className="text-sm font-normal text-ink-3">
              {spread.name} · {t('tarot.spreads.cardCount', { count: spread.cards })}
            </span>
          </p>
          <ol className={cx('mt-3 grid gap-2', spread.cards === 3 ? 'grid-cols-3' : 'grid-cols-5')}>
            {spread.positions.map((p) => (
              <li key={p.key} className="text-center">
                <TarotCardBack className="opacity-60" />
                <p className="mt-1.5 text-xs font-medium leading-tight text-ink-2">{p.label}</p>
              </li>
            ))}
          </ol>
          {spread.freeCards > 0 && spread.productId && <p className="mt-3 text-xs text-ink-3">첫 자리 풀이는 무료로, 나머지 자리는 깊은 풀이에서 이어서 읽어요.</p>}
        </section>

        <details className="mt-6 rounded-xl border border-line p-4 text-sm text-ink-2">
          <summary className="cursor-pointer font-semibold text-ink">{t('tarot.question.tips.title')}</summary>
          <ul className="mt-2 space-y-1.5 leading-relaxed">
            <li>{t('tarot.question.tips.open')}</li>
            <li>{t('tarot.question.tips.self')}</li>
            <li>{t('tarot.question.tips.time')}</li>
          </ul>
        </details>
        <p className="mt-4 text-xs text-ink-3">{t('tarot.question.privacyNote')}</p>
      </Page>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas lg:static lg:border-0 lg:bg-transparent">
        <div className="mx-auto max-w-xl space-y-1 px-5 py-3 lg:pt-8">
          <Button block size="lg" onClick={() => go(question)}>
            {t('tarot.question.submit')}
          </Button>
          <Button block variant="ghost" size="sm" onClick={() => go('')}>
            {t('tarot.question.skip')}
          </Button>
        </div>
      </div>
    </div>
  );
}
