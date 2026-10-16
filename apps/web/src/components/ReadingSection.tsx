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

/** 잠금 카드에 공개할 유료 목차 — 사주를 처음 보는 사람도 무엇을 읽게 되는지 알 수 있게 */
const TOC: Record<string, string[]> = {
  wealth: ['재물이 모이는 방식과 새어 나가기 쉬운 곳', '재능을 수입으로 연결하는 방법', '나에게 맞는 재물 관리 습관'],
  love: ['연애할 때의 성향', '나와 잘 맞는 사람', '인연이 들어오기 쉬운 시기'],
  career: ['강점을 살리기 좋은 일과 분야', '조직형인지 독립형인지', '일에서 기회가 오는 방향'],
  health: ['오행의 균형으로 본 건강 관리 포인트', '챙기면 좋은 생활 습관'],
  tenGods: ['십성으로 본 성향과 동기', '사주에 없는 십성이 뜻하는 과제'],
  daeun: ['지금 지나는 대운', '대운별 흐름(10년 단위)', '시기별 기회와 주의할 점'],
  relations: ['글자 사이의 합·충'],
};

/** 카피 가이드에 없는 섹션의 짧은 라벨(섹션 바로가기 칩용) — 섹션 제목과 맞춰 정식 용어로 */
const SHORT_LABEL: Record<string, string> = {
  elements: '오행',
  yongsin: '용신',
  shinsal: '신살',
  tenGods: '십성',
  chart: '사주 원국',
  strength: '신강·신약',
  relations: '합·충',
  stages: '12운성',
  daeunContext: '대운',
  total: '총운',
  months: '월별 흐름',
  summary: '요약',
  strengths: '잘 맞는 점',
  cautions: '조율할 점',
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
  // 리포트 맨 앞 '한눈에 보기'(points)는 리포트가 정한 제목 그대로('한눈에 보는 서윤님')
  const { label, title } = section.points?.length ? { label: '', title: section.title } : sectionLabels(section);
  const locked = Boolean(section.locked);
  // 서버가 목차를 주면 그걸 쓴다(신년운세·궁합처럼 같은 key 라도 내용이 다른 화면)
  const toc = section.toc ?? TOC[section.key] ?? TOC[section.key.replace(/\d+/, '')] ?? ['시기별 흐름과 구체적인 조언'];
  return (
    <section id={`sec-${section.key}`} className="scroll-mt-28 border-t border-line py-8 first:border-t-0">
      {label && <p className="text-sm font-semibold text-ink-3">{label}</p>}
      <h2 className="mt-1 font-serif text-[22px] font-semibold leading-snug">{title}</h2>
      {section.summary && <p className="mt-3 text-[17px] font-medium leading-relaxed text-ink-2">{section.summary}</p>}
      {!locked && section.points && section.points.length > 0 && (
        // 리포트 맨 앞 '한눈에 보기' — 표·용어보다 먼저 결론을 한 줄씩
        <dl className="mt-4 space-y-2.5 rounded-2xl border border-line bg-surface p-4">
          {section.points.map((k) => (
            <div key={k.label} className="grid grid-cols-[5.75rem_1fr] gap-3 text-[15px] leading-relaxed">
              <dt className="text-ink-3">{k.label}</dt>
              <dd className="text-ink">{k.text}</dd>
            </div>
          ))}
        </dl>
      )}
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
