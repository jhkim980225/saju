import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, formatDateDigits, formatTimeDigits, requiredProgress, validateBirthForm } from '../birth';
import { t } from '../copy';

describe('copy t()', () => {
  it('중첩 키와 변수 치환', () => {
    expect(t('result.title', { name: '서윤' })).toBe('서윤님의 사주');
    expect(t('brand.name')).toBe('달빛사주');
  });
  it('없는 키는 키 그대로', () => {
    expect(t('nope.missing')).toBe('nope.missing');
  });
});

describe('생년월일 폼', () => {
  const base = { ...EMPTY_FORM, date: '19950314', time: '14:30', gender: 'female' as const };

  it('자동 포맷', () => {
    expect(formatDateDigits('19950314')).toBe('1995.03.14');
    expect(formatDateDigits('199503')).toBe('1995.03');
    expect(formatTimeDigits('1430')).toBe('14:30');
  });

  it('정상 입력 → DTO (서울 경도·시간대)', () => {
    const { errors, dto } = validateBirthForm(base);
    expect(errors).toEqual({});
    expect(dto).toMatchObject({ calendar: 'solar', year: 1995, month: 3, day: 14, hour: 14, minute: 30, gender: 'female', timeZone: 'Asia/Seoul', longitude: 126.978 });
  });

  it('없는 날짜·미래·범위 밖', () => {
    expect(validateBirthForm({ ...base, date: '20230229' }).errors.date).toBeTruthy();
    expect(validateBirthForm({ ...base, date: '20301231' }, new Date('2026-10-12')).errors.date).toContain('미래');
    expect(validateBirthForm({ ...base, date: '18991231' }).errors.date).toContain('1900');
  });

  it('시간 모름이면 hour=null, 시간 형식 오류', () => {
    expect(validateBirthForm({ ...base, timeUnknown: true, time: '' }).dto?.hour).toBeNull();
    expect(validateBirthForm({ ...base, time: '25:00' }).errors.time).toBeTruthy();
  });

  it('성별 필수, 음력 윤달 플래그 전달', () => {
    expect(validateBirthForm({ ...base, gender: '' }).errors.gender).toBeTruthy();
    expect(validateBirthForm({ ...base, calendar: 'lunar', isLeapMonth: true, date: '20230201' }).dto?.isLeapMonth).toBe(true);
  });

  it('해외 출생 도시 → 시간대·경도', () => {
    expect(validateBirthForm({ ...base, cityId: 'losangeles' }).dto).toMatchObject({ timeZone: 'America/Los_Angeles', longitude: -118.244 });
  });

  it('필수 진행도', () => {
    expect(requiredProgress(EMPTY_FORM)).toBe(1);
    expect(requiredProgress(base)).toBe(4);
  });
});

describe('uuid (비보안 컨텍스트 대응)', () => {
  it('crypto.randomUUID 가 없어도 v4 형식', async () => {
    const { uuid } = await import('../uuid');
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const id = uuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(uuid()).not.toBe(id);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
