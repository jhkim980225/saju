import { X } from 'lucide-react';
import { useState } from 'react';
import { useConfig } from '@/hooks/queries';
import { storage } from '@/lib/storage';

/** 닫은 공지 ID 목록(이 기기) */
const SEEN_KEY = 'yd.noticesSeen';

/**
 * 서비스 공지 — 서버 GET /config 의 notices(SERVICE_NOTICES)를 화면 위쪽에 하나씩 띄운다.
 * 약관 제13조·처리방침 끝 문장이 약관 변경을 알리는 통로로 가리키는 곳이다. 닫으면 그 공지는 이 기기에서 다시 띄우지 않는다
 */
export function NoticeBar() {
  const { data } = useConfig();
  const [seen, setSeen] = useState<string[]>(() => storage.getJSON<string[]>(SEEN_KEY) ?? []);
  const notice = data?.notices?.find((n) => !seen.includes(n.id));
  if (!notice) return null;
  const close = () => {
    const next = [...seen, notice.id].slice(-20);
    storage.setJSON(SEEN_KEY, next);
    setSeen(next);
  };
  return (
    <div role="status" className="border-b border-line bg-subtle px-4 py-3 text-sm text-ink-2">
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <div className="flex-1">
          <p className="font-semibold text-ink">{notice.title}</p>
          {notice.body && <p className="mt-1 whitespace-pre-line">{notice.body}</p>}
        </div>
        <button type="button" onClick={close} aria-label="공지 닫기" className="shrink-0 rounded-full p-1 text-ink-3 hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
