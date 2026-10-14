import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initAnalytics } from './lib/analytics';
import { initTheme } from './lib/theme';
import { initNative } from './native';
// 본문 폰트 — 쓰인 글자 묶음만 내려받는 분할본(앱 번들에 포함, 오프라인에서도 동작)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/index.css';

async function bootstrap() {
  // 앱(Capacitor)에서는 네이티브 저장소·상태바·뒤로가기 등을 먼저 연결한다 (웹에서는 즉시 반환)
  await initNative();
  initTheme();
  initAnalytics();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
