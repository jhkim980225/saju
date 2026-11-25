/**
 * 토스 미니앱 제출용 번들 검사 — `npm run build:toss` 가 vite build 뒤(dist-toss)와 ait build 뒤(.ait 압축 해제)에 한 번씩 부른다.
 * 하나라도 걸리면 빌드가 실패한다.
 *
 *  - ait-ad-test        : 테스트 광고 ID 글자. 번들에 있으면 검토에서 반려된다(2026-11 한입상식 v1 반려 사유)
 *  - Capacitor 플러그인 코드, 애드센스·애드핏, 카카오 SDK, 외부 결제창 SDK, 외부 추적 스크립트
 *    (화면 문구의 키 이름처럼 SDK 가 아닌 글자는 잡지 않도록 SDK 고유 글자만 찾는다)
 *  - .map               : 소스맵
 *  - 자사 웹 주소        : 공유 링크가 자사 웹사이트로 가면 안 된다
 *  - 크기               : 100MB 이하
 * 경고만 하는 것(빌드는 통과): 약관의 사업자 정보 자리표시자가 남아 있음 — 제출 전에 .env.toss 의 VITE_TOSS_BIZ_* 를 채운다
 *
 * 쓰는 법: node scripts/check-toss-bundle.mjs [--ait] [--dir <폴더>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;
const checkAit = args.includes('--ait');

const FORBIDDEN = [
  { name: '테스트 광고 ID', re: /ait-ad-test/i },
  // 화면 문구의 키 이름(share.kakaoToday 등)이나 window.Capacitor 감지 코드는 SDK 가 아니므로 SDK 고유 글자만 찾는다
  { name: 'Capacitor 코드', re: /@capacitor\/|registerPlugin\(|CapacitorHttp|capacitor:\/\//i },
  { name: '애드센스·애드핏', re: /googlesyndication|adsbygoogle|kas\/static\/ba\.min/i },
  { name: '카카오 SDK', re: /kakaocdn|kakao_js_sdk|Kakao\.Share|kauth\.kakao|kakao_ad_area/i },
  { name: '외부 결제창 SDK', re: /js\.tosspayments\.com|cdn\.portone\.io/i },
  { name: '외부 추적 스크립트', re: /googletagmanager|connect\.facebook\.net|kakao_pixel/i },
  { name: '자사 웹 주소', re: /daldalsaju\.(com|kr)/i },
  { name: '개발용 SDK mock', re: /__ait_devtools|ait-devtools-panel/i },
];
const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.txt', '.svg', '.webmanifest', '']);
const MAX_BYTES = 100 * 1024 * 1024;
// 실패는 아니지만 제출 전에 꼭 채워야 하는 값 — 약관의 사업자 정보 자리표시자(src/toss/legal.ts 의 BUSINESS_PLACEHOLDER)
const PLACEHOLDER = Buffer.from('(출시 전 입력)', 'utf8').toString('latin1');
const warnings = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function checkDir(dir, label) {
  const problems = [];
  let bytes = 0;
  const files = walk(dir);
  for (const f of files) {
    const size = statSync(f).size;
    bytes += size;
    const rel = relative(dir, f).replace(/\\/g, '/');
    if (rel.endsWith('.map')) problems.push(`소스맵: ${rel}`);
    if (rel.startsWith('tarot/')) problems.push(`토스에 넣지 않는 자산: ${rel}`);
    const binaryBundle = /\.(bundle|hbc|jsbundle)$/.test(rel);
    if (!TEXT_EXT.has(extname(f)) && !binaryBundle) continue;
    const text = readFileSync(f, 'latin1');
    if (text.includes(PLACEHOLDER) && !warnings.includes(rel)) warnings.push(rel);
    // .ait 에는 package.json 사본(project-package.json)이 들어간다 — 의존성 이름 목록이라 실행 코드가 아니므로 테스트 광고 ID 만 본다
    const patterns = rel === 'project-package.json' ? FORBIDDEN.slice(0, 1) : FORBIDDEN;
    for (const { name, re } of patterns) {
      const m = text.match(re);
      if (m) problems.push(`${name}: ${rel} ("${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}")`);
    }
  }
  if (bytes > MAX_BYTES) problems.push(`크기 초과: ${(bytes / 1024 / 1024).toFixed(1)}MB (한도 100MB)`);
  console.log(`[toss-bundle] ${label}: 파일 ${files.length}개, ${(bytes / 1024 / 1024).toFixed(2)}MB`);
  return problems;
}

let problems = [];
if (checkAit) {
  const ait = join(root, 'daldal-saju.ait');
  if (!existsSync(ait)) {
    console.error('[toss-bundle] daldal-saju.ait 파일이 없어요. ait build 를 먼저 실행하세요.');
    process.exit(1);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'daldal-ait-'));
  try {
    // .ait 는 앞에 머리말이 붙은 zip 이라 unzip 이 경고(종료 코드 1)를 내지만 내용은 풀린다
    try {
      execFileSync('unzip', ['-q', '-o', ait, '-d', tmp], { stdio: 'ignore' });
    } catch {
      /* 경고는 무시하고 풀린 파일이 있는지로 판단한다 */
    }
    if (walk(tmp).length === 0) {
      console.error('[toss-bundle] .ait 압축을 풀지 못했어요(unzip 이 필요해요).');
      process.exit(1);
    }
    problems = checkDir(tmp, `.ait 압축 해제 (${(statSync(ait).size / 1024 / 1024).toFixed(2)}MB)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  const dir = resolve(root, dirArg ?? 'dist-toss');
  if (!existsSync(dir)) {
    console.error(`[toss-bundle] ${dir} 폴더가 없어요. vite build --mode toss 를 먼저 실행하세요.`);
    process.exit(1);
  }
  problems = checkDir(dir, relative(root, dir));
}

if (problems.length > 0) {
  console.error(`[toss-bundle] 실패: ${problems.length}건`);
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  process.exit(1);
}
if (warnings.length > 0) {
  console.warn('[toss-bundle] 주의: 약관의 사업자 정보가 비어 있어요. 제출 전에 apps/web/.env.toss 의 VITE_TOSS_BIZ_* 값을 채우고 다시 빌드하세요.');
  for (const w of warnings) console.warn('  - 자리표시자 "(출시 전 입력)" 이 들어 있는 파일: ' + w);
}
console.log('[toss-bundle] 통과');
