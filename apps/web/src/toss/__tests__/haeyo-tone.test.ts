/**
 * 말투 검사 — 토스 미니앱에 보이는 화면 문구에 합니다체("~합니다", "~입니다", "~습니다", "~하십시오", "~습니까")가 남아 있으면 실패한다.
 * 앱인토스 UX 라이팅 가이드: "상황, 맥락을 불문하고 모든 문구에 해요체".
 *
 * 검사 범위
 *  - i18n/ko.json 에서 토스 첫 버전에 없는 화면의 묶음(landing · ask · push · tarot)을 뺀 나머지
 *  - src 의 화면 코드(pages · components · lib · hooks · toss) 가운데 토스 번들에 들어가는 파일
 *    (toss/vite-plugin.ts 가 비우거나 바꿔 끼우는 파일, 타로 전용 파일은 뺀다)
 *  - 토스용 약관·개인정보 처리방침(toss/legal.ts)
 * 검사하지 않는 것
 *  - 주석, 웹·앱용 약관 본문(pages/MiscPages.tsx 의 LEGAL — 토스 빌드에서는 toss/legal.ts 로 바뀐다)
 *  - 서버가 만드는 풀이 본문(apps/api)과 꿈해몽 사전(packages/shared) — 분량이 많아 따로 다듬는다
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ko from '@/i18n/ko.json';
import { TOSS_EXCLUDED_PAGES, TOSS_REPLACE } from '../../../toss/vite-plugin';
import { BUSINESS_PLACEHOLDER, tossPrivacy, tossTerms } from '../legal';

const SRC = resolve(__dirname, '../..');

/**
 * 문장 끝의 합니다체 어미가 있는가 — 'ㅂ' 받침 글자 뒤의 '니다'·'니까'(합니다·입니다·습니다·습니까), 그리고 '십시오'·'하시오'.
 * 뒤에 한글이 이어지면(예: "합니다체", "입니다만") 문장 끝이 아니므로 잡지 않는다. '아니다', '그러니까'는 받침이 없어 잡히지 않는다.
 */
export function hasFormalEnding(text: string): boolean {
  if (/(십시오|하시오)(?![가-힣])/.test(text)) return true;
  for (const m of text.matchAll(/([가-힣])(니다|니까)(?![가-힣])/g)) {
    if ((m[1]!.charCodeAt(0) - 0xac00) % 28 === 17) return true; // 받침 ㅂ
  }
  return false;
}

/** 토스 첫 버전에 없는 화면의 문구 묶음 */
const KO_EXCLUDED = ['landing', 'ask', 'push', 'tarot'];
/** 토스 번들에 들어가지 않는 파일(타로 전용 · 네이티브 앱 전용) */
const NOT_IN_TOSS = [/^components\/Tarot/, /^lib\/tarot\.ts$/, /^native\//, /__tests__\//, /\.test\.tsx?$/, /^test-setup\.ts$/];
const SCAN_DIRS = ['pages', 'components', 'lib', 'hooks', 'toss'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** 주석을 지운 코드 줄 — 문자열과 JSX 글자만 남긴다 */
export function stripComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split(/\r?\n/)) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) {
        out.push('');
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\{?\/\*.*?\*\/\}?/g, '');
    const open = line.indexOf('/*');
    if (open >= 0) {
      line = line.slice(0, open);
      inBlock = true;
    }
    // 줄 주석: 줄 첫머리이거나, 코드 뒤에 공백을 두고 시작하는 // (주소의 :// 는 지우지 않는다)
    line = line.replace(/(^|\s)\/\/(?!\/).*$/, '$1');
    out.push(line);
  }
  return out;
}

function tossVisibleFiles(): string[] {
  const replaced = new Set(Object.keys(TOSS_REPLACE)); // 토스에서는 toss/replace/* 가 대신 들어간다
  const excluded = new Set(TOSS_EXCLUDED_PAGES);
  return SCAN_DIRS.flatMap((d) => walk(join(SRC, d)))
    .map((p) => relative(SRC, p).replace(/\\/g, '/'))
    .filter((rel) => /\.tsx?$/.test(rel) && !replaced.has(rel) && !excluded.has(rel) && !NOT_IN_TOSS.some((re) => re.test(rel)));
}

/**
 * 웹·앱용 약관 본문은 토스 화면에 나오지 않는다 — lib/legal.ts 의 webTerms·webPrivacy(합니다체)는
 * MiscPages 가 IS_TOSS 일 때 부르지 않아 토스 번들에서 빠진다(BUSINESS·businessLine 만 남는다).
 */
function withoutWebLegal(rel: string, source: string): string {
  if (rel === 'lib/legal.ts') {
    const start = source.indexOf('export function webTerms');
    if (start < 0) throw new Error('lib/legal.ts 에서 webTerms 위치를 찾지 못했어요. 검사 범위를 다시 맞춰 주세요.');
    return source.slice(0, start) + source.slice(start).replace(/[^\n]/g, '');
  }
  if (rel !== 'pages/MiscPages.tsx') return source;
  const start = source.indexOf('const LEGAL');
  const end = source.indexOf('export function LegalPage');
  if (start < 0 || end < 0) throw new Error('MiscPages.tsx 에서 LEGAL 위치를 찾지 못했어요. 검사 범위를 다시 맞춰 주세요.');
  return source.slice(0, start) + source.slice(start, end).replace(/[^\n]/g, '') + source.slice(end);
}

describe('토스 화면 문구의 말투(해요체)', () => {
  it('합니다체 어미를 찾는 규칙이 맞다', () => {
    for (const s of ['풀이합니다.', '참고 정보입니다', '열지 못했습니다.', '확인하십시오.', '계속하시겠습니까?']) expect(hasFormalEnding(s), s).toBe(true);
    for (const s of ['풀이해요.', '참고 정보예요', '열지 못했어요.', '확인해 주세요.', '합니다체', '아니다', '그러니까', '어머니다운']) expect(hasFormalEnding(s), s).toBe(false);
  });

  it('주석은 검사에서 뺀다', () => {
    expect(stripComments("const a = '봐요'; // 설명합니다\n/* 여러 줄\n 주석입니다 */ const b = 'https://x.y/입니다';").join('\n')).not.toMatch(/설명합니다|주석입니다/);
    expect(stripComments("const u = 'https://example.com/a';")[0]).toContain('https://example.com/a');
    expect(stripComments('<p>{/* 안내합니다 */}보여요</p>')[0]).toBe('<p>보여요</p>');
  });

  it('i18n/ko.json — 토스에 나오는 문구에 합니다체가 없다', () => {
    const found: string[] = [];
    const visit = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (hasFormalEnding(node)) found.push(`${path}: ${node}`);
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (!path && KO_EXCLUDED.includes(k)) continue;
          visit(v, path ? `${path}.${k}` : k);
        }
      }
    };
    visit(ko, '');
    expect(found).toEqual([]);
  });

  it('화면 코드 — 토스 번들에 들어가는 파일에 합니다체 문구가 없다', () => {
    const files = tossVisibleFiles();
    // 범위가 비어서 통과하는 일이 없게 대표 파일이 들어 있는지 본다
    for (const must of ['pages/TodayPage.tsx', 'pages/BasicsPage.tsx', 'lib/sajuBasics.ts', 'components/ReadingView.tsx', 'toss/legal.ts', 'toss/replace/ShareSheet.tsx']) expect(files).toContain(must);
    for (const never of ['pages/LandingPage.tsx', 'pages/TarotHomePage.tsx', 'components/ShareSheet.tsx', 'lib/analytics.ts']) expect(files).not.toContain(never);
    const found: string[] = [];
    for (const rel of files) {
      const lines = stripComments(withoutWebLegal(rel, readFileSync(join(SRC, rel), 'utf8')));
      lines.forEach((line, i) => {
        if (hasFormalEnding(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('토스용 약관·개인정보 처리방침 — 해요체이고, 꼭 들어가야 하는 내용이 있다', () => {
    const terms = tossTerms().body.join('\n');
    const privacy = tossPrivacy().body.join('\n');
    expect(hasFormalEnding(`${terms}\n${privacy}`)).toBe(false);
    // 토스 식별값으로 만드는 계정, 웹 계정과 분리
    expect(terms).toMatch(/토스가 이 미니앱에 제공하는 식별값/);
    expect(terms).toMatch(/웹사이트·모바일 앱의 계정과 별개/);
    // 인앱 결제, 청약 철회, 환불 절차(Android·iPhone)
    expect(terms).toMatch(/인앱 결제/);
    expect(terms).toMatch(/청약 철회/);
    expect(terms).toMatch(/환불받기/);
    expect(terms).toMatch(/Apple/);
    // 광고, 생성형 AI, 데이터 삭제
    expect(terms).toMatch(/광고/);
    expect(terms).toMatch(/생성형 AI/);
    expect(terms).toMatch(/탈퇴하기/);
    expect(privacy).toMatch(/삭제 방법/);
    expect(privacy).toMatch(/생성형 AI/);
    // 사업자 정보 칸 — 값이 없으면 자리표시자가 보인다
    expect(terms).toMatch(/사업자등록번호/);
    expect(terms).toMatch(/통신판매업 신고번호/);
    expect(tossTerms().body.join('\n')).toContain(BUSINESS_PLACEHOLDER);
    const filled = tossTerms({ NAME: '달달', REPRESENTATIVE: '홍길동', REG_NO: '123-45-67890', MAIL_ORDER_NO: '2026-서울-0001', ADDRESS: '서울', EMAIL: 'help@example.com', PHONE: '02-000-0000', PRIVACY_OFFICER: '홍길동', EFFECTIVE_DATE: '2026년 12월 1일' });
    expect(filled.body.join('\n')).not.toContain(BUSINESS_PLACEHOLDER);
    expect(filled.body.join('\n')).toContain('help@example.com');
    // 토스 첫 버전에 없는 기능은 약관에 적지 않는다
    expect(`${terms}\n${privacy}`).not.toMatch(/질문권|AI 상담|카카오|타로/);
  });
});
