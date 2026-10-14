import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@/lib/copy';

/** 바텀시트 — ESC/배경 탭/닫기 버튼으로 닫힘, 최대 높이 90% (앱 뒤로가기는 native 계층에서 연결). 데스크톱은 가운데 대화상자 */
export function BottomSheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onBack = () => onClose();
    window.addEventListener('yd:back', onBack);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('yd:back', onBack);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-8" role="dialog" aria-modal="true">
      <button type="button" aria-label={t('a11y.closeSheet')} className="animate-fade absolute inset-0 bg-[var(--scrim)]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="animate-sheet safe-bottom relative flex max-h-[90dvh] w-full max-w-xl flex-col rounded-t-3xl bg-surface shadow-[0_-8px_24px_rgba(31,29,26,0.08)] outline-none lg:max-h-[80dvh] lg:max-w-lg lg:rounded-3xl lg:pb-2 lg:shadow-[0_16px_48px_rgba(31,29,26,0.16)] lg:[animation-name:fade-in]"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong lg:hidden" aria-hidden />
        <div className="flex items-start gap-2 px-5 pt-3 lg:pt-5">
          <div className="flex-1 pt-1 text-lg font-semibold">{title}</div>
          <button type="button" aria-label={t('a11y.closeSheet')} onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-subtle">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4 pt-2">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
