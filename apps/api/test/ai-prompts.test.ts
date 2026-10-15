/**
 * AI 상담·꿈풀이·타로 이야기 프롬프트 — 사주를 모르는 사람도 읽히는 쉬운 말 지시가 들어 있는지(docs/PLAIN_KOREAN.md).
 * 리포트 다듬기(REPORT_SYSTEM)는 다른 기준으로 관리하므로 여기서 보지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_SYSTEM, DREAM_SYSTEM, PLAIN_VOICE, TAROT_SYSTEM } from '../src/modules/ai/service.js';

const PROMPTS = { chat: CHAT_SYSTEM, dream: DREAM_SYSTEM, tarot: TAROT_SYSTEM };

describe('AI 프롬프트 — 쉬운 말 지시', () => {
  it('공통 말투 규칙: 당신 금지·이름으로 부르기·용어는 풀어서·한자 금지·결론 먼저·나쁨/좋음 예시', () => {
    expect(PLAIN_VOICE).toContain('사주를 한 번도 본 적 없는 사람');
    expect(PLAIN_VOICE).toContain('"당신"이라고 부르지 않습니다');
    expect(PLAIN_VOICE).toMatch(/이름으로 부르고/);
    expect(PLAIN_VOICE).toMatch(/주어를 빼고/);
    expect(PLAIN_VOICE).toMatch(/결론을 먼저/);
    for (const term of ['일간', '용신', '십신', '대운', '신살']) expect(PLAIN_VOICE).toContain(term);
    expect(PLAIN_VOICE).toContain('같은 문장 안에서 뜻을 먼저 풀고');
    expect(PLAIN_VOICE).toContain('나무·불·흙·쇠·물');
    expect(PLAIN_VOICE).toMatch(/한자.+쓰지 않습니다/);
    const bad = PLAIN_VOICE.match(/- 나쁨: /g) ?? [];
    const good = PLAIN_VOICE.match(/ {2}좋음: /g) ?? [];
    expect(bad.length).toBeGreaterThanOrEqual(2);
    expect(bad.length).toBeLessThanOrEqual(3);
    expect(good.length).toBe(bad.length);
  });

  it('좋은 예시 문장에는 용어·한자·당신이 없다', () => {
    const goods = [...PLAIN_VOICE.matchAll(/좋음: "([^"]+)"/g)].map((m) => m[1]!);
    expect(goods.length).toBeGreaterThanOrEqual(2);
    for (const g of goods) expect(g).not.toMatch(/[一-鿿]|당신|일간|용신|십신|대운|편관|상관|원소/);
    // 이름으로 부르는 예가 들어 있다
    expect(goods.some((g) => g.includes('서윤님'))).toBe(true);
  });

  for (const [key, prompt] of Object.entries(PROMPTS)) {
    it(`${key} — 공통 말투 규칙을 그대로 담고, 자료 속 용어를 옮기지 말라고 지시한다`, () => {
      expect(prompt).toContain(PLAIN_VOICE);
      expect(prompt).not.toMatch(/^당신은/); // 역할 소개부터 '당신' 말투를 쓰지 않는다
      expect(prompt).toMatch(/이름으로 부릅니다|이름으로 부르고/);
      expect(prompt).toMatch(/그 뜻만 쉬운 말로|뜻만 씁니다|뜻만 쉬운 말로/);
    });
  }

  it('안전 규칙은 그대로 남아 있다', () => {
    for (const p of [CHAT_SYSTEM, DREAM_SYSTEM, TAROT_SYSTEM]) expect(p).toContain('109');
    expect(TAROT_SYSTEM).toContain('어느 한쪽을 정답·추천으로 고르지 않습니다');
    expect(DREAM_SYSTEM).toContain('의학적·심리학적 진단을 하지 않습니다');
    expect(CHAT_SYSTEM).toContain('전문가 상담을 권합니다');
  });
});
