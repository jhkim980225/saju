/**
 * 토스 미니앱 화면 확인용 스크린샷 — `npm run shots:toss`
 *
 * 준비: 로컬 API(:4000, `npm run dev:api`)가 떠 있어야 한다. 브라우저 확인용 빌드(dist-toss-dev, 토스 SDK mock)를 만들어
 * 미리보기 서버로 띄운 뒤, 휴대전화 크기(390×844)로 주요 화면을 찍는다.
 * 로컬 API 에 게스트 계정과 프로필 하나를 만든다(로컬 개발 DB 에만 남는다).
 *
 * 출력: 기본 ../../../toss/daldal-saju/shots (TOSS_SHOTS_DIR 로 바꿀 수 있다)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = resolve(process.env.TOSS_SHOTS_DIR ?? resolve(root, '../../../toss/daldal-saju/shots'));
const API = process.env.TOSS_SHOTS_API ?? 'http://localhost:4000/api/v1';
const PORT = 5190;
const ORIGIN = `http://localhost:${PORT}`;
const only = process.argv.slice(2);

const sh = (cmd, args) =>
  new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} → ${code}`))));
  });

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
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
if (!process.env.TOSS_SHOTS_SKIP_BUILD) await sh('npx', ['vite', 'build', '--mode', 'toss-dev']);
const server = spawn('npx', ['vite', 'preview', '--mode', 'toss-dev', '--outDir', 'dist-toss-dev', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', shell: true });

const browser = await chromium.launch();
const problems = [];
try {
  await waitFor(ORIGIN);
  const session = await api('POST', '/auth/guest', { body: { deviceId: `toss-shots-${Date.now()}` } });
  const profile = await api('POST', '/profiles', { token: session.accessToken, body: { name: '달이', relation: 'self', birth: { calendar: 'solar', year: 1992, month: 5, day: 17, hour: 9, minute: 30, gender: 'female' } } });
  const partner = await api('POST', '/profiles', { token: session.accessToken, body: { name: '별이', relation: 'partner', birth: { calendar: 'solar', year: 1990, month: 11, day: 3, hour: 14, minute: 0, gender: 'male' } } });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'dark' });
  await context.addInitScript((v) => window.localStorage.setItem('yd.session', v), JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user }));
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`화면 오류: ${e.message}`));

  const shots = [
    ['01-today', '/'],
    ['02-saju', `/saju/${profile.id}`],
    ['03-compatibility', '/compatibility'],
    ['04-my', '/my'],
    ['05-store', '/store'],
    ['06-tojeong', '/tojeong'],
    ['07-zodiac', '/zodiac'],
    ['08-dream', '/dream'],
    ['09-taekil', '/taekil'],
    ['10-yearly', `/yearly/${profile.id}`],
    ['11-payments', '/my/payments'],
    ['12-menu', '/menu'],
    ['13-excluded-tarot', '/tarot'],
    ['14-excluded-login', '/login'],
    ['15-basics', '/basics'],
    ['16-reports', '/my/reports'],
  ];
  for (const [name, path] of shots) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => ({
      path: location.pathname,
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      backButtons: [...document.querySelectorAll('header button[aria-label]')].map((b) => b.getAttribute('aria-label')).filter((l) => /뒤로|back/i.test(l ?? '')),
      excludedLinks: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /^\/(tarot|ask|login|signup|password|dream\/ask)(\/|\?|$)/.test(h ?? '')),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    if (info.theme !== 'light') problems.push(`${name}: 테마가 ${info.theme}`);
    if (info.backButtons.length) problems.push(`${name}: 자체 뒤로가기 ${info.backButtons.join(',')}`);
    if (info.excludedLinks.length) problems.push(`${name}: 제외 기능 링크 ${[...new Set(info.excludedLinks)].join(',')}`);
    if (info.overflowX) problems.push(`${name}: 가로로 넘침`);
    await page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: false });
    console.log(`[shots] ${name} ${path} → ${info.path} (theme=${info.theme}, bg=${info.bg})`);
  }

  // 콘솔 등록용 스크린샷(636×1048)과 로고(600×600) — toss/daldal-saju/store/out
  // 로고는 1024px 원본(resources/icon.png)을 600px 로 줄여서 만든다(512px 을 키우면 흐려진다)
  if (!only.length || only.includes('store')) {
    const storeDir = resolve(outDir, '../store/out');
    mkdirSync(storeDir, { recursive: true });
    const storeCtx = await browser.newContext({ viewport: { width: 636, height: 1048 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await storeCtx.addInitScript((v) => window.localStorage.setItem('yd.session', v), JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user }));
    const sp = await storeCtx.newPage();
    const storeShots = [
      ['screenshot-1', '/today'],
      ['screenshot-2', `/saju/${profile.id}`],
      ['screenshot-3', '/zodiac'],
      ['screenshot-4', '/tojeong'],
    ];
    for (const [name, path] of storeShots) {
      await sp.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' });
      // 휴대전화 너비(약 398px)로 보이게 1.6배 확대해서 찍는다
      await sp.evaluate(() => (document.documentElement.style.zoom = '1.6'));
      await sp.waitForTimeout(700);
      await sp.screenshot({ path: resolve(storeDir, `${name}.png`), fullPage: false, omitBackground: false });
      console.log(`[shots] store ${name} ${path}`);
    }
    await sp.setViewportSize({ width: 600, height: 600 });
    await sp.setContent(`<body style="margin:0;background:#060B24"><img src="data:image/png;base64,${readFileSync(resolve(root, 'resources/icon.png')).toString('base64')}" style="width:600px;height:600px;display:block"></body>`, { waitUntil: 'networkidle' });
    await sp.screenshot({ path: resolve(storeDir, 'logo-600.png') });
    await storeCtx.close();
  }
  void partner;
} finally {
  await browser.close();
  server.kill();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
}
if (problems.length) {
  console.error(`[shots] 확인할 점 ${problems.length}건`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`[shots] 문제 없음 → ${outDir}`);
