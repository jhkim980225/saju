/**
 * AI 사주 상담 — 질문권 1회 차감. AI 미설정 시 규칙 기반 답변(차감 없음)으로 대체한다.
 * AI 가 답하지 못하면 규칙 기반 답변을 주고, 질문권은 서비스 쪽 장애(unavailable)일 때만 돌려준다(하루 상한 안에서).
 * 거절(refused)은 질문 내용 탓이라 차감한 채로 둔다 — 거절을 유도하는 질문으로 AI 를 공짜로 되풀이해 부르지 못하게.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Element, SajuChart } from '@saju/core';
import type { ChatMessageDto, ChatReplyDto } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { chatMessages } from '../../db/schema.js';
import { newId } from '../../lib/ids.js';
import { isAiFailure, type AiService } from '../ai/service.js';
import type { CommerceService } from '../commerce/service.js';
import { EL_NAME, buildBasicReading, dayMasterContent, dayPillarContent, type ReadingAccess } from '../interpretation/reading.js';
import type { ProfileService } from '../profiles/service.js';

/** AI 컨텍스트용 사주 요약 (근거 데이터) */
export function chartSummary(chart: SajuChart): string {
  const p = chart.pillars;
  const pillars = [p.year, p.month, p.day, p.hour].map((x) => (x ? `${x.ganzhi.hanja}(${x.stem.tenGod}/${x.branch.tenGod})` : '시주 모름'));
  const now = new Date().getFullYear();
  const daeun = chart.daeun.periods.find((d) => now >= d.startYear && now <= d.endYear);
  return [
    `성별: ${chart.input.gender === 'male' ? '남' : '여'}, 양력 생일: ${chart.solarDate.year}-${chart.solarDate.month}-${chart.solarDate.day}`,
    `사주(년/월/일/시): ${pillars.join(' ')}`,
    `일간: ${chart.dayMaster.hanja}(${EL_NAME[chart.dayMaster.element]}) — ${dayMasterContent(chart).title}`,
    `일주: ${p.day.ganzhi.hanja} — ${dayPillarContent(chart).title}`,
    `오행 개수: 목${chart.elements.count.wood} 화${chart.elements.count.fire} 토${chart.elements.count.earth} 금${chart.elements.count.metal} 수${chart.elements.count.water}`,
    `신강약: ${chart.strength.level}(${chart.strength.score}), 용신: ${EL_NAME[chart.yongsin.yongsin]}, 희신: ${EL_NAME[chart.yongsin.heesin]}`,
    `신살: ${chart.shinsal.map((s) => s.name).join(', ') || '없음'}`,
    `대운: 만 ${chart.daeun.startAge}세 시작, 현재 대운 ${daeun ? `${daeun.ganzhi.hanja}(${daeun.startYear}~${daeun.endYear}, ${daeun.stemTenGod})` : '미시작'}`,
    `오늘 날짜: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

const TOPICS: { keys: string[]; section: string }[] = [
  { keys: ['돈', '재물', '재테크', '투자', '월급', '부자', '수입'], section: 'wealth' },
  { keys: ['연애', '사랑', '결혼', '애인', '남친', '여친', '인연', '배우자', '썸'], section: 'love' },
  { keys: ['직장', '이직', '취업', '직업', '사업', '진로', '커리어', '승진', '회사'], section: 'career' },
  { keys: ['건강', '몸', '병', '아프'], section: 'health' },
  { keys: ['대운', '10년', '인생', '흐름'], section: 'daeun' },
  { keys: ['성격', '나는', '장점', '단점', '기질'], section: 'personality' },
];

/** 규칙 기반 답변의 마지막 한 가지 — 용신(사주의 균형을 맞추는 데 가장 필요하다고 보는 오행)을 생활 속 행동으로 */
const TODAY_ACTION: Record<Element, string> = {
  wood: '새로운 것을 하나 배우거나, 미뤄 둔 일을 작게라도 시작해 보세요.',
  fire: '고마운 사람에게 고맙다는 말을 한마디 전하세요.',
  earth: '정해진 시간에 자고 먹는 생활 리듬부터 지키세요.',
  metal: '할 일 목록에서 덜 중요한 일 하나를 과감히 지우세요.',
  water: '잠시 멈춰 생각을 글로 정리해 두세요.',
};
/** 채팅에는 없는 화면 위치('아래 …에서')를 가리키는 문장 — 풀이 섹션을 옮겨 쓸 때 뺀다 */
const POINTS_ELSEWHERE = /아래 ['「‘]|아래에서|위에서 본/;
const dropPointers = (p: string) =>
  p
    .split(/(?<=[.!?])\s+/)
    .filter((x) => !POINTS_ELSEWHERE.test(x))
    .join(' ');

/**
 * 규칙 기반 답변 — 사용자의 열람 권한(access) 안에서 공개된 섹션만 사용한다(유료 본문 우회 노출 방지).
 * 말투는 docs/PLAIN_KOREAN.md — 결론 먼저, 이름으로 부르고, 용어는 풀이 섹션의 표현(처음 나올 때 뜻을 붙인)을 그대로 쓴다.
 */
export function ruleBasedAnswer(chart: SajuChart, message: string, access: ReadingAccess, name: string | null): string {
  const reading = buildBasicReading(chart, { access, name });
  const topic = TOPICS.find((t) => t.keys.some((k) => message.includes(k)))?.section ?? 'overview';
  const wanted = reading.sections.find((s) => s.key === topic);
  const sec = wanted && !wanted.locked ? wanted : (reading.sections.find((s) => s.key === 'personality' && !s.locked) ?? reading.sections[0]!);
  const lockedNote = wanted?.locked ? `${wanted.title} 풀이는 전체 풀이를 열면 볼 수 있어요. 여기서는 공개된 타고난 성격 풀이를 바탕으로 답변드릴게요.` : null;
  const lead = sec.summary.trim() ? `${sec.summary.trim().replace(/[.!?]$/, '')}.` : null;
  return [
    ...(lockedNote ? [lockedNote] : []),
    ...(lead ? [lead] : []),
    ...sec.paragraphs.slice(0, 2).map(dropPointers).filter(Boolean),
    `오늘 실천할 한 가지를 고른다면, ${TODAY_ACTION[chart.yongsin.yongsin]}`,
  ].join('\n\n');
}

export function createChatService(config: AppConfig, db: Db, profiles: ProfileService, commerce: CommerceService, ai: AiService, access: (userId: string, profileId: string) => Promise<ReadingAccess>) {
  const toDto = (m: typeof chatMessages.$inferSelect): ChatMessageDto => ({ id: m.id, role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content, createdAt: new Date(m.createdAt).toISOString() });

  return {
    async history(userId: string, profileId: string): Promise<ChatMessageDto[]> {
      await profiles.getOwned(userId, profileId);
      return (await db.select().from(chatMessages).where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, profileId))).orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))).map(toDto);
    },

    async send(userId: string, input: { profileId: string; message: string }): Promise<ChatReplyDto> {
      const profile = await profiles.getOwned(userId, input.profileId);
      const chart = profiles.chartOf(profile);
      const cost = config.AI_CHAT_CREDIT_COST;
      const userMsgId = newId();
      // AI 호출 전에 질문권을 먼저 차감(동시 요청으로 AI 비용을 부풀리는 것 방지) — 서비스 쪽 장애로 실패하면 무상으로 돌려준다
      const charged = ai.enabled && cost > 0;
      if (charged) await commerce.consumeCredits(userId, cost, 'AI 사주 상담', userMsgId);
      const history = (
        await db
          .select()
          .from(chatMessages)
          .where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, profile.id)))
          .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      ).map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));

      const now = Date.now();
      await db.insert(chatMessages).values({ id: userMsgId, userId, profileId: profile.id, role: 'user', content: input.message, createdAt: now });

      const result = ai.enabled ? await ai.chat({ chart, profileName: profile.name, chartSummary: chartSummary(chart), history, message: input.message }) : null;
      const aiReply = result && !isAiFailure(result) ? result : null;
      const text = aiReply?.text ?? ruleBasedAnswer(chart, input.message, await access(userId, profile.id), profile.name);
      const generator = aiReply ? 'ai' : 'rule';
      if (charged && isAiFailure(result) && result.failed === 'unavailable') await commerce.refundAiFailure(userId, cost, 'AI 상담 실패 환급', userMsgId);
      const creditsLeft = (await commerce.wallet(userId)).credits;

      const replyId = newId();
      const [reply] = await db.insert(chatMessages).values({ id: replyId, userId, profileId: profile.id, role: 'assistant', content: text, createdAt: now + 1 }).returning();
      return { reply: toDto(reply!), creditsLeft, generator };
    },

    async clear(userId: string, profileId: string) {
      await profiles.getOwned(userId, profileId);
      await db.delete(chatMessages).where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, profileId)));
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
