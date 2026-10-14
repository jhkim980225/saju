# 달빛사주 (月光四柱) — 사주·타로 서비스

> 정확하게 세우고, 쉽게 읽어 드려요. — 만세력 기반 사주풀이 · 오늘의 운세 · 신년운세 · 궁합 · AI 상담 · 타로

웹 우선으로 개발하고 **Capacitor 로 iOS/Android 앱으로 포팅**할 수 있도록 백엔드/프론트엔드를 분리한 모노레포입니다.
외부 연동(결제·소셜 로그인·AI·푸시·광고·분석)은 **키 없이도 전체 흐름이 동작**하도록 껍데기와 목업이 들어 있고, 키만 넣으면 실제로 연동됩니다 → [`docs/ENV_KEYS.md`](docs/ENV_KEYS.md)

## 구조

```
packages/saju-core   사주 계산 엔진 (절기·서머타임·경도 보정·음력/윤달·십신·12운성·신살·합충·대운·운세·궁합)
packages/shared      API 계약 (zod 스키마 + DTO 타입) — 웹·API·앱 공용
apps/api             백엔드 (Fastify 5 · Drizzle · SQLite→PostgreSQL · JWT · 결제/로그인/AI/푸시 어댑터)
apps/web             프론트엔드 (React 19 · Vite 7 · Tailwind v4 · React Router 7 · TanStack Query)
  ├─ android/        Capacitor Android 프로젝트 (APK 빌드·에뮬레이터 검증 완료)
  └─ ios/            Capacitor iOS 프로젝트 (빌드는 macOS + Xcode)
docs/                기획·설계·연동 문서, research/ (마케팅·홍보팀 경쟁 분석)
```

## 빠른 시작

```bash
# Node 22.13+ (개발 환경 Node 26) / npm 11
npm install
cp apps/api/.env.example apps/api/.env      # 키 없이도 실행됨 (결제는 mock)
cp apps/web/.env.example apps/web/.env       # 선택
npm run dev                                  # API :4000 + Web :5173 동시 실행
```
- 웹: http://localhost:5173 (Vite 가 `/api` 를 :4000 으로 프록시)
- DB 는 첫 기동 시 자동 마이그레이션 + 상품 카탈로그 시드 (`apps/api/data/saju.db`)
- mock 결제: 결제창 없이 바로 성공 처리됩니다 — 결제·지급·잠금 해제 흐름 전체를 키 없이 확인 가능

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | API + Web 개발 서버 |
| `npm test` | 전 워크스페이스 단위·통합 테스트 (엔진·API·웹) |
| `npm run test:e2e` | Playwright E2E (웹) |
| `npm run typecheck` | 전체 타입 검사 |
| `npm run build` | API(`apps/api/dist`) + Web(`apps/web/dist`) 운영 빌드 |
| `npm start` | 빌드된 API 실행 |
| `npm run db:migrate` / `db:seed` | 마이그레이션 / 상품 시드 |
| `npm run build:app:android -w @saju/web` | Android 앱 빌드 + `cap sync` → `apps/web/android` 에서 `./gradlew assembleDebug` (iOS 는 macOS 에서 `build:app:ios`) → [`docs/APP_PORTING.md`](docs/APP_PORTING.md) |

## CI

`.github/workflows/ci.yml` — 푸시/PR 마다 ① 타입검사·단위/통합·E2E ② Android 디버그 APK(아티팩트) ③ **iOS 시뮬레이터 빌드(macOS 러너)**.

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 제품 결정 — 기능 범위, 상품·가격, 광고 정책, UX 원칙, 출시 체크리스트 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 시스템 구조, 흐름(게스트→회원, 결제, IAP, 권한), 데이터 모델, PostgreSQL 전환·배포 |
| [`docs/SAJU_ENGINE.md`](docs/SAJU_ENGINE.md) | 사주 계산 방법론과 검증(KASI 절입 시각, 3,000건 교차 검증) |
| [`docs/API.md`](docs/API.md) | REST API 레퍼런스 |
| [`docs/ENV_KEYS.md`](docs/ENV_KEYS.md) | **연동할 API 키 전체 목록 · 발급처 · 없을 때 동작** |
| [`docs/PAYMENTS.md`](docs/PAYMENTS.md) | 토스페이먼츠·포트원·인앱결제 연동과 PG 심사 |
| [`docs/AUTH_PUSH.md`](docs/AUTH_PUSH.md) | 소셜 로그인 4종 · FCM 푸시 설정 |
| [`docs/ADS_ANALYTICS.md`](docs/ADS_ANALYTICS.md) | 광고(AdSense·애드핏·AdMob)·분석(GA4·Meta·카카오 픽셀)·카카오 공유 |
| [`docs/APP_PORTING.md`](docs/APP_PORTING.md) | Capacitor iOS/Android 포팅·심사 대응 |
| [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) | 출시 전 보안·로직 리뷰 15건과 조치 |
| [`docs/QA.md`](docs/QA.md) | 테스트 전략 · E2E 시나리오 · 수동 확인 항목 |
| [`docs/research/`](docs/research) | 경쟁 서비스 분석(기능·가격·UI/UX·카피), 타로 시장·사주아이 분석(`05`)·타로 화면·문구(`06`), 카피 리소스 `copy-ko.json`·`copy-tarot-ko.json` |

## 팀 구성 (서브 에이전트)
팀장(스택·코어 개발: 엔진·API·웹 코어) / 마케팅·광고팀(경쟁 분석·가격·광고·분석) / 홍보·브랜딩팀(UI/UX·카피) / 콘텐츠팀(해석 문구) / 결제팀 / 인증·알림팀 / 앱팀 / QA팀
