/**
 * 타로 2차 펼침 방식 — 질문 초안 확인, 문구 키, 자리 배치(켈틱 크로스의 가로 카드), 예·아니오 기울기 막대, 양자택일 비교.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { TAROT_SPREADS, TAROT_SPREAD_TOPICS, type TarotPlacedCardDto } from '@saju/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TarotChoiceCompare, TarotSpreadSlots, TarotYesNoScale } from '@/components/TarotSpread';
import { t } from '../copy';
import { draftError, draftExtras, isPaidSpread } from '../tarot';

afterEach(cleanup);

describe('질문 초안 확인', () => {
  it('예·아니오는 질문이 있어야 섞을 수 있다', () => {
    expect(draftError({ topic: 'yesno', question: '  ' })).toBe(t('tarot.spreads.yesno.questionRequired'));
    expect(draftError({ topic: 'yesno', question: '먼저 연락해 볼까요?' })).toBeNull();
    // 다른 주제는 질문 없이도 된다
    expect(draftError({ topic: 'love', question: '' })).toBeNull();
    expect(draftError({ topic: 'celtic', question: '' })).toBeNull();
  });

  it('양자택일은 서로 다른 선택지 A·B 가 모두 있어야 하고, 각 20자까지', () => {
    expect(draftError({ topic: 'choice', question: '', optionA: '남기' })).toBe(t('tarot.question.errors.optionRequired'));
    expect(draftError({ topic: 'choice', question: '', optionA: '가'.repeat(21), optionB: '나' })).toBe(t('tarot.question.errors.optionTooLong', { max: 20 }));
    expect(draftError({ topic: 'choice', question: '', optionA: '이직 하기', optionB: '이직  하기 ' })).toMatch(/서로 다른/);
    expect(draftError({ topic: 'choice', question: '', optionA: '남기', optionB: '옮기기' })).toBeNull();
    expect(draftExtras({ topic: 'choice', question: '', optionA: ' 남기 ', optionB: '옮기기', partnerProfileId: 'x' })).toEqual({ optionA: '남기', optionB: '옮기기' });
  });

  it('궁합 타로는 상대를 골라야 하고, 상대 ID 만 함께 보낸다', () => {
    expect(draftError({ topic: 'compat', question: '' })).toBe(t('tarot.spreads.compat.partnerRequired'));
    expect(draftError({ topic: 'compat', question: '', profileId: 'me', partnerProfileId: 'you' })).toBeNull();
    expect(draftExtras({ topic: 'compat', question: '', profileId: 'me', partnerProfileId: 'you', optionA: 'a' })).toEqual({ partnerProfileId: 'you' });
    expect(draftExtras({ topic: 'celtic', question: '' })).toEqual({});
  });

  it('무료 펼침(오늘의 카드·예·아니오)과 깊은 풀이가 있는 펼침', () => {
    expect(isPaidSpread('daily')).toBe(false);
    expect(isPaidSpread('yesno')).toBe(false);
    for (const s of ['three', 'choice', 'compat', 'celtic'] as const) expect(isPaidSpread(s)).toBe(true);
  });

  it('새 펼침 방식의 문구 키가 모두 있다 (t 는 없는 키를 그대로 돌려준다)', () => {
    for (const k of TAROT_SPREAD_TOPICS) {
      for (const key of [`tarot.topics.${k}.label`, `tarot.topics.${k}.title`, `tarot.spreads.${k}.name`, `tarot.spreads.${k}.desc`]) expect(t(key), key).not.toBe(key);
    }
    expect(t('tarot.topics.compat.label')).toBe('궁합');
    expect(t('tarot.error.yesnoLimit.cta')).not.toMatch(/^tarot\./);
  });
});

const card = (i: number, key: string, label: string, extra: Partial<TarotPlacedCardDto> = {}): TarotPlacedCardDto => ({
  id: `card-${i}`,
  index: i,
  nameKo: `카드${i}`,
  nameEn: `Card ${i}`,
  arcana: 'minor',
  suit: 'cups',
  number: i,
  orientation: 'upright',
  image: `/tarot/cards/cups-${String(i).padStart(2, '0')}.webp`,
  imagery: '그림 설명',
  keywords: ['키워드1', '키워드2', '키워드3'],
  meaning: `카드${i}의 뜻`,
  element: 'water',
  yesNo: 'yes',
  position: { key, label, hint: '' },
  line: '한 줄',
  ...extra,
});

describe('펼침 방식 자리 배치', () => {
  it('켈틱 크로스 — 10자리, 2번은 1번 위에 가로로(90°) 놓이고 자리 이름은 번호 범례로', () => {
    const { container } = render(<TarotSpreadSlots spread="celtic" label="펼친 카드" renderCard={(i) => <span data-testid={`slot-${i}`}>{i + 1}번 카드</span>} />);
    for (let i = 0; i < 10; i++) expect(screen.getByTestId(`slot-${i}`)).toBeInTheDocument();
    const crossing = container.querySelector('[data-crossing]')!;
    expect(within(crossing as HTMLElement).getByTestId('slot-1')).toBeInTheDocument();
    expect(crossing.firstElementChild!.className).toContain('rotate-90');
    const legend = container.querySelectorAll('ol > li');
    expect(legend).toHaveLength(10);
    TAROT_SPREADS.celtic.positions.forEach((p, i) => expect(legend[i]).toHaveTextContent(`${i + 1}${p.label}`));
  });

  it('1장·3장·5장은 자리 이름을 카드 아래에', () => {
    for (const spread of ['yesno', 'choice', 'compat'] as const) {
      render(<TarotSpreadSlots spread={spread} label={spread} renderCard={() => <span>카드</span>} />);
      const list = screen.getByRole('list', { name: spread });
      expect(within(list).getAllByRole('listitem')).toHaveLength(TAROT_SPREADS[spread].cards);
      for (const p of TAROT_SPREADS[spread].positions) expect(within(list).getByText(p.label)).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('예·아니오 기울기 막대', () => {
  it('세 칸 중 하나만 표시하고, 큰 YES/NO 대신 경향 문장', () => {
    const { container } = render(<TarotYesNoScale lean="maybe" />);
    expect(screen.getByRole('img', { name: `${t('tarot.result.yesno.scaleLabel')}: 조건부` })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-active]')).toHaveLength(1);
    expect(screen.getByText(t('tarot.result.yesno.maybe'))).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/YES|NO/);
  });
});

describe('양자택일 비교', () => {
  it('A·B 를 같은 모양으로 나란히, 어느 쪽에도 정답·추천 표시가 없다', () => {
    const cards = [card(1, 'now', '지금의 나'), card(2, 'optionA', 'A를 고르면'), card(3, 'optionB', 'B를 고르면', { orientation: 'reversed', yesNo: 'no' })];
    render(<TarotChoiceCompare cards={cards} options={{ a: '지금 회사에 남기', b: '새 회사로 옮기기' }} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('A · 지금 회사에 남기 쪽');
    expect(items[0]).toHaveTextContent('카드2');
    expect(items[1]).toHaveTextContent('B · 새 회사로 옮기기 쪽');
    expect(items[1]).toHaveTextContent('카드3');
    expect(items[0]!.className).toBe(items[1]!.className);
    expect(document.body.textContent).not.toMatch(/정답이에요|추천|더 좋아요/);
  });
});
