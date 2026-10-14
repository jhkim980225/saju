import { TAROT_OPTION_MAX, TAROT_QUESTION_MAX, TAROT_SPREADS, TAROT_TOPICS, type ProfileDto, type TarotTopic } from '@saju/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { TarotCardBack } from '@/components/TarotCard';
import { TarotSpreadSlots } from '@/components/TarotSpread';
import { Button, Chip, IconButton, PageHeader, Spinner, TextInput, cx } from '@/components/ui';
import { useProfiles } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { t } from '@/lib/copy';
import { storage } from '@/lib/storage';
import { TAROT_DRAFT_KEY, draftError, type TarotDraft } from '@/lib/tarot';


const EXPERT = /병원|아프|건강|수술|임신|소송|재판|법적|투자|주식|코인|대출|부동산/;
const CRISIS = /죽고\s*싶|자살|자해|살기\s*싫|사라지고\s*싶/;

/** 궁합 타로 — 나 × 상대 고르기 (궁합 화면과 같은 저장된 사주 목록·상대 추가 흐름) */
function PairPicker({ me, partner, onChange }: { me?: string; partner?: string; onChange: (slot: 'me' | 'partner', id: string) => void }) {
  const navigate = useNavigate();
  const profiles = useProfiles();
  const list = profiles.data ?? [];
  const [picking, setPicking] = useState<'me' | 'partner' | null>(null);
  const nameOf = (id?: string) => list.find((p) => p.id === id)?.name;
  const back = encodeURIComponent('/tarot/ask?topic=compat');

  if (profiles.isLoading) return <Spinner />;
  if (profiles.isFetched && list.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-line-strong p-5 text-center">
        <p className="text-[15px] text-ink-2">{t('tarot.spreads.compat.needSelf')}</p>
        <Button className="mt-3" size="sm" onClick={() => navigate(`/profiles/new?save=1&relation=self&next=${back}`)}>
          {t('tarot.spreads.compat.saveSelf')}
        </Button>
      </div>
    );
  }
  return (
    <>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button type="button" onClick={() => setPicking('me')} aria-label={`${t('tarot.spreads.compat.me')}: ${nameOf(me) ?? ''}`} className="h-14 rounded-2xl border border-line-strong bg-surface px-3 font-semibold">
          {nameOf(me) ?? t('tarot.spreads.compat.me')}
        </button>
        <span className="font-serif text-xl text-ink-3" aria-hidden>
          ×
        </span>
        <button
          type="button"
          onClick={() => setPicking('partner')}
          className={cx('h-14 rounded-2xl border px-3 font-semibold', partner ? 'border-line-strong bg-surface' : 'border-dashed border-line-strong text-ink-3')}
        >
          {nameOf(partner) ?? `+ ${t('tarot.spreads.compat.pickPerson')}`}
        </button>
      </div>
      <BottomSheet open={picking !== null} onClose={() => setPicking(null)} title={picking === 'me' ? t('tarot.spreads.compat.me') : t('tarot.spreads.compat.pickPerson')}>
        <ul className="divide-y divide-line">
          {list
            .filter((p) => p.id !== (picking === 'me' ? partner : me))
            .map((p: ProfileDto) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between py-3.5 text-left"
                  onClick={() => {
                    onChange(picking!, p.id);
                    setPicking(null);
                  }}
                >
                  {p.name}
                  <span className="font-serif text-sm text-ink-3">
                    {p.dayPillar} · {p.zodiac}띠
                  </span>
                </button>
              </li>
            ))}
        </ul>
        <Button variant="secondary" block className="mt-3" onClick={() => navigate(`/profiles/new?save=1&relation=${picking === 'me' ? 'self' : 'partner'}&next=${back}`)}>
          {picking === 'me' ? t('tarot.spreads.compat.saveSelf') : t('tarot.spreads.compat.addPartner')}
        </Button>
      </BottomSheet>
    </>
  );
}

/** 질문 입력 — 펼침 방식은 주제에 따라 정해진다 (양자택일은 선택지 A·B, 궁합 타로는 상대도 함께) */
export function TarotAskPage() {
  const navigate = useNavigate();
  const gate = useSessionGate();
  const [params] = useSearchParams();
  const topic = params.get('topic') as TarotTopic | null;
  const [question, setQuestion] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');
  const [pair, setPair] = useState<{ me?: string; partner?: string }>({});
  const [touched, setTouched] = useState(false);
  const profiles = useProfiles(topic === 'compat');
  if (!topic || !(topic in TAROT_TOPICS)) return <Navigate to="/tarot" replace />;
  const spreadKey = TAROT_TOPICS[topic].spread;
  const spread = TAROT_SPREADS[spreadKey];

  // 궁합 타로 기본값 — 나는 대표 사주, 상대는 가장 최근에 저장한 다른 사람(연인·배우자 우선)
  const list = profiles.data ?? [];
  const me = pair.me ?? (list.find((p) => p.isPrimary) ?? list[0])?.id;
  const others = list.filter((p) => p.id !== me);
  const partner = pair.partner ?? (others.filter((p) => p.relation === 'partner').at(-1) ?? others.at(-1))?.id;

  // t() 는 없는 키를 그대로 돌려준다
  const examples = [0, 1, 2].map((i) => t(`tarot.question.examples.${topic}.${i}`)).filter((x) => !x.startsWith('tarot.'));
  const notes = [
    CRISIS.test(question) && t('tarot.question.sensitive.crisis'),
    EXPERT.test(question) && t('tarot.question.sensitive.expert'),
    (topic === 'feelings' || topic === 'reunion' || topic === 'compat') && t('tarot.question.sensitive.thirdParty'),
  ].filter(Boolean) as string[];
  const questionRequired = spreadKey === 'yesno';
  const draft = (q: string): TarotDraft => ({
    topic,
    question: q.trim(),
    ...(spreadKey === 'choice' ? { optionA: optionA.trim(), optionB: optionB.trim() } : {}),
    ...(spreadKey === 'compat' ? { profileId: me, partnerProfileId: partner } : {}),
  });
  const error = draftError(draft(question));

  const go = (q: string) => {
    setTouched(true);
    const d = draft(q);
    if (draftError(d)) return;
    storage.setJSON(TAROT_DRAFT_KEY, d);
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
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        {spreadKey === 'compat' && (
          <section className="mt-4">
            <h2 className="font-serif text-[22px] font-semibold">{t('tarot.spreads.compat.pickTitle')}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{t('tarot.spreads.compat.pickNote')}</p>
            <PairPicker me={me} partner={partner} onChange={(slot, id) => setPair((p) => ({ me: p.me ?? me, partner: p.partner ?? partner, [slot]: id }))} />
          </section>
        )}

        {spreadKey === 'choice' && (
          <section className="mt-4">
            <h2 className="font-serif text-[22px] font-semibold">{t('tarot.spreads.choice.optionsTitle')}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{t('tarot.spreads.choice.optionsNote')}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['A', optionA, setOptionA, t('tarot.spreads.choice.optionA'), t('tarot.spreads.choice.optionPlaceholderA')],
                  ['B', optionB, setOptionB, t('tarot.spreads.choice.optionB'), t('tarot.spreads.choice.optionPlaceholderB')],
                ] as const
              ).map(([k, value, set, label, placeholder]) => (
                <div key={k}>
                  <label htmlFor={`tarot-option-${k}`} className="flex items-center justify-between text-[15px] font-semibold">
                    {label}
                    <span className="tabular text-sm font-normal text-ink-3">{t('tarot.question.counter', { count: value.length, max: TAROT_OPTION_MAX })}</span>
                  </label>
                  <TextInput
                    id={`tarot-option-${k}`}
                    value={value}
                    maxLength={TAROT_OPTION_MAX}
                    onChange={(e) => set(e.target.value.slice(0, TAROT_OPTION_MAX))}
                    placeholder={placeholder}
                    invalid={touched && !value.trim()}
                    className="mt-2"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <h2 className={cx('font-serif text-[22px] font-semibold', spreadKey === 'compat' || spreadKey === 'choice' ? 'mt-8' : 'mt-4')}>{t('tarot.question.title')}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{questionRequired ? t('tarot.spreads.yesno.questionRequired') : t('tarot.question.subtitle')}</p>

        <div className="mt-6">
          <label htmlFor="tarot-question" className="flex items-center justify-between text-[15px] font-semibold">
            <span>
              {t('tarot.question.label')} {!questionRequired && <span className="text-sm font-normal text-ink-3">({t('tarot.question.optional')})</span>}
            </span>
            <span className="tabular text-sm font-normal text-ink-3">{t('tarot.question.counter', { count: question.length, max: TAROT_QUESTION_MAX })}</span>
          </label>
          <textarea
            id="tarot-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, TAROT_QUESTION_MAX))}
            rows={3}
            required={questionRequired}
            placeholder={questionRequired ? t('tarot.question.examples.yesno.0') : spreadKey === 'choice' ? t('tarot.question.examples.choice.0') : t('tarot.question.placeholder')}
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
          <TarotSpreadSlots className="mt-3" spread={spreadKey} renderCard={() => <TarotCardBack className="opacity-60" />} />
          {spread.freeCards > 0 && spread.productId && <p className="mt-3 text-xs text-ink-3">첫 자리 풀이는 무료로, 나머지 자리는 깊은 풀이에서 이어서 읽어요.</p>}
          {spreadKey === 'yesno' && <p className="mt-3 text-xs text-ink-3">{t('tarot.spreads.yesno.dailyFree')}</p>}
          {spreadKey === 'celtic' && <p className="mt-3 text-xs leading-relaxed text-ink-3">{t('tarot.spreads.celtic.crossNote')}</p>}
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
          {touched && error && (
            <p role="alert" className="pb-1 text-center text-sm text-danger">
              {error}
            </p>
          )}
          <Button block size="lg" disabled={touched && Boolean(error)} onClick={() => go(question)}>
            {t('tarot.question.submit')}
          </Button>
          {!questionRequired && (
            <Button block variant="ghost" size="sm" onClick={() => go('')}>
              {t('tarot.question.skip')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
