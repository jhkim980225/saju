/**
 * 토스 미니앱 시작 — main.tsx 가 토스 빌드에서만 불러온다(동적 import → 웹·앱 번들에는 들어가지 않는다).
 *  - 화면: 밝은 화면 고정(앱인토스 비게임은 라이트 모드), 토스 내비게이션 바가 뒤로가기를 맡으므로 자체 뒤로가기는 숨긴다(components/ui 의 PageHeader).
 *  - 라우트: 토스 첫 버전에 없는 화면을 빼고 떠 있는 탭바로 바꾼다.
 *  - 세션: 로그인 화면 없이 토스 계정으로 들어온다. 실패하면 게스트로 무료 기능만 연다.
 */
import './toss.css';
import { ensureSession } from '@/lib/session';
import { registerFutureDayGate, registerLegalDocs, registerRouteTransform, registerSheetHistory } from '@/lib/tossBridge';
import { useFutureDayGate } from './futureDayGate';
import { tossLegalDocs } from './legal';
import { tossRoutes } from './routes';
import { installSheetHistory, useSheetHistory } from './sheetHistory';

export async function bootstrapToss(): Promise<void> {
  document.documentElement.dataset.theme = 'light';
  document.documentElement.dataset.platform = 'toss';
  registerRouteTransform(tossRoutes);
  registerFutureDayGate(useFutureDayGate);
  // 라우터보다 먼저 popstate 를 듣는다 — 시트를 닫는 뒤로가기는 화면 이동으로 넘기지 않는다
  installSheetHistory();
  registerSheetHistory(useSheetHistory);
  // 약관·개인정보 처리방침은 토스용 문서로 바꾼다(웹 계정과 분리, 인앱 결제 환불, 광고, 생성형 AI, 사업자 정보)
  registerLegalDocs(tossLegalDocs());
  // 렌더를 막지 않는다 — 탭 화면의 세션 게이트(useSessionGate)가 같은 약속을 기다린다
  void ensureSession().catch(() => undefined);
}
