import { Ellipsis, Link2, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { t } from '@/lib/copy';
import { copyLink, kakaoAvailable, preloadKakao, shareKakao, shareLink, systemShareAvailable } from '@/lib/share';
import type { SharePayload } from '@/lib/share';
import { BottomSheet } from './BottomSheet';
import { toast } from './Toast';
import { cx } from './ui';

/**
 * 공유 바텀시트 — 카카오톡(웹 + VITE_KAKAO_JS_KEY 있을 때) / 링크 복사 / 더보기(시스템 공유: 앱 네이티브 또는 Web Share API 지원 시).
 * 사용 예: <ShareSheet open={open} onClose={() => setOpen(false)} payload={{ title, text, url }} />
 */
export function ShareSheet({ open, onClose, payload }: { open: boolean; onClose: () => void; payload: SharePayload }) {
  const kakao = kakaoAvailable();
  const system = systemShareAvailable();
  const [busy, setBusy] = useState(false);

  // 시트가 열릴 때 SDK 를 미리 받아 두면 카카오톡 버튼 클릭 시 팝업 차단 없이 바로 열린다
  useEffect(() => {
    if (open && kakao) preloadKakao();
  }, [open, kakao]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const onKakao = () =>
    run(async () => {
      if (await shareKakao(payload)) return onClose();
      // SDK 로드 실패·도메인 미등록 등 → 링크 복사로 대신한다
      if (await copyLink(payload.url)) {
        toast(t('common.linkCopied'));
        onClose();
      } else toast(t('error.server.title'));
    });

  const onCopy = () =>
    run(async () => {
      if (await copyLink(payload.url)) {
        toast(t('common.linkCopied'));
        onClose();
      } else toast(t('error.server.title'));
    });

  const onMore = () =>
    run(async () => {
      const r = await shareLink(payload);
      if (r === 'copied') toast(t('common.linkCopied'));
      if (r !== 'cancelled') onClose();
    });

  return (
    <BottomSheet open={open} onClose={onClose} title={t('share.sheetTitle')}>
      <ul className="flex justify-center gap-6 py-3">
        {kakao && (
          <ShareOption label={t('share.kakao')} onClick={onKakao} disabled={busy} iconClassName="bg-[#FEE500] text-[#191919]">
            <MessageCircle className="size-6" fill="currentColor" aria-hidden />
          </ShareOption>
        )}
        <ShareOption label={t('share.copyLink')} onClick={onCopy} disabled={busy}>
          <Link2 className="size-6" aria-hidden />
        </ShareOption>
        {system && (
          <ShareOption label={t('share.moreOptions')} onClick={onMore} disabled={busy}>
            <Ellipsis className="size-6" aria-hidden />
          </ShareOption>
        )}
      </ul>
      <p className="mt-1 text-center text-xs text-ink-3">{t('share.privacyNote')}</p>
    </BottomSheet>
  );
}

function ShareOption({ label, onClick, disabled, iconClassName, children }: { label: string; onClick: () => void; disabled?: boolean; iconClassName?: string; children: ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} disabled={disabled} className="flex w-16 flex-col items-center gap-2 text-sm text-ink-2 disabled:opacity-60">
        <span className={cx('grid size-14 place-items-center rounded-full', iconClassName ?? 'bg-subtle text-ink')}>{children}</span>
        {label}
      </button>
    </li>
  );
}
