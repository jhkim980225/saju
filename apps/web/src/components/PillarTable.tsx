import type { PillarDetail, SajuChart } from '@saju/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '@/lib/copy';
import { ELEMENT_META } from '@/lib/format';
import { cx } from './ui';

type Pos = 'hour' | 'day' | 'month' | 'year';
const ORDER: Pos[] = ['hour', 'day', 'month', 'year'];

function Tile({ hanja, hangul, element, yinYang, isMe, kind, position }: { hanja: string; hangul: string; element: keyof typeof ELEMENT_META; yinYang: 'yang' | 'yin'; isMe?: boolean; kind: '천간' | '지지'; position: string }) {
  const m = ELEMENT_META[element];
  return (
    <div
      aria-label={`${position} ${kind} ${hangul}, 한자 ${hanja}, ${m.name}(${m.hanja}) ${yinYang === 'yang' ? '양' : '음'}`}
      className={cx(
        'relative flex aspect-[4/4.6] flex-col items-center justify-center rounded-xl',
        m.cls.soft,
        m.cls.ink,
        yinYang === 'yin' && 'border border-current/40',
        isMe && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
      )}
    >
      <span className="font-serif text-[clamp(26px,8vw,34px)] font-medium leading-none">{hanja}</span>
      <span className="mt-1.5 text-[11px] font-semibold opacity-90">
        {hangul}·{m.hanja}
        <span className="ml-0.5" aria-hidden>
          {yinYang === 'yang' ? '+' : '−'}
        </span>
      </span>
    </div>
  );
}

function UnknownTile() {
  return (
    <div className="flex aspect-[4/4.6] items-center justify-center rounded-xl border border-dashed border-line-strong text-2xl text-ink-3" aria-label="태어난 시간 모름">
      {t('result.pillarTable.unknownHour')}
    </div>
  );
}

export function PillarTable({ chart, editHref }: { chart: SajuChart; editHref?: string }) {
  const [expert, setExpert] = useState(false);
  const pillars = chart.pillars;
  const label = (p: Pos) => t(`result.pillarTable.${p}`);
  const col = (p: Pos): PillarDetail | null => pillars[p];

  // 기본은 처음 보는 사람용 — 여덟 글자만. 십성·천간/지지 이름표는 '전문가 보기'에서
  const rowLabel = (text: string) => (expert ? <div className="self-center text-[11px] text-ink-3">{text}</div> : null);

  return (
    <div>
      {!expert && <p className="mb-3 text-center text-sm text-ink-3">태어난 연·월·일·시를 여덟 글자로 바꾼 표예요. '나'로 표시된 글자가 나 자신이에요.</p>}
      <div className={cx('grid gap-x-2 gap-y-1.5 text-center', expert ? 'grid-cols-[2.5rem_repeat(4,minmax(0,1fr))]' : 'grid-cols-4')}>
        {expert && <div />}
        {ORDER.map((p) => (
          <div key={p} className="text-sm font-semibold text-ink-2">
            {label(p)}
            {p === 'day' && <span className="ml-1 rounded bg-action px-1 text-[10px] text-on-action">{t('result.pillarTable.me')}</span>}
          </div>
        ))}

        {expert && (
          <>
            {rowLabel(t('result.pillarTable.tenGods'))}
            {ORDER.map((p) => (
              <div key={p} className="text-xs text-ink-2">
                {col(p) ? (p === 'day' ? '일간' : col(p)!.stem.tenGod) : ''}
              </div>
            ))}
          </>
        )}

        {rowLabel(t('result.pillarTable.heavenlyStem'))}
        {ORDER.map((p) => {
          const c = col(p);
          return c ? <Tile key={p} hanja={c.stem.hanja} hangul={c.stem.hangul} element={c.stem.element} yinYang={c.stem.yinYang} isMe={p === 'day'} kind="천간" position={label(p)} /> : <UnknownTile key={p} />;
        })}

        {rowLabel(t('result.pillarTable.earthlyBranch'))}
        {ORDER.map((p) => {
          const c = col(p);
          return c ? <Tile key={p} hanja={c.branch.hanja} hangul={c.branch.hangul} element={c.branch.element} yinYang={c.branch.yinYang} kind="지지" position={label(p)} /> : <UnknownTile key={p} />;
        })}

        {expert && (
          <>
            {rowLabel(t('result.pillarTable.tenGods'))}
            {ORDER.map((p) => (
              <div key={p} className="text-xs text-ink-2">
                {col(p)?.branch.tenGod ?? ''}
              </div>
            ))}

            <div className="self-center text-[11px] text-ink-3">지장간</div>
            {ORDER.map((p) => (
              <div key={p} className="font-serif text-xs text-ink-2">
                {col(p)?.branch.hiddenStems.map((h) => h.hanja).join(' ') ?? ''}
              </div>
            ))}
            <div className="self-center text-[11px] text-ink-3">12운성</div>
            {ORDER.map((p) => (
              <div key={p} className="text-xs text-ink-2">
                {col(p)?.branch.twelveStage ?? ''}
              </div>
            ))}
            <div className="self-center text-[11px] text-ink-3">납음</div>
            {ORDER.map((p) => (
              <div key={p} className="text-[11px] text-ink-3">
                {col(p)?.napeum.name ?? ''}
              </div>
            ))}
            <div className="self-center text-[11px] text-ink-3">신살</div>
            {ORDER.map((p) => (
              <div key={p} className="text-[11px] leading-snug text-ink-3">
                {chart.shinsal
                  .filter((s) => s.positions.includes(p))
                  .map((s) => s.name.replace(/살$/, ''))
                  .join(' ')}
              </div>
            ))}
          </>
        )}
      </div>

      {!chart.hourKnown && (
        <p className="mt-3 text-center text-sm text-ink-3">
          {t('result.pillarTable.unknownHourHint')}
          {editHref && (
            <Link to={editHref} className="ml-2 font-semibold text-info underline underline-offset-2">
              {t('result.pillarTable.addTime')}
            </Link>
          )}
        </p>
      )}

      <div className="mt-3 flex justify-center">
        <button type="button" onClick={() => setExpert((v) => !v)} className="text-sm font-medium text-ink-2 underline underline-offset-4 print:hidden">
          {expert ? t('result.pillarTable.expertHide') : `${t('result.pillarTable.expertShow')} · 십성·지장간·12운성·신살`}
        </button>
      </div>
      {expert && (chart.relations.length > 0 || chart.gongmang) && (
        <div className="mt-3 space-y-1 rounded-xl bg-subtle p-3 text-sm text-ink-2">
          {chart.relations.length > 0 && <p>합·충: {chart.relations.map((r) => r.label).join(', ')}</p>}
          <p>공망: {chart.gongmang.join('')}</p>
          <p>
            신강약: {chart.strength.level} ({chart.strength.score}) · 득령 {chart.strength.deukryeong ? 'O' : 'X'} · 득지 {chart.strength.deukji ? 'O' : 'X'} · 득세 {chart.strength.deukse ? 'O' : 'X'}
          </p>
        </div>
      )}
    </div>
  );
}
