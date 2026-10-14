/**
 * 타로 화면 공용 규칙 — 질문 초안(질문 화면 → 섞기 화면), 섞기 전 입력 확인, 무료/유료 펼침 구분.
 * 서버가 같은 규칙을 다시 확인한다(apps/api/src/modules/tarot/service.ts) — 여기서는 버튼을 막고 안내만 한다.
 */
import { TAROT_OPTION_MAX, TAROT_QUESTION_MAX, TAROT_SPREADS, TAROT_TOPICS, type TarotSpread, type TarotTopic } from '@saju/shared';
import { t } from './copy';

export const TAROT_DRAFT_KEY = 'yd.tarotDraft';
export interface TarotDraft {
  topic: TarotTopic;
  question: string;
  /** 양자택일 선택지 */
  optionA?: string;
  optionB?: string;
  /** 궁합 타로 — 나(사주 결합)와 상대 */
  profileId?: string;
  partnerProfileId?: string;
}

/** 상품이 없는 펼침(오늘의 카드·예·아니오)은 깊은 풀이 없이 전부 무료 */
export const isPaidSpread = (spread: TarotSpread) => Boolean(TAROT_SPREADS[spread].productId);

const same = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim();

/** 섞기 전에 막을 입력 오류 — 없으면 null */
export function draftError(d: TarotDraft): string | null {
  const spread = TAROT_TOPICS[d.topic].spread;
  const q = d.question.trim();
  if (q.length > TAROT_QUESTION_MAX) return t('tarot.question.errors.tooLong', { max: TAROT_QUESTION_MAX });
  if (spread === 'yesno' && !q) return t('tarot.spreads.yesno.questionRequired');
  if (spread === 'choice') {
    const a = d.optionA?.trim() ?? '';
    const b = d.optionB?.trim() ?? '';
    if (!a || !b) return t('tarot.question.errors.optionRequired');
    if (a.length > TAROT_OPTION_MAX || b.length > TAROT_OPTION_MAX) return t('tarot.question.errors.optionTooLong', { max: TAROT_OPTION_MAX });
    if (same(a, b)) return '서로 다른 두 선택지를 적어 주세요.';
  }
  if (spread === 'compat' && !d.partnerProfileId) return t('tarot.spreads.compat.partnerRequired');
  return null;
}

/** 섞기·뽑기 API 에 함께 보낼 펼침 방식별 입력 */
export function draftExtras(d: TarotDraft): { optionA?: string; optionB?: string; partnerProfileId?: string } {
  const spread = TAROT_TOPICS[d.topic].spread;
  if (spread === 'choice') return { optionA: d.optionA?.trim(), optionB: d.optionB?.trim() };
  if (spread === 'compat') return { partnerProfileId: d.partnerProfileId };
  return {};
}
