import type { PillarDetail, SajuChart } from '@saju/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '@/lib/copy';
import { ELEMENT_META } from '@/lib/format';
import { RELATIONS, ROWS, SHINSAL, STRENGTH_LEVELS, STRENGTH_PARTS, termFor, type RowKey, type Term } from '@/lib/sajuBasics';
import { TermButton, TermSheet } from './TermSheet';
import { cx } from './ui';

type Pos = 'hour' | 'day' | 'month' | 'year';
const ORDER: Pos[] = ['hour', 'day', 'month', 'year'];

function Tile({ hanja, hangul, element, yinYang, isMe, kind, position, expert }: { hanja: string; hangul: string; element: keyof typeof ELEMENT_META; yinYang: 'yang' | 'yin'; isMe?: boolean; kind: '천간' | '지지'; position: string; expert: boolean }) {
  const m = ELEMENT_META[element];
  return (
    <div
      aria-label={`${position} ${kind} ${hangul}, 한자 ${hanja}, ${m.name}(${m.hanja}) ${yinYang === 'yang' ? '양' : '음'}`}
      className={cx(
        'relative flex aspect-[4/4.6] flex-col items-center justify-center rounded-xl',
        m.cls.soft,
        m.cls.ink,
        yinYang === 'yin' && 'border border-current/40',
        isMe && 'ring-2 ring-focus ring-offset-2 ring-offset-surface',
      )}
    >
      <span className="font-serif text-[clamp(26px,8vw,34px)] font-medium leading-none">{hanja}</span>
      {expert ? (
        <span className="mt-1.5 text-[11px] font-semibold opacity-90">
          {hangul}·{m.hanja}
          <span className="ml-0.5" aria-hidden>
            {yinYang === 'yang' ? '+' : '−'}
          </span>
        </span>
      ) : (
        // 처음 보는 사람에게는 음양(+/−)·한자 대신 기운 이름만
        <span className="mt-1.5 text-[11px] font-semibold opacity-90">
          {hangul} · {m.label}
        </span>
      )}
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
  // 누른 용어의 설명 — 줄 이름이나 값을 누르면 아래에서 올라온다
  const [sheet, setSheet] = useState<{ term: Term; extra?: Term[] } | null>(null);
  const pillars = chart.pillars;
  const label = (p: Pos) => t(`result.pillarTable.${p}`);
  const col = (p: Pos): PillarDetail | null => pillars[p];
  const open = (term: Term, extra?: Term[]) => setSheet({ term, extra });

  // 기본은 처음 보는 사람용 — 여덟 글자만. 십성·천간/지지 이름표는 '전문가 보기'에서. 이름표를 누르면 무슨 줄인지 알려 준다
  const rowLabel = (row: RowKey, text?: string) =>
    expert ? (
      <div className="self-center text-[11px] text-ink-3">
        <TermButton label={ROWS[row].name} onClick={() => open(ROWS[row])}>
          {text ?? ROWS[row].name}
        </TermButton>
      </div>
    ) : null;
  /** 표 안의 값 — 누르면 그 값의 뜻 */
  const value = (row: RowKey, v: string, className?: string) =>
    v ? (
      <TermButton label={v} className={className} onClick={() => open(termFor(row, v))}>
        {v}
      </TermButton>
    ) : null;
  const strengthTerm = (): Term => ({
    ...ROWS.strength,
    short: `${chart.strength.level} · 점수 ${chart.strength.score}`,
    body: `${STRENGTH_LEVELS[chart.strength.level] ?? ''} ${ROWS.strength.body}`.trim(),
  });

  return (
    <div>
      {!expert && <p className="mb-3 text-center text-sm text-ink-3">{t('result.pillarTable.intro')}</p>}
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
            {rowLabel('tenGods', t('result.pillarTable.tenGods'))}
            {ORDER.map((p) => (
              <div key={p} className="text-xs text-ink-2">
                {col(p) ? value('tenGods', p === 'day' ? '일간' : col(p)!.stem.tenGod) : ''}
              </div>
            ))}
          </>
        )}

        {rowLabel('stem', t('result.pillarTable.heavenlyStem'))}
        {ORDER.map((p) => {
          const c = col(p);
          return c ? <Tile key={p} hanja={c.stem.hanja} hangul={c.stem.hangul} element={c.stem.element} yinYang={c.stem.yinYang} isMe={p === 'day'} kind="천간" position={label(p)} expert={expert} /> : <UnknownTile key={p} />;
        })}

        {rowLabel('branch', t('result.pillarTable.earthlyBranch'))}
        {ORDER.map((p) => {
          const c = col(p);
          return c ? <Tile key={p} hanja={c.branch.hanja} hangul={c.branch.hangul} element={c.branch.element} yinYang={c.branch.yinYang} kind="지지" position={label(p)} expert={expert} /> : <UnknownTile key={p} />;
        })}

        {expert && (
          <>
            {rowLabel('tenGods', t('result.pillarTable.tenGods'))}
            {ORDER.map((p) => (
              <div key={p} className="text-xs text-ink-2">
                {value('tenGods', col(p)?.branch.tenGod ?? '')}
              </div>
            ))}

            {rowLabel('hidden')}
            {ORDER.map((p) => (
              <div key={p} className="font-serif text-xs text-ink-2">
                {col(p) ? (
                  <TermButton label="지장간" onClick={() => open(ROWS.hidden)}>
                    {col(p)!.branch.hiddenStems.map((h) => h.hanja).join(' ')}
                  </TermButton>
                ) : null}
              </div>
            ))}
            {rowLabel('stage')}
            {ORDER.map((p) => (
              <div key={p} className="text-xs text-ink-2">
                {value('stage', col(p)?.branch.twelveStage ?? '')}
              </div>
            ))}
            {rowLabel('napeum')}
            {ORDER.map((p) => (
              <div key={p} className="text-[11px] text-ink-3">
                {value('napeum', col(p)?.napeum.name ?? '')}
              </div>
            ))}
            {rowLabel('shinsal')}
            {ORDER.map((p) => (
              <div key={p} className="flex flex-wrap justify-center gap-x-1 text-[11px] leading-snug text-ink-3">
                {chart.shinsal
                  .filter((s) => s.positions.includes(p))
                  .map((s) => (
                    <TermButton key={s.name} label={s.name} onClick={() => open(SHINSAL[s.name] ?? ROWS.shinsal)}>
                      {s.name.replace(/살$/, '')}
                    </TermButton>
                  ))}
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
          {expert ? t('result.pillarTable.expertHide') : `${t('result.pillarTable.expertShow')} · ${t('result.pillarTable.expertShowHint')}`}
        </button>
      </div>
      {expert && (chart.relations.length > 0 || chart.gongmang) && (
        <div className="mt-3 space-y-1 rounded-xl bg-subtle p-3 text-sm text-ink-2">
          {chart.relations.length > 0 && (
            <p>
              <TermButton label="합·충" onClick={() => open(ROWS.relations)}>
                합·충
              </TermButton>
              :{' '}
              {chart.relations.map((r, i) => (
                <span key={r.label}>
                  {i > 0 && ', '}
                  <TermButton label={r.label} onClick={() => open(RELATIONS[r.type] ?? ROWS.relations)}>
                    {r.label}
                  </TermButton>
                </span>
              ))}
            </p>
          )}
          <p>
            <TermButton label="공망" onClick={() => open(ROWS.gongmang)}>
              공망
            </TermButton>
            : {chart.gongmang.join('')}
          </p>
          <p>
            <TermButton label="신강약" onClick={() => open(strengthTerm(), STRENGTH_PARTS)}>
              신강약
            </TermButton>
            : {chart.strength.level} ({chart.strength.score}) · 득령 {chart.strength.deukryeong ? 'O' : 'X'} · 득지 {chart.strength.deukji ? 'O' : 'X'} · 득세 {chart.strength.deukse ? 'O' : 'X'}
          </p>
        </div>
      )}
      {expert && <p className="mt-3 text-center text-xs text-ink-3 print:hidden">점선이 그어진 말을 누르면 뜻을 볼 수 있어요.</p>}
      <p className="mt-2 text-center text-sm print:hidden">
        <Link to="/basics" className="font-medium text-gold underline underline-offset-4">
          사주가 처음이라면 — 사주 기초 보기
        </Link>
      </p>
      <TermSheet term={sheet?.term ?? null} extra={sheet?.extra} onClose={() => setSheet(null)} />
    </div>
  );
}
