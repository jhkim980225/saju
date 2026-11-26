# 검색 노출 (사전 렌더링 · sitemap · 페이지 메타)

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §18을 대체한다. 배포 명령과 오픈 전 확인 목록은 [DEPLOY.md](../DEPLOY.md) §2·§3에 있다.

## 목적

웹은 SPA 라서 JS 를 실행하지 않는 크롤러(네이버 등)는 `index.html` 의 기본 제목·설명만 본다. 검색으로 들어오는 무료 화면(띠별·별자리·꿈해몽·주요 메뉴)마다 제목·설명·대표 주소(canonical)·og 태그를 미리 넣은 정적 HTML 을 만들어 검색 결과와 공유 미리보기를 화면별로 다르게 한다. 본문은 날마다 바뀌므로 정적으로 만들지 않고 그대로 JS 가 그린다. 개인 화면(내 사주·결제·리포트 등)은 색인하지 않게 막는다.

| 기능 | 운영 상태 |
|---|---|
| 사전 렌더링·sitemap·robots | 운영 중 |
| 네이버 서치어드바이저·구글 서치콘솔 등록 | 하지 않음(`index.html` 에 인증 태그 없음) |

## 사용자 흐름

사용자 화면이 없는 기능이라 빌드와 요청이 처리되는 흐름을 적는다.

1. **빌드**: `npm run deploy` 가 `npm run build -w @saju/web`(타입 검사, Vite 빌드, `npm run prerender`)를 실행한 뒤 `wrangler deploy` 한다.
2. **사전 렌더링**: `apps/web/scripts/prerender.mts` 가 `dist/index.html` 을 틀로 삼아 주소마다 `<title>`, `description`, `og:title`, `og:description`, `canonical`, `og:url` 을 바꿔 `dist/<경로>/index.html` 로 쓴다. 쿼리가 붙은 주소는 정적 파일을 만들 수 없으므로 대상 목록에 넣으면 빌드가 실패한다. `og:image` 는 카카오·페이스북이 읽을 수 있게 절대 주소로 바꾼다. 첫 화면 `/` 는 `dist/index.html` 자체를 덮어쓰므로, SPA 대체 파일도 홈의 canonical 을 갖는다.
3. **sitemap·robots**: 같은 스크립트가 `dist/sitemap.xml`(표준 네임스페이스 `http://www.sitemaps.org/schemas/sitemap/0.9`)과 `dist/robots.txt` 를 만든다. 주소 기준은 빌드 환경 변수 `PUBLIC_WEB_URL`(없으면 `https://daldalsaju.com`)이다. sitemap 에는 사전 렌더링해서 canonical 이 자기 자신인 주소만 넣는다.
4. **요청 처리**: Worker 는 `/api/*`·`/health` 만 코드로 받고 나머지는 Workers Static Assets 가 낸다(`run_worker_first`). `html_handling: drop-trailing-slash` 라서 `dist/zodiac/rat/today/index.html` 은 `/zodiac/rat/today` 로 나가고, 끝에 슬래시가 붙은 주소는 슬래시 없는 주소로 보낸다. 파일이 없는 주소는 `not_found_handling: single-page-application` 으로 `index.html` 을 받는다.
5. **JS 실행 뒤**: `RootLayout`(`App.tsx`)의 `useRouteMeta` 가 주소가 바뀔 때마다 canonical 을 지금 주소(쿼리 제외, 끝 슬래시 제거)로 맞추고, 개인 화면에는 `<meta name="robots" content="noindex">` 를 단다. 사전 렌더링하지 않은 주소는 홈 canonical 을 가진 대체 파일을 받기 때문이다. 화면이 `usePageMeta` 로 정한 제목·설명·canonical 이 있으면 그 값이 이긴다(`useRouteMeta` 는 `useLayoutEffect` 라 먼저 실행된다). canonical 의 출처는 `canonicalOrigin()` 으로, 지금 주소에서 앞의 `www.` 를 뗀 값이다. 그래서 www 로 들어와도 사전 렌더링한 HTML 과 같은 www 없는 대표 주소를 가리킨다.

**대상 주소**(2026-11-25 기준, 최신 목록은 스크립트의 `routes()`):

| 묶음 | 개수 | 정적 파일 |
|---|---|---|
| 주요 무료 화면: `/`, `/input`, `/today`, `/yearly`, `/compatibility`, `/tarot/daily`, `/ask`, `/store`, `/legal/terms`, `/legal/privacy`, `/legal/disclaimer`, `/basics`, `/tojeong`, `/manse`, `/tarot`, `/taekil`, `/zodiac`, `/horoscope`, `/dream` | 19 | 만든다 |
| 띠 12 × 기간 5(`/zodiac/<띠>/<today·tomorrow·week·month·year>`) | 60 | 만든다 |
| 별자리 12 × 기간 5(`/horoscope/<별자리>/<기간>`) | 60 | 만든다 |
| 꿈해몽 항목(`/dream/<slug>`) | 337 | 만든다 |
| 꿈해몽 분류(`/dream?c=<분류>`) | 11 | 만들 수 없고 sitemap 에도 넣지 않는다. 화면의 canonical 도 `/dream` 이다 |

사전 렌더링과 sitemap 모두 476개다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 사전 렌더링·sitemap·robots | `apps/web/scripts/prerender.mts`(`routes`, `render`, `sitemapXml`, `robotsTxt`, `SITEMAP_NS`, `main`, `recentYears`) |
| 빌드 스크립트 | `apps/web/package.json`(`build`, `prerender`), 루트 `package.json`(`deploy`) |
| 틀 HTML | `apps/web/index.html`(기본 제목·설명·og, `<link rel="manifest">` 앞에 canonical 을 끼운다) |
| 화면 메타 | `apps/web/src/lib/pageMeta.ts`(`useRouteMeta`, `usePageMeta`, `canonicalOrigin`, `NOINDEX_PREFIXES`), `apps/web/src/App.tsx`(`RootLayout`) |
| 테스트 | `apps/web/scripts/__tests__/prerender.test.ts` |
| 제목·설명을 맞춰야 하는 화면 | `apps/web/src/pages/ZodiacPage.tsx`, `HoroscopePage.tsx`, `DreamPages.tsx` |
| 정적 파일 설정 | `apps/api/wrangler.jsonc`(`assets`, `routes`), `apps/web/public/_headers` |
| 공유 이미지 | `apps/web/public/og-image.png` |

## API / 데이터 모델

API 와 DB 는 쓰지 않는다. 입력은 빌드 환경 변수 `PUBLIC_WEB_URL` 과 `@saju/shared` 의 띠·별자리·기간·꿈해몽 데이터(`ZODIAC_ANIMALS`, `STAR_SIGNS`, `FREE_FORTUNE_PERIODS`, `DREAM_CATEGORIES`, `DREAM_ENTRIES`)다.

## 비즈니스 규칙 & 엣지케이스

- **제목·설명을 손으로 맞춘다**: 스크립트의 제목·설명은 화면(`ZodiacPage`·`HoroscopePage`·`DreamPages`)의 `usePageMeta` 값과 같아야 한다. 자동으로 맞추는 장치는 없다.
- **색인 제외 목록**: `robots.txt` 는 `pageMeta.ts` 의 `NOINDEX_PREFIXES`(`/my`, `/payments/`, `/auth/`, `/reports/`, `/confirm`, `/result`, `/saju`, `/profiles/`, `/yearly/`, `/tarot/r/`, `/tarot/history`, `/taekil/r/`, `/login`, `/signup`, `/password/`)에 `/api/` 를 더해 막는다. 스크립트가 이 목록을 그대로 가져다 쓰므로 두 목록이 어긋나지 않는다. 끝이 `/` 인 항목은 그 아래 주소만 막는다(`/yearly` 자체는 열고 `/yearly/:profileId` 는 막는다). `/saju` 처럼 `/` 가 없는 항목은 그 주소와 아래 주소를 모두 막는다.
- **빌드 날짜가 들어간다**: 신년운세 제목의 연도는 빌드 날짜 기준으로 10월부터 다음 해다(화면의 `targetFortuneYear()` 와 같은 규칙). 띠 상세 설명의 "최근 년생 5개"와 sitemap 의 `lastmod` 도 빌드 날짜다.
- **www**: `www.daldalsaju.com` 도 같은 Worker 가 낸다. 사전 렌더링한 canonical 은 `PUBLIC_WEB_URL`(www 없는 주소)을 가리키고, JS 가 다시 쓰는 canonical 도 `canonicalOrigin()` 으로 `www.` 를 떼므로 같다. www 에서 대표 주소로 보내는 301 리디렉션은 없다.
- **꿈해몽 분류**: `/dream?c=<분류>` 는 정적 파일을 만들 수 없어 `/dream` 의 HTML 을 받는다. 화면(`DreamHomePage`)도 분류 보기의 canonical 을 `/dream` 으로 두고, sitemap 에는 넣지 않는다. 분류 목록은 `/dream` 화면의 링크로 크롤러가 따라간다.
- **ads.txt**: 광고 키(AdSense 게시자 ID)가 아직 없어 `apps/web/public/ads.txt` 를 만들지 않는다. 승인 뒤 게시한다([ads-analytics.md](ads-analytics.md)).
- **캐시**: `sitemap.xml`·`robots.txt` 는 1시간 캐시다. `_headers` 에 `/tarot/*` 처럼 넓게 캐시를 걸면 사전 렌더링한 `/tarot`·`/tarot/daily` HTML 까지 캐시돼, 배포 뒤 지워진 JS 를 불러 화면이 깨진다. 그래서 그림 경로만 따로 적는다.
- **보안 헤더**: 정적 화면의 보안 헤더(CSP, HSTS 등)는 `_headers` 의 `/*` 규칙이 붙인다. API 응답은 Worker 의 `secureHeaders` 가 붙인다([ops.md](ops.md)).

## 주의사항 / 알려진 이슈

1. 해결(2026-11-26): **sitemap 네임스페이스가 틀렸던 문제**. `prerender.mts` 가 표준 주소 `http://www.sitemaps.org/schemas/sitemap/0.9`(`SITEMAP_NS`)를 쓴다. 회귀 테스트는 `apps/web/scripts/__tests__/prerender.test.ts` 다.
2. 해결(2026-11-26): **www 에서 JS 가 canonical 을 www 로 바꾸던 문제**. `useRouteMeta`·`usePageMeta` 가 `window.location.origin` 대신 `canonicalOrigin()`(앞의 `www.` 를 뗀 출처)을 쓴다. 남김(외부 작업): www 에서 대표 주소로 보내는 301 리디렉션은 Cloudflare 대시보드의 리디렉션 규칙으로 운영자가 건다. 정적 파일은 Worker 코드를 거치지 않아 코드로 리디렉션하려면 모든 요청을 Worker 로 먼저 받아야 하기 때문이다.
3. 해결(2026-11-26): **꿈해몽 분류 주소의 canonical 과 sitemap 이 어긋나던 문제**. sitemap 에서 `/dream?c=` 11개를 빼고, 화면의 분류 보기 canonical 도 `/dream` 으로 맞췄다. 정적 HTML·JS·sitemap 이 모두 같은 대표 주소를 가리킨다.
4. **해가 바뀌면 다시 배포해야 한다**: 신년운세 제목 연도, 띠 년생 목록이 빌드 날짜로 정해지므로 10월 1일과 1월 1일 뒤에는 다시 빌드·배포해야 제목이 바뀐다. 모든 주소의 `lastmod` 가 배포 날짜로 바뀌는 것도 같은 이유다. 의도된 동작으로 유지: 정적 HTML 이라 빌드 때 정한다.
5. **공유 미리보기는 사전 렌더링한 주소만 화면별로 나온다**: 크롤러는 JS 를 실행하지 않으므로, 사전 렌더링하지 않은 주소(예: `/tarot/r/…`)를 공유하면 미리보기에는 홈의 제목·설명·`og:url` 이 나온다. 의도된 동작으로 유지: 개인 결과 주소는 색인·미리보기 대상이 아니다.
6. 해결(2026-11-26): **낡은 주석**. `prerender.mts` 머리 주석을 Workers Static Assets(`html_handling: drop-trailing-slash`) 기준으로, `pageMeta.ts` 머리 주석을 "사전 렌더링한 HTML 과 같은 www 없는 대표 주소를 쓴다"로 고쳤다.
7. 해결(2026-11-26): **목록이 조금 다르던 문제**. `robots.txt` 가 `NOINDEX_PREFIXES` 를 그대로 가져다 써서 `/saju` 자체도 막는다. `/legal/disclaimer` 를 사전 렌더링 대상에 넣었고, `/dream` 의 설명을 화면의 `usePageMeta` 값과 맞췄다.
8. **검색 등록을 하지 않았다**: 남김(외부 작업): 네이버 서치어드바이저·구글 서치콘솔 등록은 운영자 계정의 인증 태그가 필요하다. 1번을 고쳤으므로 다음 배포 뒤 등록할 수 있다.
