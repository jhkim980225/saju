/**
 * "오늘의 운세" 아침 푸시 스케줄러 — 매일 08:00 KST 에 대표 프로필 기준 오늘의 한 줄을 발송한다.
 * 외부 크론 없이 단일 인스턴스에서 setTimeout 으로 동작한다. 여러 인스턴스로 확장할 때는
 * DAILY_PUSH_ENABLED 를 한 인스턴스에만 켜거나 외부 스케줄러(Cloud Scheduler 등)로 POST /internal 엔드포인트를 호출하도록 바꾼다.
 */
import { utcToZoned } from '@saju/core';
import type { FastifyBaseLogger } from 'fastify';
import { buildDailyFortune } from '../modules/interpretation/reading.js';
import { displayName } from '../modules/interpretation/content/plain.js';
import type { Services } from '../services.js';

const HOUR_KST = 8;

/** 다음 08:00 KST 까지 남은 ms */
export function msUntilNextRun(now = Date.now(), hourKst = HOUR_KST): number {
  const kstNow = now + 9 * 3_600_000;
  const d = new Date(kstNow);
  let target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourKst) - 9 * 3_600_000;
  if (target <= now) target += 86_400_000;
  return target - now;
}

export async function runDailyPush(services: Services, log?: FastifyBaseLogger) {
  const t = utcToZoned(Date.now(), 'Asia/Seoul');
  const date = { year: t.year, month: t.month, day: t.day };
  const result = await services.push.sendDailyFortuneDigest((userId) => {
    const profile = services.profiles.primary(userId);
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
  log?.info({ result }, '오늘의 운세 푸시 발송 완료');
  return result;
}

export function scheduleDailyPush(services: Services, log: FastifyBaseLogger): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const plan = () => {
    timer = setTimeout(async () => {
      try {
        await runDailyPush(services, log);
      } catch (e) {
        log.error(e, '오늘의 운세 푸시 발송 실패');
      }
      plan();
    }, msUntilNextRun());
    timer.unref?.();
  };
  plan();
  return () => clearTimeout(timer);
}
