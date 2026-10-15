import type { ReadingSection } from '@saju/shared';
import { Lock } from 'lucide-react';
import { t } from '@/lib/copy';
import { Button, ScoreBar, cx } from './ui';

/** 섹션 key → 카피 가이드의 기능 라벨/감성 제목 */
const SECTION_COPY: Record<string, string> = {
  overview: 'overview',
  personality: 'personality',
  wealth: 'wealth',
  love: 'love',
  career: 'career',
  health: 'health',
  daeun: 'daeun',
};

/** 잠금 카드에 공개할 유료 목차 */
const TOC: Record<string, string[]> = {
  wealth: ['돈이 모이는 방식과 새는 지점', '재성·식상으로 본 수입 구조', '나에게 맞는 돈 관리 습관'],
  love: ['사랑할 때의 나', '배우자 자리(일지)로 본 인연', '좋은 인연이 들어오는 시기'],
  career: ['강점이 살아나는 직무와 분야', '조직형·독립형 성향', '커리어 전환 포인트'],
  health: ['오행 균형으로 본 체질 경향', '챙기면 좋은 생활 습관'],
  tenGods: ['나를 움직이는 핵심 기운', '비어 있는 기운이 주는 과제'],
  daeun: ['지금 지나는 대운', '10년마다 바뀌는 흐름', '대운별 기회와 주의점'],
  relations: ['합과 충이 만드는 변화'],
};

/** 카피 가이드에 없는 섹션의 짧은 라벨(섹션 바로가기 칩용) */
const SHORT_LABEL: Record<string, string> = {
  elements: '다섯 기운',
  yongsin: '필요한 기운',
  shinsal: '특별한 기운',
  tenGods: '움직이는 힘',
  relations: '합충',
  stages: '12운성',
  total: '총운',
  months: '월별 흐름',
  summary: '요약',
  strengths: '끌림',
  cautions: '조율',
  advice: '조언',
};

export function sectionLabels(s: ReadingSection): { label: string; title: string } {
  const key = SECTION_COPY[s.key];
  if (key) return { label: t(`result.sections.${key}.label`), title: t(`result.sections.${key}.title`) };
  if (/^year\d{4}$/.test(s.key)) {
    const year = Number(s.key.slice(4));
    // 10월 이후엔 다음 해 운세가 들어오므로 '올해'가 아니라 연도로 표기
    const label = year === new Date().getFullYear() ? t('result.sections.thisYear.label') : `${year}년 운세`;
    return { label, title: t('result.sections.thisYear.title', { year }) };
  }
  return { label: '', title: s.title };
}

/** 섹션 바로가기 칩 라벨 — 항상 비어 있지 않음 */
export function navLabel(s: ReadingSection): string {
  return sectionLabels(s).label || SHORT_LABEL[s.key] || s.title;
}

export function ReadingSectionCard({ section, onUnlock, price }: { section: ReadingSection; onUnlock?: (s: ReadingSection) => void; price?: string }) {
  const { label, title } = sectionLabels(section);
  const locked = Boolean(section.locked);
  // 서버가 목차를 주면 그걸 쓴다(신년운세·궁합처럼 같은 key 라도 내용이 다른 화면)
  const toc = section.toc ?? TOC[section.key] ?? TOC[section.key.replace(/\d+/, '')] ?? ['시기별 흐름과 구체적인 조언'];
  return (
    <section id={`sec-${section.key}`} className="scroll-mt-28 border-t border-line py-8 first:border-t-0">
      {label && <p className="text-sm font-semibold text-ink-3">{label}</p>}
      <h2 className="mt-1 font-serif text-[22px] font-semibold leading-snug">{title}</h2>
      {section.summary && <p className="mt-3 text-[17px] font-medium leading-relaxed text-ink-2">{section.summary}</p>}
      {typeof section.score === 'number' && !locked && (
        <div className="mt-4">
          <ScoreBar score={section.score} label={label} />
        </div>
      )}
      {section.keywords && section.keywords.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label={t('result.keywordsLabel')}>
          {section.keywords.map((k) => (
            <li key={k} className="rounded-full bg-subtle px-3 py-1 text-sm text-ink-2">
              {k}
            </li>
          ))}
        </ul>
      )}
      <div className={cx('prose-reading mt-5', locked && 'fade-out-bottom max-h-40 overflow-hidden')}>
        {section.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {!locked && section.tips && section.tips.length > 0 && (
        <ul className="mt-4 space-y-2">
          {section.tips.map((tip) => (
            <li key={tip} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-2">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      )}
      {!locked && section.basis && (
        // 용어가 궁금한 사람만 펼쳐 보게 — 본문은 쉬운 말로만
        <details className="group mt-4 text-sm text-ink-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-line px-3 py-1 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
            사주로 보면 <span className="transition-transform group-open:rotate-180" aria-hidden>▾</span>
          </summary>
          <p className="mt-2 leading-relaxed">{section.basis}</p>
        </details>
      )}
      {locked && (
        <div className="mt-2 rounded-2xl border border-gold/40 bg-surface p-5" aria-label={t('a11y.lockedSection')}>
          <p className="flex items-center gap-2 font-semibold text-gold">
            <Lock className="size-4" aria-hidden />
            {t('paywall.lockTitle')}
          </p>
          <p className="mt-2 text-sm text-ink-2">{label ? t('paywall.lockBody', { section: label }) : '나머지 내용을 이어서 읽을 수 있어요.'}</p>
          <p className="mt-4 text-xs font-semibold text-ink-3">{t('paywall.tocTitle')}</p>
          <ul className="mt-2 space-y-1.5 text-[15px] text-ink">
            {toc.map((x) => (
              <li key={x}>· {x}</li>
            ))}
          </ul>
          {onUnlock && (
            <Button block className="mt-5" onClick={() => onUnlock(section)}>
              {price ? t('paywall.cta', { price }) : t('paywall.ctaNoPrice')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
