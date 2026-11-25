/**
 * 토스 미니앱 디자인 점검용 스크린샷 — `node scripts/toss-review.mjs [이름 일부…]`
 *
 * toss-shots.mjs 가 "제출 자료와 기본 확인"이라면, 이 스크립트는 출시 전 점검용이다.
 *  - 휴대전화 너비 두 가지(390, 360)로 주요 화면을 전체 길이로 찍는다.
 *  - 빈 화면(저장한 사주가 없을 때)을 먼저 찍고, 사주와 구매한 리포트를 만든 뒤 나머지를 찍는다.
 *  - 바텀시트를 열고 뒤로가기를 눌러, 시트만 닫히고 화면이 그대로인지 확인한다(히스토리 칸 수도 본다).
 *  - 화면 글자에서 토스 첫 버전에 없는 기능(질문권·PDF·AI 상담·로그인·카카오)과 합니다체 문장을 찾아 적는다.
 *
 * 준비: 토스 연동을 흉내 내는 로컬 API 가 따로 떠 있어야 한다(개발 DB 와 섞이지 않게 저장 폴더를 따로 둔다).
 *   cd apps/api
 *   node scripts/local.mjs --port 4010 --ip 127.0.0.1 --persist-to <빈 폴더> --env-file <env 파일>
 *   env 파일: NODE_ENV=development, CORS_ORIGINS=http://localhost:5190, PAYMENT_PROVIDER=mock, TOSS_DEV_MOCK=true,
 *            TOSS_USER_KEY_SECRET=<32자 이상>, TOSS_IAP_SKUS=report_saju_lifetime=sku-lifetime,… (상품ID=sku-이름)
 *
 * 출력: ../../../toss/daldal-saju/shots/review (TOSS_SHOTS_DIR 로 바꿀 수 있다) 와 그 안의 report.json
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = resolve(process.env.TOSS_SHOTS_DIR ?? resolve(root, '../../../toss/daldal-saju/shots/review'));
const API = process.env.TOSS_REVIEW_API ?? 'http://localhost:4010/api/v1';
const PORT = 5190;
const ORIGIN = `http://localhost:${PORT}`;
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const want = (name) => !only.length || only.some((o) => name.includes(o));

const sh = (cmd, args, env = {}) =>
  new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} → ${code}`))));
  });

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function waitFor(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} 이 뜨지 않았어요`);
}

mkdirSync(outDir, { recursive: true });
// 토스 SDK mock 빌드 — API 는 점검용 로컬 서버를 직접 부른다
if (!process.env.TOSS_SHOTS_SKIP_BUILD) await sh('npx', ['vite', 'build', '--mode', 'toss-dev'], { VITE_API_BASE_URL: API });
const server = spawn('npx', ['vite', 'preview', '--mode', 'toss-dev', '--outDir', 'dist-toss-dev', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', shell: true });

const browser = await chromium.launch();
const report = { pages: [], sheets: [], notes: [] };
const problems = [];

/** 화면 글자와 배치에서 확인할 것을 모은다 */
const inspect = () => {
  const text = document.body.innerText;
  const formal = [];
  for (const sentence of text.split(/(?<=[.!?。])\s+|\n+/)) {
    if (/(십시오|하시오)(?![가-힣])/.test(sentence)) formal.push(sentence.trim().slice(0, 80));
    else for (const m of sentence.matchAll(/([가-힣])(니다|니까)(?![가-힣])/g)) if ((m[1].charCodeAt(0) - 0xac00) % 28 === 17) formal.push(sentence.trim().slice(0, 80));
  }
  const missing = [...text.matchAll(/질문권|PDF|AI 상담|로그인|카카오|타로|취소/g)].map((m) => m[0]);
  // 글자가 잘린 요소: 한 줄로 고정했는데 내용이 더 긴 경우
  const clipped = [...document.querySelectorAll('button, a, h1, h2, h3, p, span, li, dt, dd')]
    .filter((el) => {
      if (!el.textContent?.trim() || el.children.length > 0) return false;
      const cs = getComputedStyle(el);
      return (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
    })
    .map((el) => el.textContent.trim().slice(0, 40));
  // 화면 밖으로 나간 요소
  const offscreen = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.right > window.innerWidth + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed';
    })
    .slice(0, 5)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
  // 어두운 면이 남은 곳: 넓은 요소의 배경이 어두운 경우(버튼처럼 작은 요소는 뺀다)
  const dark = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < window.innerWidth * 0.6 || r.height < 72) return false;
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return false;
      return 0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3] < 70;
    })
    .slice(0, 5)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`);
  return {
    path: location.pathname + location.search,
    theme: document.documentElement.dataset.theme,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    formal: [...new Set(formal)],
    missing: [...new Set(missing)],
    clipped: [...new Set(clipped)],
    offscreen,
    dark,
    hasTabbar: Boolean(document.querySelector('nav[aria-label="주요 메뉴"]')),
    backButtons: [...document.querySelectorAll('header button[aria-label]')].map((b) => b.getAttribute('aria-label')).filter((l) => /뒤로|back/i.test(l ?? '')),
  };
};

async function shoot(page, name, path, { full = true, width } = {}) {
  if (!want(name)) return null;
  if (path) await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const info = await page.evaluate(inspect);
  await page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: full });
  // 긴 화면은 전체 그림이 작게 보이므로 첫 화면도 따로 찍는다
  if (full) await page.screenshot({ path: resolve(outDir, `${name}-top.png`), fullPage: false });
  // 떠 있는 탭바가 마지막 내용을 가리는지 보려고, 탭 화면은 맨 아래로 내린 모습도 찍는다
  if (info.hasTabbar) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const gap = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="주요 메뉴"] ul')?.getBoundingClientRect();
      const nodes = [...document.querySelectorAll('#root a, #root button, #root p, #root li, #root h2, #root h3')].filter((el) => !el.closest('nav[aria-label="주요 메뉴"]') && el.getBoundingClientRect().height > 0);
      const lastBottom = Math.max(0, ...nodes.map((el) => el.getBoundingClientRect().bottom));
      return nav ? Math.round(nav.top - lastBottom) : null;
    });
    info.tabbarGap = gap;
    if (gap !== null && gap < 0) problems.push(`${name}: 맨 아래 내용이 탭바에 ${-gap}px 가려짐`);
    await page.screenshot({ path: resolve(outDir, `${name}-bottom.png`), fullPage: false });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  report.pages.push({ name, width: width ?? page.viewportSize().width, ...info });
  if (info.theme !== 'light') problems.push(`${name}: 테마가 ${info.theme}`);
  if (info.overflowX) problems.push(`${name}: 가로로 넘침`);
  if (info.backButtons.length) problems.push(`${name}: 자체 뒤로가기`);
  console.log(`[review] ${name} → ${info.path}${info.formal.length ? ` · 합니다체 ${info.formal.length}` : ''}${info.missing.length ? ` · 확인할 글자 ${info.missing.join(',')}` : ''}${info.clipped.length ? ` · 잘림 ${info.clipped.length}` : ''}${info.dark.length ? ` · 어두운 면 ${info.dark.length}` : ''}`);
  return info;
}

const navIndex = (page) => page.evaluate(() => ({ index: window.navigation?.currentEntry?.index ?? -1, path: location.pathname + location.search, y: Math.round(window.scrollY), marker: history.state?.ydSheet ?? null }));
const dialogCount = (page) => page.locator('[role="dialog"][aria-modal="true"]').count();

/** 시트를 열고(open) 뒤로가기를 눌러, 시트만 닫히고 화면이 그대로인지 확인한다 */
async function sheetBack(page, name, open, { close = 'back' } = {}) {
  if (!want(name)) return;
  let before = await navIndex(page);
  try {
    await open();
    await page.locator('[role="dialog"][aria-modal="true"]').first().waitFor({ state: 'visible', timeout: 5000 });
  } catch (e) {
    report.sheets.push({ name, ok: false, reason: `시트를 열지 못함: ${String(e.message).split('\n')[0]}` });
    problems.push(`${name}: 시트를 열지 못함`);
    return;
  }
  await page.waitForTimeout(500);
  const opened = await navIndex(page);
  before = { ...before, y: opened.y }; // 버튼을 누르느라 화면이 움직였을 수 있다 — 열린 뒤의 위치와 견준다
  await page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: false });
  const text = await page.locator('[role="dialog"][aria-modal="true"]').first().innerText();
  if (close === 'back') await page.goBack({ waitUntil: 'commit' }).catch(() => undefined);
  else await page.locator('[role="dialog"] button[aria-label="시트 닫기"]').last().click();
  await page.waitForTimeout(700);
  const after = await navIndex(page);
  const dialogs = await dialogCount(page);
  const ok = dialogs === 0 && after.path === before.path && after.index === before.index && opened.index === before.index + 1 && after.marker === null && Math.abs(after.y - before.y) <= 2;
  report.sheets.push({ name, close, ok, before, opened, after, dialogs, cancelWord: /취소/.test(text), text: text.replace(/\s+/g, ' ').slice(0, 160) });
  if (!ok) problems.push(`${name}: 뒤로가기 뒤 상태가 다름 (${JSON.stringify({ before, opened, after, dialogs })})`);
  if (/취소/.test(text)) problems.push(`${name}: 시트에 '취소' 글자`);
  console.log(`[review] 시트 ${name} (${close}) → ${ok ? '시트만 닫힘' : '확인 필요'}`);
}

try {
  await waitFor(ORIGIN);
  // 모의 모드의 토스 로그인은 항상 같은 계정(dev-user)이다 — 남아 있던 데이터를 지우고 시작한다
  let session = await api('POST', '/auth/toss', { body: { code: 'mock-anon-code-review' } });
  await api('DELETE', '/auth/me', { token: session.accessToken }).catch(() => undefined);
  session = await api('POST', '/auth/toss', { body: { code: 'mock-anon-code-review' } });
  const token = session.accessToken;

  const newContext = async (width) => {
    const context = await browser.newContext({ viewport: { width, height: width === 360 ? 740 : 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'dark' });
    await context.addInitScript((v) => window.localStorage.setItem('yd.session', v), JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user }));
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`화면 오류(${width}): ${e.message}`));
    return { context, page };
  };

  // ── 1) 빈 화면: 저장한 사주가 없을 때
  {
    const { context, page } = await newContext(390);
    await shoot(page, 'e01-today-empty', '/');
    await shoot(page, 'e02-saju-empty', '/saju');
    await shoot(page, 'e03-compatibility-empty', '/compatibility');
    await shoot(page, 'e04-my-empty', '/my');
    await shoot(page, 'e05-reports-empty', '/my/reports');
    await shoot(page, 'e06-payments-empty', '/my/payments');
    await shoot(page, 'e07-yearly-empty', '/yearly');
    await shoot(page, 'e08-taekil-empty', '/taekil');
    await shoot(page, 'e09-input', '/input');
    await context.close();
  }

  // ── 2) 사주와 구매한 리포트 만들기
  const profile = await api('POST', '/profiles', { token, body: { name: '달이', relation: 'self', birth: { calendar: 'solar', year: 1992, month: 5, day: 17, hour: 9, minute: 30, gender: 'female' } } });
  const partner = await api('POST', '/profiles', { token, body: { name: '별이', relation: 'partner', birth: { calendar: 'solar', year: 1990, month: 11, day: 3, hour: 14, minute: 0, gender: 'male' } } });
  const buy = async (productId, sku, extra = {}) => {
    const intent = await api('POST', '/payments/iap/toss/orders', { token, body: { productId, profileId: profile.id, ...extra } });
    return api('POST', '/payments/iap/verify', { token, body: { platform: 'toss', orderId: `review-${productId}-${Date.now()}`, intentId: intent.intentId, sku } });
  };
  const bought = {};
  for (const [productId, sku, extra] of [
    ['report_saju_lifetime', 'sku-lifetime', {}],
    ['report_love', 'sku-love', {}],
    ['report_compat', 'sku-compat', { partnerProfileId: partner.id }],
  ]) {
    try {
      bought[productId] = await buy(productId, sku, extra);
    } catch (e) {
      report.notes.push(`구매 준비 실패 ${productId}: ${e.message}`);
    }
  }
  report.notes.push(`사주분석서 구매 뒤 질문권 잔액: ${bought.report_saju_lifetime?.creditsBalance ?? '확인 못 함'} (지급 ${bought.report_saju_lifetime?.granted?.credits ?? '?'})`);
  const reports = await api('GET', '/reports', { token }).catch(() => []);
  const reportList = Array.isArray(reports) ? reports : (reports.items ?? []);

  // ── 3) 주요 화면
  for (const width of [390, 360]) {
    const { context, page } = await newContext(width);
    const w = width === 390 ? '' : '-360';
    await shoot(page, `01-today${w}`, '/', { width });
    await shoot(page, `02-saju${w}`, `/saju/${profile.id}`, { width });
    await shoot(page, `03-compatibility${w}`, `/compatibility?a=${profile.id}&b=${partner.id}`, { width });
    await shoot(page, `04-my${w}`, '/my', { width });
    await shoot(page, `05-store${w}`, '/store', { width });
    await shoot(page, `06-tojeong${w}`, '/tojeong', { width });
    await shoot(page, `07-zodiac${w}`, '/zodiac', { width });
    await shoot(page, `08-dream${w}`, '/dream', { width });
    await shoot(page, `09-taekil${w}`, '/taekil', { width });
    await shoot(page, `10-yearly${w}`, `/yearly/${profile.id}`, { width });
    await shoot(page, `11-payments${w}`, '/my/payments', { width });
    await shoot(page, `12-menu${w}`, '/menu', { width });
    await shoot(page, `15-basics${w}`, '/basics', { width });
    await shoot(page, `16-reports${w}`, '/my/reports', { width });
    await shoot(page, `17-horoscope${w}`, '/horoscope', { width });
    await shoot(page, `18-manse${w}`, '/manse', { width });
    await shoot(page, `19-legal-terms${w}`, '/legal/terms', { width });
    await shoot(page, `20-legal-privacy${w}`, '/legal/privacy', { width });
    await shoot(page, `21-legal-disclaimer${w}`, '/legal/disclaimer', { width });
    await shoot(page, `22-saju-tab${w}`, '/saju', { width });
    await shoot(page, `23-profile-new${w}`, '/profiles/new?save=1&relation=family&next=/my', { width });
    // 상세 화면은 목록의 첫 링크를 따라간다
    for (const [name, hub, prefix] of [
      [`24-zodiac-detail${w}`, '/zodiac', '/zodiac/'],
      [`25-horoscope-detail${w}`, '/horoscope', '/horoscope/'],
      [`26-dream-entry${w}`, '/dream', '/dream/'],
    ]) {
      if (!want(name)) continue;
      await page.goto(`${ORIGIN}${hub}`, { waitUntil: 'networkidle' });
      const href = await page.locator(`a[href^="${prefix}"]`).first().getAttribute('href').catch(() => null);
      if (href) await shoot(page, name, href, { width });
      else report.notes.push(`${name}: ${hub} 에서 상세 링크를 찾지 못함`);
    }
    // 구매한 리포트 — AI 고지 시트가 먼저 뜬다
    const first = reportList[0];
    if (first && want(`27-report${w}`)) {
      await page.goto(`${ORIGIN}/reports/${first.id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      if (await dialogCount(page)) {
        await page.screenshot({ path: resolve(outDir, `27-report-ai-notice${w}.png`) });
        await page.getByRole('button', { name: '확인했어요' }).click();
        await page.waitForTimeout(600);
      }
      await shoot(page, `27-report${w}`, null, { width });
    }
    // 토정비결 결과
    if (want(`28-tojeong-result${w}`)) {
      await page.goto(`${ORIGIN}/tojeong`, { waitUntil: 'networkidle' });
      const date = page.locator('#tojeong-date');
      if (await date.count()) {
        await date.fill('1992-05-17');
        await page.getByRole('button', { name: /보기|확인|풀이/ }).first().click().catch(() => undefined);
        await page.waitForTimeout(1500);
        await shoot(page, `28-tojeong-result${w}`, null, { width });
      }
    }
    await context.close();
  }

  // ── 4) 바텀시트와 뒤로가기
  if (!only.length || only.some((o) => o.startsWith('s'))) {
    const { context, page } = await newContext(390);
    // 오늘 탭: 처음 화면(히스토리 한 칸)에서 시트를 열고 닫는다
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await sheetBack(page, 's01-today-share', () => page.getByRole('button', { name: /공유/ }).first().click());
    await sheetBack(page, 's02-today-share-x', () => page.getByRole('button', { name: /공유/ }).first().click(), { close: 'x' });
    await sheetBack(page, 's03-today-future-day', async () => {
      // 요일 줄에서 오늘 다음 날을 누른다(보상형 광고 안내 시트)
      const days = page.locator('button[aria-label*="요일 "]');
      const n = await days.count();
      for (let i = 0; i < n - 1; i++) if (await days.nth(i).locator('span.font-bold').count()) return days.nth(i + 1).click();
      throw new Error('오늘 다음 요일 버튼을 찾지 못함(오늘이 일요일이면 다음 날이 없다)');
    });
    // 내 사주: 잠긴 풀이의 구매 창
    await page.goto(`${ORIGIN}/saju/${partner.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await sheetBack(page, 's04-saju-paywall', () => page.locator('[aria-label^="잠긴 내용"] button').first().click());
    await sheetBack(page, 's05-saju-basics', () => page.locator('button.text-gold.underline').first().click());
    // 궁합: 사람 고르기
    await page.goto(`${ORIGIN}/compatibility?a=${profile.id}&b=${partner.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await sheetBack(page, 's06-compat-pick', () => page.getByRole('button', { name: /별이/ }).first().click());
    // 상점: 누구의 리포트를 볼까요
    await page.goto(`${ORIGIN}/store`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await sheetBack(page, 's07-store-pick', () => page.getByRole('button', { name: /구매|원/ }).first().click());
    // 마이: 사주 삭제 확인, 탈퇴 확인
    await page.goto(`${ORIGIN}/my`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await sheetBack(page, 's08-my-delete-profile', () => page.getByRole('button', { name: '별이 삭제' }).click());
    await sheetBack(page, 's09-my-delete-account', () => page.getByRole('button', { name: '탈퇴하기' }).click());
    // 다른 화면에서 들어온 뒤: 시트를 닫아도 이전 화면으로 가지 않는다
    await page.goto(`${ORIGIN}/my`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: '리포트 구매' }).click();
    await page.waitForURL('**/store');
    await page.waitForTimeout(1000);
    await sheetBack(page, 's10-store-pick-after-nav', () => page.getByRole('button', { name: /구매|원/ }).first().click());
    const afterSheet = await navIndex(page);
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForTimeout(700);
    const backTo = await navIndex(page);
    report.sheets.push({ name: 's10b-back-after-sheet', ok: backTo.path === '/my' && backTo.index === afterSheet.index - 1, afterSheet, backTo });
    if (backTo.path !== '/my') problems.push(`s10b: 시트를 닫은 뒤 뒤로가기가 이전 화면(/my)으로 가지 않음 → ${backTo.path}`);
    await context.close();
  }
} finally {
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify({ problems, ...report }, null, 2));
  await browser.close();
  server.kill();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
}
if (problems.length) {
  console.error(`[review] 확인할 점 ${problems.length}건`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else console.log(`[review] 문제 없음 → ${outDir}`);
