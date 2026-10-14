/**
 * AI 해석·상담 (Anthropic Claude).
 * - ANTHROPIC_API_KEY 가 없으면 enabled=false → 호출부는 규칙 기반 결과를 그대로 사용한다.
 * - 리포트: 규칙 기반 초안을 근거 자료로 주고, 같은 섹션 구조(JSON)로 문장을 다듬게 한다(structured outputs).
 * - 상담: 고정 시스템 프롬프트 + 프로필 사주 요약을 캐시해 대화 비용을 줄인다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { SajuChart } from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiService {
  enabled: boolean;
  /** 기본 모델 — 상담(채팅), 리포트 다듬기 */
  model: string | null;
  /** 카드끼리 엮어 읽는 해석처럼 추론이 필요한 곳 — 타로 이야기 */
  premiumModel: string | null;
  enhanceSections(input: { title: string; chart: SajuChart; draft: ReadingSection[] }): Promise<{ sections: ReadingSection[]; generator: 'ai' | 'rule'; model: string | null }>;
  chat(input: { chart: SajuChart; profileName: string; chartSummary: string; history: ChatTurn[]; message: string }): Promise<{ text: string; generator: 'ai' | 'rule' } | null>;
  /** 타로 — 카드끼리 이어지는 이야기 문단. 실패하면 null (규칙 기반 문단 사용) */
  tarotStory(input: TarotStoryInput): Promise<string[] | null>;
}

export interface TarotStoryInput {
  spreadName: string;
  topicLabel: string | null;
  question: string | null;
  cards: { position: string; hint: string; name: string; orientation: 'upright' | 'reversed'; meaning: string; line: string; keywords: string[] }[];
  /** 사주 결합 근거 한 줄 (있으면) */
  basis: string | null;
  /** 양자택일 선택지 — 어느 한쪽을 정답으로 고르지 않는다 */
  options?: { a: string; b: string };
  /** 궁합 타로 — 두 사람 이름 */
  people?: { me: string; partner: string };
}

const EnhancedSchema = z.object({
  sections: z.array(
    z.object({
      key: z.string(),
      summary: z.string(),
      paragraphs: z.array(z.string()),
    }),
  ),
});

const REPORT_SYSTEM = `당신은 20년 경력의 자평명리 전문가이자 따뜻한 상담가입니다.
사용자의 사주 계산 결과와 규칙 기반 초안이 주어집니다. 초안의 사실(간지, 십신, 오행 수치, 신살, 대운 연도 등)은 절대 바꾸지 말고, 문장만 더 자연스럽고 구체적으로 다듬어 주세요.

규칙:
- 친근한 존댓말("~해요")로, 일상의 장면을 예로 들어 설명합니다.
- 섹션 key 와 순서는 초안과 똑같이 유지합니다. 초안의 일부 섹션만 주어질 수 있으니, 받은 섹션만 돌려줍니다.
- 분량을 줄이지 않습니다. 섹션마다 문단 수는 초안과 같게, 문단 길이는 초안과 비슷하거나 조금 더 길게 씁니다.
- 숫자·연도·나이·점수·간지, "재물 —"처럼 머리말이 붙은 줄, "2월 壬寅 52점 · …" 같은 목록 줄은 형식과 값을 그대로 둡니다.
- 공포를 조장하거나 단정적인 흉사(사고, 이혼, 단명 등)를 예언하지 않습니다.
- 의료·법률·투자에 대해 단정하지 않고, 필요하면 전문가 상담을 권합니다.
- 초안에 없는 새로운 명리 사실(새 신살, 새 합충)을 지어내지 않습니다.
- "제가 오랫동안 봐 온 바로는"처럼 경력·자격을 내세우는 1인칭 표현을 쓰지 않습니다.`;

/** 리포트 다듬기 한 번에 보낼 초안 분량(글자) — 2만 자 분석서는 여러 덩어리로 나눠 동시에 다듬는다 */
const REPORT_CHUNK_CHARS = 3_500;
const REPORT_CONCURRENCY = 4;

function chunkSections(draft: ReadingSection[]): ReadingSection[][] {
  const chunks: ReadingSection[][] = [];
  let cur: ReadingSection[] = [];
  let size = 0;
  for (const s of draft) {
    const len = s.paragraphs.join('').length + s.summary.length;
    if (cur.length && size + len > REPORT_CHUNK_CHARS) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** 동시 실행 개수를 제한한 map */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const StorySchema = z.object({ paragraphs: z.array(z.string()) });

const TAROT_SYSTEM = `당신은 타로 리딩 서비스 "달빛사주"의 해석가입니다. 1909년 웨이트-스미스 덱의 전통적인 카드 뜻을 바탕으로, 사용자가 뽑은 카드들이 어떻게 이어지는지 이야기로 풀어 줍니다.

규칙:
- 주어진 카드·자리·뜻에만 근거합니다. 나오지 않은 카드나 새로운 상징을 지어내지 않습니다.
- 친근한 존댓말("~해요")로 2~3문단, 문단마다 2~4문장으로 씁니다. 자리 이름과 카드 이름을 자연스럽게 짚어 줍니다.
- 미래를 단정하지 않고 "기울어 있는 방향"으로 말합니다. 다른 사람의 마음을 확정하지 않습니다.
- 공포를 주거나 흉사(이별 확정, 사고, 질병 등)를 예언하지 않습니다. 역방향은 막힘·안으로 향함·무르익는 중으로 읽습니다.
- 건강·법률·투자 결정은 카드로 정하지 말고 전문가와 상의하라고 부드럽게 덧붙입니다.
- 사주 근거가 주어지면 마지막 문단에서 한 문장만 자연스럽게 연결하고, 근거에 없는 명리 사실을 만들지 않습니다.
- 질문에 자해·자살 암시가 있으면 리딩을 멈추고 공감과 함께 자살예방상담전화 109(24시간) 연락을 권합니다.
- 선택지(options)가 주어지면 두 길을 같은 분량으로 나란히 읽고, 어느 한쪽을 정답·추천으로 고르지 않습니다.
- 두 사람(people)이 주어지면 어느 한 사람의 탓으로 돌리지 않고 두 사람 모두의 자리에서 읽습니다.`;

const CHAT_SYSTEM = `당신은 사주 상담 서비스의 AI 상담가 "달빛 선생"입니다. 자평명리 지식을 바탕으로, 사용자의 사주 데이터에 근거해 따뜻하고 현실적인 조언을 합니다.

규칙:
- 반드시 아래에 제공되는 사용자의 사주 요약에 근거해서만 이야기하고, 제공되지 않은 간지·신살을 지어내지 않습니다.
- 친근한 존댓말("~해요")로 3~6문장 이내로 답합니다. 마지막에 실천 가능한 한 가지 제안을 덧붙입니다.
- 운세는 참고용이며 선택은 사용자에게 있음을 존중합니다. 공포 조장, 단정적 흉사 예언, 특정 종교·부적 구매 권유를 하지 않습니다.
- 질병·법률·투자·도박 관련 질문은 일반적인 성향 이야기만 하고 전문가 상담을 권합니다.
- 사용자가 자해·자살을 암시하면 사주 이야기를 멈추고, 공감과 함께 자살예방상담전화 109(24시간) 또는 정신건강위기상담 1577-0199 연락을 권합니다.
- 사주와 무관한 요청(코딩, 숙제 대행 등)은 정중히 사주 상담 범위로 안내합니다.`;

export function createAiService(config: AppConfig): AiService {
  if (!config.ANTHROPIC_API_KEY) {
    return {
      enabled: false,
      model: null,
      premiumModel: null,
      async enhanceSections({ draft }) {
        return { sections: draft, generator: 'rule', model: null };
      },
      async chat() {
        return null;
      },
      async tarotStory() {
        return null;
      },
    };
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  const model = config.ANTHROPIC_MODEL;
  const premiumModel = config.ANTHROPIC_MODEL_PREMIUM;

  const logError = (where: string, error: unknown) => {
    if (error instanceof Anthropic.RateLimitError) console.warn(`[ai:${where}] rate limited`);
    else if (error instanceof Anthropic.AuthenticationError) console.error(`[ai:${where}] ANTHROPIC_API_KEY 가 유효하지 않아요`);
    else if (error instanceof Anthropic.BadRequestError) console.error(`[ai:${where}] bad request: ${error.message}`);
    else if (error instanceof Anthropic.APIError) console.error(`[ai:${where}] API error ${error.status}: ${error.message}`);
    else console.error(`[ai:${where}]`, error);
  };

  return {
    enabled: true,
    model,
    premiumModel,
    async enhanceSections({ title, chart, draft }) {
      const summary = {
        pillars: [chart.pillars.year, chart.pillars.month, chart.pillars.day, chart.pillars.hour].filter(Boolean).map((p) => ({
          position: p!.position,
          ganzhi: p!.ganzhi.hanja,
          stemTenGod: p!.stem.tenGod,
          branchTenGod: p!.branch.tenGod,
          stage: p!.branch.twelveStage,
        })),
        gender: chart.input.gender,
        elements: chart.elements.count,
        strength: chart.strength.level,
        yongsin: chart.yongsin.yongsin,
        shinsal: chart.shinsal.map((s) => s.name),
      };
      /** 덩어리 하나 다듬기 — 실패하면 null (그 덩어리는 규칙 기반 초안 유지) */
      const enhanceChunk = async (part: ReadingSection[]) => {
        try {
          const response = await client.messages.parse({
            model,
            max_tokens: 16000,
            output_config: { effort: 'medium', format: zodOutputFormat(EnhancedSchema) },
            system: [{ type: 'text', text: REPORT_SYSTEM, cache_control: { type: 'ephemeral' } }],
            messages: [
              {
                role: 'user',
                content: `다음 리포트 초안의 일부를 다듬어 주세요.\n\n${JSON.stringify({ title, chart: summary, draft: part.map((s) => ({ key: s.key, title: s.title, summary: s.summary, paragraphs: s.paragraphs })) })}`,
              },
            ],
          });
          if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
          return response.parsed_output.sections;
        } catch (error) {
          logError('report', error);
          return null;
        }
      };
      const results = await mapLimit(chunkSections(draft), REPORT_CONCURRENCY, enhanceChunk);
      const enhanced = results.flatMap((r) => r ?? []);
      if (enhanced.length === 0) return { sections: draft, generator: 'rule', model: null };
      const byKey = new Map(enhanced.map((s) => [s.key, s]));
      const sections = draft.map((s) => {
        const e = byKey.get(s.key);
        if (!e || e.paragraphs.length === 0) return s;
        return { ...s, summary: e.summary || s.summary, paragraphs: e.paragraphs };
      });
      return { sections, generator: 'ai', model };
    },
    async chat({ profileName, chartSummary, history, message }) {
      try {
        const messages: Anthropic.Beta.BetaMessageParam[] = [
          ...history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
          { role: 'user', content: message },
        ];
        const response = await client.beta.messages.create(
          {
            model,
            max_tokens: 4000,
            // 거절 시 서버 측 대체 모델 재시도 — Haiku 는 지원하지 않아 보내지 않는다
            ...(model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
            output_config: { effort: 'low' },
            system: [
              { type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: `[상담 대상: ${profileName}]\n${chartSummary}`, cache_control: { type: 'ephemeral' } },
            ],
            messages,
          },
          { timeout: 60_000 },
        );
        if (response.stop_reason === 'refusal') return null;
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return text ? { text, generator: 'ai' } : null;
      } catch (error) {
        logError('chat', error);
        return null;
      }
    },
    async tarotStory(input) {
      try {
        const response = await client.messages.parse({
          model: premiumModel,
          max_tokens: 4000,
          output_config: { effort: 'low', format: zodOutputFormat(StorySchema) },
          system: [{ type: 'text', text: TAROT_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: `다음 리딩의 '카드끼리 이어지는 이야기'를 써 주세요.

${JSON.stringify(input)}` }],
        });
        const paragraphs = response.parsed_output?.paragraphs.map((p) => p.trim()).filter(Boolean) ?? [];
        if (response.stop_reason === 'refusal' || paragraphs.length === 0) return null;
        return paragraphs.slice(0, 4);
      } catch (error) {
        logError('tarot', error);
        return null;
      }
    },
  };
}
