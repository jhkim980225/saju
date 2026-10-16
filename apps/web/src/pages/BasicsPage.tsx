import { ArrowLeft, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { ServiceNote as Note } from '@/components/TermSheet';
import { Card, IconButton, PageHeader, cx } from '@/components/ui';
import { t } from '@/lib/copy';
import { ELEMENT_META, ELEMENT_ORDER } from '@/lib/format';
import { NAPEUM, RELATIONS, ROWS, SHINSAL, STAGES, STRENGTH_PARTS, TEN_GODS, TEN_GOD_GROUPS, type Term } from '@/lib/sajuBasics';

type El = keyof typeof ELEMENT_META;
/** 천간 열 개 — 글자·읽기·오행·음양 (packages/saju-core constants 의 STEMS 와 같다) */
const STEMS: [string, string, El, '+' | '−'][] = [
  ['甲', '갑', 'wood', '+'], ['乙', '을', 'wood', '−'], ['丙', '병', 'fire', '+'], ['丁', '정', 'fire', '−'], ['戊', '무', 'earth', '+'],
  ['己', '기', 'earth', '−'], ['庚', '경', 'metal', '+'], ['辛', '신', 'metal', '−'], ['壬', '임', 'water', '+'], ['癸', '계', 'water', '−'],
];
/** 지지 열두 개 — 글자·읽기·띠·오행·음양·시간대 (BRANCHES 와 같다) */
const BRANCHES: [string, string, string, El, '+' | '−', string][] = [
  ['子', '자', '쥐', 'water', '+', '23~1시'], ['丑', '축', '소', 'earth', '−', '1~3시'], ['寅', '인', '호랑이', 'wood', '+', '3~5시'], ['卯', '묘', '토끼', 'wood', '−', '5~7시'],
  ['辰', '진', '용', 'earth', '+', '7~9시'], ['巳', '사', '뱀', 'fire', '−', '9~11시'], ['午', '오', '말', 'fire', '+', '11~13시'], ['未', '미', '양', 'earth', '−', '13~15시'],
  ['申', '신', '원숭이', 'metal', '+', '15~17시'], ['酉', '유', '닭', 'metal', '−', '17~19시'], ['戌', '술', '개', 'earth', '+', '19~21시'], ['亥', '해', '돼지', 'water', '−', '21~23시'],
];
/** 사주표 그림 — 오른쪽부터 연주·월주·일주·시주 */
const PILLARS: { name: string; when: string; me?: boolean }[] = [
  { name: '시주', when: '태어난 시간' },
  { name: '일주', when: '태어난 날', me: true },
  { name: '월주', when: '태어난 달' },
  { name: '연주', when: '태어난 해' },
];

/**
 * 사주 기초 — 사주를 처음 접하는 성인이 결과 화면과 '전문가 보기' 사주표를 해석할 수 있게.
 * 정식 명리학 용어를 쓰고 처음 나올 때 뜻을 붙인다. 달빛사주 자체 계산 기준은 '달빛사주 기준' 상자로 구분한다.
 * 용어 설명은 lib/sajuBasics.ts 와 같은 것을 쓴다.
 */
export function BasicsPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-page pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title="사주 기초"
        width="medium"
      />
      <Page width="medium" className="space-y-5">
        <p className="pt-2 text-[15px] leading-relaxed text-ink-2">
          사주 풀이를 이해하는 데 필요한 기본 개념을 정리했습니다. 순서대로 읽으면 결과 화면의 &lsquo;전문가 보기&rsquo; 사주표를 해석하는 데 도움이 됩니다.
        </p>

        <Section n={1} topic="사주의 기본 구조" title="사주는 여덟 글자로 이루어져 있어요">
          <p>사주는 태어난 연도, 월, 일, 시간을 바탕으로 만들어지는 여덟 글자예요. 각 시간 단위는 두 글자로 표현되며, 이를 하나의 &lsquo;기둥&rsquo;이라고 부릅니다. 네 개의 기둥으로 이루어져 있어 &lsquo;사주(四柱)&rsquo;, 여덟 글자로 구성되어 있어 &lsquo;팔자(八字)&rsquo;라고 해요.</p>
          <div className="grid grid-cols-[3rem_repeat(4,minmax(0,1fr))] gap-1.5 text-center text-xs">
            <div />
            {PILLARS.map((p) => (
              <div key={p.name}>
                <p className="font-semibold text-ink">{p.name}</p>
                <p className="text-[11px] text-ink-3">{p.when}</p>
              </div>
            ))}
            <div className="self-center text-ink-3">위쪽</div>
            {PILLARS.map((p) => (
              <div key={p.name} className={cx('grid h-12 place-items-center rounded-lg bg-subtle font-semibold', p.me && 'ring-2 ring-focus')}>
                {p.me ? '일간(나)' : '천간'}
              </div>
            ))}
            <div className="self-center text-ink-3">아래쪽</div>
            {PILLARS.map((p) => (
              <div key={p.name} className="grid h-12 place-items-center rounded-lg bg-subtle font-semibold">
                지지
              </div>
            ))}
          </div>
          <p>사주표는 오른쪽부터 연주, 월주, 일주, 시주 순서로 읽어요. 각 기둥의 위쪽 글자는 &lsquo;천간&rsquo;, 아래쪽 글자는 &lsquo;지지&rsquo;라고 합니다. 특히 태어난 날의 천간인 &lsquo;일간&rsquo;은 나 자신을 나타내며, 사주를 해석하는 중요한 기준이 됩니다.</p>
          <Note>태어난 시간을 모르면 시주를 뺀 여섯 글자로 계산합니다. 시간에 따라 달라지는 해석은 따로 표시해요.</Note>
        </Section>

        <Section n={2} topic="일간" title="사주를 해석하는 기준은 일간이에요">
          <p>태어난 날 기둥의 천간을 일간(日干)이라고 하며, 사주에서 나 자신을 나타냅니다. 나머지 일곱 글자는 모두 일간과 어떤 관계에 있는지를 기준으로 해석해요. 결과 화면의 사주표에서 &lsquo;나&rsquo;로 표시된 글자가 일간입니다.</p>
        </Section>

        <Section n={3} topic="오행" title="다섯 가지 기운, 오행">
          <p>모든 글자는 목(木)·화(火)·토(土)·금(金)·수(水) 다섯 가지 오행 가운데 하나에 속합니다. 사주에서 어떤 오행이 강하고 약한지를 통해 기질과 균형을 살펴봐요.</p>
          <div className="flex flex-wrap gap-2">
            {ELEMENT_ORDER.map((e) => (
              <span key={e} className={cx('rounded-full px-3 py-1 text-sm font-semibold', ELEMENT_META[e].cls.soft, ELEMENT_META[e].cls.ink)}>
                {ELEMENT_META[e].name}({ELEMENT_META[e].hanja}) · {ELEMENT_META[e].label}
              </span>
            ))}
          </div>
          <dl className="space-y-2 rounded-xl bg-subtle p-3 text-sm">
            <div>
              <dt className="font-semibold">상생(相生) — 서로 생하는 관계</dt>
              <dd className="mt-0.5 text-ink-2">목 → 화 → 토 → 금 → 수 → 목. 앞의 오행이 뒤의 오행을 생(生)하여 돕는 관계입니다.</dd>
            </div>
            <div>
              <dt className="font-semibold">상극(相剋) — 서로 극하는 관계</dt>
              <dd className="mt-0.5 text-ink-2">목 → 토, 토 → 수, 수 → 화, 화 → 금, 금 → 목. 앞의 오행이 뒤의 오행을 극(剋)하여 제어하는 관계로, 서로 견제하며 균형을 이룹니다.</dd>
            </div>
          </dl>
          <Note>결과 화면의 오행 분포는 여덟 글자의 오행을 개수로 센 값입니다. 지장간이나 계절의 영향은 반영하지 않은 단순 집계예요. 쉬운 이해를 위해 나무·불·흙·쇠·물을 함께 표기합니다.</Note>
        </Section>

        <Section n={4} topic="음양" title="양(+)과 음(−)">
          <p>각 오행은 다시 양과 음으로 나뉩니다. 양은 확장하고 드러나는 성질, 음은 수렴하고 응축하는 성질을 뜻해요. 같은 오행이라도 음양에 따라 성향이 달라지며, 십성을 구분하는 기준이 되기도 합니다. 사주표의 +, − 표시가 음양입니다.</p>
        </Section>

        <Section n={5} topic="천간과 지지" title="천간 열 개, 지지 열두 개">
          <TermList terms={[ROWS.stem, ROWS.branch]} />
          <Fold summary="천간 열 개 보기">
            <table className="w-full text-center text-sm">
              <thead className="text-xs text-ink-3">
                <tr>
                  <th className="py-1 font-medium">글자</th>
                  <th className="font-medium">읽기</th>
                  <th className="font-medium">오행</th>
                  <th className="font-medium">음양</th>
                </tr>
              </thead>
              <tbody>
                {STEMS.map(([h, k, e, y]) => (
                  <tr key={h} className="border-t border-line">
                    <td className="py-1.5 font-serif text-base">{h}</td>
                    <td>{k}</td>
                    <td className={ELEMENT_META[e].cls.solid}>{ELEMENT_META[e].name}</td>
                    <td>{y}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Fold>
          <Fold summary="지지 열두 개 보기">
            <table className="w-full text-center text-sm">
              <thead className="text-xs text-ink-3">
                <tr>
                  <th className="py-1 font-medium">글자</th>
                  <th className="font-medium">읽기</th>
                  <th className="font-medium">띠</th>
                  <th className="font-medium">오행</th>
                  <th className="font-medium">음양</th>
                  <th className="font-medium">시간</th>
                </tr>
              </thead>
              <tbody>
                {BRANCHES.map(([h, k, a, e, y, time]) => (
                  <tr key={h} className="border-t border-line">
                    <td className="py-1.5 font-serif text-base">{h}</td>
                    <td>{k}</td>
                    <td>{a}</td>
                    <td className={ELEMENT_META[e].cls.solid}>{ELEMENT_META[e].name}</td>
                    <td>{y}</td>
                    <td className="tabular text-xs text-ink-2">{time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Fold>
        </Section>

        <Section n={6} topic="십성" title="나를 중심으로 살펴보는 열 가지 관계">
          <p>{ROWS.tenGods.body}</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {TEN_GOD_GROUPS.map((g) => (
              <li key={g.group} className="px-3 py-2.5 text-sm">
                <p className="font-semibold">
                  {g.group} <span className="font-normal text-ink-3">· {g.pair.join(' · ')}</span>
                </p>
                <p className="mt-0.5 text-ink-2">{g.relation}</p>
                <p className="mt-0.5 text-xs text-ink-3">{g.what}</p>
              </li>
            ))}
          </ul>
          <Fold summary="십성 열 가지 보기">
            <TermList terms={Object.values(TEN_GODS).filter((x) => x.name !== '일간')} />
          </Fold>
          {ROWS.tenGods.note && <Note>{ROWS.tenGods.note}</Note>}
        </Section>

        <Section n={7} topic="사주표의 다른 항목" title="지장간, 12운성, 신살, 합·충, 공망, 신강·신약">
          <TermList terms={[ROWS.hidden, ROWS.stage, ROWS.napeum, ROWS.shinsal, ROWS.relations, ROWS.gongmang, ROWS.strength]} />
          <Fold summary="12운성 열두 단계">
            <TermList terms={Object.values(STAGES)} />
          </Fold>
          <Fold summary="신살 종류">
            <TermList terms={Object.values(SHINSAL).filter((x) => x.name !== '공망')} />
          </Fold>
          <Fold summary="합·충 종류">
            <TermList terms={Object.values(RELATIONS)} />
          </Fold>
          <Fold summary="신강·신약을 판단하는 세 가지 기준">
            <TermList terms={STRENGTH_PARTS} />
          </Fold>
          <Fold summary="납음 서른 가지">
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {Object.entries(NAPEUM).map(([k, v]) => (
                <li key={k}>
                  <span className="font-semibold">{k}</span> <span className="text-ink-2">{v}</span>
                </li>
              ))}
            </ul>
          </Fold>
          {ROWS.strength.note && <Note>{ROWS.strength.note}</Note>}
        </Section>

        <Section n={8} topic="대운과 세운" title="시기에 따라 달라지는 운의 흐름">
          <p>타고난 사주팔자는 바뀌지 않지만, 시기마다 들어오는 기운이 달라 운의 흐름도 달라진다고 봅니다.</p>
          <TermList
            terms={[
              { name: '대운', short: '10년 단위로 바뀌는 운의 큰 흐름', body: '월주를 기준으로 순행 또는 역행하며 정해집니다. 시작 나이는 성별과 태어난 해의 음양, 출생일과 절기 사이의 날짜 수에 따라 사람마다 달라요.' },
              { name: '세운', short: '해마다 들어오는 운', body: '그해의 간지(예: 2027년 정미년)와 사주의 관계로 한 해의 흐름을 해석하며, 신년운세가 이에 해당합니다.' },
              { name: '월운 · 일진', short: '달마다, 날마다 들어오는 기운', body: '오늘의 운세는 그날의 간지(일진)와 사주의 관계를 바탕으로 해석해요.' },
            ]}
          />
          <Note>달빛사주는 출생일과 가까운 절기(절입일) 사이의 날짜 수를 3으로 나누어 대운 시작 나이(만 나이)를 계산합니다.</Note>
        </Section>

        <Section n={9} topic="용신" title="사주의 균형을 돕는 기운, 용신">
          <p>용신(用神)은 사주 전체의 균형과 흐름에 가장 도움이 되는 오행을 말합니다. 전통 명리학에서는 일간의 강약을 조절하는 억부(抑扶), 계절의 차고 더움을 조절하는 조후(調候), 사주의 구조를 보는 격국(格局) 등 여러 방법을 종합해 정하며, 학파와 해석자에 따라 결과가 달라질 수 있어요.</p>
          <TermList
            terms={[
              { name: '희신', short: '용신을 생하여 돕는 오행', body: '용신이 제 역할을 하도록 뒷받침하는 오행입니다.' },
              { name: '기신', short: '용신을 극하는 오행', body: '사주의 균형을 해치기 쉬운 오행으로 봅니다. 기신이 강한 시기라고 해서 반드시 나쁜 결과를 의미하지는 않아요.' },
            ]}
          />
          <Note>달빛사주는 일간의 강약을 기준으로 하는 억부법을 중심으로 용신을 계산하며, 강약이 균형에 가까우면 가장 약한 오행을 보완하는 방식으로 정합니다. 조후와 격국은 반영하지 않은 참고용 판단이에요. 결과 화면의 &lsquo;용신 — 나에게 필요한 기운&rsquo; 항목이 이 계산 결과입니다.</Note>
        </Section>
      </Page>
    </div>
  );
}

function Section({ n, topic, title, children }: { n: number; topic: string; title: string; children: ReactNode }) {
  return (
    <Card as="section" className="space-y-3 text-[15px] leading-relaxed">
      <div>
        <p className="tabular text-xs font-semibold tracking-wide text-gold">
          {String(n).padStart(2, '0')} · {topic}
        </p>
        <h2 className="mt-1 font-serif text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function TermList({ terms }: { terms: Term[] }) {
  return (
    <dl className="space-y-3">
      {terms.map((x) => (
        <div key={x.name}>
          <dt className="font-semibold">
            {x.name} <span className="font-normal text-ink-3">· {x.short}</span>
          </dt>
          <dd className="mt-0.5 text-sm leading-relaxed text-ink-2">{x.body}</dd>
        </div>
      ))}
    </dl>
  );
}

function Fold({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown className="size-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
