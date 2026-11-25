import type { PillarDetail, SajuChart } from '@saju/core';
import type { ReadingDto } from '@saju/shared';
import { ELEMENT_META, ELEMENT_ORDER, POSITION_LABEL, dotDate } from './format';

/**
 * '사주 요약' — 결과 화면의 계산값과 항목별 한 줄 요약을 한 장으로 모은다.
 * 화면(SummaryPage)과 '텍스트 복사'가 같은 데이터를 쓴다.
 */

export interface SummaryRow {
  label: string;
  text: string;
}

export interface SummaryDaeun {
  startAge: number;
  startYear: number;
  hanja: string;
  hangul: string;
  stemTenGod: string;
  branchTenGod: string;
  current: boolean;
}

export interface SajuSummary {
  name: string;
  /** 생년월일·성별·띠·일주 */
  profile: SummaryRow[];
  /** 시·일·월·년 순서. 시간을 모르면 시주는 null */
  pillars: { label: string; pillar: PillarDetail | null }[];
  /** 오행·강약·용신·십성·신살·합충·공망 */
  analysis: SummaryRow[];
  daeun: { headline: string; periods: SummaryDaeun[] };
  /** 재물·연애·직업·건강·대운·올해 — 풀이 화면의 한 줄 요약(성격은 '한눈에 보는 나'에 있다) */
  topics: SummaryRow[];
  /** 한눈에 보는 나(행운 포인트 포함) */
  keyPoints: SummaryRow[];
}

const POS_ORDER = ['hour', 'day', 'month', 'year'] as const;

/** 풀이 화면의 섹션 key → 요약에 쓸 이름. 순서도 이 표를 따른다 */
const TOPIC_LABEL: [key: string | RegExp, label: string][] = [
  ['wealth', '재물운'],
  ['love', '연애·결혼운'],
  ['career', '일과 적성'],
  ['health', '건강'],
  ['tenGods', '나를 움직이는 힘'],
  ['shinsal', '신살'],
  ['daeun', '10년 흐름(대운)'],
  [/^year\d{4}$/, ''],
];

const elName = (e: keyof typeof ELEMENT_META) => `${ELEMENT_META[e].name}(${ELEMENT_META[e].hanja})`;
const genderKo = (g: string) => (g === 'female' ? '여성' : '남성');
const pad = (n: number) => String(n).padStart(2, '0');

export function buildSajuSummary(reading: ReadingDto, name: string, now = new Date()): SajuSummary {
  const c: SajuChart = reading.chart;
  const input = c.input;
  const birth = `${input.calendar === 'lunar' ? `음력${input.isLeapMonth ? '(윤달)' : ''}` : '양력'} ${dotDate(input.year, input.month, input.day)}`;
  const time = c.hourKnown ? `${pad(input.hour!)}:${pad(input.minute ?? 0)}` : '태어난 시간 모름';
  const solar = input.calendar === 'lunar' ? ` (양력 ${dotDate(c.solarDate.year, c.solarDate.month, c.solarDate.day)})` : '';
  const corrected = c.hourKnown && c.correctedTime && c.correctionMinutes !== 0 ? ` · 계산에 쓴 시각 ${pad(c.correctedTime.hour)}:${pad(c.correctedTime.minute)}` : '';

  const profile: SummaryRow[] = [
    { label: '생년월일시', text: `${birth}${solar} ${time}${corrected}` },
    { label: '성별·띠', text: `${genderKo(input.gender)} · ${c.zodiac.animal}띠` },
    { label: '일주', text: `${c.pillars.day.ganzhi.hangul}(${c.pillars.day.ganzhi.hanja})일주 · ${reading.dayPillarTitle}` },
  ];

  const pillars = POS_ORDER.map((p) => ({ label: `${POSITION_LABEL[p]}주`, pillar: c.pillars[p] }));

  // 십성은 많은 순으로 세 개까지
  const tenGods = Object.entries(c.tenGodCount)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
  const s = c.strength;
  const parts = [s.deukryeong && '득령', s.deukji && '득지', s.deukse && '득세'].filter(Boolean).join('·');
  const analysis: SummaryRow[] = [
    { label: '일간', text: `${c.dayMaster.hangul}${ELEMENT_META[c.dayMaster.element].name}(${c.dayMaster.hanja}) · ${c.dayMaster.yinYang === 'yang' ? '양' : '음'}의 ${ELEMENT_META[c.dayMaster.element].name}` },
    { label: '오행 글자 수', text: ELEMENT_ORDER.map((e) => `${ELEMENT_META[e].name} ${c.elements.count[e]}`).join(' · ') },
    { label: '일간의 강약', text: `${s.level}(${s.score}점, 달달사주 기준)${parts ? ` · ${parts}` : ''}` },
    { label: '용신', text: `${elName(c.yongsin.yongsin)} · 희신 ${elName(c.yongsin.heesin)} · 기신 ${elName(c.yongsin.gisin)}` },
    { label: '많은 십성', text: tenGods || '없음' },
    { label: '신살', text: c.shinsal.length ? c.shinsal.map((x) => `${x.name}(${x.positions.map((p) => POSITION_LABEL[p]).join('·')})`).join(', ') : '없음' },
    { label: '합·충', text: c.relations.length ? c.relations.map((r) => r.label).join(', ') : '없음' },
    { label: '공망', text: c.gongmang.join('') },
  ];

  const kstYear = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
  const age = kstYear - c.solarDate.year;
  const periods: SummaryDaeun[] = c.daeun.periods.map((p) => ({
    startAge: p.startAge,
    startYear: p.startYear,
    hanja: p.ganzhi.hanja,
    hangul: p.ganzhi.hangul,
    stemTenGod: p.stemTenGod,
    branchTenGod: p.branchTenGod,
    current: age >= p.startAge && age <= p.endAge,
  }));
  const daeun = {
    headline: `대운수 ${c.daeun.startAge} · ${c.daeun.direction === 'forward' ? '순행' : '역행'} (만 ${c.daeun.startAge}세부터 10년마다 바뀜)`,
    periods,
  };

  const topics: SummaryRow[] = [];
  for (const [key, label] of TOPIC_LABEL) {
    const sec = reading.sections.find((x) => (typeof key === 'string' ? x.key === key : key.test(x.key)));
    if (!sec?.summary) continue;
    topics.push({ label: label || sec.title, text: sec.summary });
  }

  return { name, profile, pillars, analysis, daeun, topics, keyPoints: reading.keyPoints ?? [] };
}

/** 메모장이나 다른 AI 대화창에 붙여 넣기 좋은 글 */
export function summaryToText(s: SajuSummary): string {
  const lines: string[] = [`[${s.name} 사주 요약 · 달달사주]`, ''];
  for (const r of s.profile) lines.push(`${r.label}: ${r.text}`);

  lines.push('', '■ 사주 원국 (시주 · 일주 · 월주 · 년주)');
  const cell = (f: (p: PillarDetail) => string) => s.pillars.map(({ pillar }) => (pillar ? f(pillar) : '모름')).join(' | ');
  lines.push(`천간: ${cell((p) => `${p.stem.hanja}(${p.stem.hangul}${ELEMENT_META[p.stem.element].name})`)}`);
  lines.push(`지지: ${cell((p) => `${p.branch.hanja}(${p.branch.hangul}${ELEMENT_META[p.branch.element].name})`)}`);
  lines.push(`천간 십성: ${cell((p) => p.stem.tenGod)}`);
  lines.push(`지지 십성: ${cell((p) => p.branch.tenGod)}`);
  lines.push(`지장간: ${cell((p) => p.branch.hiddenStems.map((h) => h.hanja).join(''))}`);
  lines.push(`12운성: ${cell((p) => p.branch.twelveStage)}`);
  lines.push(`납음: ${cell((p) => p.napeum.name)}`);

  lines.push('', '■ 분석');
  for (const r of s.analysis) lines.push(`${r.label}: ${r.text}`);

  lines.push('', `■ 대운: ${s.daeun.headline}`);
  lines.push(s.daeun.periods.map((p) => `${p.startAge}세 ${p.hanja}${p.current ? '(지금)' : ''}`).join(' · '));

  if (s.keyPoints.length) {
    lines.push('', '■ 한눈에 보는 나');
    for (const r of s.keyPoints) lines.push(`${r.label}: ${r.text}`);
  }
  if (s.topics.length) {
    lines.push('', '■ 분야별 한 줄 요약');
    for (const r of s.topics) lines.push(`${r.label}: ${r.text}`);
  }
  lines.push('', '※ 강약 점수와 용신은 달달사주의 억부 중심 간이 계산이에요.');
  return lines.join('\n');
}
