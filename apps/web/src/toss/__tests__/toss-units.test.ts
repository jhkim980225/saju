import type { ProductDto } from '@saju/shared';
import { describe, expect, it } from 'vitest';
import { TOSS_EXCLUDED_PAGES, TOSS_REPLACE, stubSource } from '../../../toss/vite-plugin';
import { bannerId, rewardedId, TEST_BANNER_ID, TEST_REWARDED_ID } from '../adIds';
import { isTossEntryPath, resolveTossEntry } from '../entry';
import { isTossExcludedProduct, mergeTossProducts, parseDisplayAmount, tossDescription } from '../products';
import { tossPath } from '../replace/share';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');

describe('광고 ID 고르기', () => {
  it('제출용 빌드(toss)에서는 환경 변수의 실제 ID 만 쓰고, 없으면 빈 문자열이다', () => {
    expect(rewardedId('toss', ' ait.v2.live.abc ')).toBe('ait.v2.live.abc');
    expect(rewardedId('toss', undefined)).toBe('');
    expect(rewardedId('toss', '')).toBe('');
    expect(bannerId('toss', 'ait.v2.live.def')).toBe('ait.v2.live.def');
    expect(bannerId('toss', undefined)).toBe('');
  });

  it('제출용이 아니면 환경 변수에 실제 ID 가 있어도 테스트 ID 를 쓴다', () => {
    for (const mode of ['toss-qa', 'toss-dev', 'test', 'development']) {
      expect(rewardedId(mode, 'ait.v2.live.abc')).toBe(TEST_REWARDED_ID);
      expect(bannerId(mode, 'ait.v2.live.def')).toBe(TEST_BANNER_ID);
    }
    expect(TEST_REWARDED_ID).toMatch(/^ait-ad-test-/);
  });

  it('테스트 ID 글자는 adIds.ts 한 곳에만 있다(제출용 번들에서 상수째 빠지게)', () => {
    const files = readdirSync(join(SRC, 'toss'), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !d.parentPath.includes('__tests__'));
    const hits = files.filter((d) => readFileSync(join(d.parentPath, d.name), 'utf8').includes('ait-ad-test')).map((d) => d.name);
    expect(hits).toEqual(['adIds.ts']);
  });
});

describe('진입 경로', () => {
  it('경로가 붙은 스킴을 그 화면으로 보낸다', () => {
    expect(resolveTossEntry('intoss://daldal-saju/zodiac')).toBe('/zodiac');
    expect(resolveTossEntry('intoss://daldal-saju/zodiac/monkey/today')).toBe('/zodiac/monkey/today');
    expect(resolveTossEntry('intoss-private://daldal-saju/tojeong?from=share')).toBe('/tojeong?from=share');
  });

  it('?tab= 쿼리도 받는다', () => {
    expect(resolveTossEntry('intoss://daldal-saju?tab=saju')).toBe('/saju');
    expect(resolveTossEntry(undefined, '?tab=compatibility')).toBe('/compatibility');
  });

  it('없는 화면·제외한 화면·모르는 값이면 오늘의 운세로 보낸다', () => {
    expect(resolveTossEntry(undefined)).toBe('/today');
    expect(resolveTossEntry('intoss://daldal-saju')).toBe('/today');
    expect(resolveTossEntry('intoss://daldal-saju/tarot')).toBe('/today');
    expect(resolveTossEntry('intoss://daldal-saju/login')).toBe('/today');
    expect(resolveTossEntry('intoss://daldal-saju/dream/ask')).toBe('/today');
    expect(resolveTossEntry('intoss://daldal-saju?tab=ask')).toBe('/today');
    expect(resolveTossEntry('이상한 값')).toBe('/today');
    expect(isTossEntryPath('/dream/ask')).toBe(false);
    expect(isTossEntryPath('/dream/snake')).toBe(true);
  });
});

describe('공유 링크', () => {
  it('화면 주소를 토스 앱에서 여는 스킴으로 바꾼다(자사 웹 주소가 남지 않는다)', () => {
    expect(tossPath('https://daldal-saju.apps.tossmini.com/today')).toBe('intoss://daldal-saju/today');
    expect(tossPath('https://example.com/compatibility?x=1')).toBe('intoss://daldal-saju/compatibility?x=1');
    expect(tossPath('/input')).toBe('intoss://daldal-saju/input');
    expect(tossPath('https://example.com/')).toBe('intoss://daldal-saju/today');
  });
});

const product = (over: Partial<ProductDto>): ProductDto => ({
  id: 'report_saju_lifetime',
  name: '평생 사주분석서',
  description: '타고난 성향을 담았어요. PDF로 저장할 수 있고, AI 상담 질문권 3회가 함께 들어 있어요.',
  type: 'one_time',
  price: 9900,
  listPrice: 19800,
  credits: 3,
  grants: ['report:lifetime'],
  requiresProfile: true,
  requiresPartner: false,
  requiresReading: false,
  periodDays: null,
  perUserLimit: null,
  purchasable: true,
  saleEndsAt: '2026-12-31T00:00:00.000Z',
  badge: '50%',
  comingSoon: false,
  iosProductId: null,
  androidProductId: null,
  ...over,
});

describe('토스 상점 상품', () => {
  it('질문권 팩·타로·묶음 상품은 뺀다', () => {
    expect(isTossExcludedProduct(product({ id: 'chat_pack_10', type: 'credit_pack' }))).toBe(true);
    expect(isTossExcludedProduct(product({ id: 'tarot_love_5' }))).toBe(true);
    expect(isTossExcludedProduct(product({ id: 'bundle_newyear_2027' }))).toBe(true);
    expect(isTossExcludedProduct(product({ id: 'report_compat' }))).toBe(false);
  });

  it('SKU 가 연결되지 않은 상품은 준비 중으로 보이고 살 수 없다', () => {
    const [p] = mergeTossProducts([product({})], {}, {}, true);
    expect(p).toMatchObject({ purchasable: false, comingSoon: true, listPrice: null, badge: null });
  });

  it('인앱 결제를 쓸 수 없는 환경이면 SKU 가 있어도 준비 중이다', () => {
    const [p] = mergeTossProducts([product({})], { report_saju_lifetime: { sku: 'sku1', amount: 9900 } }, {}, false);
    expect(p).toMatchObject({ purchasable: false, comingSoon: true });
  });

  it('연결된 상품은 콘솔 가격(SDK)을 쓰고, 없으면 서버가 아는 토스 판매가를 쓴다', () => {
    const links = { report_saju_lifetime: { sku: 'sku1', amount: 9900 }, report_compat: { sku: 'sku2', amount: 5940 } };
    const out = mergeTossProducts([product({}), product({ id: 'report_compat', price: 5900 })], links, { sku1: 9900 }, true);
    expect(out[0]).toMatchObject({ price: 9900, purchasable: true, comingSoon: false, listPrice: null, saleEndsAt: null });
    expect(out[1]).toMatchObject({ price: 5940 });
  });

  it('없는 기능(PDF 저장·질문권)을 말하는 문장은 설명에서 뺀다', () => {
    expect(tossDescription('타고난 성향을 담았어요. PDF로 저장할 수 있고, AI 상담 질문권 3회가 함께 들어 있어요.')).toBe('타고난 성향을 담았어요.');
    expect(tossDescription('두 사람의 궁합을 담았어요.')).toBe('두 사람의 궁합을 담았어요.');
    expect(mergeTossProducts([product({})], {}, {}, true)[0]!.description).not.toMatch(/PDF|질문권/);
  });

  it('표시 가격 글자를 숫자로 읽는다', () => {
    expect(parseDisplayAmount('9,900원')).toBe(9900);
    expect(parseDisplayAmount('₩990')).toBe(990);
    expect(parseDisplayAmount(undefined)).toBeNull();
    expect(parseDisplayAmount('무료')).toBeNull();
  });
});

describe('빌드 구성', () => {
  it('바꿔 끼울 파일과 원본이 모두 있고, 내보내는 이름이 빠지지 않는다', () => {
    const names = (file: string) => [...readFileSync(file, 'utf8').matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]!);
    for (const [from, to] of Object.entries(TOSS_REPLACE)) {
      expect(existsSync(join(SRC, from)), from).toBe(true);
      expect(existsSync(join(SRC, to)), to).toBe(true);
      const replaced = new Set(names(join(SRC, to)));
      // native/index.ts 는 다른 파일에서 다시 내보내는 이름(appWebOrigin)이 있어 대체 파일 쪽 이름으로 확인한다
      const missing = names(join(SRC, from)).filter((n) => !replaced.has(n));
      expect(missing, `${to} 에 없는 내보내기`).toEqual([]);
    }
  });

  it('제외한 화면 모듈이 모두 있고, 빈 컴포넌트로 바꿔도 내보내는 이름이 그대로다', () => {
    for (const page of TOSS_EXCLUDED_PAGES) expect(existsSync(join(SRC, page)), page).toBe(true);
    expect(stubSource("export function LoginPage() {}\nexport const SignupPage = () => null;\nfunction helper() {}")).toBe('export const LoginPage = () => null;\nexport const SignupPage = () => null;\n');
  });

  it('토스 전용 화면 문구는 해요체이고 대화상자 왼쪽 버튼은 "닫기"다', () => {
    const files = readdirSync(join(SRC, 'toss'), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.tsx$/.test(d.name) && !d.parentPath.includes('__tests__'));
    for (const d of files) {
      const text = readFileSync(join(d.parentPath, d.name), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
        .join('\n');
      expect(text, d.name).not.toMatch(/습니다|입니다|됩니다|하십시오|해 주십시오/);
      expect(text, d.name).not.toMatch(/>\s*취소\s*</);
    }
  });

  it('.env.toss 예시에는 값이 비어 있다(실제 ID 는 사람이 넣는다)', () => {
    const env = readFileSync(resolve(SRC, '../.env.toss'), 'utf8');
    for (const key of ['VITE_TOSS_AD_REWARDED', 'VITE_TOSS_AD_BANNER_RESULT', 'VITE_TOSS_AD_BANNER_FEED']) expect(env).toMatch(new RegExp(`^${key}=`, 'm'));
    expect(env).not.toMatch(/ait-ad-test/);
  });
});
