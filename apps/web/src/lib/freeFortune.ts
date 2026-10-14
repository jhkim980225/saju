/**
 * 띠별·별자리 운세 화면 공용 — URL, 기간 이름, 내 띠·내 별자리 찾기.
 */
import { useQuery } from '@tanstack/react-query';
import {
  FREE_FORTUNE_PERIODS,
  ZODIAC_ANIMALS,
  starSignOfBirthday,
  zodiacAnimalByName,
  type FreeFortunePeriod,
  type ProfileDto,
  type StarSign,
  type ZodiacAnimal,
} from '@saju/shared';
import { useProfiles } from '@/hooks/queries';
import { api } from './api';
import type { BirthDraft } from './birth';
import { useSession } from './session';
import { STORAGE_KEYS, storage } from './storage';

export const zodiacPath = (slug: string, period: FreeFortunePeriod = 'today') => `/zodiac/${slug}/${period}`;
export const horoscopePath = (slug: string, period: FreeFortunePeriod = 'today') => `/horoscope/${slug}/${period}`;

export function parsePeriod(p: string | undefined): FreeFortunePeriod | null {
  return (FREE_FORTUNE_PERIODS as readonly string[]).includes(p ?? '') ? (p as FreeFortunePeriod) : null;
}

/** 제목용 기간 이름 — '호랑이띠 오늘의 운세' */
export const PERIOD_TITLE: Record<FreeFortunePeriod, string> = {
  today: '오늘의 운세',
  tomorrow: '내일의 운세',
  week: '이번 주 운세',
  month: '이번 달 운세',
  year: '올해 운세',
};

/** 태어난 해(입춘 이후 출생 기준) → 띠 */
export function animalOfYear(year: number): ZodiacAnimal {
  return ZODIAC_ANIMALS[(((year - 4) % 12) + 12) % 12]!;
}

/** 띠의 출생 연도(기준 연도에서 7~90세) — 설명 문구용 */
export function birthYearsOf(animal: ZodiacAnimal, refYear: number): number[] {
  const out: number[] = [];
  for (let y = refYear - 90; y <= refYear - 7; y++) if (animalOfYear(y).slug === animal.slug) out.push(y);
  return out;
}

/** 양력 생일이 바로 보이는 프로필이면 별자리, 음력이면 null(양력 변환이 필요) */
export function signOfSolarBirth(birth: { calendar: 'solar' | 'lunar'; month: number; day: number }): StarSign | null {
  return birth.calendar === 'solar' ? (starSignOfBirthday(birth.month, birth.day)?.sign ?? null) : null;
}

export function pickProfile(list: ProfileDto[]): ProfileDto | undefined {
  const activeId = storage.get(STORAGE_KEYS.activeProfile);
  return list.find((p) => p.id === activeId) ?? list.find((p) => p.isPrimary) ?? list[0];
}

/**
 * 내 띠·내 별자리 — 저장한 사주(대표·선택 프로필)가 있으면 그것으로, 없으면 이 기기에 입력해 둔 생년월일로.
 * 띠는 사주와 같은 입춘 기준(프로필의 zodiac), 별자리는 양력 생일 기준(음력이면 서버에서 양력으로 바꾼 날짜).
 */
export function useOwnSigns(): { animal: ZodiacAnimal | null; sign: StarSign | null; name: string | null; loading: boolean } {
  const token = useSession((s) => s.accessToken);
  const profiles = useProfiles();
  const profile = pickProfile(profiles.data ?? []);
  const draft = profile || (token && !profiles.isFetched) ? null : storage.getJSON<BirthDraft>(STORAGE_KEYS.birthDraft);

  // 음력 프로필·입력해 둔 생년월일은 원국 계산으로 양력 날짜와 입춘 기준 띠를 얻는다
  const needChart = Boolean((profile && profile.birth.calendar === 'lunar') || (!profile && draft));
  const chart = useQuery({
    queryKey: ['ownChart', profile?.id ?? 'draft', draft ? JSON.stringify(draft.dto) : null],
    queryFn: () => api.chart(profile ? { profileId: profile.id } : { birth: draft!.dto }),
    enabled: needChart,
    staleTime: Infinity,
    retry: false,
  });

  const animal = zodiacAnimalByName(profile?.zodiac ?? chart.data?.zodiac.animal);
  const solar = profile && profile.birth.calendar === 'solar' ? profile.birth : chart.data?.solarDate;
  const sign = solar ? (starSignOfBirthday(solar.month, solar.day)?.sign ?? null) : null;
  return {
    animal,
    sign,
    name: profile?.name ?? draft?.form.name ?? null,
    loading: (Boolean(token) && profiles.isLoading) || (needChart && chart.isLoading),
  };
}
