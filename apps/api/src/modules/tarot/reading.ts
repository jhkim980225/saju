/**
 * 타로 리딩 생성 (규칙 기반) — 카드 문안(content/) + 펼침 자리 + 주제 + (있으면) 사주 원국.
 *
 * 무료/유료 경계 (docs/research/05-tarot-market.md §7.4, 06 §6):
 * - 무료: 카드 공개, 카드별 전통 뜻·한 줄, 총평 첫 문단, 펼침의 앞쪽 freeCards 장 자리 풀이
 * - 유료: 나머지 자리별 풀이, 카드끼리 이어지는 이야기, 행동 세 가지, 사주로 본 근거
 * 잠긴 섹션은 첫 문단 미리보기만 보낸다(lock).
 *
 * 2차 펼침 방식:
 * - 예·아니오: 오늘의 카드처럼 전부 무료. 기울기는 yesno.ts 의 카드·방향별 표
 * - 양자택일: 총평·한 줄·행동을 두 선택지에 같은 무게로 — 어느 한쪽을 정답으로 고르지 않는다(06 §8.4)
 * - 궁합 타로: 나의 자리는 내 일간, 상대 자리는 상대 일간, 둘 사이 자리는 두 사람 모두에 견준다
 * - 켈틱 크로스: 십자(1~6)와 기둥(7~10)으로 나눠 이야기를 잇는다
 *
 * 사주 결합은 "달빛사주 방식" 연결임을 화면에 밝힌다 — 타로의 원소와 오행을 잇는 전통은 없다.
 */
import { calculateCompatibility, controls, generates, type Element, type SajuChart } from '@saju/core';
import { TAROT_SPREADS, TAROT_TOPICS, type ReadingSection, type TarotCardDto, type TarotPlacedCardDto, type TarotSpread, type TarotTopic, type TarotYesNoLean } from '@saju/shared';
import { EL_NAME, josa, lock, pick } from '../interpretation/reading.js';
import { DECK, type TarotCardContent, type TarotOrientation, type TarotOrientationContent } from './content/index.js';
import type { DrawnCard } from './deck.js';
import { YES_NO_LABEL, leanOf } from './yesno.js';

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
const TOPIC_FIELD: Record<TarotTopic, Field> = {
  love: 'love',
  feelings: 'love',
  reunion: 'love',
  career: 'career',
  money: 'money',
  relation: 'general',
  self: 'general',
  yesno: 'general',
  choice: 'general',
  compat: 'love',
  celtic: 'general',
};
/** 상대의 마음을 읽는 자리는 '속마음' 문안, 도움·조언 자리는 '조언' 문안 */
const POSITION_FIELD: Record<string, Field> = { outer: 'feelings', inner: 'feelings', them: 'feelings', help: 'advice', need: 'advice', partner: 'feelings', together: 'advice' };

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

const hanja = (el: Element) => EL_NAME[el][2];
/** 일간 이름 — "경금(庚金)" */
const dmLabel = (chart: SajuChart) => `${chart.dayMaster.hangul}${EL_NAME[chart.dayMaster.element][0]}(${chart.dayMaster.hanja}${hanja(chart.dayMaster.element)})`;
const cardEls = (placed: TarotPlacedCardDto[]) => [...new Set(placed.map((p) => hanja(p.element)))].join('·');

/** 카드 원소와 용신 — 같은 방향(같거나 낳아 줌) · 누름 · 부딪히지 않음 */
const yongsinRel = (el: Element, y: Element): 'align' | 'press' | 'calm' => (el === y || generates(el) === y ? 'align' : controls(el) === y ? 'press' : 'calm');

/** 카드 원소와 용신의 관계 한 문장 */
function yongsinLine(who: string, el: Element, y: Element): string {
  const rel = yongsinRel(el, y);
  if (rel === 'align') return `${who} 지금 필요한 기운(용신 ${EL_NAME[y]})과 같은 방향이에요. 이 카드의 조언을 조금 더 적극적으로 따라 보기 좋아요.`;
  if (rel === 'press') return `${who} 용신 ${elj(y, '을', '를')} 누르는 쪽의 기운이에요. 서두르기보다 속도를 조금 줄이고 한 번 더 살펴보라는 신호로 읽어요.`;
  return `${who} 용신 ${elj(y, '과', '와')} 부딪히지 않는 기운이라, 카드의 조언을 내 속도에 맞춰 편하게 적용해 보세요.`;
}

function sajuLines(chart: SajuChart, placed: TarotPlacedCardDto[], spread: TarotSpread): { paragraphs: string[]; basis: string } {
  const dm = chart.dayMaster;
  const dmName = dmLabel(chart);
  const y = chart.yongsin.yongsin;
  const paragraphs = placed.map((p) => {
    const c = DECK[p.index]!;
    const rel = RELATION_TEXT[relationTo(dm.element, p.element)];
    return `${p.position.label} · ${p.nameKo}${REV(p.orientation)} — ${elementWhy(c)}라 ${elj(p.element, '으로', '로')} 읽어요. ${dmName} 일간인 당신에게는 ${rel}.`;
  });
  // 용신과 견주는 카드 — 보통 마지막 자리, 양자택일은 어느 선택지도 편들지 않도록 '지금의 나' 자리
  const anchor = spread === 'choice' ? placed[0]! : placed.at(-1)!;
  const name = cj(anchor.nameKo, '은', '는');
  const who =
    spread === 'daily' ? `오늘의 카드 ${name}` : placed.length === 1 ? `이번에 뽑은 ${name}` : anchor === placed.at(-1) ? `마지막 ${anchor.position.label} 자리의 ${name}` : `${anchor.position.label} 자리의 ${name}`;
  paragraphs.push(yongsinLine(who, anchor.element, y));
  if (spread === 'choice') paragraphs.push('두 선택지 카드의 기운은 어느 쪽이 맞다는 뜻이 아니에요. 그 길을 갈 때 내가 어떻게 느끼기 쉬운지를 보여 주는 참고로 읽어 주세요.');
  return { paragraphs, basis: `근거: 일간 ${dm.hanja}${hanja(dm.element)} · 용신 ${hanja(y)} · 카드 원소 ${cardEls(placed)} (달빛사주 방식 연결)` };
}

/** 두 사람에게 같은 카드가 어떻게 닿는지 — 짧은 표현 */
const RELATION_SHORT: Record<Relation, string> = {
  same: '같은 결의 기운',
  support: '받쳐 주는 기운',
  express: '표현하게 만드는 기운',
  manage: '다뤄서 결과로 만드는 기운',
  test: '다듬고 시험하는 기운',
};

export interface TarotPerson {
  name: string;
  chart: SajuChart;
}

/** 궁합 타로 — 나의 자리는 내 일간, 상대 자리는 상대 일간, 둘 사이 자리는 두 사람 모두에 견준다 */
function compatSajuLines(me: TarotPerson, partner: TarotPerson, placed: TarotPlacedCardDto[]): { paragraphs: string[]; basis: string } {
  const [a, b] = [me.chart, partner.chart];
  const paragraphs = placed.map((p) => {
    const head = `${p.position.label} · ${p.nameKo}${REV(p.orientation)} — ${elementWhy(DECK[p.index]!)}라 ${elj(p.element, '으로', '로')} 읽어요.`;
    if (p.position.key === 'me') return `${head} ${dmLabel(a)} 일간인 ${me.name}님에게는 ${RELATION_TEXT[relationTo(a.dayMaster.element, p.element)]}.`;
    if (p.position.key === 'partner') return `${head} ${dmLabel(b)} 일간인 ${partner.name}님에게는 ${RELATION_SHORT[relationTo(b.dayMaster.element, p.element)]}이에요.`;
    return `${head} ${me.name}님에게는 ${RELATION_SHORT[relationTo(a.dayMaster.element, p.element)]}, ${partner.name}님에게는 ${RELATION_SHORT[relationTo(b.dayMaster.element, p.element)]}이에요.`;
  });
  // 두 일간의 관계 — 궁합 계산과 같은 근거 문장을 쓴다
  const stem = calculateCompatibility(a, b).factors.find((f) => f.key.startsWith('stem_'));
  paragraphs.push(`두 사람의 일간을 견주면 ${me.name}님은 ${dmLabel(a)}, ${partner.name}님은 ${dmLabel(b)} 일간이에요.${stem ? ` ${stem.label}` : ''}`);
  // 마지막 카드와 두 사람의 용신
  const last = placed.at(-1)!;
  const [ra, rb] = [yongsinRel(last.element, a.yongsin.yongsin), yongsinRel(last.element, b.yongsin.yongsin)];
  const relA = { align: elj(a.yongsin.yongsin, '과', '와') + ' 같은 방향이고', press: elj(a.yongsin.yongsin, '을', '를') + ' 누르는 쪽이고', calm: elj(a.yongsin.yongsin, '과', '와') + ' 부딪히지 않고' }[ra];
  const relB = { align: elj(b.yongsin.yongsin, '과', '와') + ' 같은 방향이에요', press: elj(b.yongsin.yongsin, '을', '를') + ' 누르는 쪽이에요', calm: elj(b.yongsin.yongsin, '과', '와') + ' 부딪히지 않아요' }[rb];
  const closing =
    ra === 'align' && rb === 'align'
      ? '두 사람 모두 이 카드의 조언을 조금 더 적극적으로 함께 해 보기 좋아요.'
      : ra === 'press' || rb === 'press'
        ? '한 사람에게는 속도를 늦추라는 신호이니, 서로의 속도를 맞춰 가며 조언을 적용해 보세요.'
        : '두 사람의 속도에 맞춰 카드의 조언을 편하게 함께 해 보세요.';
  paragraphs.push(`마지막 ${last.position.label} 자리의 ${cj(last.nameKo, '은', '는')} ${me.name}님의 용신 ${relA}, ${partner.name}님의 용신 ${relB}. ${closing}`);
  const basis = `근거: ${me.name} 일간 ${a.dayMaster.hanja}${hanja(a.dayMaster.element)}·용신 ${hanja(a.yongsin.yongsin)} · ${partner.name} 일간 ${b.dayMaster.hanja}${hanja(b.dayMaster.element)}·용신 ${hanja(b.yongsin.yongsin)} · 카드 원소 ${cardEls(placed)} (달빛사주 방식 연결)`;
  return { paragraphs, basis };
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

/** 양자택일 총평 — 두 선택지를 같은 무게로 나란히 놓고, 어느 쪽도 정답으로 고르지 않는다 */
function choiceOverview(placed: TarotPlacedCardDto[], options: { a: string; b: string }): string {
  const [now, a, b] = placed as [TarotPlacedCardDto, TarotPlacedCardDto, TarotPlacedCardDto];
  return [
    `${now.position.label} 자리에는 ${cj(now.nameKo, '이', '가')} 놓였어요. ${now.line}`,
    `A(${options.a}) 쪽에는 ${a.nameKo}${REV(a.orientation)}, B(${options.b}) 쪽에는 ${b.nameKo}${REV(b.orientation)} 카드가 나왔어요.`,
    '어느 쪽이 정답이라기보다, 두 길에서 각각 무엇을 기대하고 무엇을 챙기면 좋을지 보여 주는 카드로 읽어요.',
  ].join(' ');
}

function headlineOf(placed: TarotPlacedCardDto[], spread?: TarotSpread): string {
  // 양자택일은 선택지 카드가 한 줄을 차지하지 않도록 '지금의 나' 카드로
  if (spread === 'choice') return placed[0]!.meaning;
  const center = placed.find((p) => p.arcana === 'major') ?? placed.at(-1)!;
  return center.meaning;
}

/** 규칙 기반 '카드끼리 이어지는 이야기' — 펼침 방식마다 읽는 순서가 다르다 */
function ruleStory(spread: TarotSpread, placed: TarotPlacedCardDto[], topic: TarotTopic | null, options: { a: string; b: string } | null): string[] {
  const line = (p: TarotPlacedCardDto) => firstSentence(DECK[p.index]![p.orientation][fieldFor(topic, p.position.key)]);
  if (spread === 'choice' && options) {
    const [now, a, b] = placed as [TarotPlacedCardDto, TarotPlacedCardDto, TarotPlacedCardDto];
    return [
      `${now.position.label} 자리의 ${cj(now.nameKo, '은', '는')} 지금 고민하는 마음을 비춰요. ${line(now)}`,
      `A(${options.a})를 고르면 ${cj(a.nameKo, '이', '가')} 이렇게 말해요. ${line(a)} B(${options.b})를 고르면 ${cj(b.nameKo, '이', '가')} 이렇게 말해요. ${line(b)}`,
      '두 카드는 어느 길이 맞다고 정해 주지 않아요. 각 길에서 기대할 수 있는 것과 챙겨야 할 것을 나란히 놓고, 지금의 나에게 더 중요한 기준이 무엇인지 먼저 정해 보세요.',
    ];
  }
  if (spread === 'celtic' && placed.length === 10) {
    // 십자(1~6): 중심·가로막는 것 → 바탕·지나가는 것·다가오는 것 / 기둥(7~10): 바라는 것·태도·주변·바람과 걱정 → 흐름의 방향
    const at = (key: string) => placed.find((p) => p.position.key === key)!;
    const [present, cross, near, outcome] = [at('present'), at('cross'), at('near'), at('outcome')];
    return [
      `${present.position.label} 자리의 ${cj(present.nameKo, '이', '가')} 고민의 중심이고, 그 위를 ${cj(cross.nameKo, '이', '가')} 가로지르고 있어요. ${line(present)} ${line(cross)}`,
      `바탕에는 ${at('root').nameKo}, 지나가는 자리에는 ${at('past').nameKo}, 다가오는 자리에는 ${cj(near.nameKo, '이', '가')} 놓였어요. 뿌리에서 가까운 앞날로 이어지는 흐름이에요. ${line(near)}`,
      `바라는 것은 ${at('goal').nameKo}, 나의 태도는 ${at('attitude').nameKo}, 주변은 ${at('surroundings').nameKo}, 바람과 걱정은 ${at('hopes').nameKo} 카드로 읽혀요. ${line(at('attitude'))}`,
      `${outcome.position.label} 자리의 ${cj(outcome.nameKo, '은', '는')} 이렇게 말해요. ${line(outcome)} 정해진 결과가 아니라 지금 그대로 갈 때 이어지기 쉬운 방향이니, 나의 태도와 주변 자리에서 바꿀 수 있는 것부터 살펴보세요.`,
    ];
  }
  return [
    placed
      .map((p, i) => {
        const lead = i === 0 ? `${p.position.label}의 ${p.nameKo}에서 시작해요.` : i === placed.length - 1 ? `마지막 ${p.position.label} 자리의 ${cj(p.nameKo, '은', '는')} 이렇게 말해요.` : `이어서 ${p.position.label} 자리에는 ${cj(p.nameKo, '이', '가')} 놓였어요.`;
        return `${lead} ${line(p)}`;
      })
      .join(' '),
    `${placed.length}장을 한 줄로 이어 보면 「${headlineOf(placed, spread)}」라는 메시지가 남아요. 카드가 보여 주는 것은 정해진 결과가 아니라 지금 기울어 있는 방향이니, 마음에 걸리는 자리부터 하나씩 살펴보세요.`,
  ];
}

// ── 리딩 조립 ─────────────────────────────────────────────

export interface BuiltReading {
  cards: TarotPlacedCardDto[];
  headline: string;
  sections: ReadingSection[];
  basis: string | null;
  /** 예·아니오 기울기 (다른 펼침 방식은 null) */
  lean: TarotYesNoLean | null;
}

export function buildTarotReading(input: {
  id: string;
  spread: TarotSpread;
  topic: TarotTopic | null;
  drawn: DrawnCard[];
  chart: SajuChart | null;
  unlocked: boolean;
  aiParagraphs?: string[] | null;
  /** 양자택일 선택지 */
  options?: { a: string; b: string } | null;
  /** 궁합 타로 — 나와 상대 (둘 다 있을 때만 두 사람 근거) */
  people?: { me: TarotPerson; partner: TarotPerson } | null;
}): BuiltReading {
  const def = TAROT_SPREADS[input.spread];
  const productId = def.productId ?? '';
  const options = input.spread === 'choice' ? (input.options ?? null) : null;
  const placed: TarotPlacedCardDto[] = input.drawn.map((d, i) => {
    const pos = def.positions[i]!;
    const o: TarotOrientationContent = DECK[d.index]![d.orientation];
    // 양자택일 — 자리 힌트에 사용자가 적은 선택지를 넣는다
    const hint = options && pos.key === 'optionA' ? `${options.a} 쪽의 흐름` : options && pos.key === 'optionB' ? `${options.b} 쪽의 흐름` : pos.hint;
    return { ...cardDto(d), position: { key: pos.key, label: pos.label, hint }, line: firstSentence(o[fieldFor(input.topic, pos.key)]) };
  });
  const saju =
    input.spread === 'compat' && input.people ? compatSajuLines(input.people.me, input.people.partner, placed) : input.chart ? sajuLines(input.chart, placed, input.spread) : null;

  // 예·아니오 — 전부 무료. 기울기는 카드·방향별 표(yesno.ts)로
  if (input.spread === 'yesno') {
    const p = placed[0]!;
    const o = DECK[p.index]![p.orientation];
    const lean = leanOf(input.drawn[0]!);
    const who = `${p.orientation === 'reversed' ? '역방향으로 나온 ' : ''}${cj(p.nameKo, '은', '는')} 「${p.keywords[0]}」의 카드라`;
    const leanText: Record<TarotYesNoLean, string> = {
      yes: `${who}, 이 질문에서는 '예' 쪽으로 기울어 있어요. 정해진 답이라기보다 지금 흐름이 그쪽으로 열려 있다는 뜻이에요.`,
      maybe: `${who}, 지금은 어느 한쪽으로 정해지지 않은 조건부 흐름이에요. 아래 조건을 챙길수록 바라는 쪽으로 열리기 쉬워요.`,
      no: `${who}, 지금은 '아니오' 쪽으로 기울어 있어요. 안 된다는 뜻이라기보다, 서두르기 전에 한 번 더 살펴보라는 신호로 읽어요.`,
    };
    const sections: ReadingSection[] = [
      { key: 'lean', title: '카드의 기울기', summary: YES_NO_LABEL[lean], keywords: p.keywords, paragraphs: [leanText[lean], `${lean === 'maybe' ? '조건' : '지금 해 볼 수 있는 한 가지'} — ${o.advice}`] },
      { key: 'card', title: `${p.nameKo}${REV(p.orientation)}`, summary: p.meaning, keywords: p.keywords, paragraphs: [o.general] },
    ];
    if (saju) sections.push({ key: 'saju', title: '사주로 본 이 카드', summary: saju.basis, paragraphs: [...saju.paragraphs, ELEMENT_NOTE] });
    return { cards: placed, headline: p.meaning, sections, basis: saju?.basis ?? null, lean };
  }

  // 오늘의 카드 — 전부 무료
  if (input.spread === 'daily') {
    const p = placed[0]!;
    const o = DECK[p.index]![p.orientation];
    const sections: ReadingSection[] = [
      { key: 'today', title: `${p.nameKo}${REV(p.orientation)}`, summary: p.meaning, keywords: p.keywords, paragraphs: [o.general, o.advice] },
    ];
    if (saju) sections.push({ key: 'saju', title: '사주로 본 오늘의 카드', summary: saju.basis, paragraphs: [...saju.paragraphs, ELEMENT_NOTE] });
    return { cards: placed, headline: p.meaning, sections, basis: saju?.basis ?? null, lean: null };
  }

  const seed = input.id;
  const headline = headlineOf(placed, input.spread);
  const overview =
    options && placed.length === 3
      ? choiceOverview(placed, options)
      : input.spread === 'compat' && input.people
        ? `${input.people.me.name}님과 ${input.people.partner.name}님 사이를 다섯 장으로 펼쳤어요. ${overviewParagraph(placed, seed)}`
        : overviewParagraph(placed, seed);
  const sections: ReadingSection[] = [{ key: 'overview', title: '총평', summary: headline, paragraphs: [overview] }];

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
  const story = input.aiParagraphs && input.aiParagraphs.length > 0 ? input.aiParagraphs : ruleStory(input.spread, placed, input.topic, options);
  sections.push(lock({ key: 'story', title: '카드끼리 이어지는 이야기', summary: '자리마다 놓인 카드가 어떻게 이어지는지 읽어요', paragraphs: story }, !input.unlocked, productId));

  // 행동 세 가지 — 뒤쪽(조언·도움) 카드부터. 양자택일은 지금의 나 + 두 선택지에서 하나씩, 같은 무게로
  const advice = (p: TarotPlacedCardDto) => DECK[p.index]![p.orientation].advice;
  const actions =
    options && placed.length === 3
      ? [advice(placed[0]!), `A를 고른다면 — ${advice(placed[1]!)}`, `B를 고른다면 — ${advice(placed[2]!)}`]
      : [...new Set([...placed].reverse().map(advice))].slice(0, 3);
  sections.push(lock({ key: 'actions', title: '지금 해 볼 수 있는 행동', summary: '카드가 건네는 구체적인 한 걸음', paragraphs: actions }, !input.unlocked, productId));

  if (saju) sections.push(lock({ key: 'saju', title: '사주로 본 근거', summary: saju.basis, paragraphs: [...saju.paragraphs, ELEMENT_NOTE] }, !input.unlocked, productId));

  return { cards: placed, headline, sections, basis: saju?.basis ?? null, lean: null };
}

export const topicLabel = (t: TarotTopic | null) => (t ? TAROT_TOPICS[t].label : null);
