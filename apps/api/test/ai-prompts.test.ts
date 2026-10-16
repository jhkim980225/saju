/**
 * AI 상담·꿈풀이·타로 이야기 프롬프트 — 사주를 처음 접하는 성인을 위한 문체 지시가 들어 있는지(docs/PLAIN_KOREAN.md, 2026-10-16 개정).
 * 리포트 다듬기(REPORT_SYSTEM)는 다른 기준으로 관리하므로 여기서 보지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_SYSTEM, DREAM_SYSTEM, PLAIN_VOICE, TAROT_SYSTEM } from '../src/modules/ai/service.js';
import { toneProblems } from '../src/modules/interpretation/plainGuard.js';

const PROMPTS = { chat: CHAT_SYSTEM, dream: DREAM_SYSTEM, tarot: TAROT_SYSTEM };

describe('AI 프롬프트 — 문체 지시', () => {
  it('공통 문체 규칙: 성인 대상 전문 설명체·당신 금지·이름으로 부르기·용어는 처음에 뜻을 붙여·한자 금지·나쁨/좋음 예시', () => {
    expect(PLAIN_VOICE).toContain('사주를 처음 접하는 성인');
    expect(PLAIN_VOICE).toContain('"당신"이라고 부르지 않습니다');
    expect(PLAIN_VOICE).toMatch(/이름으로 부르고/);
    expect(PLAIN_VOICE).toMatch(/주어를 빼고/);
    expect(PLAIN_VOICE).toMatch(/결론을 먼저/);
    expect(PLAIN_VOICE).toMatch(/명리학적 해석/);
    for (const term of ['일간', '용신', '십성', '대운', '신살']) expect(PLAIN_VOICE).toContain(term);
    expect(PLAIN_VOICE).toContain('처음 나오는 용어에는 뜻을 붙입니다');
    expect(PLAIN_VOICE).toContain('나무·불·흙·쇠·물');
    expect(PLAIN_VOICE).toMatch(/한자.+쓰지 않습니다/);
    // 비유·관용구·유아적인 표현 금지(docs/PLAIN_KOREAN.md '문체')
    expect(PLAIN_VOICE).toMatch(/비유·관용구·속담/);
    expect(PLAIN_VOICE).toMatch(/유아적인 표현/);
    expect(PLAIN_VOICE).toMatch(/~편이에요/);
    const bad = PLAIN_VOICE.match(/- 나쁨: /g) ?? [];
    const good = PLAIN_VOICE.match(/ {2}좋음: /g) ?? [];
    expect(bad.length).toBeGreaterThanOrEqual(2);
    expect(bad.length).toBeLessThanOrEqual(3);
    expect(good.length).toBe(bad.length);
  });

  it('좋은 예시 문장에는 한자·당신·비유·유아적인 표현이 없고, 용어는 처음에 뜻을 붙인다', () => {
    const goods = [...PLAIN_VOICE.matchAll(/좋음: "([^"]+)"/g)].map((m) => m[1]!);
    expect(goods.length).toBeGreaterThanOrEqual(2);
    for (const g of goods) expect(g).not.toMatch(/[一-鿿]|당신/);
    for (const g of goods) expect(toneProblems(g), g).toEqual([]);
    // 용어를 쓴 예시는 바로 뒤 괄호에 뜻이 있다
    for (const g of goods) for (const term of ['일간', '편관', '용신']) if (g.includes(term)) expect(g, g).toMatch(new RegExp(`${term}\\(`));
    // 이름으로 부르는 예가 들어 있다
    expect(goods.some((g) => g.includes('서윤님'))).toBe(true);
  });

  for (const [key, prompt] of Object.entries(PROMPTS)) {
    it(`${key} — 공통 문체 규칙을 그대로 담고, 자료 속 용어는 뜻을 붙여 쓰라고 지시한다`, () => {
      expect(prompt).toContain(PLAIN_VOICE);
      expect(prompt).not.toMatch(/^당신은/); // 역할 소개부터 '당신' 말투를 쓰지 않는다
      expect(prompt).toMatch(/이름으로 부릅니다|이름으로 부르고/);
      expect(prompt).toMatch(/뜻을 붙입니다/);
    });
  }

  it('안전 규칙은 그대로 남아 있다', () => {
    for (const p of [CHAT_SYSTEM, DREAM_SYSTEM, TAROT_SYSTEM]) expect(p).toContain('109');
    expect(TAROT_SYSTEM).toContain('어느 한쪽을 정답·추천으로 고르지 않습니다');
    expect(DREAM_SYSTEM).toContain('의학적·심리학적 진단을 하지 않습니다');
    expect(CHAT_SYSTEM).toContain('전문가 상담을 권합니다');
  });
});
