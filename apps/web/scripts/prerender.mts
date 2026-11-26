/**
 * 빌드 뒤 사전 렌더링 — 검색 유입용 페이지마다 제목·설명·대표 주소가 들어간 정적 index.html 을 만든다.
 *
 * SPA 라서 JS 를 실행하지 않는 크롤러(네이버 등)는 index.html 기본값만 본다. 그래서 dist/<경로>/index.html 에
 * 그 화면의 <title>·description·canonical·og 태그를 미리 넣어 둔다(본문은 날마다 바뀌므로 그대로 JS 가 그린다).
 * Worker(Workers Static Assets, apps/api/wrangler.jsonc 의 html_handling: drop-trailing-slash)가 /경로 요청에 이 파일을 낸다.
 * 함께 sitemap.xml·robots.txt 를 만든다(주소 기준: PUBLIC_WEB_URL, 기본 https://daldalsaju.com, 끝 슬래시·www 없는 대표 주소).
 * sitemap 에는 사전 렌더링해서 canonical 이 자기 자신인 주소만 넣는다(쿼리 주소는 정적 파일을 만들 수 없어 넣지 않는다).
 *
 * 실행: `npm run build -w @saju/web` 뒤에 자동(package.json build). 제목·설명은 화면 쪽(ZodiacPage·HoroscopePage·DreamPages)과 같아야 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_FORTUNE_PERIODS, STAR_SIGNS, ZODIAC_ANIMALS, starSignDates, type FreeFortunePeriod, type ZodiacAnimal } from '@saju/shared';
import { DREAM_ENTRIES, dreamTitle } from '@saju/shared/dream';
import { NOINDEX_PREFIXES } from '../src/lib/pageMeta.ts';

const DIST = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const SITE = '달달사주';
const BASE = (process.env.PUBLIC_WEB_URL ?? 'https://daldalsaju.com').replace(/\/$/, '');
const TODAY = new Date().toISOString().slice(0, 10);
/** sitemap 표준 네임스페이스(https://www.sitemaps.org/protocol.html). 다른 주소면 검색 엔진이 sitemap 을 거부한다 */
export const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

const PERIOD_TITLE: Record<FreeFortunePeriod, string> = { today: '오늘의 운세', tomorrow: '내일의 운세', week: '이번 주 운세', month: '이번 달 운세', year: '올해 운세' };

/** 띠의 최근 출생 연도 5개 — ZodiacPage 의 birthYearsOf().slice(-5) 와 같다 */
function recentYears(animal: ZodiacAnimal, refYear: number): number[] {
  // 지지 0(子)은 1984·1996·… 처럼 (year - 4) % 12 === branch
  const out: number[] = [];
  for (let y = refYear; y >= refYear - 60 && out.length < 5; y--) if ((((y - 4) % 12) + 12) % 12 === animal.branch) out.push(y);
  return out.reverse();
}

export interface Route {
  path: string;
  title: string;
  description: string;
  /** sitemap 갱신 주기 */
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

export function routes(): Route[] {
  const year = Number(TODAY.slice(0, 4));
  // 신년운세 대상 연도 — 화면의 targetFortuneYear()(lib/format.ts)와 같다: 10월부터는 다음 해
  const fortuneYear = year + (Number(TODAY.slice(5, 7)) >= 10 ? 1 : 0);
  const list: Route[] = [
    { path: '/', title: '달달사주 — 만세력 기반 사주풀이 · 오늘의 운세', description: '태어난 날과 시간으로 세운 사주팔자를 명리학 용어와 함께 알기 쉽게 풀이합니다. 보정 내역까지 공개하는 만세력과 매일 오늘의 운세.', changefreq: 'daily', priority: 1 },
    // 검색어가 많은 무료 진입 화면 — 사전 렌더링하지 않으면 SPA 대체 파일(홈)의 제목·대표 주소가 그대로 보인다
    { path: '/input', title: `무료 사주 풀이 — 생년월일시로 보는 사주팔자 | ${SITE}`, description: '생년월일과 태어난 시간을 넣으면 사주팔자 여덟 글자와 오행, 성격·재물·연애·직업 풀이를 무료로 볼 수 있어요. 태어난 시간을 몰라도 됩니다.', changefreq: 'monthly', priority: 0.9 },
    { path: '/today', title: `오늘의 운세 — 내 사주로 보는 하루 흐름 | ${SITE}`, description: '내 사주로 보는 오늘의 운세. 재물·연애·일·건강 점수와 조언, 행운 아이템, 이번 주 흐름을 매일 무료로 확인하세요.', changefreq: 'daily', priority: 0.9 },
    { path: '/yearly', title: `${fortuneYear} 신년운세 — 내 사주로 보는 한 해 흐름 | ${SITE}`, description: `내 사주로 보는 ${fortuneYear}년 신년운세. 한 해의 핵심 흐름은 무료로 보고, 열두 달 흐름과 재물·연애·일·건강 풀이는 신년운세 리포트에서 볼 수 있어요.`, changefreq: 'weekly', priority: 0.9 },
    { path: '/compatibility', title: `사주 궁합 — 두 사람의 사주로 보는 궁합 | ${SITE}`, description: '두 사람의 생년월일시로 보는 사주 궁합. 궁합 점수와 요약은 무료이고, 잘 맞는 점·부딪히는 점·관계 시기까지 담은 상세 풀이는 궁합 리포트에서 볼 수 있어요.', changefreq: 'monthly', priority: 0.8 },
    { path: '/tarot/daily', title: `오늘의 타로 — 하루 한 장 무료 타로 카드 | ${SITE}`, description: '하루에 한 장, 오늘의 타로 카드를 뽑아 웨이트-스미스 전통 해석으로 읽어 봅니다. 무료로 볼 수 있어요.', changefreq: 'weekly', priority: 0.6 },
    { path: '/ask', title: `AI 사주 상담 — 내 사주로 묻고 답하기 | ${SITE}`, description: '저장한 사주의 계산 결과를 바탕으로 연애·일·돈 고민을 AI 에게 물어볼 수 있어요. 질문권으로 이용합니다.', changefreq: 'monthly', priority: 0.5 },
    { path: '/store', title: `이용권·리포트 — 사주분석서·신년운세·궁합 리포트 | ${SITE}`, description: '평생 사주분석서, 신년운세, 궁합, 연애·결혼운, 재물·직업운 리포트와 AI 상담 질문권의 가격과 구성을 확인할 수 있어요.', changefreq: 'monthly', priority: 0.4 },
    { path: '/legal/terms', title: `이용약관 | ${SITE}`, description: '달달사주 이용약관입니다.', changefreq: 'monthly', priority: 0.1 },
    { path: '/legal/privacy', title: `개인정보 처리방침 | ${SITE}`, description: '달달사주 개인정보 처리방침입니다.', changefreq: 'monthly', priority: 0.1 },
    { path: '/legal/disclaimer', title: `면책 고지 | ${SITE}`, description: '달달사주의 사주·운세·타로 콘텐츠가 참고 정보라는 점과 AI 풀이에 관한 안내입니다.', changefreq: 'monthly', priority: 0.1 },
    { path: '/basics', title: `사주 기초 — 사주를 처음 접하는 분을 위한 안내 | ${SITE}`, description: '사주팔자, 천간과 지지, 일간, 오행, 십성, 용신, 대운까지 사주 풀이를 읽는 데 필요한 기본 개념을 순서대로 정리했습니다.', changefreq: 'monthly', priority: 0.7 },
    { path: '/tojeong', title: `토정비결 — 생년월일로 보는 한 해의 흐름 | ${SITE}`, description: '토정비결 144괘로 보는 한 해 운세와 열두 달 흐름. 생년월일만 넣으면 무료로 볼 수 있어요.', changefreq: 'weekly', priority: 0.8 },
    { path: '/manse', title: `만세력 — 날짜별 간지와 24절기 | ${SITE}`, description: '날짜를 고르면 그날의 연주·월주·일주와 그해 24절기 시각을 보여 주는 무료 만세력입니다.', changefreq: 'monthly', priority: 0.6 },
    { path: '/tarot', title: `타로 — 웨이트-스미스 전통 해석으로 보는 오늘의 카드 | ${SITE}`, description: '오늘의 카드는 무료. 연애·돈·일 등 고민별 펼침으로 카드의 전통적인 뜻을 살펴봅니다.', changefreq: 'weekly', priority: 0.7 },
    { path: '/taekil', title: `택일 — 이사·계약·결혼에 좋은 날 고르기 | ${SITE}`, description: '내 사주와 옛 달력(건제12신·황도흑도)을 함께 보고 좋은 날을 추천합니다. 날짜별 등급과 추천 날짜는 무료.', changefreq: 'monthly', priority: 0.6 },
    { path: '/zodiac', title: `띠별 운세 — 12띠 오늘의 운세 | ${SITE}`, description: '쥐띠부터 돼지띠까지 열두 띠의 오늘·내일·이번 주·이번 달·올해 운세. 그날의 띠와 내 띠가 잘 맞는지 푼 이유와 년생별 한 줄까지 무료로 보여 드려요.', changefreq: 'daily', priority: 0.9 },
    { path: '/horoscope', title: `별자리 운세 — 12별자리 오늘의 운세 | ${SITE}`, description: '양자리부터 물고기자리까지 열두 별자리의 오늘·내일·이번 주·이번 달·올해 운세. 생일로 내 별자리를 찾고, 달과 행성의 자리로 푼 근거까지 무료로 보여 드려요.', changefreq: 'daily', priority: 0.9 },
    // 설명은 DreamHomePage 의 usePageMeta 와 같다
    { path: '/dream', title: `꿈해몽 사전 — 자주 꾸는 꿈 ${DREAM_ENTRIES.length}가지 풀이 | ${SITE}`, description: `뱀꿈, 돼지꿈, 이가 빠지는 꿈처럼 자주 꾸는 꿈 ${DREAM_ENTRIES.length}가지의 전통 해석을 차분하게 정리했어요. 꿈 이야기를 적으면 AI 꿈풀이도 받아 볼 수 있어요.`, changefreq: 'weekly', priority: 0.9 },
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
  // 꿈해몽 분류(/dream?c=<분류>)는 넣지 않는다. 쿼리 주소라 정적 파일을 만들 수 없어 /dream 의 HTML(canonical /dream)을 받고,
  // 화면(DreamHomePage)도 분류 보기의 canonical 을 /dream 으로 둔다. 분류 목록은 /dream 화면의 링크로 크롤러가 따라간다
  for (const e of DREAM_ENTRIES) {
    list.push({ path: `/dream/${e.slug}`, title: `${dreamTitle(e)} 해몽 — 뜻과 상황별 풀이 | ${SITE}`, description: `${e.summary} ${e.variations.map((v) => v.title).join(', ')} 등 상황별 풀이를 정리했어요.`.slice(0, 160), changefreq: 'monthly', priority: 0.7 });
  }
  return list;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** index.html 의 제목·설명·og·canonical 을 그 화면 값으로 바꾼다 */
export function render(template: string, r: Route): string {
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

export function sitemapXml(all: Route[]): string {
  const urls = all.map((r) => `  <url><loc>${esc(`${BASE}${r.path}`)}</loc><lastmod>${TODAY}</lastmod><changefreq>${r.changefreq}</changefreq><priority>${r.priority}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${SITEMAP_NS}">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * 회원 화면·개인 결과·결제·인증 화면은 색인하지 않는다. 화면의 noindex 목록(src/lib/pageMeta.ts NOINDEX_PREFIXES)에 /api/ 를 더한 목록이다.
 * 끝이 / 인 줄은 그 아래 주소만 막고(/yearly 자체는 열어 둠), /saju 처럼 / 없는 줄은 그 주소와 아래 주소를 모두 막는다
 */
export function robotsTxt(): string {
  const disallow = [...NOINDEX_PREFIXES, '/api/'];
  return `User-agent: *\nAllow: /\n${disallow.map((p) => `Disallow: ${p}\n`).join('')}Sitemap: ${BASE}/sitemap.xml\n`;
}

function main() {
  const indexPath = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error(`빌드 결과가 없어요: ${indexPath}`);
  const template = fs.readFileSync(indexPath, 'utf8');
  const all = routes();
  for (const r of all) {
    if (r.path.includes('?')) throw new Error(`쿼리 주소는 사전 렌더링할 수 없어 sitemap 에도 넣지 않아요: ${r.path}`);
    const dir = r.path === '/' ? DIST : path.join(DIST, r.path.slice(1));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), render(template, r));
  }
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemapXml(all));
  fs.writeFileSync(path.join(DIST, 'robots.txt'), robotsTxt());
  console.log(`사전 렌더링·sitemap ${all.length}개 URL (${BASE})`);
}

// 테스트가 함수만 가져다 쓸 때는 실행하지 않는다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
