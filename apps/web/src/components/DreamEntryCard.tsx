import { MoonStar } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from './ui';

/**
 * 오늘 탭의 꿈해몽 입구 — 사전 데이터(@saju/shared/dream)는 여기서 불러오지 않는다(오늘 화면 번들을 가볍게).
 */
export function DreamEntryCard() {
  return (
    <Card className="mt-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-3">
        <MoonStar className="size-4" aria-hidden />
        꿈해몽
      </p>
      <p className="mt-2 font-serif text-lg font-semibold">어젯밤 꿈이 마음에 남았나요?</p>
      <p className="mt-0.5 text-sm text-ink-2">자주 꾸는 꿈의 전통 해석을 찾아보거나, 꿈 이야기를 적어 풀어 볼 수 있어요.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/dream" className="inline-flex h-10 items-center rounded-full bg-action-2 px-4 text-sm font-semibold">
          꿈해몽 사전
        </Link>
        <Link to="/dream/ask" className="inline-flex h-10 items-center rounded-full border border-line-strong px-4 text-sm font-semibold">
          AI 꿈풀이
        </Link>
      </div>
    </Card>
  );
}
