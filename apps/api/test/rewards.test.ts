import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { users } from '../src/db/schema.js';
import { createGateways } from '../src/modules/commerce/providers/index.js';
import { createCommerceService } from '../src/modules/commerce/service.js';
import { createRewardsService } from '../src/modules/rewards/service.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signedQuery(params: Record<string, string>, keyId = '3335741209') {
  const message = new URLSearchParams(params).toString();
  const signature = sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'der' }).toString('base64url');
  return `${message}&signature=${signature}&key_id=${keyId}`;
}

describe('AdMob 보상형 광고 SSV', () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', REWARDED_AD_DAILY_LIMIT: '3' });
  const { db } = createDb(':memory:');
  let rewards: ReturnType<typeof createRewardsService>;
  beforeAll(() => {
    runMigrations(db);
    seedProducts(db);
    db.insert(users).values({ id: 'u1', nickname: '테스트', provider: 'email' }).run();
    const commerce = createCommerceService(config, db, createGateways(config));
    rewards = createRewardsService(config, db, commerce, { fetchKeys: async () => new Map([['3335741209', pem]]) });
  });
  const base = { ad_network: '5450213213286189855', ad_unit: '1234567890', reward_amount: '1', reward_item: 'credit', timestamp: '1791736000000', user_id: 'u1' };

  it('정상 서명 → 무상 질문권 지급, 같은 거래는 중복 지급 안 함', async () => {
    const q = signedQuery({ ...base, transaction_id: 'tx-1' });
    expect(await rewards.handleAdmobSsv(q)).toEqual({ granted: true, credits: 1 });
    expect(await rewards.handleAdmobSsv(q)).toEqual({ granted: false, reason: 'DUPLICATE' });
  });
  it('위조 서명은 거부', async () => {
    const q = signedQuery({ ...base, transaction_id: 'tx-2' }).replace('user_id=u1', 'user_id=u2');
    await expect(rewards.handleAdmobSsv(q)).rejects.toThrow('서명 검증');
  });
  it('하루 3회 한도', async () => {
    await rewards.handleAdmobSsv(signedQuery({ ...base, transaction_id: 'tx-3' }));
    await rewards.handleAdmobSsv(signedQuery({ ...base, transaction_id: 'tx-4' }));
    expect(rewards.todayCount('u1')).toBe(3);
    expect(await rewards.handleAdmobSsv(signedQuery({ ...base, transaction_id: 'tx-5' }))).toEqual({ granted: false, reason: 'DAILY_LIMIT' });
  });
});

describe('AdMob SSV — 광고 단위 허용 목록', () => {
  it('허용 목록에 없는 광고 단위는 지급하지 않는다', async () => {
    const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', ADMOB_REWARDED_AD_UNITS: 'ca-app-pub-1/9999999999' });
    const { db } = createDb(':memory:');
    runMigrations(db);
    seedProducts(db);
    db.insert(users).values({ id: 'u9', nickname: '테스트', provider: 'email' }).run();
    const rewards = createRewardsService(config, db, createCommerceService(config, db, createGateways(config)), { fetchKeys: async () => new Map([['3335741209', pem]]) });
    const params = { ad_network: '1', reward_amount: '1', reward_item: 'credit', timestamp: '1', user_id: 'u9' };
    expect(await rewards.handleAdmobSsv(signedQuery({ ...params, ad_unit: '1234567890', transaction_id: 'a-1' }))).toEqual({ granted: false, reason: 'AD_UNIT_NOT_ALLOWED' });
    expect(await rewards.handleAdmobSsv(signedQuery({ ...params, ad_unit: '9999999999', transaction_id: 'a-2' }))).toEqual({ granted: true, credits: 1 });
  });
});
