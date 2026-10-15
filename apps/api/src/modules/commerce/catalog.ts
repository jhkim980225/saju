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
 *   taekil:reading         → taekil:reading:<readingId> (택일 결과 1건 상세)
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
    description: '돈·연애·일에 대한 풀이(재물운·연애운·직업운)를 열어 볼 수 있어요. 계정마다 한 번만 살 수 있어요.',
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
    description: '타고난 성향과 다섯 가지 기운(나무·불·흙·쇠·물)의 균형, 80년 동안 10년마다 바뀌는 큰 흐름, 한 해 열두 달 흐름까지 A4 20쪽에 담았어요. PDF로 저장할 수 있고, AI 상담 질문권 3회가 함께 들어 있어요.',
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
    description: '2027년 한 해의 큰 흐름과 돈·사랑·일·건강, 열두 달 흐름까지 A4 10쪽에 담았어요.',
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
    description: '두 사람의 타고난 성향이 어떻게 어울리는지, 서로 끌리는 점과 맞춰 갈 점, 대화하고 다투는 방식, 올해와 내년 흐름까지 담았어요.',
    type: 'one_time',
    price: 5900,
    grants: ['report:compatibility'],
    iosProductId: 'kr.dalbitsaju.report.compat',
    androidProductId: 'report_compat',
  },
  // ── 주제별 리포트 (docs/research/01-competitor-features.md S8) — 프로필 하나, 일회성 ──
  {
    id: 'report_love',
    name: '연애·결혼운 리포트',
    description: '사랑할 때의 내 모습, 오래 함께하기 좋은 사람, 부딪히기 쉬운 지점, 앞으로 10년의 인연 흐름과 가까운 3년 풀이까지 담았어요. PDF로 저장할 수 있어요.',
    type: 'one_time',
    price: 4900,
    grants: ['report:love'],
    iosProductId: 'kr.dalbitsaju.report.love',
    androidProductId: 'report_love',
  },
  {
    id: 'report_career_wealth',
    name: '재물·직업운 리포트',
    description: '돈이 들어오고 나가는 길, 잘 버는 방법과 지키는 방법, 어울리는 일과 분야, 앞으로 10년 가운데 방향을 바꾸기 좋은 때와 가까운 3년 풀이까지 담았어요. PDF로 저장할 수 있어요.',
    type: 'one_time',
    price: 4900,
    grants: ['report:career_wealth'],
    iosProductId: 'kr.dalbitsaju.report.careerwealth',
    androidProductId: 'report_career_wealth',
  },
  {
    id: 'bundle_newyear_2027',
    name: '2027 신년 패키지',
    description: '사주분석서와 2027 신년운세, 궁합 리포트 한 번, AI 상담 질문권 열 번을 한꺼번에 담았어요.',
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
    description: '내 사주를 아는 AI 상담가에게 궁금한 걸 물어보세요. 기한 없이 쓸 수 있어요.',
    type: 'credit_pack',
    price: 3900,
    credits: 10,
    iosProductId: 'kr.dalbitsaju.chat.10',
    androidProductId: 'chat_pack_10',
  },
  {
    id: 'chat_pack_30',
    name: 'AI 상담 질문권 30회',
    description: '한 번에 330원꼴이에요. 기한 없이 쓸 수 있어요.',
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
    description: '카드 자리마다 질문에 맞춘 풀이와 카드끼리 이어지는 이야기, 내 사주와 함께 본 풀이까지 담았어요. AI 상담 질문권 1회가 함께 들어 있어요.',
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
    description: '상대의 마음과 둘 사이의 흐름, 관계를 위해 해 볼 일까지 다섯 장으로 깊게 읽어요. AI 상담 질문권 1회가 함께 들어 있어요.',
    type: 'one_time',
    price: 2900,
    credits: 1,
    grants: ['tarot:reading'],
    iosProductId: 'kr.dalbitsaju.tarot.love5',
    androidProductId: 'tarot_love_5',
  },
  {
    id: 'tarot_choice_3',
    name: '양자택일 타로 3장 깊은 풀이',
    description: '두 선택지를 같은 무게로 나란히 놓고, 길마다 기대할 것과 챙길 것을 읽어요. 내 사주와 함께 본 풀이와 AI 상담 질문권 1회가 함께 들어 있어요.',
    type: 'one_time',
    price: 990,
    credits: 1,
    grants: ['tarot:reading'],
    iosProductId: 'kr.dalbitsaju.tarot.choice3',
    androidProductId: 'tarot_choice_3',
  },
  {
    id: 'tarot_compat_5',
    name: '궁합 타로 5장 깊은 풀이',
    description: '두 사람의 마음과 서로 끌리는 점, 맞춰 갈 점을 다섯 장으로 읽고, 두 사람의 사주와 함께 본 풀이까지 담았어요. AI 상담 질문권 1회가 함께 들어 있어요.',
    type: 'one_time',
    price: 2900,
    credits: 1,
    grants: ['tarot:reading'],
    iosProductId: 'kr.dalbitsaju.tarot.compat5',
    androidProductId: 'tarot_compat_5',
  },
  {
    id: 'tarot_celtic_10',
    name: '켈틱 크로스 10장 깊은 풀이',
    description: '한 가지 고민을 카드 열 장으로 깊고 넓게 펼쳐 읽어요. 자리별 풀이와 카드끼리 이어지는 이야기, 내 사주와 함께 본 풀이까지 담았어요. AI 상담 질문권 3회가 함께 들어 있어요.',
    type: 'one_time',
    price: 4900,
    credits: 3,
    grants: ['tarot:reading'],
    iosProductId: 'kr.dalbitsaju.tarot.celtic10',
    androidProductId: 'tarot_celtic_10',
  },
  // ── 택일 (docs/research/05-tarot-market.md §2.2 사주아이 '990원 택일') — 택일 결과 1건의 상세를 여는 소모성 상품 ──
  {
    id: 'report_taekil',
    name: '택일 상세 풀이',
    description: '추천 날짜 세 곳이 좋은 이유와 시작하기 좋은 시간, 날짜마다 좋은 점과 아쉬운 점, 목적에 맞춘 조언까지 열어 봐요.',
    type: 'one_time',
    price: 990,
    grants: ['taekil:reading'],
    iosProductId: 'kr.dalbitsaju.report.taekil',
    androidProductId: 'report_taekil',
  },
];
