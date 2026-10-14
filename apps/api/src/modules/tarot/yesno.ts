/**
 * 예·아니오 기울기 — 카드와 방향만으로 정한다(사주·질문은 기울기를 바꾸지 않는다).
 *
 * 표의 원본은 카드 문안(content/*)의 `yesNo` 값이다(콘텐츠팀 작성, 78장 × 정/역 = 156칸).
 * 어느 칸이 어디에 속하는지는 docs/API.md '예·아니오 기울기 표'에 그대로 옮겨 두었고,
 * test/tarot.test.ts 가 이 문서 표와 문안이 어긋나지 않는지 확인한다.
 *
 *   기울기          정방향   역방향   분류 원칙
 *   예(yes)           51       4     시작·성취·결합·확장의 카드. 역방향은 막힘이 풀리는 카드만(완드 5, 컵 4·7, 소드 8)
 *   조건부(maybe)     16      51     기다림·숙고·선택이 필요한 카드(여사제·은둔자·정의·달 …)와 대부분 카드의 역방향(안에서 무르익는 중)
 *   아니오(no)        11      23     상실·갈등·속임이 중심인 카드(탑·악마·소드 3·5·7·9·10 …)와 '나아감'이 막힌 역방향(바보·전차·에이스 …)
 *
 * 역방향 35%(deck.ts)를 반영한 실제 비율은 대략 예 44% · 조건부 36% · 아니오 20%.
 * 화면은 큰 YES/NO 대신 3단계 기울기 막대와 경향 문장만 쓴다(06 §8.4 — 결정을 대신하지 않는다).
 */
import type { TarotYesNoLean } from '@saju/shared';
import { DECK, type TarotOrientation } from './content/index.js';
import type { DrawnCard } from './deck.js';

export const YES_NO_LABEL: Record<TarotYesNoLean, string> = {
  yes: "'예' 쪽으로 기울어 있어요",
  maybe: '조건부예요. 아직 어느 쪽으로도 열려 있어요',
  no: "'아니오' 쪽으로 기울어 있어요",
};

/** 카드 한 장(덱 인덱스·방향)의 기울기 */
export function yesNoLean(index: number, orientation: TarotOrientation): TarotYesNoLean {
  const card = DECK[index];
  if (!card) throw new Error(`없는 카드 인덱스: ${index}`);
  return card[orientation].yesNo;
}

export const leanOf = (d: DrawnCard): TarotYesNoLean => yesNoLean(d.index, d.orientation);
