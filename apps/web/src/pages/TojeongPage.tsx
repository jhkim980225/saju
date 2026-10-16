import { useQuery } from '@tanstack/react-query';
import { TOJEONG_DEFAULT_YEAR, type ProfileDto, type TojeongBirthDto, type TojeongDto } from '@saju/shared';
import { ArrowLeft, CalendarRange, ChevronDown, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AdSlot } from '@/components/AdSlot';
import { Page } from '@/components/AppShell';
import { ShareSheet } from '@/components/ShareSheet';
import { Badge, Button, Card, Chip, ErrorState, Field, IconButton, PageHeader, Segmented, Spinner, TextInput, cx } from '@/components/ui';
import { useProfiles } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { formatDateDigits, type BirthDraft } from '@/lib/birth';
import { t } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import {
  EMPTY_TOJEONG_FORM,
  FLOW_DOT,
  FLOW_LABEL,
  TOJEONG_BIRTH_KEY,
  fetchTojeong,
  formFromBirth,
  pickTojeongBirth,
  validateTojeongForm,
  type TojeongFormState,
} from '@/lib/tojeong';

type Source = { kind: 'profile'; profile: ProfileDto } | { kind: 'birth'; birth: TojeongBirthDto; name?: string };

const PAGE_TITLE = (year: number) => `${year} 토정비결 무료 — 생년월일로 보는 한 해 운세 | 달빛사주`;
const PAGE_DESCRIPTION = (year: number) => `생년월일만 넣으면 ${year}년 토정비결 총평과 음력 열두 달 흐름을 무료로 볼 수 있어요. 풀이 번호(괘)를 뽑은 계산 과정도 함께 보여 드려요.`;

/** 검색 유입용 페이지라 탭 제목·설명을 이 화면 동안만 바꿔 둔다(나갈 때 원래대로) */
function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content') ?? null;
    document.title = title;
    meta?.setAttribute('content', description);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== null) meta.setAttribute('content', prevDesc);
    };
  }, [title, description]);
}

/** 2027 토정비결 — 무료. 저장한 사주(프로필) · 사주 입력 중인 생년월일 · 이 화면에서 직접 넣은 생년월일 순으로 고른다 */
export function TojeongPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const year = Number(params.get('year')) || TOJEONG_DEFAULT_YEAR;
  usePageMeta(PAGE_TITLE(year), PAGE_DESCRIPTION(year));

  const token = useSession((s) => s.accessToken);
  const profiles = useProfiles();
  const list = profiles.data ?? [];
  const settled = !token || profiles.isFetched || profiles.isError;
  const draft = useMemo(() => storage.getJSON<BirthDraft>(STORAGE_KEYS.birthDraft), []);
  const saved = useMemo(() => storage.getJSON<TojeongBirthDto>(TOJEONG_BIRTH_KEY), []);

  const [chosen, setChosen] = useState<Source | null>(null);
  const [editing, setEditing] = useState(false);
  const activeId = storage.get(STORAGE_KEYS.activeProfile);
  const fallback: Source | null = settled
    ? (() => {
        const p = list.find((x) => x.id === activeId) ?? list.find((x) => x.isPrimary) ?? list[0];
        if (p) return { kind: 'profile', profile: p };
        if (saved) return { kind: 'birth', birth: saved };
        if (draft) return { kind: 'birth', birth: pickTojeongBirth(draft.dto), name: draft.form.name || undefined };
        return null;
      })()
    : null;
  const source = chosen ?? fallback;
  const showForm = settled && (editing || !source);

  const body = source?.kind === 'profile' ? { profileId: source.profile.id, year } : source ? { birth: source.birth, year } : null;
  const q = useQuery({
    queryKey: ['tojeong', year, body],
    queryFn: () => fetchTojeong(body!),
    enabled: Boolean(body) && !showForm,
    staleTime: 10 * 60_000,
  });
  const name = source?.kind === 'profile' ? source.profile.name : source?.name;
  const badInput = q.error instanceof ApiError && q.error.status === 400;
  // 서버가 받지 않은 생년월일(없는 음력 날짜 등)은 다음 방문 때 다시 불러오지 않는다
  useEffect(() => {
    if (badInput) storage.remove(TOJEONG_BIRTH_KEY);
  }, [badInput]);

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };

  const submit = (birth: TojeongBirthDto) => {
    storage.setJSON(TOJEONG_BIRTH_KEY, birth);
    setChosen({ kind: 'birth', birth });
    setEditing(false);
  };

  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={back}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={`${year} 토정비결`}
        width="wide"
      />
      <Page width="wide" className="pb-12">
        {!settled && <Spinner />}

        {list.length > 0 && (
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pt-2 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
            {list.map((p) => (
              <Chip
                key={p.id}
                active={!showForm && source?.kind === 'profile' && source.profile.id === p.id}
                onClick={() => {
                  setChosen({ kind: 'profile', profile: p });
                  setEditing(false);
                }}
              >
                {p.name}
              </Chip>
            ))}
            <Chip active={showForm || source?.kind === 'birth'} onClick={() => setEditing(true)}>
              다른 생년월일
            </Chip>
          </div>
        )}

        {showForm && (
          <TojeongForm
            year={year}
            initial={source?.kind === 'birth' ? formFromBirth(source.birth) : saved ? formFromBirth(saved) : EMPTY_TOJEONG_FORM}
            onSubmit={submit}
            onCancel={source ? () => setEditing(false) : undefined}
          />
        )}

        {!showForm && q.isLoading && <Spinner label="올해 풀이를 찾고 있어요" />}
        {!showForm && q.error && !badInput && <ErrorState title={t('error.server.title')} onRetry={() => q.refetch()} />}
        {!showForm && badInput && (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-lg font-semibold">이 생년월일로는 풀이를 볼 수 없어요</p>
            <p className="text-[15px] text-ink-2">{q.error?.message}</p>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              생년월일 다시 입력
            </Button>
          </div>
        )}
        {!showForm && q.data && <TojeongResult data={q.data} name={name} onEdit={() => setEditing(true)} />}
      </Page>
    </div>
  );
}

function TojeongForm({ year, initial, onSubmit, onCancel }: { year: number; initial: TojeongFormState; onSubmit: (b: TojeongBirthDto) => void; onCancel?: () => void }) {
  const [form, setForm] = useState<TojeongFormState>(initial);
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validateTojeongForm(form);
    setError(r.error);
    if (r.dto) onSubmit(r.dto);
  };
  return (
    <section className="animate-fade pt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
      <div>
        <p className="text-sm font-semibold text-ink-3">무료 · 생년월일만으로 볼 수 있어요</p>
        <h2 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[34px]">{year}년 토정비결로 보는 한 해의 흐름</h2>
        <p className="prose-reading mt-3 text-[16px] leading-relaxed text-ink-2">
          토정비결은 조선 시대부터 새해에 한 해의 운을 살펴보던 풍속으로, 토정 이지함이 지었다고 전해집니다. 음력 생년월일로 144가지 괘 가운데 하나를 정해 한 해의 흐름과 열두 달을 풀이합니다. 태어난 시간은 필요하지 않아요.
        </p>
        <form onSubmit={submit} noValidate className="mt-6 space-y-6 lg:max-w-md">
          <Field label={t('form.calendar.label')} required error={error} helper="양력으로 입력해도 음력으로 변환해 계산합니다." htmlFor="tojeong-date">
            <Segmented
              name={t('form.calendar.label')}
              value={form.calendar}
              onChange={(v) => setForm((f) => ({ ...f, calendar: v, isLeapMonth: v === 'solar' ? false : f.isLeapMonth }))}
              options={[
                { value: 'solar', label: t('form.calendar.solar') },
                { value: 'lunar', label: t('form.calendar.lunar') },
              ]}
            />
            <TextInput
              id="tojeong-date"
              inputMode="numeric"
              pattern="[0-9.]*"
              autoComplete="bday"
              placeholder={t('form.birthDate.placeholder')}
              value={formatDateDigits(form.date)}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
              invalid={Boolean(error)}
            />
            {form.calendar === 'lunar' && (
              <label className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" className="size-5 accent-[var(--action)]" checked={form.isLeapMonth} onChange={(e) => setForm((f) => ({ ...f, isLeapMonth: e.target.checked }))} />
                {t('form.calendar.leapMonth')}
                <span className="text-sm text-ink-3">— 윤달 생일은 같은 달의 평달로 계산해요.</span>
              </label>
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="lg" className="flex-1">
              토정비결 보기
            </Button>
            {onCancel && (
              <Button type="button" size="lg" variant="secondary" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </form>
      </div>
      <Card className="mt-8 lg:mt-0">
        <h3 className="font-semibold">풀이는 어떻게 정해지나요?</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          음력 생년월일과 그해의 간지에 붙은 수를 더하고 나눠 세 자리 번호를 만듭니다. 이 번호를 &lsquo;괘&rsquo;라고 하며, 괘마다 정해진 풀이가 있어 생년월일이 같으면 같은 풀이가 나와요.
        </p>
        <details className="group mt-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-ink-2">
            계산 방법 자세히 보기 <span className="text-ink-3">(참고)</span>
            <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-3 space-y-2 leading-relaxed text-ink-2">
            <li>
              <b className="text-ink">첫째 자리(상괘)</b> 그해 나이(세는나이)와 그해에 붙은 수를 더해 8로 나눈 나머지
            </li>
            <li>
              <b className="text-ink">둘째 자리(중괘)</b> 그해 태어난 달의 날수(큰달 30·작은달 29)와 그달에 붙은 수를 더해 6으로 나눈 나머지
            </li>
            <li>
              <b className="text-ink">셋째 자리(하괘)</b> 태어난 날과 그해 생일에 붙은 수를 더해 3으로 나눈 나머지
            </li>
          </ul>
          <p className="mt-3 text-xs text-ink-3">8 × 6 × 3 = 144가지입니다. 결과 화면에서 내 괘의 계산 과정을 그대로 보여 드려요.</p>
        </details>
      </Card>
    </section>
  );
}

const lunarLabel = (b: TojeongDto['basis']['lunarBirth']) => `음력 ${b.year}년 ${b.isLeapMonth ? '윤' : ''}${b.month}월 ${b.day}일`;

/** 결과 — 괘사·총평·열두 달·작괘 근거·신년운세 추천·광고(무료 결과 하단)·공유 */
export function TojeongResult({ data: d, name, onEdit }: { data: TojeongDto; name?: string; onEdit?: () => void }) {
  const [shareOpen, setShareOpen] = useState(false);
  const shareUrl = `${window.location.origin}/tojeong`;
  return (
    <div className="animate-fade lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div>
        <section className="pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-3">
              {name ? `${name}님의 ` : ''}
              {d.year}년 토정비결
            </p>
            {onEdit && (
              <button type="button" onClick={onEdit} className="shrink-0 text-sm font-medium text-ink-2 underline underline-offset-4">
                다른 생년월일
              </button>
            )}
          </div>
          {/* 뜻을 먼저 — 제목·한 줄 요약, 옛 글귀(한문)와 번호는 그 아래 참고로 */}
          <h2 className="mt-3 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">{d.gwae.title}</h2>
          <p className="mt-2 text-[17px] leading-relaxed text-ink-2">{d.gwae.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.gwae.keywords.map((k) => (
              <Badge key={k}>{k}</Badge>
            ))}
          </div>
          <div className="mt-5 rounded-2xl bg-subtle px-4 py-3">
            <p className="text-xs font-semibold text-ink-3">이 풀이의 바탕이 된 옛 글귀</p>
            <p className="mt-1.5 font-serif text-lg tracking-wide">{d.gwae.verse}</p>
            <p className="mt-0.5 text-sm text-ink-3">{d.gwae.reading}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              <span className="tabular font-semibold text-ink-2">{d.gwae.code}괘</span> · 토정비결의 144가지 풀이 가운데, 생년월일로 정해진 번호예요.
            </p>
          </div>
        </section>

        <Card className="mt-6">
          <h3 className="font-semibold">총평</h3>
          <div className="prose-reading mt-3 space-y-3 text-[16px] leading-relaxed">
            {d.overview.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </Card>

        <section className="mt-8" aria-labelledby="tojeong-months">
          <div className="flex items-end justify-between gap-3">
            <h3 id="tojeong-months" className="text-lg font-semibold">
              열두 달의 흐름
            </h3>
            <p className="text-xs text-ink-3">음력 기준 · 괄호는 양력</p>
          </div>
          <ol className="mt-3 grid grid-cols-12 gap-1" aria-hidden>
            {d.months.map((m) => (
              <li key={m.month} className="flex flex-col items-center gap-1">
                <span className={cx('size-3 rounded-full border', FLOW_DOT[m.flow])} />
                <span className="tabular text-[10px] text-ink-3">{m.month}</span>
              </li>
            ))}
          </ol>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3" aria-hidden>
            {(['rise', 'even', 'care'] as const).map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <span className={cx('size-2.5 rounded-full border', FLOW_DOT[f])} />
                {FLOW_LABEL[f]}
              </li>
            ))}
          </ul>
          <ol className="mt-4 grid gap-2 lg:grid-cols-2 lg:gap-3">
            {d.months.map((m) => (
              <li key={m.month} className="rounded-2xl border border-line bg-surface px-5 py-4" data-flow={m.flow}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">
                    {m.label}
                    <span className="tabular ml-1.5 text-xs font-normal text-ink-3">({m.period})</span>
                  </p>
                  <span className="flex items-center gap-1.5 text-xs text-ink-3">
                    <span className={cx('size-2.5 rounded-full border', FLOW_DOT[m.flow])} aria-hidden />
                    {m.flowLabel}
                  </span>
                </div>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{m.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="lg:sticky lg:top-6 lg:pt-4">
        <details className="group mt-6 rounded-2xl border border-line bg-surface p-5 lg:mt-0">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
            <span>
              괘를 뽑은 방법 <span className="text-sm font-normal text-ink-3">· 펼쳐 보기</span>
            </span>
            <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            생년월일과 {d.year}년의 간지에 붙은 수로 세 자리 번호(괘)를 정했어요. 첫째 자리는 나이, 둘째 자리는 태어난 달, 셋째 자리는 태어난 날로 정합니다.
          </p>
          <p className="mt-2 text-sm text-ink-2">
            {lunarLabel(d.basis.lunarBirth)} · {d.year}년 세는나이 {d.basis.age}세
          </p>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="rounded-xl bg-subtle p-3">
              <dt className="font-semibold">
                첫째 자리 {d.gwae.upper} <span className="font-normal text-ink-3">· 나이 + 그해의 수(상괘·태세수)</span>
              </dt>
              <dd className="tabular mt-1 text-ink-2">
                {d.basis.age} + {d.basis.upper.value}({d.basis.upper.ganzhi}) = {d.basis.upper.sum} → 8로 나눈 나머지 {d.gwae.upper}
              </dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="font-semibold">
                둘째 자리 {d.gwae.middle} <span className="font-normal text-ink-3">· 태어난 달의 날수 + 그달의 수(중괘·월건수)</span>
              </dt>
              <dd className="tabular mt-1 text-ink-2">
                {d.basis.middle.monthDays} + {d.basis.middle.value}({d.basis.middle.ganzhi}월) = {d.basis.middle.sum} → 6으로 나눈 나머지 {d.gwae.middle}
              </dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="font-semibold">
                셋째 자리 {d.gwae.lower} <span className="font-normal text-ink-3">· 태어난 날 + 그날의 수(하괘·일진수)</span>
              </dt>
              <dd className="tabular mt-1 text-ink-2">
                {d.basis.lower.birthDay} + {d.basis.lower.value}({d.basis.lower.ganzhi}일) = {d.basis.lower.sum} → 3으로 나눈 나머지 {d.gwae.lower}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            나머지가 0이면 나눈 수(8·6·3)로 봅니다. 괄호 속 한자는 {d.year}년({d.yearPillar.hangul}년)과 그해 생월·생일의 간지입니다.
          </p>
          {d.basis.notes.map((n) => (
            <p key={n} className="mt-1 text-xs leading-relaxed text-ink-3">
              {n}
            </p>
          ))}
        </details>

        <Card className="mt-4 border-line-strong">
          <div className="flex items-start gap-3">
            <CalendarRange className="mt-0.5 size-6 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <div>
              <p className="font-serif text-lg font-semibold">{d.year} 신년운세</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                토정비결이 한 해의 큰 흐름을 본다면, 신년운세는 태어난 시간까지 반영한 내 사주로 {d.year}년의 재물·연애·일·건강을 달마다 자세히 풀이합니다. 한 해 전체 흐름과 첫 두 달은 무료예요.
              </p>
            </div>
          </div>
          <Link
            to={d.profileId ? `/yearly/${d.profileId}?year=${d.year}` : '/input'}
            className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-full bg-action font-semibold text-on-action"
          >
            {d.profileId ? '신년운세 보기' : '내 사주로 신년운세 보기'}
          </Link>
        </Card>

        <div className="mt-6">
          <AdSlot placement="result_bottom" />
        </div>

        <Button variant="secondary" block className="mt-6" onClick={() => setShareOpen(true)}>
          <Share2 className="size-4" aria-hidden />
          {t('common.share')}
        </Button>
        <p className="mt-6 text-xs leading-relaxed text-ink-3">{d.disclaimer}</p>
      </div>

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        payload={{
          title: `${d.year} 토정비결 ${d.gwae.code}괘 「${d.gwae.title}」`,
          text: `${d.gwae.summary} — 생년월일만 넣으면 무료로 볼 수 있어요.`,
          url: shareUrl,
          buttons: [{ title: '토정비결 보기', url: shareUrl }],
        }}
      />
    </div>
  );
}
