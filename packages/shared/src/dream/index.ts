/**
 * @saju/shared/dream — 꿈해몽 사전 + AI 꿈풀이 API 계약.
 *
 * 사전 데이터가 커서(300여 항목) 메인 진입점(@saju/shared)과 분리한 하위 경로로 둔다.
 * 웹은 꿈해몽 화면(지연 로딩)에서만, API 는 꿈풀이 모듈에서만 불러온다.
 */
import { z } from 'zod';
import { ACTION_DREAMS } from './entries/action.js';
import { ANIMAL_DREAMS } from './entries/animal.js';
import { BODY_DREAMS } from './entries/body.js';
import { COLOR_NUMBER_DREAMS } from './entries/colorNumber.js';
import { EVENT_DREAMS } from './entries/event.js';
import { FOOD_DREAMS } from './entries/food.js';
import { KIND_DREAMS } from './entries/kind.js';
import { NATURE_DREAMS } from './entries/nature.js';
import { OBJECT_DREAMS } from './entries/object.js';
import { PERSON_DREAMS } from './entries/person.js';
import { PLACE_DREAMS } from './entries/place.js';
import { createDreamIndex, type DreamMatch } from './search.js';
import { DREAM_CATEGORIES, type DreamCategory, type DreamEntry, type DreamEntryInput, type DreamTone } from './types.js';

export * from './types.js';
export { choseong, createDreamIndex, normalizeDreamQuery, type DreamIndex, type DreamMatch } from './search.js';

// ---------------------------------------------------------------------------
// 사전
// ---------------------------------------------------------------------------

export const DREAM_CATEGORY_META: Record<DreamCategory, { label: string; description: string }> = {
  animal: { label: '동물', description: '뱀·돼지·호랑이처럼 꿈에 자주 찾아오는 동물' },
  person: { label: '사람', description: '가족·연인·낯선 사람, 꿈에서 만난 얼굴들' },
  nature: { label: '자연', description: '해와 달, 물과 불, 하늘과 땅의 풍경' },
  object: { label: '물건', description: '돈·반지·열쇠처럼 손에 쥐어지는 것들' },
  action: { label: '행동', description: '날고, 떨어지고, 쫓기는 꿈속의 몸짓' },
  body: { label: '신체', description: '이가 빠지거나 피가 나는, 몸에 관한 꿈' },
  place: { label: '장소', description: '집·학교·화장실, 꿈의 무대가 된 곳' },
  colorNumber: { label: '색·숫자', description: '유난히 또렷했던 색과 숫자' },
  food: { label: '음식', description: '밥·떡·과일, 꿈속 식탁에 오른 것들' },
  event: { label: '사건·상황', description: '결혼·시험·이사처럼 꿈에서 겪은 일' },
  kind: { label: '꿈의 종류', description: '태몽·예지몽·악몽, 꿈을 부르는 이름들' },
};

export const DREAM_TONE_LABEL: Record<DreamTone, string> = { good: '길몽', bad: '흉몽', neutral: '중립' };
export const DREAM_TONE_HINT: Record<DreamTone, string> = {
  good: '좋은 기운으로 풀이해 온 꿈',
  bad: '조심하라는 신호로 풀이해 온 꿈',
  neutral: '상황에 따라 다르게 읽는 꿈',
};

/** 사전·꿈풀이 공통 고지 — 꿈은 예언이 아니다 */
export const DREAM_DISCLAIMER = '꿈은 앞날을 알려 주는 예언이 아니에요. 전해 오는 해석을 참고해 지금의 마음을 돌아보는 이야기로 가볍게 읽어 주세요.';
/** 사전 문안 출처 표기 — 가공 인물 없이 */
export const DREAM_SOURCE_NOTE = '전해 오는 민속 해석을 바탕으로 달빛사주 콘텐츠팀이 새로 쓴 풀이예요.';

const toSlug = (keyword: string) => keyword.trim().replace(/\s+/g, '-');

const BY_CATEGORY: Record<DreamCategory, DreamEntryInput[]> = {
  animal: ANIMAL_DREAMS,
  person: PERSON_DREAMS,
  nature: NATURE_DREAMS,
  object: OBJECT_DREAMS,
  action: ACTION_DREAMS,
  body: BODY_DREAMS,
  place: PLACE_DREAMS,
  colorNumber: COLOR_NUMBER_DREAMS,
  food: FOOD_DREAMS,
  event: EVENT_DREAMS,
  kind: KIND_DREAMS,
};

/** 사전 전체 — 분류 순서 → 파일 안 순서 */
export const DREAM_ENTRIES: readonly DreamEntry[] = DREAM_CATEGORIES.flatMap((category) => BY_CATEGORY[category].map((e) => ({ ...e, category, slug: toSlug(e.keyword) })));

export const dreamIndex = createDreamIndex(DREAM_ENTRIES);
export const getDreamEntry = (slug: string) => dreamIndex.get(slug);
/** 키워드·별칭으로 항목 찾기 ('구렁이' → 뱀) */
export const resolveDreamTerm = (term: string) => dreamIndex.resolve(term);
export const searchDreams = (query: string, limit?: number) => dreamIndex.search(query, limit);
export const extractDreamSymbols = (text: string, limit?: number): DreamMatch[] => dreamIndex.extract(text, limit);
export const dreamEntriesOf = (category: DreamCategory) => DREAM_ENTRIES.filter((e) => e.category === category);

/** 화면 제목용 — '뱀' → '뱀 꿈', '쫓기는 꿈' → '쫓기는 꿈' */
export const dreamTitle = (e: Pick<DreamEntry, 'keyword'>) => (e.keyword.endsWith('꿈') ? e.keyword : `${e.keyword} 꿈`);

// ---------------------------------------------------------------------------
// AI 꿈풀이 API 계약 — POST /api/v1/dream/interpret
// ---------------------------------------------------------------------------

export const DREAM_TEXT_MIN = 5;
export const DREAM_TEXT_MAX = 500;

export const dreamInterpretSchema = z.object({
  text: z.string().trim().min(DREAM_TEXT_MIN, '꿈 내용을 조금만 더 적어 주세요.').max(DREAM_TEXT_MAX, `꿈 내용은 ${DREAM_TEXT_MAX}자까지 적을 수 있어요.`),
  /** 사주를 함께 볼 프로필 — 없으면 대표 프로필(있을 때) */
  profileId: z.string().optional(),
  /** true 면 사주 없이 꿈만 본다 */
  withoutSaju: z.boolean().optional(),
});
export type DreamInterpretDto = z.input<typeof dreamInterpretSchema>;

/** 자해·자살 암시 — 화면에 상담 전화 안내를 함께 띄운다 */
export const DREAM_CRISIS_PATTERN = /죽고\s*싶|자살|자해|살기\s*싫|사라지고\s*싶|목숨을\s*끊/;

export interface DreamSymbolDto {
  slug: string;
  keyword: string;
  category: DreamCategory;
  tone: DreamTone;
  summary: string;
  /** 꿈 설명과 맞아떨어진 상황 */
  variation: { title: string; text: string; tone: DreamTone } | null;
}

export interface DreamInterpretationDto {
  /** 사전에서 찾은 상징 (규칙 기반 근거) */
  symbols: DreamSymbolDto[];
  headline: string;
  paragraphs: string[];
  /** ai: AI 가 쓴 풀이 / rule: 사전 해석을 규칙으로 엮은 기본 풀이 */
  generator: 'ai' | 'rule';
  /** 이번에 차감된 질문권 (AI 풀이일 때만) */
  creditsCharged: number;
  creditsLeft: number;
  /** 사주를 함께 본 프로필 이름 (AI 풀이에서만) */
  profileName: string | null;
  /** 꿈 설명에 위기 신호가 있으면 true — 화면에 109 안내 */
  crisis: boolean;
  /** 생성 방식 고지 (AI 생성물 표시) */
  notice: string;
  disclaimer: string;
}

export const toDreamSymbolDto = (m: DreamMatch): DreamSymbolDto => ({
  slug: m.entry.slug,
  keyword: m.entry.keyword,
  category: m.entry.category,
  tone: m.entry.tone,
  summary: m.entry.summary,
  variation: m.variation ? { title: m.variation.title, text: m.variation.text, tone: m.variation.tone ?? m.entry.tone } : null,
});
