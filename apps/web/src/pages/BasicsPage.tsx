import { ArrowLeft, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { Card, IconButton, PageHeader, cx } from '@/components/ui';
import { t } from '@/lib/copy';
import { ELEMENT_META, ELEMENT_ORDER } from '@/lib/format';
import { NAPEUM, RELATIONS, ROWS, SHINSAL, STAGES, STRENGTH_PARTS, TEN_GODS, TEN_GOD_GROUPS, type Term } from '@/lib/sajuBasics';

type El = keyof typeof ELEMENT_META;
/** 천간 열 개 — 글자·읽기·기운·음양 (packages/saju-core constants 의 STEMS 와 같다) */
const STEMS: [string, string, El, '+' | '−'][] = [
  ['甲', '갑', 'wood', '+'], ['乙', '을', 'wood', '−'], ['丙', '병', 'fire', '+'], ['丁', '정', 'fire', '−'], ['戊', '무', 'earth', '+'],
  ['己', '기', 'earth', '−'], ['庚', '경', 'metal', '+'], ['辛', '신', 'metal', '−'], ['壬', '임', 'water', '+'], ['癸', '계', 'water', '−'],
];
/** 지지 열두 개 — 글자·읽기·띠·기운·음양·시간대 (BRANCHES 와 같다) */
const BRANCHES: [string, string, string, El, '+' | '−', string][] = [
  ['子', '자', '쥐', 'water', '+', '23~1시'], ['丑', '축', '소', 'earth', '−', '1~3시'], ['寅', '인', '호랑이', 'wood', '+', '3~5시'], ['卯', '묘', '토끼', 'wood', '−', '5~7시'],
  ['辰', '진', '용', 'earth', '+', '7~9시'], ['巳', '사', '뱀', 'fire', '−', '9~11시'], ['午', '오', '말', 'fire', '+', '11~13시'], ['未', '미', '양', 'earth', '−', '13~15시'],
  ['申', '신', '원숭이', 'metal', '+', '15~17시'], ['酉', '유', '닭', 'metal', '−', '17~19시'], ['戌', '술', '개', 'earth', '+', '19~21시'], ['亥', '해', '돼지', 'water', '−', '21~23시'],
];

/**
 * 사주 기초 — 사주를 처음 보는 사람이 결과 화면과 '전문가 보기' 표를 읽을 수 있게.
 * 용어를 가르치는 자리라 용어를 쓰되, 바로 뒤에 뜻을 붙인다. 설명은 lib/sajuBasics.ts 와 같은 것을 쓴다.
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
          사주 풀이를 읽을 때 알아 두면 좋은 것만 모았어요. 위에서부터 차례로 읽으면 결과 화면의 &lsquo;전문가 보기&rsquo; 표도 읽을 수 있어요.
        </p>

        <Section n={1} title="사주는 여덟 글자예요">
          <p>태어난 해·달·날·시간을 각각 두 글자로 바꾼 것을 기둥이라고 해요. 기둥이 넷이라 &lsquo;사주&rsquo;, 글자가 여덟이라 &lsquo;팔자&rsquo;라고 불러요.</p>
          <div className="grid grid-cols-[3.5rem_repeat(4,minmax(0,1fr))] gap-1.5 text-center text-xs">
            <div />
            {['시간', '날', '달', '해'].map((c) => (
              <div key={c} className="font-semibold text-ink-2">
                태어난 {c}
              </div>
            ))}
            <div className="self-center text-ink-3">위 글자</div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cx('grid h-12 place-items-center rounded-lg bg-subtle font-semibold', i === 1 && 'ring-2 ring-focus')}>
                {i === 1 ? '나' : '천간'}
              </div>
            ))}
            <div className="self-center text-ink-3">아래 글자</div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid h-12 place-items-center rounded-lg bg-subtle font-semibold">
                지지
              </div>
            ))}
          </div>
          <p>표는 오른쪽부터 해 → 달 → 날 → 시간 순서예요. 위 글자를 천간, 아래 글자를 지지라고 해요.</p>
          <TermList terms={[ROWS.stem, ROWS.branch]} />
        </Section>

        <Section n={2} title="'나'는 태어난 날의 위 글자예요">
          <p>태어난 날 기둥의 위 글자를 일간이라고 하고, 표에서 &lsquo;나&rsquo;로 표시해요. 사주는 이 글자를 기준으로 나머지 일곱 글자가 나와 어떤 관계인지를 읽어요.</p>
        </Section>

        <Section n={3} title="다섯 가지 기운 — 오행">
          <p>글자마다 나무·불·흙·쇠·물 가운데 하나의 기운이 있어요. 이것을 오행이라고 해요. 어떤 기운이 많고 적은지로 성향을 읽고, 부족한 기운을 어떻게 채울지 찾아요.</p>
          <div className="flex flex-wrap gap-2">
            {ELEMENT_ORDER.map((e) => (
              <span key={e} className={cx('rounded-full px-3 py-1 text-sm font-semibold', ELEMENT_META[e].cls.soft, ELEMENT_META[e].cls.ink)}>
                {ELEMENT_META[e].label}({ELEMENT_META[e].name})
              </span>
            ))}
          </div>
          <dl className="space-y-2 rounded-xl bg-subtle p-3 text-sm">
            <div>
              <dt className="font-semibold">서로 돕는 순서 — 상생</dt>
              <dd className="mt-0.5 text-ink-2">나무 → 불 → 흙 → 쇠 → 물 → 다시 나무. 앞의 기운이 뒤의 기운을 도와요.</dd>
            </div>
            <div>
              <dt className="font-semibold">서로 누르는 관계 — 상극</dt>
              <dd className="mt-0.5 text-ink-2">나무 → 흙, 흙 → 물, 물 → 불, 불 → 쇠, 쇠 → 나무. 앞의 기운이 뒤의 기운을 눌러요.</dd>
            </div>
          </dl>
        </Section>

        <Section n={4} title="양(+)과 음(−)">
          <p>같은 기운도 양과 음으로 나뉘어요. 양은 밖으로 드러나고 힘차게 움직이는 쪽, 음은 안으로 모으고 섬세한 쪽이에요. 표에서 글자 옆의 +, − 표시가 이것이에요.</p>
        </Section>

        <Section n={5} title="위 글자 열 개, 아래 글자 열두 개">
          <Fold summary="천간 열 개 보기">
            <table className="w-full text-center text-sm">
              <thead className="text-xs text-ink-3">
                <tr>
                  <th className="py-1 font-medium">글자</th>
                  <th className="font-medium">읽기</th>
                  <th className="font-medium">기운</th>
                  <th className="font-medium">음양</th>
                </tr>
              </thead>
              <tbody>
                {STEMS.map(([h, k, e, y]) => (
                  <tr key={h} className="border-t border-line">
                    <td className="py-1.5 font-serif text-base">{h}</td>
                    <td>{k}</td>
                    <td className={ELEMENT_META[e].cls.solid}>{ELEMENT_META[e].label}</td>
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
                  <th className="font-medium">기운</th>
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
                    <td className={ELEMENT_META[e].cls.solid}>{ELEMENT_META[e].label}</td>
                    <td>{y}</td>
                    <td className="tabular text-xs text-ink-2">{time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Fold>
        </Section>

        <Section n={6} title="나와의 관계 열 가지 — 십성">
          <p>{ROWS.tenGods.body}</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {TEN_GOD_GROUPS.map((g) => (
              <li key={g.group} className="px-3 py-2.5 text-sm">
                <p className="font-semibold">
                  {g.group} <span className="font-normal text-ink-3">· {g.pair.join(' · ')}</span>
                </p>
                <p className="mt-0.5 text-ink-2">{g.what}</p>
              </li>
            ))}
          </ul>
          <Fold summary="열 가지 하나씩 보기">
            <TermList terms={Object.values(TEN_GODS).filter((x) => x.name !== '일간')} />
          </Fold>
        </Section>

        <Section n={7} title="표의 나머지 줄">
          <TermList terms={[ROWS.hidden, ROWS.stage, ROWS.napeum, ROWS.shinsal, ROWS.relations, ROWS.gongmang, ROWS.strength]} />
          <Fold summary="12운성 열두 단계">
            <TermList terms={Object.values(STAGES)} />
          </Fold>
          <Fold summary="신살 — 특별한 기운">
            <TermList terms={Object.values(SHINSAL).filter((x) => x.name !== '공망')} />
          </Fold>
          <Fold summary="합·충 — 글자끼리의 관계">
            <TermList terms={Object.values(RELATIONS)} />
          </Fold>
          <Fold summary="신강·신약을 정하는 세 가지">
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
        </Section>

        <Section n={8} title="시기마다 달라지는 운">
          <p>타고난 여덟 글자는 바뀌지 않지만, 시기마다 들어오는 기운이 달라서 운이 달라져요.</p>
          <TermList
            terms={[
              { name: '대운', short: '10년마다 바뀌는 큰 흐름', body: '태어난 달에서 시작해 10년마다 바뀌는 기운이에요. 인생의 큰 흐름을 볼 때 써요.' },
              { name: '세운', short: '그해의 흐름', body: '해마다 들어오는 기운이에요. 신년운세는 이것을 보고 풀어요.' },
              { name: '월운 · 일진', short: '그달과 그날의 흐름', body: '달마다, 날마다 들어오는 기운이에요. 오늘의 운세는 그날의 기운(일진)이 나와 어떻게 만나는지 보고 풀어요.' },
            ]}
          />
        </Section>

        <Section n={9} title="필요한 기운 — 용신">
          <TermList
            terms={[
              { name: '용신', short: '균형을 맞추는 데 가장 필요한 기운', body: '사주에서 넘치는 쪽을 덜고 모자란 쪽을 채워 균형을 맞추는 기운이에요. 결과 화면의 ‘필요한 기운’이 이것이에요.' },
              { name: '희신', short: '용신을 돕는 기운', body: '필요한 기운이 힘을 내도록 곁에서 돕는 기운이에요.' },
              { name: '기신', short: '균형을 깨기 쉬운 기운', body: '이미 넘치는 쪽을 더 키워 균형을 깨기 쉬운 기운이에요. 나쁜 운이라는 뜻은 아니고, 이 기운이 강한 시기에는 무리하지 않으면 돼요.' },
            ]}
          />
        </Section>
      </Page>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card as="section" className="space-y-3 text-[15px] leading-relaxed">
      <h2 className="flex items-baseline gap-2 font-serif text-lg font-semibold">
        <span className="tabular text-sm text-gold">{n}</span>
        {title}
      </h2>
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
