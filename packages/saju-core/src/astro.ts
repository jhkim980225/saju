/**
 * 별자리 운세용 간이 천문 계산 — 태양·달·목성·토성의 지심 황경(그 날의 춘분점 기준, tropical).
 *
 * - 태양: Meeus 『Astronomical Algorithms』 25장 저정밀식. 오차 0.01° 안팎
 *   → 24절기 중기(춘분 0°, 곡우 30° …) 시각과 비교해 검증한다(lunar-javascript·KASI 기준).
 * - 달: Meeus 47장 경도 주기항 상위 34개 + 금성·목성 섭동 3항. 오차 0.3° 안팎(달은 시간당 약 0.55° 움직이므로
 *   별자리가 바뀌는 시각은 1시간 안팎 차이가 날 수 있다) → 음력 초하루(KASI)와 Meeus 예제 47.a 로 검증.
 * - 목성·토성: JPL(Standish) 근사 케플러 궤도 요소(1800~2050년용)로 태양 중심 위치를 구하고,
 *   지구(지구·달 질량중심) 위치를 빼서 지심 황경을 얻는다. 세차는 J2000 기준 1.397°/세기로 더한다.
 *   오차는 0.1~0.3° 수준이라 별자리를 옮기는 날짜가 며칠 어긋날 수 있다.
 *
 * 결과는 30° 단위 별자리(0 = 양자리 … 11 = 물고기자리)를 정하는 데만 쓴다. 정밀 천문력이 필요한 곳에는 쓰지 않는다.
 */

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;

const norm360 = (x: number) => ((x % 360) + 360) % 360;
const sinD = (x: number) => Math.sin(x * DEG);
const cosD = (x: number) => Math.cos(x * DEG);

/** UTC epoch ms → 율리우스일(JD) */
export function julianDay(utcMs: number): number {
  return utcMs / DAY_MS + 2_440_587.5;
}

/** J2000.0 기준 율리우스 세기 (ΔT 약 70초는 무시 — 결과에 주는 영향은 달 0.01° 미만) */
function centuries(utcMs: number): number {
  return (julianDay(utcMs) - 2_451_545.0) / 36_525;
}

/** 태양의 겉보기 황경(도) */
export function sunLongitude(utcMs: number): number {
  const T = centuries(utcMs);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinD(M) + (0.019993 - 0.000101 * T) * sinD(2 * M) + 0.000289 * sinD(3 * M);
  const omega = 125.04 - 1934.136 * T;
  return norm360(L0 + C - 0.00569 - 0.00478 * sinD(omega));
}

/** Meeus 표 47.A 경도 항 — [D, M, M', F, 계수(1e-6 도)] */
const MOON_TERMS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618],
  [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066],
  [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528], [0, 0, 1, -2, 10980],
  [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665], [0, 1, -2, 0, -2689],
  [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390], [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236],
  [0, 1, 2, 0, -2120], [0, 2, 0, 0, -2069],
];

/** 달의 황경(도) */
export function moonLongitude(utcMs: number): number {
  const T = centuries(utcMs);
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;

  let sum = 0;
  for (const [d, m, mp, f, coef] of MOON_TERMS) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sum += coef * e * sinD(d * D + m * M + mp * Mp + f * F);
  }
  sum += 3958 * sinD(A1) + 1962 * sinD(Lp - F) + 318 * sinD(A2);
  return norm360(Lp + sum / 1_000_000);
}

/** JPL 근사 궤도 요소(1800~2050) — [a(AU), e, I, L, 근일점 경도 ϖ, 승교점 경도 Ω] 와 세기당 변화율 */
type Elements = readonly [number, number, number, number, number, number];
const ORBITS: Record<'earth' | 'jupiter' | 'saturn', { base: Elements; rate: Elements }> = {
  earth: {
    base: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  },
  jupiter: {
    base: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  saturn: {
    base: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
};

/** 태양 중심 황도 직교좌표(J2000 황도·춘분점, AU) */
function heliocentric(body: keyof typeof ORBITS, T: number): [number, number, number] {
  const { base, rate } = ORBITS[body];
  const [a, e, I, L, peri, node] = base.map((v, i) => v + rate[i]! * T) as unknown as Elements;
  const omega = peri - node;
  let M = norm360(L - peri);
  if (M > 180) M -= 360;
  // 케플러 방정식 E - e·sinE = M (라디안, 뉴턴법)
  const Mr = M * DEG;
  let Ecc = Mr + e * Math.sin(Mr);
  for (let i = 0; i < 8; i++) Ecc -= (Ecc - e * Math.sin(Ecc) - Mr) / (1 - e * Math.cos(Ecc));
  const xp = a * (Math.cos(Ecc) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(Ecc);
  const [cw, sw, cn, sn, ci, si] = [cosD(omega), sinD(omega), cosD(node), sinD(node), cosD(I), sinD(I)];
  return [
    (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
    (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** 목성·토성의 지심 황경(도, 그 날의 춘분점 기준) */
export function planetLongitude(body: 'jupiter' | 'saturn', utcMs: number): number {
  const T = centuries(utcMs);
  const p = heliocentric(body, T);
  const earth = heliocentric('earth', T);
  const lonJ2000 = Math.atan2(p[1] - earth[1], p[0] - earth[0]) / DEG;
  return norm360(lonJ2000 + 1.3969713 * T);
}

export type SkyBody = 'sun' | 'moon' | 'jupiter' | 'saturn';

export function bodyLongitude(body: SkyBody, utcMs: number): number {
  if (body === 'sun') return sunLongitude(utcMs);
  if (body === 'moon') return moonLongitude(utcMs);
  return planetLongitude(body, utcMs);
}

/** 황경 → 별자리 인덱스 (0 = 양자리, 1 = 황소자리 … 11 = 물고기자리) */
export function signOfLongitude(longitude: number): number {
  return Math.floor(norm360(longitude) / 30) % 12;
}

export function signOfBody(body: SkyBody, utcMs: number): number {
  return signOfLongitude(bodyLongitude(body, utcMs));
}

/**
 * fromUtcMs 이후 처음으로 천체가 다른 별자리로 옮기는 시각(분 단위 이분 탐색).
 * stepMs 간격으로 훑으므로, stepMs 보다 짧게 머무는 경우(역행 직후 등)는 놓칠 수 있다.
 * maxMs 안에 바뀌지 않으면 null.
 */
export function nextSignChange(body: SkyBody, fromUtcMs: number, opts: { stepMs?: number; maxMs?: number } = {}): { utcMs: number; from: number; to: number } | null {
  const step = opts.stepMs ?? (body === 'moon' ? 3_600_000 : DAY_MS);
  const max = opts.maxMs ?? (body === 'moon' ? 4 * DAY_MS : body === 'sun' ? 40 * DAY_MS : 1_200 * DAY_MS);
  const from = signOfBody(body, fromUtcMs);
  let lo = fromUtcMs;
  for (let t = fromUtcMs + step; t <= fromUtcMs + max; t += step) {
    const s = signOfBody(body, t);
    if (s !== from) {
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2);
        if (signOfBody(body, mid) === from) lo = mid;
        else hi = mid;
      }
      return { utcMs: hi, from, to: s };
    }
    lo = t;
  }
  return null;
}

/** 달과 태양의 이각(0~360°) — 0 근처 = 삭(초승 전), 180 근처 = 망(보름) */
export function moonElongation(utcMs: number): number {
  return norm360(moonLongitude(utcMs) - sunLongitude(utcMs));
}

/**
 * 태양 별자리(sign)를 1번 자리로 셀 때 천체 별자리가 몇 번째 자리인지(1~12) — 태양 별자리를 기준으로 세는 솔라 하우스(solar house) 방식(상승궁 기준의 홀사인 하우스와 다르다).
 * 1 = 같은 별자리(합), 5·9 = 120°(트라인), 3·11 = 60°(섹스타일), 4·10 = 90°(스퀘어), 7 = 180°(오포지션),
 * 2·12 = 30°, 6·8 = 150°(퀸컹스).
 */
export function solarHouse(sunSign: number, bodySign: number): number {
  return ((((bodySign - sunSign) % 12) + 12) % 12) + 1;
}

export type AspectKind = 'conjunction' | 'semisextile' | 'sextile' | 'square' | 'trine' | 'quincunx' | 'opposition';

const ASPECT_BY_DISTANCE: readonly AspectKind[] = ['conjunction', 'semisextile', 'sextile', 'square', 'trine', 'quincunx', 'opposition'];

/** 두 별자리 사이의 각(별자리 단위) */
export function signAspect(a: number, b: number): AspectKind {
  const d = ((((b - a) % 12) + 12) % 12);
  return ASPECT_BY_DISTANCE[Math.min(d, 12 - d)]!;
}
