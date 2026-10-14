/**
 * 출생 정보 입력 폼 모델 — 폼 상태 ↔ API 요청(BirthInputDto) 변환과 검증.
 */
import type { BirthInputDto, ProfileDto } from '@saju/shared';
import { t } from './copy';

export interface City {
  id: string;
  name: string;
  longitude: number;
  timeZone: string;
  abroad?: boolean;
}

export const CITIES: City[] = [
  { id: 'seoul', name: '서울특별시', longitude: 126.978, timeZone: 'Asia/Seoul' },
  { id: 'busan', name: '부산광역시', longitude: 129.075, timeZone: 'Asia/Seoul' },
  { id: 'daegu', name: '대구광역시', longitude: 128.601, timeZone: 'Asia/Seoul' },
  { id: 'incheon', name: '인천광역시', longitude: 126.705, timeZone: 'Asia/Seoul' },
  { id: 'gwangju', name: '광주광역시', longitude: 126.851, timeZone: 'Asia/Seoul' },
  { id: 'daejeon', name: '대전광역시', longitude: 127.385, timeZone: 'Asia/Seoul' },
  { id: 'ulsan', name: '울산광역시', longitude: 129.311, timeZone: 'Asia/Seoul' },
  { id: 'sejong', name: '세종특별자치시', longitude: 127.289, timeZone: 'Asia/Seoul' },
  { id: 'suwon', name: '수원시', longitude: 127.029, timeZone: 'Asia/Seoul' },
  { id: 'seongnam', name: '성남시', longitude: 127.137, timeZone: 'Asia/Seoul' },
  { id: 'goyang', name: '고양시', longitude: 126.832, timeZone: 'Asia/Seoul' },
  { id: 'yongin', name: '용인시', longitude: 127.178, timeZone: 'Asia/Seoul' },
  { id: 'chuncheon', name: '춘천시', longitude: 127.73, timeZone: 'Asia/Seoul' },
  { id: 'wonju', name: '원주시', longitude: 127.92, timeZone: 'Asia/Seoul' },
  { id: 'gangneung', name: '강릉시', longitude: 128.876, timeZone: 'Asia/Seoul' },
  { id: 'cheongju', name: '청주시', longitude: 127.489, timeZone: 'Asia/Seoul' },
  { id: 'cheonan', name: '천안시', longitude: 127.114, timeZone: 'Asia/Seoul' },
  { id: 'jeonju', name: '전주시', longitude: 127.148, timeZone: 'Asia/Seoul' },
  { id: 'gunsan', name: '군산시', longitude: 126.737, timeZone: 'Asia/Seoul' },
  { id: 'mokpo', name: '목포시', longitude: 126.392, timeZone: 'Asia/Seoul' },
  { id: 'yeosu', name: '여수시', longitude: 127.662, timeZone: 'Asia/Seoul' },
  { id: 'suncheon', name: '순천시', longitude: 127.487, timeZone: 'Asia/Seoul' },
  { id: 'pohang', name: '포항시', longitude: 129.365, timeZone: 'Asia/Seoul' },
  { id: 'gyeongju', name: '경주시', longitude: 129.224, timeZone: 'Asia/Seoul' },
  { id: 'andong', name: '안동시', longitude: 128.729, timeZone: 'Asia/Seoul' },
  { id: 'changwon', name: '창원시', longitude: 128.681, timeZone: 'Asia/Seoul' },
  { id: 'jinju', name: '진주시', longitude: 128.108, timeZone: 'Asia/Seoul' },
  { id: 'gimhae', name: '김해시', longitude: 128.889, timeZone: 'Asia/Seoul' },
  { id: 'jeju', name: '제주시', longitude: 126.531, timeZone: 'Asia/Seoul' },
  { id: 'seogwipo', name: '서귀포시', longitude: 126.56, timeZone: 'Asia/Seoul' },
  { id: 'pyongyang', name: '평양', longitude: 125.754, timeZone: 'Asia/Pyongyang' },
  { id: 'tokyo', name: '도쿄 (일본)', longitude: 139.692, timeZone: 'Asia/Tokyo', abroad: true },
  { id: 'osaka', name: '오사카 (일본)', longitude: 135.502, timeZone: 'Asia/Tokyo', abroad: true },
  { id: 'beijing', name: '베이징 (중국)', longitude: 116.407, timeZone: 'Asia/Shanghai', abroad: true },
  { id: 'shanghai', name: '상하이 (중국)', longitude: 121.474, timeZone: 'Asia/Shanghai', abroad: true },
  { id: 'hongkong', name: '홍콩', longitude: 114.169, timeZone: 'Asia/Hong_Kong', abroad: true },
  { id: 'taipei', name: '타이베이 (대만)', longitude: 121.565, timeZone: 'Asia/Taipei', abroad: true },
  { id: 'singapore', name: '싱가포르', longitude: 103.82, timeZone: 'Asia/Singapore', abroad: true },
  { id: 'bangkok', name: '방콕 (태국)', longitude: 100.502, timeZone: 'Asia/Bangkok', abroad: true },
  { id: 'hanoi', name: '하노이 (베트남)', longitude: 105.854, timeZone: 'Asia/Ho_Chi_Minh', abroad: true },
  { id: 'newyork', name: '뉴욕 (미국)', longitude: -74.006, timeZone: 'America/New_York', abroad: true },
  { id: 'losangeles', name: '로스앤젤레스 (미국)', longitude: -118.244, timeZone: 'America/Los_Angeles', abroad: true },
  { id: 'chicago', name: '시카고 (미국)', longitude: -87.63, timeZone: 'America/Chicago', abroad: true },
  { id: 'seattle', name: '시애틀 (미국)', longitude: -122.332, timeZone: 'America/Los_Angeles', abroad: true },
  { id: 'toronto', name: '토론토 (캐나다)', longitude: -79.383, timeZone: 'America/Toronto', abroad: true },
  { id: 'vancouver', name: '밴쿠버 (캐나다)', longitude: -123.121, timeZone: 'America/Vancouver', abroad: true },
  { id: 'london', name: '런던 (영국)', longitude: -0.128, timeZone: 'Europe/London', abroad: true },
  { id: 'paris', name: '파리 (프랑스)', longitude: 2.352, timeZone: 'Europe/Paris', abroad: true },
  { id: 'berlin', name: '베를린 (독일)', longitude: 13.405, timeZone: 'Europe/Berlin', abroad: true },
  { id: 'sydney', name: '시드니 (호주)', longitude: 151.209, timeZone: 'Australia/Sydney', abroad: true },
  { id: 'auckland', name: '오클랜드 (뉴질랜드)', longitude: 174.763, timeZone: 'Pacific/Auckland', abroad: true },
  { id: 'saopaulo', name: '상파울루 (브라질)', longitude: -46.633, timeZone: 'America/Sao_Paulo', abroad: true },
];

export const cityById = (id: string) => CITIES.find((c) => c.id === id) ?? CITIES[0]!;
export const cityByLongitude = (lng: number, tz: string) => CITIES.find((c) => Math.abs(c.longitude - lng) < 0.01 && c.timeZone === tz);

/** 12지시 시간대 (경도 보정 후 경계 기준, 서울 기준 30분 단위 표기) — 대표 시각은 구간 중앙 */
export const HOUR_RANGES = [
  { key: 'ja', time: '00:30' },
  { key: 'chuk', time: '02:30' },
  { key: 'in', time: '04:30' },
  { key: 'myo', time: '06:30' },
  { key: 'jin', time: '08:30' },
  { key: 'sa', time: '10:30' },
  { key: 'o', time: '12:30' },
  { key: 'mi', time: '14:30' },
  { key: 'sin', time: '16:30' },
  { key: 'yu', time: '18:30' },
  { key: 'sul', time: '20:30' },
  { key: 'hae', time: '22:30' },
] as const;

export interface BirthFormState {
  name: string;
  calendar: 'solar' | 'lunar';
  isLeapMonth: boolean;
  /** 숫자 8자리 YYYYMMDD */
  date: string;
  /** HH:MM */
  time: string;
  timeUnknown: boolean;
  gender: 'female' | 'male' | '';
  cityId: string;
  timeCorrection: 'lmt' | 'trueSolar' | 'clock';
  ziHourRule: 'nextDay' | 'midnight';
}

export const EMPTY_FORM: BirthFormState = {
  name: '',
  calendar: 'solar',
  isLeapMonth: false,
  date: '',
  time: '',
  timeUnknown: false,
  gender: '',
  cityId: 'seoul',
  timeCorrection: 'lmt',
  ziHourRule: 'nextDay',
};

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2050;

export type FormErrors = Partial<Record<'name' | 'date' | 'time' | 'gender', string>>;

export function formatDateDigits(d: string): string {
  const s = d.replace(/\D/g, '').slice(0, 8);
  if (s.length <= 4) return s;
  if (s.length <= 6) return `${s.slice(0, 4)}.${s.slice(4)}`;
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}`;
}

export function formatTimeDigits(v: string): string {
  const s = v.replace(/\D/g, '').slice(0, 4);
  if (s.length <= 2) return s;
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

export function validateBirthForm(f: BirthFormState, now = new Date()): { errors: FormErrors; dto: BirthInputDto | null } {
  const errors: FormErrors = {};
  if (f.name.length > 12) errors.name = t('form.errors.nameTooLong', { max: 12 });

  const digits = f.date.replace(/\D/g, '');
  let year = 0;
  let month = 0;
  let day = 0;
  if (!digits) errors.date = t('form.errors.birthDateRequired');
  else if (digits.length !== 8) errors.date = t('form.errors.birthDateFormat');
  else {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
    if (year < MIN_YEAR || year > MAX_YEAR) errors.date = t('form.errors.birthDateOutOfRange', { minYear: MIN_YEAR, maxYear: MAX_YEAR });
    else if (month < 1 || month > 12 || day < 1 || day > (f.calendar === 'lunar' ? 30 : 31)) errors.date = t('form.errors.birthDateInvalid');
    else if (f.calendar === 'solar') {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (d.getUTCMonth() !== month - 1) errors.date = t('form.errors.birthDateInvalid');
      else if (d.getTime() > now.getTime()) errors.date = t('form.errors.birthDateFuture');
    }
  }

  let hour: number | null = null;
  let minute: number | null = null;
  if (!f.timeUnknown) {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(f.time.trim());
    if (!f.time.trim()) errors.time = t('form.errors.birthTimeRequired');
    else if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) errors.time = t('form.errors.birthTimeFormat');
    else {
      hour = Number(m[1]);
      minute = Number(m[2]);
    }
  }
  if (!f.gender) errors.gender = t('form.errors.genderRequired');
  if (Object.keys(errors).length > 0) return { errors, dto: null };

  const city = cityById(f.cityId);
  return {
    errors,
    dto: {
      calendar: f.calendar,
      year,
      month,
      day,
      isLeapMonth: f.calendar === 'lunar' ? f.isLeapMonth : false,
      hour,
      minute,
      gender: f.gender as 'male' | 'female',
      timeZone: city.timeZone,
      longitude: city.longitude,
      timeCorrection: f.timeCorrection,
      ziHourRule: f.ziHourRule,
    },
  };
}

export const requiredProgress = (f: BirthFormState) =>
  [f.date.replace(/\D/g, '').length === 8, f.timeUnknown || /^\d{2}:\d{2}$/.test(f.time), f.gender !== '', Boolean(f.cityId)].filter(Boolean).length;

export function profileToForm(p: ProfileDto): BirthFormState {
  const b = p.birth;
  const city = cityByLongitude(b.longitude, b.timeZone);
  return {
    name: p.name,
    calendar: b.calendar,
    isLeapMonth: b.isLeapMonth,
    date: `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`,
    time: b.hour === null ? '' : `${String(b.hour).padStart(2, '0')}:${String(b.minute ?? 0).padStart(2, '0')}`,
    timeUnknown: b.hour === null,
    gender: b.gender,
    cityId: city?.id ?? 'seoul',
    timeCorrection: b.timeCorrection,
    ziHourRule: b.ziHourRule,
  };
}

/** 현재 세션의 입력(비회원 흐름) — 저장소에 보관해 새로고침에도 유지 */
export interface BirthDraft {
  form: BirthFormState;
  dto: BirthInputDto;
}
