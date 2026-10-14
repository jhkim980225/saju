import type { TarotCardDto } from '@saju/shared';
import { t } from '@/lib/copy';
import { cx } from './ui';

/** 카드 비율 2:3 — 그림은 public/tarot (생성형 AI 수묵화, 검수본) */
const FRAME = 'aspect-[2/3] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_2px_8px_rgba(31,29,26,0.08)]';

export const orientationLabel = (o: TarotCardDto['orientation']) => (o === 'reversed' ? t('tarot.reveal.reversed') : t('tarot.reveal.upright'));

/** 카드 앞면 — 역방향이면 그림만 180° 돌리고, 정/역은 글자로도 함께 표시한다 */
export function TarotCardFace({ card, className, eager }: { card: Pick<TarotCardDto, 'image' | 'nameKo' | 'orientation' | 'imagery'>; className?: string; eager?: boolean }) {
  return (
    <div className={cx(FRAME, className)}>
      <img
        src={card.image}
        alt={`${card.nameKo} · ${orientationLabel(card.orientation)} — ${card.imagery}`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className={cx('size-full object-cover', card.orientation === 'reversed' && 'rotate-180')}
      />
    </div>
  );
}

/** 카드 뒷면 */
export function TarotCardBack({ className }: { className?: string }) {
  return (
    <div className={cx(FRAME, className)} aria-hidden>
      <img src="/tarot/back.webp" alt="" decoding="async" className="size-full object-cover" />
    </div>
  );
}

/** 뒤집히는 카드 — 앞면 정보가 없으면 뒷면만 */
export function FlipCard({ card, flipped, className }: { card: TarotCardDto | null; flipped: boolean; className?: string }) {
  return (
    <div className={cx('flip aspect-[2/3]', className)}>
      <div className="flip-inner" data-flipped={flipped && Boolean(card)}>
        <TarotCardBack className="flip-face flip-back" />
        {card && <TarotCardFace card={card} eager className="flip-face flip-front" />}
      </div>
    </div>
  );
}
