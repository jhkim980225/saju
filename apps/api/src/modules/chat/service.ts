/**
 * AI 사주 상담 — 질문권 1회 차감. AI 미설정 시 규칙 기반 답변(차감 없음)으로 대체한다.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Element, SajuChart } from '@saju/core';
import type { ChatMessageDto, ChatReplyDto } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { chatMessages } from '../../db/schema.js';
import { newId } from '../../lib/ids.js';
import type { AiService } from '../ai/service.js';
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

/** 규칙 기반 답변의 마지막 한 가지 — 가장 필요한 기운(용신)을 생활 속 행동으로 */
const TODAY_ACTION: Record<Element, string> = {
  wood: '새로운 걸 하나 배워 보거나, 미뤄 둔 일을 작게라도 시작해 보세요.',
  fire: '고마운 사람에게 마음을 한마디 표현해 보세요.',
  earth: '정해진 시간에 자고 먹는 것부터 지켜 보세요.',
  metal: '할 일 목록에서 하나를 과감히 지워 보세요.',
  water: '잠깐 멈춰서 생각을 글로 정리하는 시간을 가져 보세요.',
};

/**
 * 규칙 기반 답변 — 사용자의 열람 권한(access) 안에서 공개된 섹션만 사용한다(유료 본문 우회 노출 방지).
 * 말투는 docs/PLAIN_KOREAN.md — 결론 먼저, 이름으로 부르고, 용어 없이.
 */
export function ruleBasedAnswer(chart: SajuChart, message: string, access: ReadingAccess, name: string | null): string {
  const reading = buildBasicReading(chart, { access, name });
  const topic = TOPICS.find((t) => t.keys.some((k) => message.includes(k)))?.section ?? 'overview';
  const wanted = reading.sections.find((s) => s.key === topic);
  const sec = wanted && !wanted.locked ? wanted : (reading.sections.find((s) => s.key === 'personality' && !s.locked) ?? reading.sections[0]!);
  const lockedNote = wanted?.locked ? `${wanted.title} 이야기는 전체 풀이를 열면 볼 수 있어요. 대신 타고난 성격으로 먼저 이야기해 볼게요.` : null;
  const lead = sec.summary.trim() ? `${sec.summary.trim().replace(/[.!?]$/, '')}.` : null;
  return [
    ...(lockedNote ? [lockedNote] : []),
    ...(lead ? [lead] : []),
    ...sec.paragraphs.slice(0, 2),
    `오늘 하나만 해 본다면, ${TODAY_ACTION[chart.yongsin.yongsin]}`,
  ].join('\n\n');
}

export function createChatService(config: AppConfig, db: Db, profiles: ProfileService, commerce: CommerceService, ai: AiService, access: (userId: string, profileId: string) => ReadingAccess) {
  const toDto = (m: typeof chatMessages.$inferSelect): ChatMessageDto => ({ id: m.id, role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content, createdAt: new Date(m.createdAt).toISOString() });

  return {
    history(userId: string, profileId: string): ChatMessageDto[] {
      profiles.getOwned(userId, profileId);
      return db.select().from(chatMessages).where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, profileId))).orderBy(asc(chatMessages.createdAt)).all().map(toDto);
    },

    async send(userId: string, input: { profileId: string; message: string }): Promise<ChatReplyDto> {
      const profile = profiles.getOwned(userId, input.profileId);
      const chart = profiles.chartOf(profile);
      const cost = config.AI_CHAT_CREDIT_COST;
      const userMsgId = newId();
      // AI 호출 전에 질문권을 먼저 차감(동시 요청으로 AI 비용을 부풀리는 것 방지) — 실패하면 무상으로 돌려준다
      if (ai.enabled && cost > 0) commerce.consumeCredits(userId, cost, 'AI 사주 상담', userMsgId);
      const history = db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, profile.id)))
        .orderBy(asc(chatMessages.createdAt))
        .all()
        .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));

      const now = Date.now();
      db.insert(chatMessages).values({ id: userMsgId, userId, profileId: profile.id, role: 'user', content: input.message, createdAt: now }).run();

      const aiReply = ai.enabled ? await ai.chat({ chart, profileName: profile.name, chartSummary: chartSummary(chart), history, message: input.message }) : null;
      const text = aiReply?.text ?? ruleBasedAnswer(chart, input.message, access(userId, profile.id), profile.name);
      const generator = aiReply ? 'ai' : 'rule';
      if (ai.enabled && cost > 0 && !aiReply) commerce.grantFreeCredits(userId, cost, 'AI 상담 실패 환급');
      const creditsLeft = commerce.wallet(userId).credits;

      const replyId = newId();
      db.insert(chatMessages).values({ id: replyId, userId, profileId: profile.id, role: 'assistant', content: text, createdAt: now + 1 }).run();
      const reply = db.select().from(chatMessages).where(eq(chatMessages.id, replyId)).get()!;
      return { reply: toDto(reply), creditsLeft, generator };
    },

    clear(userId: string, profileId: string) {
      profiles.getOwned(userId, profileId);
      db.delete(chatMessages).where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, profileId))).run();
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
