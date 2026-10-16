import { Suspense, lazy } from 'react';
import { BottomSheet } from './BottomSheet';
import { Spinner } from './ui';

// 첫 화면 번들에 용어 설명을 싣지 않게 — 팝업을 열 때 내려받는다
const BasicsContent = lazy(() => import('@/pages/BasicsPage').then((m) => ({ default: m.BasicsContent })));

/** 사주 기초 팝업 — 보던 화면(입력 중인 폼·결과)을 떠나지 않고 읽게. 모바일은 아래에서 올라오고, PC 는 가운데 넓은 창 */
export function BasicsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="사주 기초" size="wide">
      <Suspense fallback={<Spinner />}>
        <BasicsContent />
      </Suspense>
    </BottomSheet>
  );
}
