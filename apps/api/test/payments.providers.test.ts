/**
 * 결제 어댑터(토스 / 포트원 / Apple / Google) 단위 테스트 — 외부 호출은 모두 globalThis.fetch 모킹.
 */
import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, importPKCS8, importSPKI, jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { AppError } from '../src/lib/errors.js';
import { createAppleIapVerifier, createGoogleIapVerifier, GOOGLE_TOKEN_URL } from '../src/modules/commerce/providers/iap.js';
import { createPortOneGateway } from '../src/modules/commerce/providers/portone.js';
import { createTossGateway } from '../src/modules/commerce/providers/toss.js';
import { GatewayError } from '../src/modules/commerce/providers/types.js';

const cfg = (env: Record<string, string> = {}) => loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', ...env });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: Mock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (i: number) => {
  const c = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url: c[0], init: c[1], headers: c[1].headers as Record<string, string>, body: c[1].body as string | undefined };
};
const caught = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('예외가 발생하지 않았어요');
};

// ── 토스페이먼츠 ─────────────────────────────────────────────

describe('토스페이먼츠', () => {
  const tossConfig = () => cfg({ TOSS_CLIENT_KEY: 'test_ck_x', TOSS_SECRET_KEY: 'test_sk_x' });
  const donePayment = {
    paymentKey: 'pk_123',
    orderId: 'ORD-1',
    status: 'DONE',
    totalAmount: 9900,
    method: '간편결제',
    easyPay: { provider: '토스페이' },
    approvedAt: '2026-10-12T10:00:00+09:00',
    lastTransactionKey: 'tx_1',
  };

  it('키가 없으면 NOT_CONFIGURED(501), 웹훅은 null', async () => {
    const gw = createTossGateway(cfg({ TOSS_CLIENT_KEY: '', TOSS_SECRET_KEY: '' }));
    expect(gw.isConfigured()).toBe(false);
    const e = await caught(gw.confirm({ orderId: 'ORD-1', amount: 1000, paymentKey: 'pk' }));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).statusCode).toBe(501);
    expect(await gw.parseWebhook({ headers: {}, rawBody: '{"data":{"paymentKey":"pk"}}' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('승인 성공 — Basic 인증·본문·멱등 키 전송, 금액/수단/승인시각 매핑', async () => {
    fetchMock.mockResolvedValueOnce(json(donePayment));
    const r = await createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' });

    const { url, init, headers, body } = call(0);
    expect(url).toBe('https://api.tosspayments.com/v1/payments/confirm');
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('test_sk_x:').toString('base64')}`);
    expect(headers['Idempotency-Key']).toMatch(/^confirm-[0-9a-f]{64}$/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(body!)).toEqual({ paymentKey: 'pk_123', orderId: 'ORD-1', amount: 9900 });

    expect(r.paymentKey).toBe('pk_123');
    expect(r.totalAmount).toBe(9900);
    expect(r.method).toBe('간편결제(토스페이)');
    expect(r.approvedAt).toBe(Date.parse('2026-10-12T10:00:00+09:00'));
  });

  it('결제사가 확인한 금액(totalAmount)을 그대로 돌려준다 — 서비스가 주문 금액과 대조', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...donePayment, totalAmount: 100, method: '카드' }));
    const r = await createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' });
    expect(r.totalAmount).toBe(100);
    expect(r.method).toBe('카드');
  });

  it('승인 실패 — 토스 오류 {code, message} 를 GatewayError 로 변환', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'REJECT_CARD_PAYMENT', message: '한도초과 혹은 잔액부족으로 결제에 실패했습니다.' }, 403));
    const e = await caught(createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' }));
    expect(e).toBeInstanceOf(GatewayError);
    expect((e as GatewayError).code).toBe('REJECT_CARD_PAYMENT');
    expect((e as GatewayError).message).toBe('한도초과 혹은 잔액부족으로 결제에 실패했습니다.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('JSON 이 아닌 오류 응답은 HTTP 상태로 코드 생성', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));
    const e = (await caught(createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' }))) as GatewayError;
    expect(e.code).toBe('HTTP_502');
  });

  it('타임아웃/네트워크 오류 → 재조회도 실패하면 NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const e = (await caught(createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' }))) as GatewayError;
    expect(e).toBeInstanceOf(GatewayError);
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.message).toContain('결제사와 통신에 실패했어요');
  });

  it('응답 유실(타임아웃) 후 재조회에서 승인 완료면 성공 처리', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    fetchMock.mockResolvedValueOnce(json(donePayment));
    const r = await createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' });
    expect(r.totalAmount).toBe(9900);
    expect(call(1).url).toBe('https://api.tosspayments.com/v1/payments/pk_123');
    expect(call(1).init.method).toBe('GET');
  });

  it('ALREADY_PROCESSED_PAYMENT 인데 다른 주문의 결제면 실패 유지', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'ALREADY_PROCESSED_PAYMENT', message: '이미 처리된 결제 입니다.' }, 400));
    fetchMock.mockResolvedValueOnce(json({ ...donePayment, orderId: 'ORD-OTHER' }));
    const e = (await caught(createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' }))) as GatewayError;
    expect(e.code).toBe('ALREADY_PROCESSED_PAYMENT');
  });

  it('가상계좌(입금 대기)는 발급 취소 후 PAYMENT_NOT_DONE', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...donePayment, status: 'WAITING_FOR_DEPOSIT', method: '가상계좌' }));
    fetchMock.mockResolvedValueOnce(json({ ...donePayment, status: 'CANCELED' }));
    const e = (await caught(createTossGateway(tossConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pk_123' }))) as GatewayError;
    expect(e.code).toBe('PAYMENT_NOT_DONE');
    expect(call(1).url).toBe('https://api.tosspayments.com/v1/payments/pk_123/cancel');
  });

  it('취소 — cancelReason/cancelAmount + Idempotency-Key, 이미 취소된 결제는 성공 처리', async () => {
    const gw = createTossGateway(tossConfig());
    fetchMock.mockResolvedValueOnce(json({ ...donePayment, status: 'PARTIAL_CANCELED' }));
    await gw.cancel({ paymentKey: 'pk_123', reason: '고객 요청', amount: 1000 });
    expect(call(0).url).toBe('https://api.tosspayments.com/v1/payments/pk_123/cancel');
    expect(JSON.parse(call(0).body!)).toEqual({ cancelReason: '고객 요청', cancelAmount: 1000 });
    expect(call(0).headers['Idempotency-Key']).toMatch(/^cancel-[0-9a-f]{64}$/);

    fetchMock.mockResolvedValueOnce(json({ code: 'ALREADY_CANCELED_PAYMENT', message: '이미 취소된 결제 입니다.' }, 400));
    await expect(gw.cancel({ paymentKey: 'pk_123', reason: '재시도' })).resolves.toBeUndefined();
    expect(JSON.parse(call(1).body!)).toEqual({ cancelReason: '재시도' });
  });

  it('웹훅 — 본문 상태를 믿지 않고 결제 조회 API 로 재조회해 상태 결정', async () => {
    // 본문은 DONE 이라고 주장하지만 실제 결제는 취소된 상태
    const rawBody = JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-10-12T10:00:00.000000', data: { ...donePayment } });
    fetchMock.mockResolvedValueOnce(json({ ...donePayment, status: 'CANCELED', lastTransactionKey: 'tx_cancel' }));
    const ev = await createTossGateway(tossConfig()).parseWebhook({ headers: {}, rawBody });

    expect(call(0).url).toBe('https://api.tosspayments.com/v1/payments/pk_123');
    expect(call(0).init.method).toBe('GET');
    expect(ev).toMatchObject({ type: 'PAYMENT_STATUS_CHANGED', orderId: 'ORD-1', paymentKey: 'pk_123', status: 'canceled' });
    expect(ev!.id).toBe('pk_123:CANCELED:tx_cancel');
  });

  it('웹훅 — 상태 매핑 DONE→paid, ABORTED/EXPIRED→failed', async () => {
    const gw = createTossGateway(tossConfig());
    const rawBody = JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: 'pk_123', orderId: 'ORD-1' } });
    for (const [status, expected] of [['DONE', 'paid'], ['PARTIAL_CANCELED', 'canceled'], ['ABORTED', 'failed'], ['EXPIRED', 'failed'], ['IN_PROGRESS', 'other']]) {
      fetchMock.mockResolvedValueOnce(json({ ...donePayment, status }));
      expect((await gw.parseWebhook({ headers: {}, rawBody }))!.status).toBe(expected);
    }
  });

  it('웹훅 — 존재하지 않는 결제(404)·주문 불일치는 null(검증 실패)', async () => {
    const gw = createTossGateway(tossConfig());
    fetchMock.mockResolvedValueOnce(json({ code: 'NOT_FOUND_PAYMENT', message: '존재하지 않는 결제 정보 입니다.' }, 404));
    expect(await gw.parseWebhook({ headers: {}, rawBody: JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: 'forged' } }) })).toBeNull();

    fetchMock.mockResolvedValueOnce(json(donePayment));
    expect(await gw.parseWebhook({ headers: {}, rawBody: JSON.stringify({ data: { paymentKey: 'pk_123', orderId: 'ORD-VICTIM' } }) })).toBeNull();

    expect(await gw.parseWebhook({ headers: {}, rawBody: 'not-json' })).toBeNull();
  });

  it('웹훅 — DEPOSIT_CALLBACK 은 orderId 로 재조회하고 secret 을 대조', async () => {
    const gw = createTossGateway(tossConfig());
    const deposit = { createdAt: '2026-10-12T10:00:00.000000', secret: 'sec_ok', status: 'DONE', transactionKey: 'tx_dep', orderId: 'ORD-1' };
    fetchMock.mockResolvedValueOnce(json({ ...donePayment, secret: 'sec_ok' }));
    const ev = await gw.parseWebhook({ headers: {}, rawBody: JSON.stringify(deposit) });
    expect(call(0).url).toBe('https://api.tosspayments.com/v1/payments/orders/ORD-1');
    expect(ev).toMatchObject({ type: 'DEPOSIT_CALLBACK', status: 'paid', orderId: 'ORD-1' });
    expect(JSON.stringify(ev!.raw)).not.toContain('sec_ok');

    fetchMock.mockResolvedValueOnce(json({ ...donePayment, secret: 'sec_real' }));
    expect(await gw.parseWebhook({ headers: {}, rawBody: JSON.stringify({ ...deposit, secret: 'sec_forged' }) })).toBeNull();
  });
});

// ── 포트원 V2 ────────────────────────────────────────────────

describe('포트원 V2', () => {
  const webhookSecret = `whsec_${randomBytes(24).toString('base64')}`;
  const portoneConfig = (extra: Record<string, string> = {}) =>
    cfg({ PORTONE_STORE_ID: 'store-x', PORTONE_CHANNEL_KEY: 'channel-key-x', PORTONE_API_SECRET: 'api_secret_x', PORTONE_WEBHOOK_SECRET: webhookSecret, ...extra });
  const paid = {
    status: 'PAID',
    id: 'ORD-1',
    transactionId: 'tx-1',
    method: { type: 'PaymentMethodEasyPay', provider: 'KAKAOPAY' },
    amount: { total: 9900, paid: 9900, cancelled: 0 },
    paidAt: '2026-10-12T01:00:00Z',
  };
  const sign = (body: string, opts: { id?: string; ts?: number; secret?: string } = {}) => {
    const id = opts.id ?? 'msg_1';
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const key = Buffer.from((opts.secret ?? webhookSecret).replace(/^whsec_/, ''), 'base64');
    const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
    return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
  };
  const webhookBody = JSON.stringify({ type: 'Transaction.Paid', timestamp: '2026-10-12T01:00:00Z', data: { paymentId: 'ORD-1', transactionId: 'tx-1', storeId: 'store-x' } });

  it('키가 없으면 NOT_CONFIGURED', async () => {
    const gw = createPortOneGateway(cfg({ PORTONE_STORE_ID: '', PORTONE_CHANNEL_KEY: '', PORTONE_API_SECRET: '' }));
    expect((await caught(gw.confirm({ orderId: 'ORD-1', amount: 1, paymentKey: 'ORD-1' }))) as AppError).toMatchObject({ statusCode: 501 });
  });

  it('승인 — 결제 단건 조회로 PAID·금액 검증, PortOne 인증 헤더', async () => {
    fetchMock.mockResolvedValueOnce(json(paid));
    const r = await createPortOneGateway(portoneConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'ORD-1' });
    expect(call(0).url).toBe('https://api.portone.io/payments/ORD-1?storeId=store-x');
    expect(call(0).init.method).toBe('GET');
    expect(call(0).headers.Authorization).toBe('PortOne api_secret_x');
    expect(r).toMatchObject({ paymentKey: 'ORD-1', totalAmount: 9900, method: '간편결제(KAKAOPAY)', approvedAt: Date.parse('2026-10-12T01:00:00Z') });
  });

  it('승인 — paymentKey 가 없으면 orderId 를 paymentId 로 사용, customData 주문 ID 도 허용', async () => {
    fetchMock.mockResolvedValueOnce(json(paid));
    await createPortOneGateway(portoneConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: '' });
    expect(call(0).url).toBe('https://api.portone.io/payments/ORD-1?storeId=store-x');

    fetchMock.mockResolvedValueOnce(json({ ...paid, id: 'pay-abc', customData: JSON.stringify({ orderId: 'ORD-1' }) }));
    await expect(createPortOneGateway(portoneConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'pay-abc' })).resolves.toMatchObject({ paymentKey: 'pay-abc' });
  });

  it('승인 — 다른 주문의 결제건 재사용은 ORDER_MISMATCH', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...paid, id: 'ORD-OTHER' }));
    const e = (await caught(createPortOneGateway(portoneConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'ORD-OTHER' }))) as GatewayError;
    expect(e.code).toBe('ORDER_MISMATCH');
  });

  it('승인 — 미완료/실패 상태 매핑', async () => {
    const gw = createPortOneGateway(portoneConfig());
    fetchMock.mockResolvedValueOnce(json({ ...paid, status: 'READY' }));
    expect(((await caught(gw.confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'ORD-1' }))) as GatewayError).code).toBe('PAYMENT_NOT_DONE');

    fetchMock.mockResolvedValueOnce(json({ ...paid, status: 'FAILED', failure: { reason: 'PG 거절', pgCode: '8326', pgMessage: '한도초과' } }));
    const e = (await caught(gw.confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'ORD-1' }))) as GatewayError;
    expect(e).toMatchObject({ code: '8326', message: '한도초과' });

    fetchMock.mockResolvedValueOnce(json({ type: 'PAYMENT_NOT_FOUND', message: '결제 건이 존재하지 않습니다.' }, 404));
    expect(((await caught(gw.confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'ORD-1' }))) as GatewayError).code).toBe('PAYMENT_NOT_FOUND');
  });

  it('승인 — 금액 불일치면 즉시 취소하고 AMOUNT_MISMATCH', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...paid, amount: { total: 100 } }));
    fetchMock.mockResolvedValueOnce(json({ cancellation: { status: 'SUCCEEDED' } }));
    const e = (await caught(createPortOneGateway(portoneConfig()).confirm({ orderId: 'ORD-1', amount: 9900, paymentKey: 'ORD-1' }))) as GatewayError;
    expect(e.code).toBe('AMOUNT_MISMATCH');
    expect(call(1).url).toBe('https://api.portone.io/payments/ORD-1/cancel');
    expect(JSON.parse(call(1).body!)).toEqual({ reason: '결제 금액 불일치', storeId: 'store-x' });
  });

  it('취소 — reason/amount 전송, 이미 취소된 결제는 성공 처리', async () => {
    const gw = createPortOneGateway(portoneConfig());
    fetchMock.mockResolvedValueOnce(json({ cancellation: { status: 'SUCCEEDED' } }));
    await gw.cancel({ paymentKey: 'ORD-1', reason: '고객 요청', amount: 500 });
    expect(JSON.parse(call(0).body!)).toEqual({ reason: '고객 요청', storeId: 'store-x', amount: 500 });

    fetchMock.mockResolvedValueOnce(json({ type: 'PAYMENT_ALREADY_CANCELLED', message: '이미 취소된 결제입니다.' }, 409));
    await expect(gw.cancel({ paymentKey: 'ORD-1', reason: '재시도' })).resolves.toBeUndefined();
  });

  it('웹훅 — 정상 서명이면 결제를 재조회해 상태 결정, id 는 webhook-id', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...paid, status: 'CANCELLED' }));
    const ev = await createPortOneGateway(portoneConfig()).parseWebhook({ headers: sign(webhookBody), rawBody: webhookBody });
    expect(call(0).url).toBe('https://api.portone.io/payments/ORD-1?storeId=store-x');
    expect(ev).toMatchObject({ id: 'msg_1', type: 'Transaction.Paid', orderId: 'ORD-1', paymentKey: 'ORD-1', status: 'canceled' });
  });

  it('웹훅 — 키 교체 기간의 복수 서명 중 하나만 맞아도 통과', async () => {
    fetchMock.mockResolvedValueOnce(json(paid));
    const h = sign(webhookBody);
    h['webhook-signature'] = `v1,${randomBytes(32).toString('base64')} ${h['webhook-signature']}`;
    expect((await createPortOneGateway(portoneConfig()).parseWebhook({ headers: h, rawBody: webhookBody }))!.status).toBe('paid');
  });

  it('웹훅 — 위조(다른 시크릿 / 본문 변조 / 헤더 누락)는 null 이고 재조회하지 않는다', async () => {
    const gw = createPortOneGateway(portoneConfig());
    const otherSecret = `whsec_${randomBytes(24).toString('base64')}`;
    expect(await gw.parseWebhook({ headers: sign(webhookBody, { secret: otherSecret }), rawBody: webhookBody })).toBeNull();
    expect(await gw.parseWebhook({ headers: sign(webhookBody), rawBody: webhookBody.replace('ORD-1', 'ORD-2') })).toBeNull();
    expect(await gw.parseWebhook({ headers: { 'webhook-id': 'msg_1' }, rawBody: webhookBody })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('웹훅 — 타임스탬프가 5분을 넘으면(과거·미래) null', async () => {
    const gw = createPortOneGateway(portoneConfig());
    const now = Math.floor(Date.now() / 1000);
    expect(await gw.parseWebhook({ headers: sign(webhookBody, { ts: now - 301 }), rawBody: webhookBody })).toBeNull();
    expect(await gw.parseWebhook({ headers: sign(webhookBody, { ts: now + 301 }), rawBody: webhookBody })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json(paid));
    expect(await gw.parseWebhook({ headers: sign(webhookBody, { ts: now - 290 }), rawBody: webhookBody })).not.toBeNull();
  });

  it('웹훅 — 시크릿 미설정이면 null', async () => {
    const gw = createPortOneGateway(portoneConfig({ PORTONE_WEBHOOK_SECRET: '' }));
    expect(await gw.parseWebhook({ headers: sign(webhookBody), rawBody: webhookBody })).toBeNull();
  });

  it('웹훅 — 결제 외 이벤트(paymentId 없음)는 재조회 없이 other', async () => {
    const body = JSON.stringify({ type: 'BillingKey.Issued', timestamp: '2026-10-12T01:00:00Z', data: { billingKey: 'bk' } });
    const ev = await createPortOneGateway(portoneConfig()).parseWebhook({ headers: sign(body, { id: 'msg_2' }), rawBody: body });
    expect(ev).toMatchObject({ id: 'msg_2', status: 'other', orderId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Apple App Store ──────────────────────────────────────────

describe('Apple App Store Server API', () => {
  const ec = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const BUNDLE = 'kr.example.saju';
  const appleConfig = () =>
    cfg({
      APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
      APPLE_IAP_KEY_ID: 'ABC123DEFG',
      // env 에는 줄바꿈이 \n 으로 이스케이프되어 들어오는 경우가 많다
      APPLE_IAP_PRIVATE_KEY: ec.privateKey.replace(/\n/g, '\\n'),
      APPLE_BUNDLE_ID: BUNDLE,
    });
  /** Apple 이 서명한 것처럼 만든 JWSTransaction (테스트 키로 서명) */
  const signedTx = async (claims: Record<string, unknown> = {}) =>
    new SignJWT({
      transactionId: '2000000123456789',
      originalTransactionId: '2000000123456789',
      bundleId: BUNDLE,
      productId: `${BUNDLE}.chat_pack_10`,
      purchaseDate: 1760230800000,
      type: 'Consumable',
      environment: 'Production',
      ...claims,
    })
      .setProtectedHeader({ alg: 'ES256', x5c: ['MIIB-test'] })
      .sign(await importPKCS8(ec.privateKey, 'ES256'));

  it('키가 없으면 NOT_CONFIGURED', async () => {
    const v = createAppleIapVerifier(cfg({ APPLE_IAP_ISSUER_ID: '', APPLE_IAP_KEY_ID: '', APPLE_IAP_PRIVATE_KEY: '', APPLE_BUNDLE_ID: '' }));
    expect(v.isConfigured()).toBe(false);
    expect((await caught(v.verify({ productId: 'x', receipt: '1' }))) as AppError).toMatchObject({ statusCode: 501 });
  });

  it('검증 성공 — ES256 인증 JWT(kid/iss/aud/bid/exp) 서명, signedTransactionInfo 디코드', async () => {
    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx() }));
    const r = await createAppleIapVerifier(appleConfig()).verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: '2000000123456789' });

    expect(call(0).url).toBe('https://api.storekit.itunes.apple.com/inApps/v1/transactions/2000000123456789');
    const jwt = call(0).headers.Authorization!.replace(/^Bearer /, '');
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
    const { payload } = await jwtVerify(jwt, await importSPKI(ec.publicKey, 'ES256'), { audience: 'appstoreconnect-v1', issuer: '57246542-96fe-1a63-e053-0824d011072a' });
    expect(payload.bid).toBe(BUNDLE);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(3600);

    expect(r).toMatchObject({ transactionId: '2000000123456789', productId: `${BUNDLE}.chat_pack_10`, purchasedAt: 1760230800000 });
    expect(r.raw).toMatchObject({ environment: 'Production' });
  });

  it('운영에서 404 면 샌드박스로 재시도', async () => {
    fetchMock.mockResolvedValueOnce(json({ errorCode: 4040010, errorMessage: 'Transaction id not found.' }, 404));
    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx({ environment: 'Sandbox' }) }));
    const r = await createAppleIapVerifier(appleConfig()).verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: '2000000123456789' });
    expect(call(1).url).toBe('https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/2000000123456789');
    expect(r.raw).toMatchObject({ environment: 'Sandbox' });
  });

  it('양쪽 모두 404 면 TRANSACTION_NOT_FOUND', async () => {
    fetchMock.mockImplementation(async () => json({ errorCode: 4040010, errorMessage: 'Transaction id not found.' }, 404));
    const e = (await caught(createAppleIapVerifier(appleConfig()).verify({ productId: 'p', receipt: '1' }))) as GatewayError;
    expect(e.code).toBe('TRANSACTION_NOT_FOUND');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bundleId 불일치 → BUNDLE_MISMATCH, productId 불일치 → PRODUCT_MISMATCH, 환불됨 → REVOKED', async () => {
    const v = createAppleIapVerifier(appleConfig());
    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx({ bundleId: 'com.attacker.app' }) }));
    expect(((await caught(v.verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: '2000000123456789' }))) as GatewayError).code).toBe('BUNDLE_MISMATCH');

    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx({ productId: `${BUNDLE}.report_saju_mini` }) }));
    expect(((await caught(v.verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: '2000000123456789' }))) as GatewayError).code).toBe('PRODUCT_MISMATCH');

    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx({ revocationDate: 1760230900000, revocationReason: 0 }) }));
    expect(((await caught(v.verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: '2000000123456789' }))) as GatewayError).code).toBe('REVOKED');
  });

  it('receipt 로 signedTransaction(JWS) 을 보내도 transactionId 를 꺼내 서버 API 로 재검증', async () => {
    const clientJws = await signedTx({ transactionId: '2000000999' });
    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx({ transactionId: '2000000999' }) }));
    const r = await createAppleIapVerifier(appleConfig()).verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: clientJws });
    expect(call(0).url).toBe('https://api.storekit.itunes.apple.com/inApps/v1/transactions/2000000999');
    expect(r.transactionId).toBe('2000000999');
  });

  it('형식이 맞지 않는 영수증은 호출 없이 INVALID_RECEIPT', async () => {
    const e = (await caught(createAppleIapVerifier(appleConfig()).verify({ productId: 'p', receipt: '../../etc/passwd' }))) as GatewayError;
    expect(e.code).toBe('INVALID_RECEIPT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('인증 JWT 는 재사용(캐시)한다', async () => {
    const v = createAppleIapVerifier(appleConfig());
    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx() }));
    fetchMock.mockResolvedValueOnce(json({ signedTransactionInfo: await signedTx() }));
    await v.verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: '2000000123456789' });
    await v.verify({ productId: `${BUNDLE}.chat_pack_10`, receipt: '2000000123456789' });
    expect(call(0).headers.Authorization).toBe(call(1).headers.Authorization);
  });
});

// ── Google Play ──────────────────────────────────────────────

describe('Google Play Developer API', () => {
  const rsa = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const serviceAccount = {
    type: 'service_account',
    project_id: 'saju-test',
    private_key_id: 'key-1',
    private_key: rsa.privateKey,
    client_email: 'play-verifier@saju-test.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token',
  };
  const googleConfig = () => cfg({ GOOGLE_PLAY_PACKAGE_NAME: 'kr.example.saju', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) });
  const purchase = { kind: 'androidpublisher#productPurchase', purchaseTimeMillis: '1760230800000', purchaseState: 0, consumptionState: 0, orderId: 'GPA.3333-4444-5555-66666', acknowledgementState: 0, regionCode: 'KR' };
  const PRODUCT_URL = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/kr.example.saju/purchases/products/chat_pack_10/tokens/tok_abc';

  it('키가 없으면 NOT_CONFIGURED', async () => {
    const v = createGoogleIapVerifier(cfg({ GOOGLE_PLAY_PACKAGE_NAME: '', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '' }));
    expect((await caught(v.verify({ productId: 'x', receipt: 't' }))) as AppError).toMatchObject({ statusCode: 501 });
  });

  it('서비스 계정 JWT(RS256)로 토큰 발급 → 구매 조회, orderId 를 transactionId 로', async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: 'ya29.test-token', expires_in: 3599, token_type: 'Bearer' }));
    fetchMock.mockResolvedValueOnce(json(purchase));
    const r = await createGoogleIapVerifier(googleConfig()).verify({ productId: 'chat_pack_10', receipt: 'tok_abc' });

    // 1) 토큰 발급
    expect(call(0).url).toBe(GOOGLE_TOKEN_URL);
    expect(call(0).init.method).toBe('POST');
    expect(call(0).headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(call(0).body!);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = form.get('assertion')!;
    expect(decodeProtectedHeader(assertion)).toMatchObject({ alg: 'RS256', kid: 'key-1' });
    const { payload } = await jwtVerify(assertion, await importSPKI(rsa.publicKey, 'RS256'), { audience: GOOGLE_TOKEN_URL, issuer: serviceAccount.client_email });
    expect(payload.scope).toBe('https://www.googleapis.com/auth/androidpublisher');

    // 2) 구매 조회
    expect(call(1).url).toBe(PRODUCT_URL);
    expect(call(1).headers.Authorization).toBe('Bearer ya29.test-token');
    expect(r).toMatchObject({ transactionId: 'GPA.3333-4444-5555-66666', productId: 'chat_pack_10', purchasedAt: 1760230800000 });
  });

  it('PEM 이 \\n 이스케이프로 들어와도 동작', async () => {
    const escaped = JSON.stringify({ ...serviceAccount, private_key: rsa.privateKey.replace(/\n/g, '\\n') });
    fetchMock.mockResolvedValueOnce(json({ access_token: 'tok', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json(purchase));
    const v = createGoogleIapVerifier(cfg({ GOOGLE_PLAY_PACKAGE_NAME: 'kr.example.saju', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: escaped }));
    await expect(v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' })).resolves.toMatchObject({ transactionId: purchase.orderId });
  });

  it('액세스 토큰은 만료 전까지 캐시 — 두 번째 검증은 토큰 발급 없이 조회만', async () => {
    const v = createGoogleIapVerifier(googleConfig());
    fetchMock.mockResolvedValueOnce(json({ access_token: 'ya29.cached', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json(purchase));
    fetchMock.mockResolvedValueOnce(json({ ...purchase, orderId: 'GPA.2' }));
    await v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' });
    const r2 = await v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(2).url).toBe(PRODUCT_URL);
    expect(call(2).headers.Authorization).toBe('Bearer ya29.cached');
    expect(r2.transactionId).toBe('GPA.2');
  });

  it('401 이면 토큰을 다시 발급해 1회 재시도', async () => {
    const v = createGoogleIapVerifier(googleConfig());
    fetchMock.mockResolvedValueOnce(json({ access_token: 'old', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json({ error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } }, 401));
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json(purchase));
    await expect(v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' })).resolves.toBeTruthy();
    expect(call(3).headers.Authorization).toBe('Bearer new');
  });

  it('purchaseState 가 0 이 아니면 실패 (1 취소 / 2 대기)', async () => {
    const v = createGoogleIapVerifier(googleConfig());
    fetchMock.mockResolvedValueOnce(json({ access_token: 'tok', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json({ ...purchase, purchaseState: 1 }));
    expect(((await caught(v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' }))) as GatewayError).code).toBe('PURCHASE_CANCELED');
    fetchMock.mockResolvedValueOnce(json({ ...purchase, purchaseState: 2 }));
    expect(((await caught(v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' }))) as GatewayError).code).toBe('PURCHASE_PENDING');
  });

  it('없는 구매 토큰(404)은 PURCHASE_NOT_FOUND, 토큰 발급 실패는 GOOGLE_AUTH_FAILED', async () => {
    const v = createGoogleIapVerifier(googleConfig());
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400));
    expect(((await caught(v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' }))) as GatewayError).code).toBe('GOOGLE_AUTH_FAILED');

    fetchMock.mockResolvedValueOnce(json({ access_token: 'tok', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }, 404));
    expect(((await caught(v.verify({ productId: 'chat_pack_10', receipt: 'tok_abc' }))) as GatewayError).code).toBe('PURCHASE_NOT_FOUND');
  });

  it('테스트 구매(orderId 없음)는 구매 토큰 해시를 거래 ID 로', async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: 'tok', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(json({ ...purchase, orderId: undefined, purchaseType: 0 }));
    const r = await createGoogleIapVerifier(googleConfig()).verify({ productId: 'chat_pack_10', receipt: 'tok_abc' });
    expect(r.transactionId).toMatch(/^TEST-[0-9a-f]{40}$/);
  });
});
