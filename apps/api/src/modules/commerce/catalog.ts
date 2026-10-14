/**
 * 상품 카탈로그 — 마케팅팀 권장안(docs/research/03-pricing-payments-ads.md) 기준.
 * 서버 기동/마이그레이션 시 DB 에 upsert 된다. 가격 변경은 이 파일만 수정하면 된다.
 *
 * grants 템플릿 규칙 (fulfillment 시 실제 권한 키로 변환):
 *   report:lifetime        → report:lifetime:<profileId>
 *   report:mini            → report:mini:<profileId>
 *   report:yearly:<YYYY>   → report:yearly:<profileId>:<YYYY>
 *   report:compatibility   → report:compatibility:<profileA>:<profileB> (상대 미지정 시 ticket 으로 지급)
 *   report:love / report:career_wealth → report:<kind>:<profileId>
 *   ticket:compatibility   → ticket:compatibility:<orderId> (나중에 궁합 1회 열람에 사용)
 *   tarot:reading          → tarot:reading:<readingId> (타로 리딩 1건 깊은 풀이)
 */
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  type: 'one_time' | 'credit_pack' | 'subscription';
  price: number;
  listPrice?: number;
  credits?: number;
  grants?: string[];
  periodDays?: number;
  perUserLimit?: number;
  /** ISO 시각 — 지나면 listPrice 로 판매 */
  saleEndsAt?: string;
  badge?: string;
  comingSoon?: boolean;
  iosProductId?: string;
  androidProductId?: string;
}

export const CATALOG: CatalogItem[] = [
  {
    id: 'report_saju_mini',
    name: '첫 사주 미니 리포트',
    description: '재물운·연애운·직업운 풀이를 열어볼 수 있어요. (계정당 1회)',
    type: 'one_time',
    price: 990,
    listPrice: 2900,
    grants: ['report:mini'],
    perUserLimit: 1,
    badge: '첫 구매 특가',
    iosProductId: 'kr.dalbitsaju.report.mini',
    androidProductId: 'report_saju_mini',
  },
  {
    id: 'report_saju_lifetime',
    name: '평생 사주분석서',
    description: '원국표·오행 비율·대운 80년·열두 달 월운까지 A4 20쪽 분량. PDF로 저장할 수 있어요. AI 질문권 3회 포함.',
    type: 'one_time',
    price: 9900,
    listPrice: 19800,
    credits: 3,
    grants: ['report:lifetime'],
    badge: '가장 인기',
    iosProductId: 'kr.dalbitsaju.report.lifetime',
    androidProductId: 'report_saju_lifetime',
  },
  {
    id: 'report_newyear_2027',
    name: '2027 丁未년 신년운세',
    description: '2027년 총운과 재물·애정·직장·건강, 열두 달마다 영역별 흐름까지 A4 10쪽 분량으로 담았어요.',
    type: 'one_time',
    price: 5900,
    listPrice: 7900,
    grants: ['report:yearly:2027'],
    saleEndsAt: '2026-12-31T14:59:59.000Z',
    badge: '얼리버드',
    iosProductId: 'kr.dalbitsaju.report.newyear2027',
    androidProductId: 'report_newyear_2027',
  },
  {
    id: 'report_compat',
    name: '사주 궁합 리포트',
    description: '본성과 오행의 균형, 끌림과 조율 포인트, 대화·갈등 방식, 올해·내년 흐름까지 담은 리포트예요.',
    type: 'one_time',
    price: 5900,
    grants: ['report:compatibility'],
    iosProductId: 'kr.dalbitsaju.report.compat',
    androidProductId: 'report_compat',
  },
  {
    id: 'bundle_newyear_2027',
    name: '2027 신년 패키지',
    description: '사주분석서 + 2027 신년운세 + 궁합 1회권 + AI 질문권 10회',
    type: 'one_time',
    price: 16900,
    listPrice: 23700,
    credits: 10,
    grants: ['report:lifetime', 'report:yearly:2027', 'ticket:compatibility'],
    badge: '29% 할인',
    iosProductId: 'kr.dalbitsaju.bundle.newyear2027',
    androidProductId: 'bundle_newyear_2027',
  },
  {
    id: 'chat_pack_10',
    name: 'AI 상담 질문권 10회',
    description: '내 사주를 아는 AI 상담가에게 궁금한 걸 물어보세요. 유효기간 없음.',
    type: 'credit_pack',
    price: 3900,
    credits: 10,
    iosProductId: 'kr.dalbitsaju.chat.10',
    androidProductId: 'chat_pack_10',
  },
  {
    id: 'chat_pack_30',
    name: 'AI 상담 질문권 30회',
    description: '1회당 330원. 유효기간 없음.',
    type: 'credit_pack',
    price: 9900,
    listPrice: 11700,
    credits: 30,
    badge: 'BEST',
    iosProductId: 'kr.dalbitsaju.chat.30',
    androidProductId: 'chat_pack_30',
  },
  // ── 타로 (docs/research/05-tarot-market.md §7.4) — 리딩 1건을 여는 소모성 상품 ──
  {
    id: 'tarot_question_3',
    name: '질문 타로 3장 깊은 풀이',
    description: '자리마다 질문에 맞춘 풀이, 카드끼리 이어지는 이야기, 사주로 본 근거까지. AI 질문권 1회 포함.',
    type: 'one_time',
    price: 990,
    credits: 1,
    grants: ['tarot:reading'],
    iosProductId: 'kr.dalbitsaju.tarot.question3',
    androidProductId: 'tarot_question_3',
  },
  {
    id: 'tarot_love_5',
    name: '연애 속마음·재회 타로 5장',
    description: '상대의 마음과 둘 사이의 흐름, 관계를 위한 행동까지 다섯 장으로 깊게 읽어요. AI 질문권 1회 포함.',
    type: 'one_time',
    price: 2900,
    credits: 1,
    grants: ['tarot:reading'],
    iosProductId: 'kr.dalbitsaju.tarot.love5',
    androidProductId: 'tarot_love_5',
  },
  // ── 2차 출시 ───────────────────────────────────────────
  { id: 'report_love', name: '연애·결혼운 리포트', description: '인연이 들어오는 시기와 나에게 맞는 사람.', type: 'one_time', price: 4900, grants: ['report:love'], comingSoon: true },
  { id: 'report_career_wealth', name: '재물·직업운 리포트', description: '돈이 모이는 방식과 커리어 전환 타이밍.', type: 'one_time', price: 4900, grants: ['report:career_wealth'], comingSoon: true },
  { id: 'chat_pack_100', name: 'AI 상담 질문권 100회', description: '1회당 269원. 유효기간 없음.', type: 'credit_pack', price: 26900, credits: 100, comingSoon: true },
  { id: 'sub_plus_monthly', name: '플러스 월 구독', description: '광고 제거 · 월운 자동 발행 · 질문권 월 100회 · 리포트 20% 할인', type: 'subscription', price: 6900, credits: 100, periodDays: 30, comingSoon: true },
  { id: 'sub_plus_yearly', name: '플러스 연 구독', description: '월 구독 혜택 + 신년운세 포함', type: 'subscription', price: 59000, credits: 100, periodDays: 365, comingSoon: true },
];
