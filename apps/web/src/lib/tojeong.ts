/**
 * 토정비결(무료) — 입력 폼 검증과 API 호출.
 * 토정비결은 음력 생년월일만 쓰므로 태어난 시간·성별·출생지를 묻지 않는다.
 */
import { TOJEONG_DEFAULT_YEAR, type TojeongBirthDto, type TojeongDto, type TojeongMonthFlow, type TojeongRequestDto } from '@saju/shared';
import { request } from './api';
import { MAX_YEAR, MIN_YEAR } from './birth';
import { t } from './copy';

export interface TojeongFormState {
  calendar: 'solar' | 'lunar';
  isLeapMonth: boolean;
  /** 숫자 8자리 YYYYMMDD */
  date: string;
}

export const EMPTY_TOJEONG_FORM: TojeongFormState = { calendar: 'solar', isLeapMonth: false, date: '' };

/** 마지막으로 직접 입력한 생년월일 — 다시 들어오면 바로 결과를 보여 준다 */
export const TOJEONG_BIRTH_KEY = 'yd.tojeongBirth';

export function validateTojeongForm(f: TojeongFormState, now = new Date()): { error?: string; dto: TojeongBirthDto | null } {
  const digits = f.date.replace(/\D/g, '');
  if (!digits) return { error: t('form.errors.birthDateRequired'), dto: null };
  if (digits.length !== 8) return { error: t('form.errors.birthDateFormat'), dto: null };
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < MIN_YEAR || year > MAX_YEAR) return { error: t('form.errors.birthDateOutOfRange', { minYear: MIN_YEAR, maxYear: MAX_YEAR }), dto: null };
  if (month < 1 || month > 12 || day < 1 || day > (f.calendar === 'lunar' ? 30 : 31)) return { error: t('form.errors.birthDateInvalid'), dto: null };
  if (f.calendar === 'solar') {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return { error: t('form.errors.birthDateInvalid'), dto: null };
    if (d.getTime() > now.getTime()) return { error: t('form.errors.birthDateFuture'), dto: null };
  }
  return { dto: { calendar: f.calendar, year, month, day, isLeapMonth: f.calendar === 'lunar' && f.isLeapMonth } };
}

export function formFromBirth(b: TojeongBirthDto): TojeongFormState {
  return { calendar: b.calendar, isLeapMonth: Boolean(b.isLeapMonth), date: `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}` };
}

/** 저장된 출생 정보(BirthInputDto 등)에서 토정비결에 필요한 부분만 */
export function pickTojeongBirth(b: TojeongBirthDto): TojeongBirthDto {
  return { calendar: b.calendar, year: b.year, month: b.month, day: b.day, isLeapMonth: Boolean(b.isLeapMonth) };
}

export function fetchTojeong(body: TojeongRequestDto): Promise<TojeongDto> {
  return request<TojeongDto>('POST', '/tojeong', { body: { year: TOJEONG_DEFAULT_YEAR, ...body } });
}

export const FLOW_LABEL: Record<TojeongMonthFlow, string> = { rise: '힘이 붙는 달', even: '고른 달', care: '살피는 달' };

/** 열두 달 흐름 표시 — 점의 채움으로 기운을 보여 준다(색은 오행 데이터에만 쓰는 원칙) */
export const FLOW_DOT: Record<TojeongMonthFlow, string> = {
  rise: 'bg-action border-action',
  even: 'bg-action/35 border-action/60',
  care: 'bg-transparent border-line-strong',
};
