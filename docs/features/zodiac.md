# 띠별 운세 · 별자리 운세

> 기준일: 2026-11-26. 계산 방법은 [SAJU_ENGINE.md §7](../SAJU_ENGINE.md), 응답 필드는 [API.md 「띠별 · 별자리 운세」](../API.md)를 본다.

## 목적

개인 원국 없이 "띠 하나" 또는 "태양 별자리 하나"로 보는 무료 공개 콘텐츠다. 검색 유입을 받아 사주 입력으로 이어 주는 것이 목적이다. 화면에는 "태어난 날과 시간까지 입력하면 내 사주에 맞춘 오늘의 운세를 볼 수 있다"는 안내를 함께 둔다.

운영 상태는 둘 다 **운영 중**이다. 전부 무료이고 로그인도 필요 없다.

## 사용자 흐름

| 화면 | 주소 |
|---|---|
| 띠별 첫 화면(12띠 오늘 한눈에, 태어난 해로 띠 찾기) | `/zodiac` |
| 띠 하나 | `/zodiac/:animal/:period?` |
| 별자리 첫 화면(12별자리 오늘 한눈에, 생일로 별자리 찾기) | `/horoscope` |
| 별자리 하나 | `/horoscope/:sign/:period?` |

1. 전체 운세 메뉴('띠·별자리'), 마이, 검색 유입으로 들어온다. 하단 탭이 함께 보인다.
2. 저장한 프로필(마지막으로 쓴 프로필 → 대표 프로필 순)이나 비회원 입력값이 있어도 첫 화면의 12띠·12별자리 목록을 그대로 보여 준다. 대신 첫 화면 맨 위에 '내 띠(별자리) 오늘의 운세 보기' 바로 가기를 두고, 목록에서 내 띠·별자리에 '내 띠'·'내 별자리' 표시를 붙인다. 음력 프로필과 비회원 입력값은 원국 계산(`/chart`)으로 양력 날짜와 입춘 기준 띠를 얻는다(`useOwnSigns`).
3. 기간 탭(오늘·내일·이번 주·이번 달·올해)과 띠·별자리 선택 줄로 다른 기간과 다른 띠·별자리를 본다. 기간이 없는 주소(`/zodiac/:animal`)는 기본 기간 주소로 옮긴다.
4. 띠 찾기는 태어난 해(양력)를 받아 띠를 알려 주고, "입춘(2월 4일 무렵) 전에 태어났다면 앞 해의 띠"라고 안내한다. 별자리 찾기는 생일 월·일로 별자리를 알려 주고, 경계일이면 "옆 별자리일 수 있다"고 안내한다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 라우트 | `apps/api/src/modules/zodiac/routes.ts` |
| 생성기 | `apps/api/src/modules/zodiac/zodiacFortune.ts`, `apps/api/src/modules/zodiac/horoscope.ts`, `apps/api/src/modules/zodiac/common.ts` |
| 문구 풀 | `apps/api/src/modules/zodiac/content/zodiacText.ts`, `apps/api/src/modules/zodiac/content/horoscopeText.ts` |
| 계산 엔진 | `packages/saju-core/src/zodiac.ts`(`evaluateZodiac`, 지지 관계), `packages/saju-core/src/astro.ts`(태양·달·목성·토성 위치, `ASTRO_MIN_YEAR`·`ASTRO_MAX_YEAR`) |
| 공용 정의 | `packages/shared/src/zodiac.ts`(`FREE_FORTUNE_PERIODS`, `ZODIAC_ANIMALS`, `STAR_SIGNS`, `starSignOfBirthday`) |
| 화면 | `apps/web/src/pages/ZodiacPage.tsx`, `apps/web/src/pages/HoroscopePage.tsx`, `apps/web/src/components/FreeFortune.tsx`, `apps/web/src/lib/freeFortune.ts` |
| SEO 사전 렌더링 | `apps/web/scripts/prerender.mts`(12띠·12별자리 × 5기간 주소) |
| 테스트 | `apps/api/test/zodiac.test.ts`, `packages/saju-core/test/zodiac.test.ts`, `apps/web/src/lib/__tests__/freeFortune.test.tsx`, `e2e/free-fortune.spec.ts` |

## API / 데이터 모델

- `GET /zodiac`, `GET /zodiac/:animal`, `GET /horoscope`, `GET /horoscope/:sign`. 인증이 필요 없다. 쿼리는 `period`(`today` 기본·`tomorrow`·`week`·`month`·`year`)와 `date`(KST `YYYY-MM-DD`, 기본 오늘)다. `date` 범위는 띠 1900~2100년, 별자리 1900~2049년이다.
- 저장하는 데이터가 없다. 요청마다 계산한다.

## 비즈니스 규칙 & 엣지케이스

### 공통

- **같은 입력은 항상 같은 결과다.** 문장은 계산 결과로 풀을 고르고, 풀 안의 변형은 (띠·별자리, 기간, 기간 시작일) 해시로 고른다. 무작위가 없다. 이번 달·올해 문구는 그 기간 안에서는 날짜가 달라도 같다.
- 개인 정보를 받지 않고 같은 입력이면 같은 응답이므로 `Cache-Control: public` 을 붙인다. `date` 를 주면 `max-age=600`, `date` 없이 서버의 오늘(KST)로 계산하면 600초와 KST 자정까지 남은 초 중 짧은 쪽(`secondsToKstMidnight`)이다. 자정 직후 캐시에서 전날 결과가 나오지 않게 하려는 것이다. 웹은 언제나 `date` 를 붙여 부른다.
- 잘못된 `period`·`date`(띠는 1900~2100 밖, 별자리는 1900~2049 밖, 없는 날짜)는 400, 없는 띠·별자리는 404 다. 별자리 범위는 목성·토성 궤도 요소(1800~2050년용)와 태양 날짜표 검증(1950~2049)에 맞춰 '올해' 기간도 근사 범위 안에 들게 정했다.
- AI 를 쓰지 않으므로 키 없이 동작하고 AI 비용이 0원이다.
- 기간별 흐름(좋음·무난·섞임·살핌) 판정은 **달달사주 기준**이며 화면에 밝힌다([../PLAIN_KOREAN.md §4](../PLAIN_KOREAN.md)).
- 광고 자리: 첫 화면은 본문 중간(`web_content_mid`)만, 띠 하나·별자리 하나 화면은 본문 중간(`web_content_mid`)과 결과 하단(`result_bottom`)이다. 광고는 키가 없어 꺼져 있다([ads-analytics.md](./ads-analytics.md)).

### 띠별 운세

- 띠는 년지이고 **입춘**을 해의 경계로 본다. 포털의 "음력 설 기준"과 다르므로 화면(`basisNote`)에 밝힌다.
- 기간별 운 기둥: 오늘·내일은 그날 일진, 이번 달은 그날 정오(KST)가 속한 절기 달의 월건, 올해는 입춘~입춘 세운이다. 절입이 오후면 그날은 앞 달로 본다.
- 띠와 운 기둥 지지의 관계(육합·삼합·충·형·원진·해·파)와 오행 작용으로 점수와 흐름을 정한다. 가중치와 우선순위 표는 [SAJU_ENGINE.md §7.1](../SAJU_ENGINE.md).
- 이번 주는 월~일 7일 일진의 관계 점수로 좋은 날·살필 날을 뽑는다.
- 년생별 한 줄은 기준 연도 7~90세의 같은 띠 출생 연도마다, 태어난 해 천간과 운 천간의 관계로 고른다. 태어난 해 천간을 '나'로 보는 **달달사주 방식**이다(정식 사주는 일간 기준). 나이대별 실천 한 줄을 붙인다.
- 행운 포인트(색·방향·수)는 합이 만드는 오행, 없으면 띠 오행을 생해 주는 오행에서 고른다.

### 별자리 운세

- 내 별자리는 태양 별자리 날짜표(`starSignOfBirthday`)로 정한다. 1950~2049 모든 날 정오의 실제 태양 별자리와 경계일 앞뒤 하루를 빼고 일치한다(테스트). 음력 프로필은 원국 계산의 양력 날짜로 찾는다.
- 천체 위치는 외부 의존성 없는 간이 천문 계산이다(태양 Meeus 25장, 달 Meeus 47장 주기항, 목성·토성 JPL 근사 궤도 요소). 오차는 달이 별자리를 옮기는 시각 1시간 안팎, 행성은 며칠 안팎이며 화면에 밝힌다.
- 자리는 태양 별자리를 1번으로 세는 **솔라 하우스**다(상승궁 기준의 출생 차트 하우스와 다름). 각에 따라 흐름을 정한다: 같은 별자리·60°·120° 좋음, 30° 무난, 150°·180° 섞임, 90° 살핌.
- 오늘·내일은 그날 정오 달의 별자리, 이번 주는 매일 정오의 달, 이번 달은 태양이 지금 머무는 별자리 기간, 올해는 목성·토성 자리다.
- 화면 고지: "서양 점성술을 바탕으로 한 참고용 콘텐츠", "같은 별자리라면 모두에게 같은 풀이".

## 주의사항 / 알려진 이슈

1. 해결(2026-11-26): FEATURES.md §8 과 §17.1 의 광고 자리 서술을 코드에 맞췄다. 띠 하나·별자리 하나 화면에는 본문 중간(`web_content_mid`)과 결과 하단(`result_bottom`) 자리가 있다.
2. 해결(2026-11-26): SAJU_ENGINE.md §7.2 의 자리 계산 표기를 코드·화면·ACCURACY_REVIEW.md 와 같은 '솔라 하우스(태양 별자리를 1번 자리로 세는 방식, 상승궁 기준의 홀사인 하우스와 다름)'로 고쳤다.
3. 해결(2026-11-26): 별자리 API 는 `date` 를 1900~2049년(`ASTRO_MIN_YEAR`·`ASTRO_MAX_YEAR`)만 받는다. 범위 밖은 400 이다. 띠는 천문 계산을 쓰지 않아 1900~2100년을 그대로 받는다.
4. 해결(2026-11-26): 띠·별자리 첫 화면은 내 띠·별자리를 알아도 바로 넘기지 않는다. 12띠·12별자리 목록을 보여 주고, 맨 위 바로 가기와 목록의 '내 띠'·'내 별자리' 표시로 안내한다(`e2e/free-fortune.spec.ts` 도 새 흐름으로 고쳤다).
5. 해결(2026-11-26): `date` 없이 부른 응답의 캐시 시간을 KST 자정까지 남은 시간으로 줄인다. 자정 직후 전날 결과가 캐시에서 나오지 않는다.
