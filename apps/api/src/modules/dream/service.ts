/**
 * AI 꿈풀이 — 꿈 이야기에서 사전 상징을 찾아(규칙 기반 근거) AI 가 맞춤 풀이를 쓴다.
 *
 * - 질문권: AI 상담과 같은 장치·같은 단가(AI_CHAT_CREDIT_COST). AI 호출 전에 먼저 차감하고, AI 가 실패하면 무상으로 돌려준다.
 * - AI 미설정(ANTHROPIC_API_KEY 없음): 사전 해석을 규칙으로 엮은 기본 풀이를 주고, 질문권은 차감하지 않는다.
 * - 사주: 프로필이 있으면(또는 지정하면) 사주 요약을 AI 에 함께 준다. 규칙 기반 풀이에는 쓰지 않는다.
 * - 꿈 이야기는 저장하지 않는다(민감할 수 있는 내용 — 응답으로만 돌려준다).
 */
import type { SajuChart } from '@saju/core';
import {
  DREAM_CRISIS_PATTERN,
  DREAM_DISCLAIMER,
  extractDreamSymbols,
  toDreamSymbolDto,
  type DreamInterpretDto,
  type DreamInterpretationDto,
  type DreamMatch,
  type DreamTone,
} from '@saju/shared/dream';
import type { AppConfig } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AiService } from '../ai/service.js';
import { chartSummary } from '../chat/service.js';
import type { CommerceService } from '../commerce/service.js';
import type { ProfileService } from '../profiles/service.js';

export const DREAM_NOTICE = {
  ai: 'AI가 꿈 이야기와 사전의 전통 해석을 바탕으로 쓴 풀이예요. 같은 꿈이라도 표현은 조금씩 달라질 수 있어요.',
  rule: '사전에 정리한 전통 해석을 정해진 규칙으로 엮은 기본 풀이예요.',
} as const;

const CRISIS_LINE = '혼자 감당하기 어려운 마음이라면 지금 전문 상담을 받아 보세요. 자살예방상담전화 109는 24시간 열려 있어요.';

/** 상징들의 결 — 길몽이 많으면 good, 흉몽이 많으면 bad, 아니면 neutral */
function overallTone(matches: DreamMatch[]): DreamTone {
  const tones = matches.map((m) => m.variation?.tone ?? m.entry.tone);
  const good = tones.filter((t) => t === 'good').length;
  const bad = tones.filter((t) => t === 'bad').length;
  if (good > bad) return 'good';
  if (bad > good) return 'bad';
  return 'neutral';
}

const HEADLINE: Record<DreamTone, string> = {
  good: '좋은 기운으로 풀이해 온 상징이 많은 꿈이에요',
  bad: '마음을 한 번 살펴보라는 신호로 읽히는 꿈이에요',
  neutral: '여러 상징이 섞여 지금의 마음을 비추는 꿈이에요',
};

const CLOSING: Record<DreamTone, string> = {
  good: '좋은 꿈이라도 결과를 정해 주지는 않아요. 마음이 가볍게 열린 오늘, 미뤄 둔 일 하나를 시작해 보는 계기로 삼아 보세요.',
  bad: '조심하라는 꿈은 겁을 주려는 게 아니라 지친 마음을 알아차리라는 신호로 읽어요. 오늘은 일정을 하나 덜고 푹 쉬어 보세요.',
  neutral: '꿈에서 깨어났을 때 가장 크게 남은 느낌을 한 줄로 적어 보세요. 지금 마음이 어디에 머물러 있는지 보이기 시작할 거예요.',
};

/** 규칙 기반 풀이 — 사전 문장만 엮는다(새 해석을 만들지 않음) */
export function composeRuleBased(matches: DreamMatch[], crisis: boolean): { headline: string; paragraphs: string[] } {
  const lead = crisis ? [CRISIS_LINE] : [];
  if (matches.length === 0) {
    return {
      headline: '사전에서 딱 맞는 상징을 찾지 못했어요',
      paragraphs: [
        ...lead,
        '꿈에 나온 사람·동물·물건·장소를 한두 낱말로 더 적어 주시면, 사전에 정리한 풀이를 이어서 보여 드릴게요.',
        '꿈은 하루 동안 쌓인 생각과 감정이 이리저리 섞여 나오기도 해요. 깨어났을 때 남은 느낌이 편안했는지, 불안했는지 떠올려 보면 지금의 마음을 읽는 데 도움이 돼요.',
      ],
    };
  }
  const tone = overallTone(matches);
  const top = matches.slice(0, 3);
  return {
    headline: HEADLINE[tone],
    paragraphs: [
      ...lead,
      `꿈 이야기에서 사전의 상징 ${matches.length}가지를 찾았어요. ${matches.map((m) => m.entry.keyword).join(', ')}.`,
      ...top.map((m) => (m.variation ? `${m.variation.title} — ${m.variation.text}` : `${m.entry.keyword} — ${m.entry.meaning}`)),
      CLOSING[tone],
    ],
  };
}

export function createDreamService(config: AppConfig, profiles: ProfileService, commerce: CommerceService, ai: AiService) {
  /** 사주를 함께 볼 원국 — 지정 프로필(없으면 대표 프로필). 사주 없이 보기를 고르면 null */
  const chartFor = (userId: string, dto: DreamInterpretDto): { chart: SajuChart; name: string } | null => {
    if (dto.withoutSaju) return null;
    if (dto.profileId) {
      try {
        const p = profiles.getOwned(userId, dto.profileId);
        return { chart: profiles.chartOf(p), name: p.name };
      } catch {
        throw badRequest('사주를 함께 볼 프로필을 다시 선택해 주세요.');
      }
    }
    const p = profiles.primary(userId);
    return p ? { chart: profiles.chartOf(p), name: p.name } : null;
  };

  return {
    async interpret(userId: string, dto: DreamInterpretDto): Promise<DreamInterpretationDto> {
      const text = dto.text.trim();
      const matches = extractDreamSymbols(text, 6);
      const crisis = DREAM_CRISIS_PATTERN.test(text);
      const owner = chartFor(userId, dto);
      const cost = config.AI_CHAT_CREDIT_COST;
      // AI 호출 전에 질문권을 먼저 차감(동시 요청으로 AI 비용을 부풀리는 것 방지) — 실패하면 무상으로 돌려준다
      if (ai.enabled && cost > 0) commerce.consumeCredits(userId, cost, 'AI 꿈풀이', newId());
      const aiOut = ai.enabled
        ? await ai.dreamInterpret({
            dream: text,
            symbols: matches.map((m) => ({
              keyword: m.entry.keyword,
              category: m.entry.category,
              tone: m.variation?.tone ?? m.entry.tone,
              meaning: m.entry.meaning,
              situation: m.variation ? { title: m.variation.title, text: m.variation.text } : null,
            })),
            saju: owner ? { profileName: owner.name, summary: chartSummary(owner.chart) } : null,
          })
        : null;
      if (ai.enabled && cost > 0 && !aiOut) commerce.grantFreeCredits(userId, cost, 'AI 꿈풀이 실패 환급');
      const out = aiOut ?? composeRuleBased(matches, crisis);
      return {
        symbols: matches.map(toDreamSymbolDto),
        headline: out.headline,
        paragraphs: out.paragraphs,
        generator: aiOut ? 'ai' : 'rule',
        creditsCharged: aiOut ? cost : 0,
        creditsLeft: commerce.wallet(userId).credits,
        profileName: aiOut && owner ? owner.name : null,
        crisis,
        notice: aiOut ? DREAM_NOTICE.ai : DREAM_NOTICE.rule,
        disclaimer: DREAM_DISCLAIMER,
      };
    },
  };
}

export type DreamService = ReturnType<typeof createDreamService>;
