import { TAROT_SPREADS, type TarotPlacedCardDto, type TarotSpread, type TarotYesNoLean } from '@saju/shared';
import type { ReactNode } from 'react';
import { t } from '@/lib/copy';
import { TarotCardFace, orientationLabel } from './TarotCard';
import { cx } from './ui';

/**
 * 펼침 방식 자리 배치 — 질문 미리보기·고르기·펼치기·결과가 같은 배치를 쓴다.
 *  - 1장: 가운데 한 장 / 3장: 가로 3칸 / 5장: 가로 5칸
 *  - 켈틱 크로스: 고전 배치. 가운데 십자(1~6)와 오른쪽 기둥(아래에서 위로 7~10),
 *    2번(가로막는 것)은 1번 위에 90° 돌려 놓는다. 자리 이름은 번호 범례로 아래에 모은다.
 */
export function TarotSpreadSlots({
  spread,
  renderCard,
  caption,
  className,
  label,
}: {
  spread: TarotSpread;
  /** 자리 i 의 카드(빈 슬롯·뒷면·앞면·뒤집히는 카드) */
  renderCard: (i: number) => ReactNode;
  /** 자리 i 의 이름 아래 덧붙일 글(펼친 카드 이름 등) */
  caption?: (i: number) => ReactNode;
  className?: string;
  label?: string;
}) {
  const positions = TAROT_SPREADS[spread].positions;
  if (spread === 'celtic') return <CelticCross renderCard={renderCard} caption={caption} className={className} label={label} />;
  const n = positions.length;
  return (
    <ol aria-label={label} className={cx('grid gap-2 sm:gap-3', n === 1 ? 'mx-auto w-40 grid-cols-1' : n === 3 ? 'mx-auto max-w-md grid-cols-3' : 'grid-cols-5', className)}>
      {positions.map((p, i) => (
        <li key={p.key} className="text-center">
          {renderCard(i)}
          <p className="mt-1.5 text-xs font-medium leading-tight text-ink-2">{p.label}</p>
          {caption?.(i)}
        </li>
      ))}
    </ol>
  );
}

/** 켈틱 크로스 자리 번호(0부터) → 격자 위치. 십자는 반 장만큼 내려 기둥과 가운데를 맞춘다 */
const CELTIC_CELL: Record<number, string> = {
  4: 'col-start-2 row-start-1 translate-y-1/2',
  3: 'col-start-1 row-start-2 translate-y-1/2',
  0: 'col-start-2 row-start-2 translate-y-1/2',
  5: 'col-start-3 row-start-2 translate-y-1/2',
  2: 'col-start-2 row-start-3 translate-y-1/2',
  9: 'col-start-5 row-start-1',
  8: 'col-start-5 row-start-2',
  7: 'col-start-5 row-start-3',
  6: 'col-start-5 row-start-4',
};

function Num({ n, className }: { n: number; className?: string }) {
  return (
    <span aria-hidden className={cx('tabular pointer-events-none absolute z-10 grid size-5 place-items-center rounded-full bg-action text-[11px] font-semibold text-on-action', className)}>
      {n}
    </span>
  );
}

function CelticCross({ renderCard, caption, className, label }: { renderCard: (i: number) => ReactNode; caption?: (i: number) => ReactNode; className?: string; label?: string }) {
  const positions = TAROT_SPREADS.celtic.positions;
  return (
    <div className={cx('mx-auto max-w-md', className)} data-spread="celtic">
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_4px_minmax(0,1fr)] gap-x-3 gap-y-2" role="group" aria-label={label}>
        {[4, 3, 0, 5, 2, 9, 8, 7, 6].map((i) => (
          <div key={i} className={cx('relative', CELTIC_CELL[i])}>
            {renderCard(i)}
            <Num n={i + 1} className="-left-1.5 -top-1.5" />
            {i === 0 && (
              <>
                {/* 2번 — 1번 위를 가로지르는 카드 */}
                <div className="absolute inset-0 grid place-items-center" data-crossing>
                  <div className="w-full rotate-90 scale-[0.7]">{renderCard(1)}</div>
                </div>
                <Num n={2} className="-bottom-1.5 -right-1.5" />
              </>
            )}
          </div>
        ))}
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs leading-snug text-ink-2">
        {positions.map((p, i) => (
          <li key={p.key} className="flex gap-1.5">
            <span className="tabular w-4 shrink-0 text-right font-semibold text-ink-3">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-medium">{p.label}</span>
              {caption?.(i)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 예·아니오 — 큰 YES/NO 대신 3단계 기울기 막대 (06 §8.4) */
export function TarotYesNoScale({ lean }: { lean: TarotYesNoLean }) {
  const steps: TarotYesNoLean[] = ['no', 'maybe', 'yes'];
  const scale: Record<TarotYesNoLean, string> = { no: t('tarot.result.yesno.scaleNo'), maybe: t('tarot.result.yesno.scaleMaybe'), yes: t('tarot.result.yesno.scaleYes') };
  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-ink-3">{t('tarot.result.yesno.scaleLabel')}</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5" role="img" aria-label={`${t('tarot.result.yesno.scaleLabel')}: ${scale[lean]}`}>
        {steps.map((s) => (
          <span key={s} data-active={s === lean || undefined} className={cx('h-2 rounded-full', s === lean ? 'bg-action' : 'bg-subtle')} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-3 text-xs text-ink-3" aria-hidden>
        {steps.map((s, i) => (
          <span key={s} className={cx(i === 1 && 'text-center', i === 2 && 'text-right', s === lean && 'font-semibold text-ink')}>
            {scale[s]}
          </span>
        ))}
      </div>
      <p className="mt-3 font-serif text-xl font-semibold">{t(`tarot.result.yesno.${lean}`)}</p>
    </div>
  );
}

/** 양자택일 — A·B 를 같은 크기·같은 순서로 나란히(모바일은 세로로 쌓기). 어느 쪽에도 표시를 달지 않는다 */
export function TarotChoiceCompare({ cards, options }: { cards: TarotPlacedCardDto[]; options: { a: string; b: string } }) {
  const sides = [
    { key: 'A', option: options.a, card: cards.find((c) => c.position.key === 'optionA') },
    { key: 'B', option: options.b, card: cards.find((c) => c.position.key === 'optionB') },
  ];
  return (
    <section className="mt-6 border-t border-line pt-6" aria-labelledby="choice-compare">
      <h2 id="choice-compare" className="font-serif text-[22px] font-semibold">
        {t('tarot.result.choice.compareTitle')}
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {sides.map(({ key, option, card }) =>
          card ? (
            <li key={key} className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
              <TarotCardFace card={card} className="w-16 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-3">
                  {key} · {t('tarot.result.choice.optionLabel', { option })}
                </p>
                <p className="mt-1 font-serif text-lg font-semibold leading-snug">
                  {card.nameKo} <span className="text-sm font-normal text-ink-3">· {orientationLabel(card.orientation)}</span>
                </p>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{card.meaning}</p>
                <p className="mt-2 text-xs text-ink-3">{card.keywords.slice(0, 3).join(' · ')}</p>
              </div>
            </li>
          ) : null,
        )}
      </ul>
      <p className="mt-3 text-sm leading-relaxed text-ink-3">{t('tarot.result.choice.note')}</p>
    </section>
  );
}
