import { Check, ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { Wordmark } from '@/components/Seal';
import { TojeongEntryCard } from '@/components/TojeongEntryCard';
import { Button } from '@/components/ui';
import { t } from '@/lib/copy';
import { ELEMENT_META, targetFortuneYear } from '@/lib/format';
import { isMember, useSession } from '@/lib/session';

const SAMPLE = [
  { s: '丙', b: '午', se: 'fire', be: 'fire' },
  { s: '壬', b: '寅', se: 'water', be: 'wood' },
  { s: '癸', b: '未', se: 'water', be: 'earth' },
  { s: '乙', b: '巳', se: 'wood', be: 'fire' },
] as const;

const PREVIEW = ['overview', 'personality', 'wealth', 'love', 'career', 'health', 'daeun', 'thisYear'] as const;
/** 처음 오는 사람에게 용어('대운')를 먼저 보이지 않게 — 랜딩 미리보기에서만 쉬운 이름으로 */
const PREVIEW_LABEL: Partial<Record<(typeof PREVIEW)[number], string>> = { daeun: '인생의 큰 흐름' };
const FAQ = ['timeUnknown', 'lunar', 'accuracy', 'privacy'] as const;

export function LandingPage() {
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  return (
    <div className="min-h-page pb-36 lg:pb-20">
      <header className="safe-top lg:hidden">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-5">
          <Wordmark />
          {user ? (
            <Link to="/today" className="text-sm font-semibold text-ink-2">
              {isMember(user) ? '내 운세' : '오늘의 운세'}
            </Link>
          ) : (
            <Link to="/login" className="text-sm font-semibold text-ink-2">
              로그인
            </Link>
          )}
        </div>
      </header>
      <Page width="wide">
        <section className="pt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-center lg:gap-16 lg:pt-20">
          <div>
            <p className="text-sm font-semibold text-ink-3">{t('landing.heroEyebrow')}</p>
            <h1 className="mt-3 font-serif text-[32px] font-semibold leading-[1.3] lg:text-[52px] lg:leading-[1.25]">
              {t('landing.heroTitle').replace('읽는 ', '읽는\n')
                .split('\n')
                .map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
            </h1>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-2 lg:mt-6 lg:text-xl">{t('landing.heroSubtitle')}</p>
            <div className="mt-10 hidden items-center gap-5 lg:flex">
              <Button size="lg" className="px-10" onClick={() => navigate('/input')}>
                {t('landing.heroCta')}
              </Button>
              <div className="text-sm text-ink-3">
                <p>{t('landing.heroCtaCaption')}</p>
                <Link to="/today" className="font-medium text-ink-2 underline underline-offset-4">
                  {t('landing.secondaryCta')}
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-line bg-surface p-5 lg:mt-0 lg:p-8">
            <div className="grid grid-cols-4 gap-2">
              {SAMPLE.map((c, i) => (
                <div key={i} className="space-y-2">
                  {[
                    [c.s, c.se],
                    [c.b, c.be],
                  ].map(([ch, el]) => {
                    const m = ELEMENT_META[el as keyof typeof ELEMENT_META];
                    return (
                      <div key={ch} className={`animate-dot grid aspect-square place-items-center rounded-xl font-serif text-3xl lg:text-5xl ${m.cls.soft} ${m.cls.ink}`} style={{ animationDelay: `${i * 120}ms` }}>
                        {ch}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-ink-3">예시 사주팔자 · 태어난 연·월·일·시가 이렇게 여덟 글자가 돼요</p>
          </div>
        </section>

        <section className="lg:mt-20 lg:border-t lg:border-line lg:pt-12">
          <ul className="mt-8 space-y-5 lg:mt-0 lg:grid lg:grid-cols-3 lg:gap-10 lg:space-y-0">
            {(['transparent', 'readable', 'timeUnknown'] as const).map((k) => (
              <li key={k} className="flex gap-3">
                <Check className="mt-1 size-5 shrink-0 text-success" aria-hidden />
                <div>
                  <p className="font-semibold">{t(`landing.valueProps.${k}.title`)}</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{t(`landing.valueProps.${k}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 lg:mt-20">
          <h2 className="text-lg font-semibold">{t('landing.sectionsPreviewTitle')}</h2>
          <ul className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-3 lg:overflow-visible lg:px-0">
            {PREVIEW.map((k) => (
              <li key={k} className="shrink-0 rounded-2xl border border-line bg-surface px-4 py-3 lg:px-5 lg:py-4">
                <p className="text-xs text-ink-3">{PREVIEW_LABEL[k] ?? t(`result.sections.${k}.label`)}</p>
                <p className="mt-1 font-serif text-[15px] font-semibold">{t(`result.sections.${k}.title`, { year: targetFortuneYear() })}</p>
              </li>
            ))}
          </ul>
        </section>

        <TojeongEntryCard className="mt-12 lg:mt-20 lg:max-w-md" />

        <section className="mt-12 lg:mt-20 lg:max-w-3xl">
          <h2 className="text-lg font-semibold">{t('landing.faqTitle')}</h2>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {FAQ.map((k) => (
              <details key={k} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                  {t(`landing.faq.${k}.q`)}
                  <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{t(`landing.faq.${k}.a`)}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className="mt-12 space-y-2 text-xs leading-relaxed text-ink-3 lg:mt-20 lg:border-t lg:border-line lg:pt-8">
          <p>{t('disclaimer.standard')}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <Link to="/legal/terms" className="underline">
              {t('my.terms')}
            </Link>
            <Link to="/legal/privacy" className="underline">
              {t('my.privacy')}
            </Link>
            <Link to="/manse" className="underline">
              만세력
            </Link>
            <Link to="/dream" className="underline">
              꿈해몽
            </Link>
            <Link to="/zodiac" className="underline">
              띠별 운세
            </Link>
            <Link to="/horoscope" className="underline">
              별자리 운세
            </Link>
            <Link to="/taekil" className="underline">
              {t('taekil.meta.navLabel')}
            </Link>
          </p>
        </footer>
      </Page>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas to-transparent pt-6 lg:hidden">
        <div className="mx-auto max-w-xl space-y-2 px-5 pb-4">
          <Button block size="lg" onClick={() => navigate('/input')}>
            {t('landing.heroCta')}
          </Button>
          <div className="flex items-center justify-center gap-3 text-sm text-ink-3">
            <span>{t('landing.heroCtaCaption')}</span>
            <span aria-hidden>·</span>
            <Link to="/today" className="font-medium text-ink-2 underline underline-offset-4">
              {t('landing.secondaryCta')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
