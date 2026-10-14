import { CUPS } from './cups.js';
import { MAJOR_ARCANA } from './major.js';
import { PENTACLES } from './pentacles.js';
import { SWORDS } from './swords.js';
import type { TarotCardContent } from './types.js';
import { WANDS } from './wands.js';

export * from './types.js';

/** 78장 덱 — 인덱스(0~77)가 셔플·저장에 쓰이므로 순서 변경 금지: 메이저 22 → 완드 → 컵 → 소드 → 펜타클 */
export const DECK: readonly TarotCardContent[] = [...MAJOR_ARCANA, ...WANDS, ...CUPS, ...SWORDS, ...PENTACLES];

const BY_ID = new Map(DECK.map((c, i) => [c.id, i]));
export const deckIndexOf = (id: string): number | undefined => BY_ID.get(id);
