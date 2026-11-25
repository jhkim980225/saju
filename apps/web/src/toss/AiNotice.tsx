/**
 * 생성형 AI 사용 고지 — 앱인토스 정책: 생성형 AI 기능을 처음 쓰는 시점에 그 사실을 알려야 한다.
 * 유료 리포트는 규칙 기반 본문을 AI 가 다듬은 글이 섞여 있어서, 리포트를 처음 열 때 한 번 알린다.
 * (리포트 본문의 "AI가 쓴 풀이" 표시는 기존 화면이 그대로 보여 준다)
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui';
import { storage } from '@/lib/storage';

export const AI_NOTICE_KEY = 'yd.tossAiNotice';
export const AI_NOTICE_TITLE = 'AI가 다듬은 글이 들어 있어요';
export const AI_NOTICE_BODY = [
  '리포트의 풀이는 사주 계산 결과와 달달사주가 쓴 해석을 바탕으로 만들고, 문장은 생성형 AI가 읽기 쉽게 다듬어요.',
  'AI가 다듬은 글에는 "AI가 쓴 풀이" 표시가 붙어요. 사실과 다른 표현이 섞일 수 있으니 참고용으로 읽어 주세요.',
];

export function AiNoticeGate({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => storage.get(AI_NOTICE_KEY) !== '1');
  const confirm = () => {
    storage.set(AI_NOTICE_KEY, '1');
    setOpen(false);
  };
  return (
    <>
      {children}
      <BottomSheet
        open={open}
        onClose={confirm}
        title={AI_NOTICE_TITLE}
        footer={
          <Button block size="lg" onClick={confirm}>
            확인했어요
          </Button>
        }
      >
        <div className="space-y-3 text-[15px] leading-relaxed text-ink-2">
          {AI_NOTICE_BODY.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
