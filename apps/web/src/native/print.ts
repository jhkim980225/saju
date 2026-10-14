/**
 * 보고서 PDF 저장(앱) — 지금 웹뷰를 시스템 인쇄 화면으로 넘긴다 (@capgo/capacitor-printer).
 *  - Android: PrintManager + WebView.createPrintDocumentAdapter → 프린터 선택에서 'PDF로 저장'
 *  - iOS: UIPrintInteractionController + WKWebView.viewPrintFormatter → 인쇄 옵션의 공유 버튼 → '파일에 저장'
 * 화면을 그린 웹뷰가 그대로 인쇄하므로 @media print 규칙과 이미 받은 글꼴(Pretendard·마루 부리·Noto Serif KR)이
 * 웹의 '인쇄 → PDF로 저장'과 똑같이 적용되고, 네트워크 없이도 된다.
 * 인쇄 화면이 닫히면(저장·취소 모두) 끝난다 — 그때까지 웹뷰 내용이 인쇄 원본이므로 화면을 바꾸지 않는다.
 */
import { Printer } from '@capgo/capacitor-printer';

export async function printWebView(name: string): Promise<void> {
  await Printer.printWebView({ name });
}
