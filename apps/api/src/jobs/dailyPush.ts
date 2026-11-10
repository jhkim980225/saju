/**
 * "오늘의 운세" 아침 푸시 — 매일 08:00 KST 에 대표 프로필 기준 오늘의 한 줄을 발송한다.
 * Worker 예약 실행(wrangler.jsonc triggers.crons "0 23 * * *" = 08:00 KST)이 src/worker.ts 의 scheduled 에서 부른다.
 */
import { utcToZoned } from '@saju/core';
import { buildDailyFortune } from '../modules/interpretation/reading.js';
import { displayName } from '../modules/interpretation/content/plain.js';
import type { Services } from '../services.js';

export async function runDailyPush(services: Services) {
  const t = utcToZoned(Date.now(), 'Asia/Seoul');
  const date = { year: t.year, month: t.month, day: t.day };
  const result = await services.push.sendDailyFortuneDigest(async (userId) => {
    const profile = await services.profiles.primary(userId);
    if (!profile) return null;
    const daily = buildDailyFortune(services.profiles.chartOf(profile), date, profile.id);
    const name = displayName(profile.name);
    return {
      title: '오늘의 한 줄이 도착했어요',
      body: name ? `${name}님, ${daily.headline}` : daily.headline,
      link: '/today',
      data: { kind: 'daily', profileId: profile.id },
    };
  });
  console.info('[push] 오늘의 운세 푸시 발송 완료', result);
  return result;
}
