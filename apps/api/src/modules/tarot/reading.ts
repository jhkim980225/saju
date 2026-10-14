/**
 * 타로 리딩 생성 (규칙 기반) — 카드 문안(content/) + 펼침 자리 + 주제 + (있으면) 사주 원국.
 *
 * 무료/유료 경계 (docs/research/05-tarot-market.md §7.4, 06 §6):
 * - 무료: 카드 공개, 카드별 전통 뜻·한 줄, 총평 첫 문단, 펼침의 앞쪽 freeCards 장 자리 풀이
 * - 유료: 나머지 자리별 풀이, 카드끼리 이어지는 이야기, 행동 세 가지, 사주로 본 근거
 * 잠긴 섹션은 첫 문단 미리보기만 보낸다(lock).
 *
 * 사주 결합은 "달빛사주 방식" 연결임을 화면에 밝힌다 — 타로의 원소와 오행을 잇는 전통은 없다.
 */
import { controls, generates, type Element, type SajuChart } from '@saju/core';
import { TAROT_SPREADS, TAROT_TOPICS, type ReadingSection, type TarotCardDto, type TarotPlacedCardDto, type TarotSpread, type TarotTopic } from '@saju/shared';
import { EL_NAME, josa, lock, pick } from '../interpretation/reading.js';
import { DECK, type TarotCardContent, type TarotOrientation, type TarotOrientationContent } from './content/index.js';
import type { DrawnCard } from './deck.js';

export const TAROT_DISCLAIMER =
  '타로는 지금의 마음과 흐름을 비춰 보는 참고 도구예요. 미래를 정해 주지 않으니, 중요한 결정은 스스로의 판단과 전문가의 조언을 함께 고려해 주세요.';

// ── 달빛사주 방식 원소 연결 ───────────────────────────────────

/** 완드 = 잎이 돋은 나무 지팡이(木), 컵 = 물(水), 소드 = 쇠(金), 펜타클 = 흙과 재물(土) */
const SUIT_ELEMENT = { wands: 'wood', cups: 'water', swords: 'metal', pentacles: 'earth' } as const satisfies Record<string, Element>;
/** 메이저 22장 — 행성은 동양 이름(水星·金星·火星·木星·土星, 太陰·太陽)을, 별자리는 원소(공기 = 소드와 같은 金)를 따른다 */
const MAJOR_ELEMENT: readonly [Element, string][] = [
  ['metal', '바람(공기)의 카드'],
  ['water', '수성(水星)의 카드'],
  ['water', '달(太陰)의 카드'],
  ['metal', '금성(金星)의 카드'],
  ['fire', '양자리(불)의 카드'],
  ['earth', '황소자리(흙)의 카드'],
  ['metal', '쌍둥이자리(공기)의 카드'],
  ['water', '게자리(물)의 카드'],
  ['fire', '사자자리(불)의 카드'],
  ['earth', '처녀자리(흙)의 카드'],
  ['wood', '목성(木星)의 카드'],
  ['metal', '천칭자리(공기)의 카드'],
  ['water', '물의 카드'],
  ['water', '전갈자리(물)의 카드'],
  ['fire', '궁수자리(불)의 카드'],
  ['earth', '염소자리(흙)의 카드'],
  ['fire', '화성(火星)의 카드'],
  ['metal', '물병자리(공기)의 카드'],
  ['water', '물고기자리(물)의 카드'],
  ['fire', '태양(太陽)의 카드'],
  ['fire', '불의 카드'],
  ['earth', '토성(土星)의 카드'],
];
const SUIT_WHY = { wands: '잎이 돋은 나무 지팡이', cups: '물을 담는 잔', swords: '쇠로 벼린 칼', pentacles: '흙과 재물을 뜻하는 동전' } as const;

export const ELEMENT_NOTE =
  '타로의 원소와 사주의 오행을 달빛사주 방식으로 연결한 해석이에요. 완드는 잎이 돋은 나무 지팡이라 木, 컵은 水, 소드는 金, 펜타클은 土로, 메이저 카드는 행성·별자리의 동양 이름을 따라 이었어요.';

const ELEMENT_THEME: Record<Element, string> = {
  wood: '시작하고 자라나는 일',
  fire: '드러내고 표현하는 일',
  earth: '현실을 다지고 지키는 일',
  metal: '판단하고 정리하는 일',
  water: '마음과 관계를 살피는 일',
};

export function cardElement(c: TarotCardContent): Element {
  return c.suit ? SUIT_ELEMENT[c.suit] : MAJOR_ELEMENT[c.number]![0];
}
function elementWhy(c: TarotCardContent): string {
  return c.suit ? `${josa(SUIT_WHY[c.suit], '이', '가')} 그려진 카드` : MAJOR_ELEMENT[c.number]![1];
}

// ── 카드 DTO ─────────────────────────────────────────────

const REV = (o: TarotOrientation) => (o === 'reversed' ? ' (역방향)' : '');
const DIGIT_HAS_BATCHIM = [true, true, false, true, false, false, true, true, true, false];
/** 카드 이름 뒤 조사 — "완드 2는", "컵 10은" */
function cj(name: string, withBatchim: string, without: string) {
  const last = name.at(-1)!;
  if (/\d/.test(last)) return name + (DIGIT_HAS_BATCHIM[Number(last)] ? withBatchim : without);
  return josa(name, withBatchim, without);
}

export function cardDto(d: DrawnCard): TarotCardDto {
  const c = DECK[d.index]!;
  const o = c[d.orientation];
  return {
    id: c.id,
    index: d.index,
    nameKo: c.nameKo,
    nameEn: c.nameEn,
    arcana: c.arcana,
    suit: c.suit,
    number: c.number,
    orientation: d.orientation,
    image: `/tarot/cards/${c.id}.webp`,
    imagery: c.imagery,
    keywords: o.keywords,
    meaning: o.summary,
    element: cardElement(c),
    yesNo: o.yesNo,
  };
}

// ── 주제·자리별 문안 선택 ─────────────────────────────────

type Field = 'general' | 'love' | 'feelings' | 'career' | 'money' | 'advice';
const TOPIC_FIELD: Record<TarotTopic, Field> = { love: 'love', feelings: 'love', reunion: 'love', career: 'career', money: 'money', relation: 'general', self: 'general' };
/** 상대의 마음을 읽는 자리는 '속마음' 문안, 도움·조언 자리는 '조언' 문안 */
const POSITION_FIELD: Record<string, Field> = { outer: 'feelings', inner: 'feelings', them: 'feelings', help: 'advice', need: 'advice' };

const firstSentence = (t: string) => t.match(/^.+?[요다]\.(?=\s|$)/)?.[0] ?? t;

function fieldFor(topic: TarotTopic | null, positionKey: string): Field {
  return POSITION_FIELD[positionKey] ?? (topic ? TOPIC_FIELD[topic] : 'general');
}

// ── 사주 결합 ────────────────────────────────────────────

type Relation = 'same' | 'support' | 'express' | 'manage' | 'test';
function relationTo(dayMaster: Element, el: Element): Relation {
  if (el === dayMaster) return 'same';
  if (generates(el) === dayMaster) return 'support';
  if (generates(dayMaster) === el) return 'express';
  if (controls(dayMaster) === el) return 'manage';
  return 'test';
}
const RELATION_TEXT: Record<Relation, string> = {
  same: '나와 같은 결의 기운이라 자연스럽게 받아들이기 쉬워요',
  support: '나를 받쳐 주는 기운이라, 이 카드의 메시지에서 힘을 얻기 좋아요',
  express: '내가 힘을 쏟아 표현하게 만드는 기운이라, 움직일수록 의미가 또렷해져요',
  manage: '내가 다뤄서 결과로 만드는 기운이라, 손에 잡히는 계획으로 옮겨 보면 좋아요',
  test: '나를 다듬고 시험하는 기운이라 조금 부담스럽게 느껴질 수 있어요. 그만큼 배울 것이 분명한 카드예요',
};

/** 오행 이름 + 조사 — "화(火)를", "목(木)을" */
const elj = (el: Element, withBatchim: string, without: string) => EL_NAME[el] + josa(EL_NAME[el][0]!, withBatchim, without).slice(1);
/** 조사만 — "「…것」을" */
const particle = (word: string, withBatchim: string, without: string) => cj(word, withBatchim, without).slice(word.length);

function sajuLines(chart: SajuChart, placed: TarotPlacedCardDto[]): { paragraphs: string[]; basis: string } {
  const dm = chart.dayMaster;
  const dmName = `${dm.hangul}${EL_NAME[dm.element][0]}(${dm.hanja}${EL_NAME[dm.element][2]})`;
  const y = chart.yongsin.yongsin;
  const paragraphs = placed.map((p) => {
    const c = DECK[p.index]!;
    const rel = RELATION_TEXT[relationTo(dm.element, p.element)];
    return `${p.position.label} · ${p.nameKo}${REV(p.orientation)} — ${elementWhy(c)}라 ${elj(p.element, '으로', '로')} 읽어요. ${dmName} 일간인 당신에게는 ${rel}.`;
  });
  const last = placed.at(-1)!;
  const who = placed.length === 1 ? `오늘의 카드 ${cj(last.nameKo, '은', '는')}` : `마지막 ${last.position.label} 자리의 ${cj(last.nameKo, '은', '는')}`;
  if (last.element === y || generates(last.element) === y) {
    paragraphs.push(`${who} 지금 필요한 기운(용신 ${EL_NAME[y]})과 같은 방향이에요. 이 카드의 조언을 조금 더 적극적으로 따라 보기 좋아요.`);
  } else if (controls(last.element) === y) {
    paragraphs.push(`${who} 용신 ${elj(y, '을', '를')} 누르는 쪽의 기운이에요. 서두르기보다 속도를 조금 줄이고 한 번 더 살펴보라는 신호로 읽어요.`);
  } else {
    paragraphs.push(`${who} 용신 ${elj(y, '과', '와')} 부딪히지 않는 기운이라, 카드의 조언을 내 속도에 맞춰 편하게 적용해 보세요.`);
  }
  const hanja = (el: Element) => EL_NAME[el][2];
  const els = [...new Set(placed.map((p) => hanja(p.element)))].join('·');
  return { paragraphs, basis: `근거: 일간 ${dm.hanja}${hanja(dm.element)} · 용신 ${hanja(y)} · 카드 원소 ${els} (달빛사주 방식 연결)` };
}

// ── 총평 ─────────────────────────────────────────────────

function overviewParagraph(placed: TarotPlacedCardDto[], seed: string): string {
  const majors = placed.filter((p) => p.arcana === 'major');
  const reversed = placed.filter((p) => p.orientation === 'reversed').length;
  const parts: string[] = [];
  if (placed.length === 1) {
    const p = placed[0]!;
    parts.push(`${p.nameKo}${REV(p.orientation)} 한 장이 오늘의 메시지예요. ${p.meaning}.`);
  } else if (majors.length === 0) {
    parts.push(pick([`${placed.length}장 모두 일상의 카드(마이너 아르카나)예요. 큰 운명보다는 지금 내가 고르는 선택과 습관이 흐름을 만드는 때로 읽어요.`, `메이저 카드 없이 마이너 카드로만 펼쳐졌어요. 생활 속 작은 결정들이 이 고민의 열쇠라는 뜻으로 읽어요.`], seed));
  } else if (majors.length === 1) {
    parts.push(`${cj(majors[0]!.nameKo, '이', '가')} ${majors[0]!.position.label} 자리에서 중심을 잡고 있어요. 이 자리가 지금 고민에서 가장 무게가 실린 곳이에요.`);
  } else {
    parts.push(`메이저 카드가 ${majors.length}장 나왔어요. 이 고민이 마음속에서 꽤 큰 자리를 차지하고 있다는 뜻으로 읽어요.`);
  }
  if (placed.length > 1) {
    if (reversed === 0) parts.push('모두 정방향이라 기운이 바깥으로 자연스럽게 흐르는 편이에요.');
    else if (reversed * 2 > placed.length) parts.push(`역방향이 ${reversed}장이라 아직 안에서 무르익는 마음이 많아요. 서두르기보다 정리할 시간을 먼저 가져 보세요.`);
    const counts = new Map<Element, number>();
    for (const p of placed) counts.set(p.element, (counts.get(p.element) ?? 0) + 1);
    const [topEl, n] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    if (n >= 2) parts.push(`${EL_NAME[topEl]} 기운의 카드가 ${n}장 겹쳐, ${ELEMENT_THEME[topEl]}에 무게가 실려 있어요.`);
  }
  return parts.join(' ');
}

function headlineOf(placed: TarotPlacedCardDto[]): string {
  const center = placed.find((p) => p.arcana === 'major') ?? placed.at(-1)!;
  return center.meaning;
}

// ── 리딩 조립 ─────────────────────────────────────────────

export interface BuiltReading {
  cards: TarotPlacedCardDto[];
  headline: string;
  sections: ReadingSection[];
  basis: string | null;
}

export function buildTarotReading(input: {
  id: string;
  spread: TarotSpread;
  topic: TarotTopic | null;
  drawn: DrawnCard[];
  chart: SajuChart | null;
  unlocked: boolean;
  aiParagraphs?: string[] | null;
}): BuiltReading {
  const def = TAROT_SPREADS[input.spread];
  const productId = def.productId ?? '';
  const placed: TarotPlacedCardDto[] = input.drawn.map((d, i) => {
    const pos = def.positions[i]!;
    const o: TarotOrientationContent = DECK[d.index]![d.orientation];
    return { ...cardDto(d), position: { key: pos.key, label: pos.label, hint: pos.hint }, line: firstSentence(o[fieldFor(input.topic, pos.key)]) };
  });
  const saju = input.chart ? sajuLines(input.chart, placed) : null;

  // 오늘의 카드 — 전부 무료
  if (input.spread === 'daily') {
    const p = placed[0]!;
    const o = DECK[p.index]![p.orientation];
    const sections: ReadingSection[] = [
      { key: 'today', title: `${p.nameKo}${REV(p.orientation)}`, summary: p.meaning, keywords: p.keywords, paragraphs: [o.general, o.advice] },
    ];
    if (saju) sections.push({ key: 'saju', title: '사주로 본 오늘의 카드', summary: saju.basis, paragraphs: [...saju.paragraphs, ELEMENT_NOTE] });
    return { cards: placed, headline: p.meaning, sections, basis: saju?.basis ?? null };
  }

  const seed = input.id;
  const sections: ReadingSection[] = [{ key: 'overview', title: '총평', summary: headlineOf(placed), paragraphs: [overviewParagraph(placed, seed)] }];

  // 자리별 풀이 — 앞쪽 freeCards 장은 무료
  placed.forEach((p, i) => {
    const c = DECK[p.index]!;
    const o = c[p.orientation];
    const field = fieldFor(input.topic, p.position.key);
    const paragraphs = [o[field]];
    if (field !== 'general') paragraphs.push(o.general);
    if (field !== 'advice') paragraphs.push(`${p.position.label} 자리에서 이 카드는 「${p.position.hint}」${particle(p.position.hint, '을', '를')} 비춰요. ${o.advice}`);
    const section: ReadingSection = { key: `pos-${p.position.key}`, title: `${p.position.label} · ${p.nameKo}${REV(p.orientation)}`, summary: p.line, keywords: p.keywords, paragraphs };
    sections.push(lock(section, !input.unlocked && i >= def.freeCards, productId));
  });

  // 카드끼리 이어지는 이야기 (AI 가 있으면 AI 문단)
  const story =
    input.aiParagraphs && input.aiParagraphs.length > 0
      ? input.aiParagraphs
      : [
          placed
            .map((p, i) => {
              const o = DECK[p.index]![p.orientation];
              const lead = i === 0 ? `${p.position.label}의 ${p.nameKo}에서 시작해요.` : i === placed.length - 1 ? `마지막 ${p.position.label} 자리의 ${cj(p.nameKo, '은', '는')} 이렇게 말해요.` : `이어서 ${p.position.label} 자리에는 ${cj(p.nameKo, '이', '가')} 놓였어요.`;
              return `${lead} ${firstSentence(o[fieldFor(input.topic, p.position.key)])}`;
            })
            .join(' '),
          `${placed.length}장을 한 줄로 이어 보면 「${headlineOf(placed)}」라는 메시지가 남아요. 카드가 보여 주는 것은 정해진 결과가 아니라 지금 기울어 있는 방향이니, 마음에 걸리는 자리부터 하나씩 살펴보세요.`,
        ];
  sections.push(lock({ key: 'story', title: '카드끼리 이어지는 이야기', summary: '자리마다 놓인 카드가 어떻게 이어지는지 읽어요', paragraphs: story }, !input.unlocked, productId));

  // 행동 세 가지 — 뒤쪽(조언·도움) 카드부터
  const actions = [...new Set([...placed].reverse().map((p) => DECK[p.index]![p.orientation].advice))].slice(0, 3);
  sections.push(lock({ key: 'actions', title: '지금 해 볼 수 있는 행동', summary: '카드가 건네는 구체적인 한 걸음', paragraphs: actions }, !input.unlocked, productId));

  if (saju) sections.push(lock({ key: 'saju', title: '사주로 본 근거', summary: saju.basis, paragraphs: [...saju.paragraphs, ELEMENT_NOTE] }, !input.unlocked, productId));

  return { cards: placed, headline: headlineOf(placed), sections, basis: saju?.basis ?? null };
}

export const topicLabel = (t: TarotTopic | null) => (t ? TAROT_TOPICS[t].label : null);
