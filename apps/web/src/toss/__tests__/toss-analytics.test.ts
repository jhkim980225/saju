/**
 * 토스 분석 이벤트 — 공용 track() 이벤트를 앱인토스 Analytics.log 이벤트로 바꾼다.
 * 이벤트 이름은 콘솔의 전환 지표(toss/daldal-saju/store/listing.md ⑧)에 등록하는 이름이라 바뀌면 안 된다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.fn(async (_p: unknown) => undefined);
vi.mock('@apps-in-toss/web-framework', () => ({ Analytics: { log: (p: unknown) => log(p) } }));

import { TOSS_EVENTS, toTossEvent, track } from '../replace/analytics';

beforeEach(() => log.mockClear());

describe('토스 분석 이벤트', () => {
  it('전환 지표로 등록하는 이벤트 이름이 고정돼 있다', () => {
    expect(TOSS_EVENTS).toEqual({
      birthSubmit: 'birth_submit',
      sajuResultView: 'saju_result_view',
      dailyFortuneView: 'daily_fortune_view',
      compatibilityView: 'compatibility_view',
      paywallView: 'paywall_view',
      checkoutStart: 'checkout_start',
      purchaseComplete: 'purchase_complete',
      share: 'share',
    });
  });

  it('핵심 행동을 토스 이벤트로 바꾼다', () => {
    expect(toTossEvent('reading_viewed', { locked: true })).toEqual({ log_name: 'saju_result_view', params: { locked: true } });
    expect(toTossEvent('daily_viewed', { grade: 'good' })).toEqual({ log_name: 'daily_fortune_view', params: { grade: 'good' } });
    expect(toTossEvent('purchase', { product: 'report_saju_lifetime', price: 9900, channel: 'iap' })).toEqual({ log_name: 'purchase_complete', params: { product: 'report_saju_lifetime', price: 9900 } });
    expect(toTossEvent('checkout_started', { product: 'report_compat', price: 5940 })?.log_name).toBe('checkout_start');
    expect(toTossEvent('share', { channel: 'copy_link' })).toEqual({ log_name: 'share', params: { channel: 'copy_link' } });
  });

  it('화면 이동(SDK 가 자동 기록)과 토스 첫 버전에 없는 기능의 이벤트는 보내지 않는다', () => {
    for (const e of ['page_view', 'signup', 'login', 'chat_sent', 'tarot_drawn', 'tarot_daily_drawn', 'tarot_result_viewed'] as const) expect(toTossEvent(e, { path: '/today' })).toBeNull();
    track('page_view', { path: '/today' });
    expect(log).not.toHaveBeenCalled();
  });

  it('정해 둔 값만 보낸다 — 프로필·주문 같은 값이 섞여 와도 넘기지 않는다', () => {
    expect(toTossEvent('purchase', { product: 'report_love', price: 4950, orderId: 'o1', profileId: 'p1', name: '서윤' } as never)?.params).toEqual({ product: 'report_love', price: 4950 });
    expect(toTossEvent('compatibility_viewed', { score: 82 })?.params).toEqual({});
  });

  it('track 은 Analytics.log 를 event 유형으로 부르고, 실패해도 예외를 내지 않는다', async () => {
    track('reading_viewed', { locked: false });
    expect(log).toHaveBeenCalledWith({ log_name: 'saju_result_view', log_type: 'event', params: { locked: false } });
    log.mockRejectedValueOnce(new Error('unsupported'));
    expect(() => track('daily_viewed', { grade: 'good' })).not.toThrow();
    log.mockImplementationOnce(() => {
      throw new Error('sync');
    });
    expect(() => track('daily_viewed', { grade: 'good' })).not.toThrow();
    await Promise.resolve();
  });
});
