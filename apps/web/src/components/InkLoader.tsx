import { useEffect, useState } from 'react';
import { t } from '@/lib/copy';
import { ELEMENT_META, ELEMENT_ORDER } from '@/lib/format';
import { cx } from './ui';

/** 먹 번짐 로딩 — 단계 문구 5개 순환, 8초 이후 보조 문구 */
export function InkLoader({ name }: { name?: string }) {
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const i = setInterval(() => setStep((s) => Math.min(s + 1, 4)), 1300);
    const s = setTimeout(() => setSlow(true), 8000);
    return () => {
      clearInterval(i);
      clearTimeout(s);
    };
  }, []);
  return (
    <div role="status" aria-label={t('loading.a11y')} className="flex min-h-[60dvh] flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="relative size-36">
        <div className="animate-ink absolute inset-0 rounded-full bg-ink" />
        <div className="animate-ink absolute inset-4 rounded-full bg-ink [animation-delay:600ms]" />
        <div className="absolute inset-0 flex items-center justify-center gap-2">
          {ELEMENT_ORDER.map((e, i) => (
            <span key={e} className={cx('size-2.5 rounded-full transition-opacity duration-300', ELEMENT_META[e].cls.bg, i <= step ? 'opacity-100' : 'opacity-15')} />
          ))}
        </div>
      </div>
      {/* 이름이 없으면 '당신님' 대신 '나만의' — docs/PLAIN_KOREAN.md 규칙 4 */}
      <p className="font-serif text-lg">{step === 4 && !name ? t('loading.step5NoName') : t(`loading.step${step + 1}`, { name: name ?? '' })}</p>
      {slow && <p className="text-sm text-ink-3">{t('loading.slow')}</p>}
    </div>
  );
}
