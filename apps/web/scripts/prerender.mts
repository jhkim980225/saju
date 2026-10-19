/**
 * 빌드 뒤 사전 렌더링 — 검색 유입용 페이지마다 제목·설명·대표 주소가 들어간 정적 index.html 을 만든다.
 *
 * SPA 라서 JS 를 실행하지 않는 크롤러(네이버 등)는 index.html 기본값만 본다. 그래서 dist/<경로>/index.html 에
 * 그 화면의 <title>·description·canonical·og 태그를 미리 넣어 둔다(본문은 날마다 바뀌므로 그대로 JS 가 그린다).
 * nginx 의 `try_files $uri $uri/index.html /index.html` 이 이 파일을 먼저 집는다.
 * 함께 sitemap.xml·robots.txt 를 만든다(주소 기준: PUBLIC_WEB_URL, 기본 https://dalbitsaju.kr).
 *
 * 실행: `npm run build -w @saju/web` 뒤에 자동(package.json build). 제목·설명은 화면 쪽(ZodiacPage·HoroscopePage·DreamPages)과 같아야 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_FORTUNE_PERIODS, STAR_SIGNS, ZODIAC_ANIMALS, starSignDates, type FreeFortunePeriod, type ZodiacAnimal } from '@saju/shared';
import { DREAM_CATEGORIES, DREAM_CATEGORY_META, DREAM_ENTRIES, dreamEntriesOf, dreamTitle } from '@saju/shared/dream';

const DIST = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const SITE = '달빛사주';
const BASE = (process.env.PUBLIC_WEB_URL ?? 'https://dalbitsaju.kr').replace(/\/$/, '');
const TODAY = new Date().toISOString().slice(0, 10);

const PERIOD_TITLE: Record<FreeFortunePeriod, string> = { today: '오늘의 운세', tomorrow: '내일의 운세', week: '이번 주 운세', month: '이번 달 운세', year: '올해 운세' };

/** 띠의 최근 출생 연도 5개 — ZodiacPage 의 birthYearsOf().slice(-5) 와 같다 */
function recentYears(animal: ZodiacAnimal, refYear: number): number[] {
  // 지지 0(子)은 1984·1996·… 처럼 (year - 4) % 12 === branch
  const out: number[] = [];
  for (let y = refYear; y >= refYear - 60 && out.length < 5; y--) if ((((y - 4) % 12) + 12) % 12 === animal.branch) out.push(y);
  return out.reverse();
}

interface Route {
  path: string;
  title: string;
  description: string;
  /** sitemap 갱신 주기 */
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

function routes(): Route[] {
  const year = Number(TODAY.slice(0, 4));
  const list: Route[] = [
    { path: '/', title: '달빛사주 — 만세력 기반 사주풀이 · 오늘의 운세', description: '태어난 날과 시간으로 세운 사주팔자를 명리학 용어와 함께 알기 쉽게 풀이합니다. 보정 내역까지 공개하는 만세력과 매일 오늘의 운세.', changefreq: 'daily', priority: 1 },
    { path: '/basics', title: `사주 기초 — 사주를 처음 접하는 분을 위한 안내 | ${SITE}`, description: '사주팔자, 천간과 지지, 일간, 오행, 십성, 용신, 대운까지 사주 풀이를 읽는 데 필요한 기본 개념을 순서대로 정리했습니다.', changefreq: 'monthly', priority: 0.7 },
    { path: '/tojeong', title: `토정비결 — 생년월일로 보는 한 해의 흐름 | ${SITE}`, description: '토정비결 144괘로 보는 한 해 운세와 열두 달 흐름. 생년월일만 넣으면 무료로 볼 수 있어요.', changefreq: 'weekly', priority: 0.8 },
    { path: '/manse', title: `만세력 — 날짜별 간지와 24절기 | ${SITE}`, description: '날짜를 고르면 그날의 연주·월주·일주와 그해 24절기 시각을 보여 주는 무료 만세력입니다.', changefreq: 'monthly', priority: 0.6 },
    { path: '/tarot', title: `타로 — 웨이트-스미스 전통 해석으로 보는 오늘의 카드 | ${SITE}`, description: '오늘의 카드는 무료. 연애·돈·일 등 고민별 펼침으로 카드의 전통적인 뜻을 살펴봅니다.', changefreq: 'weekly', priority: 0.7 },
    { path: '/taekil', title: `택일 — 이사·계약·결혼에 좋은 날 고르기 | ${SITE}`, description: '내 사주와 옛 달력(건제12신·황도흑도)을 함께 보고 좋은 날을 추천합니다. 날짜별 등급과 추천 날짜는 무료.', changefreq: 'monthly', priority: 0.6 },
    { path: '/zodiac', title: `띠별 운세 — 12띠 오늘의 운세 | ${SITE}`, description: '쥐띠부터 돼지띠까지 열두 띠의 오늘·내일·이번 주·이번 달·올해 운세. 그날의 띠와 내 띠가 잘 맞는지 푼 이유와 년생별 한 줄까지 무료로 보여 드려요.', changefreq: 'daily', priority: 0.9 },
    { path: '/horoscope', title: `별자리 운세 — 12별자리 오늘의 운세 | ${SITE}`, description: '양자리부터 물고기자리까지 열두 별자리의 오늘·내일·이번 주·이번 달·올해 운세. 생일로 내 별자리를 찾고, 달과 행성의 자리로 푼 근거까지 무료로 보여 드려요.', changefreq: 'daily', priority: 0.9 },
    { path: '/dream', title: `꿈해몽 사전 — 자주 꾸는 꿈 ${DREAM_ENTRIES.length}가지 풀이 | ${SITE}`, description: '뱀 꿈, 돼지꿈, 이가 빠지는 꿈 등 자주 꾸는 꿈의 전통 해석과 상황별 풀이를 무료로 찾아볼 수 있어요.', changefreq: 'weekly', priority: 0.9 },
  ];
  for (const a of ZODIAC_ANIMALS) {
    for (const p of FREE_FORTUNE_PERIODS) {
      const t = `${a.name}띠 ${PERIOD_TITLE[p]}`;
      list.push({ path: `/zodiac/${a.slug}/${p}`, title: `${t} — 띠별 운세 | ${SITE}`, description: `${a.name}띠 ${PERIOD_TITLE[p]}. 그 기간의 띠와 ${a.name}띠가 잘 맞는지로 풀고, ${recentYears(a, year).join('·')}년생 등 년생별 한 줄까지 무료로 보여 드려요.`, changefreq: p === 'year' ? 'monthly' : 'daily', priority: p === 'today' ? 0.8 : 0.6 });
    }
  }
  for (const s of STAR_SIGNS) {
    for (const p of FREE_FORTUNE_PERIODS) {
      const t = `${s.name} ${PERIOD_TITLE[p]}`;
      list.push({ path: `/horoscope/${s.slug}/${p}`, title: `${t} — 별자리 운세 | ${SITE}`, description: `${s.name}(${starSignDates(s)}) ${PERIOD_TITLE[p]}. 달·태양·목성·토성이 지나는 별자리가 ${s.name}에서 몇 번째 자리인지로 풀었어요. 재미로 보는 무료 별자리 운세예요.`, changefreq: p === 'year' ? 'monthly' : 'daily', priority: p === 'today' ? 0.8 : 0.6 });
    }
  }
  for (const c of DREAM_CATEGORIES) {
    const meta = DREAM_CATEGORY_META[c];
    const entries = dreamEntriesOf(c);
    list.push({ path: `/dream?c=${c}`, title: `${meta.label} 꿈해몽 — ${meta.description} | ${SITE}`, description: `${entries.slice(0, 8).map(dreamTitle).join(', ')} 등 ${meta.label}에 관한 꿈 ${entries.length}가지의 전통 해석과 상황별 풀이를 무료로 볼 수 있어요.`, changefreq: 'monthly', priority: 0.5 });
  }
  for (const e of DREAM_ENTRIES) {
    list.push({ path: `/dream/${e.slug}`, title: `${dreamTitle(e)} 해몽 — 뜻과 상황별 풀이 | ${SITE}`, description: `${e.summary} ${e.variations.map((v) => v.title).join(', ')} 등 상황별 풀이를 정리했어요.`.slice(0, 160), changefreq: 'monthly', priority: 0.7 });
  }
  return list;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** index.html 의 제목·설명·og·canonical 을 그 화면 값으로 바꾼다 */
function render(template: string, r: Route): string {
  const url = `${BASE}${r.path}`;
  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(r.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(r.description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(r.title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(r.description)}" />`)
    // 공유 미리보기 이미지는 절대 주소여야 카카오·페이스북이 읽는다
    .replace('<meta property="og:image" content="/og-image.png" />', `<meta property="og:image" content="${esc(BASE)}/og-image.png" />`);
  const extra = `<link rel="canonical" href="${esc(url)}" />\n    <meta property="og:url" content="${esc(url)}" />`;
  html = html.replace('<link rel="manifest"', `${extra}\n    <link rel="manifest"`);
  if (!html.includes('rel="canonical"')) throw new Error('index.html 에 manifest 링크가 없어 canonical 을 넣을 자리를 찾지 못했어요');
  return html;
}

function main() {
  const indexPath = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error(`빌드 결과가 없어요: ${indexPath}`);
  const template = fs.readFileSync(indexPath, 'utf8');
  const all = routes();
  let written = 0;
  for (const r of all) {
    if (r.path.includes('?')) continue; // 쿼리 주소(분류)는 정적 파일을 만들 수 없다 — sitemap 에만
    const dir = r.path === '/' ? DIST : path.join(DIST, r.path.slice(1));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), render(template, r));
    written++;
  }
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.w3.org/2000/sitemaps/sitemap/0.9">\n${all
    .map((r) => `  <url><loc>${esc(`${BASE}${r.path}`)}</loc><lastmod>${TODAY}</lastmod><changefreq>${r.changefreq}</changefreq><priority>${r.priority}</priority></url>`)
    .join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
  // 회원 화면·결제·인증 콜백은 색인하지 않는다
  fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /my\nDisallow: /payments/\nDisallow: /auth/\nDisallow: /reports/\nDisallow: /confirm\nDisallow: /result\nSitemap: ${BASE}/sitemap.xml\n`);
  console.log(`사전 렌더링 ${written}개, sitemap ${all.length}개 URL (${BASE})`);
}

main();
