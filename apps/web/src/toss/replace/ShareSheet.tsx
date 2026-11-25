/**
 * 공유 바텀시트 (토스 빌드) — components/ShareSheet.tsx 를 대신한다.
 * 토스 공유 링크(토스 앱에서 이 화면을 여는 링크)를 시스템 공유 시트로 보내거나 복사한다.
 */
import { Link2, Share2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { toast } from '@/components/Toast';
import { t } from '@/lib/copy';
import { copyLink, shareLink } from '@/lib/share';
import type { SharePayload } from '@/lib/share';

export function ShareSheet({ open, onClose, payload }: { open: boolean; onClose: () => void; payload: SharePayload }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const onShare = () =>
    run(async () => {
      if ((await shareLink(payload)) === 'shared') onClose();
      else toast('공유를 마치지 못했어요. 다시 시도해 주세요.');
    });
  const onCopy = () =>
    run(async () => {
      if (await copyLink(payload.url)) {
        toast(t('common.linkCopied'));
        onClose();
      } else toast('링크를 복사하지 못했어요. 다시 시도해 주세요.');
    });

  return (
    <BottomSheet open={open} onClose={onClose} title={t('share.sheetTitle')}>
      <ul className="flex justify-center gap-6 py-3">
        <Option label="공유하기" onClick={onShare} disabled={busy}>
          <Share2 className="size-6" aria-hidden />
        </Option>
        <Option label={t('share.copyLink')} onClick={onCopy} disabled={busy}>
          <Link2 className="size-6" aria-hidden />
        </Option>
      </ul>
      <p className="mt-1 text-center text-xs text-ink-3">{t('share.privacyNote')}</p>
    </BottomSheet>
  );
}

function Option({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} disabled={disabled} className="flex w-16 flex-col items-center gap-2 text-sm text-ink-2 disabled:opacity-60">
        <span className="grid size-14 place-items-center rounded-full bg-subtle text-ink">{children}</span>
        {label}
      </button>
    </li>
  );
}
