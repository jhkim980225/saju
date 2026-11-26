# 검색 유입 화면은 빌드 때 메타 태그만 넣은 정적 HTML 로 사전 렌더링한다

- 날짜: 2026-10-19 (대상 화면 확대는 2026-11-25)
- 상태: 채택
- 관련 커밋:
  - `731060f` 띠·별자리·꿈해몽 466개 화면의 정적 `index.html` 과 `sitemap.xml`·`robots.txt` 생성, nginx 가 이 파일을 먼저 집게 함(2026-10-19)
  - `2a4b0b8` Cloudflare 로 옮기며 nginx 대신 Workers Static Assets 의 `html_handling` 으로 사전 렌더링 파일을 냄(2026-11-11)
  - `37dca41` 신년운세·궁합·오늘·무료 풀이 등 9개 화면 추가, 주소마다 canonical 을 맞추고 개인 화면은 noindex 와 robots Disallow(2026-11-25)
- 관련 문서: [features/seo.md](../features/seo.md), [PRD.md](../PRD.md) §2·§5, [DEPLOY.md](../DEPLOY.md) §2·§3, [research/01-competitor-features.md](../research/01-competitor-features.md)

## 맥락

웹은 React SPA 라서 JS 를 실행하지 않는 크롤러(네이버 등)는 `index.html` 의 기본 제목과 설명만 본다. 띠별·별자리 운세와 꿈해몽 사전은 검색 유입과 광고 지면을 늘리려고 무료로 만든 화면이다(research/01 의 S4·S7, PRD §2). 화면마다 제목과 설명이 달라야 검색 결과와 공유 미리보기에서 구분된다.

## 결정

- 빌드 뒤 `apps/web/scripts/prerender.mts` 가 `dist/index.html` 을 틀로 삼아 주소마다 `<title>`, `description`, canonical, `og:title`, `og:description`, `og:url` 을 바꾼 `dist/<경로>/index.html` 을 쓴다. `og:image` 는 절대 주소로 바꾼다.
- 본문은 정적으로 만들지 않고 JS 가 그린다.
- 같은 스크립트가 `sitemap.xml` 과 `robots.txt` 를 만든다. 주소 기준은 빌드 환경 변수 `PUBLIC_WEB_URL` 이다.
- 대상은 2026-11-25 기준으로 주요 무료 화면 18개, 띠 12 × 기간 5, 별자리 12 × 기간 5, 꿈해몽 항목 337개다. 사전 렌더링 475개, sitemap 486개다. 꿈해몽 분류 주소(`/dream?c=<분류>`)는 파일로 만들 수 없어 sitemap 에만 넣는다.
- 개인 화면(내 사주, 결제, 리포트, 인증 등)은 `robots.txt` 로 막고, JS 가 실행되면 `useRouteMeta` 가 noindex 를 단다.

## 근거

- 스크립트 머리 주석과 features/seo.md 는 이유를 "JS 를 실행하지 않는 크롤러는 index.html 기본값만 본다"로 적는다. 본문을 정적으로 만들지 않은 이유는 "본문은 날마다 바뀌므로"다.
- 서버 렌더링(SSR)이나 본문까지 정적으로 만드는 방식을 검토했는지는 기록에 없다. TODO: 확인 필요.

## 결과와 영향

얻은 것:
- 웹을 SPA 로 둔 채 화면별 제목, 설명, 공유 미리보기를 얻었다. 서버가 HTML 을 만들지 않으므로 Worker 에 렌더링 부담이 없다.
- 띠·별자리·꿈해몽 데이터를 `@saju/shared` 에서 가져오므로 화면과 같은 목록으로 주소를 만든다.

감수한 것:
- 스크립트의 제목·설명을 화면(`ZodiacPage`, `HoroscopePage`, `DreamPages`)의 `usePageMeta` 값과 손으로 맞춰야 한다. 자동으로 맞추는 장치는 없다.
- 신년운세 제목의 연도, 띠 상세의 "최근 년생 5개", sitemap 의 `lastmod` 가 빌드 날짜로 정해진다. 10월 1일과 1월 1일 뒤에는 다시 빌드하고 배포해야 제목이 바뀐다.
- 사전 렌더링하지 않은 주소를 공유하면 크롤러는 홈의 제목, 설명, `og:url` 을 본다.
- 배포 구성이 바뀔 때 정적 파일을 내는 규칙도 다시 맞춰야 했다. nginx 의 `try_files` 에서 Workers Static Assets 의 `html_handling: drop-trailing-slash` 로 옮겼다. `_headers` 에 `/tarot/*` 처럼 넓게 캐시를 걸면 사전 렌더링한 HTML 까지 캐시되어 배포 뒤 화면이 깨지는 문제가 있었다(`37dca41` 에서 수정).

남은 일:
- sitemap 의 XML 네임스페이스가 표준 주소(`http://www.sitemaps.org/schemas/sitemap/0.9`)가 아니다. 서치콘솔에 등록하기 전에 고쳐야 한다(features/seo.md).
- 네이버 서치어드바이저와 구글 서치콘솔 등록을 하지 않았다.
- www 주소에서는 JS 가 canonical 을 www 로 바꾸고 리디렉션도 없어, 같은 화면이 두 주소로 색인될 수 있다.
