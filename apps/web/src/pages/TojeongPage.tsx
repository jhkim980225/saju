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

const PAGE_TITLE = (year: number) => `${year} 토정비결 무료 — 144괘로 보는 한 해 | 달빛사주`;
const PAGE_DESCRIPTION = (year: number) => `생년월일만 넣으면 ${year}년 토정비결 괘와 총평, 음력 열두 달 흐름을 무료로 볼 수 있어요. 괘를 뽑은 계산 근거까지 함께 보여 드려요.`;

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

        {!showForm && q.isLoading && <Spinner label="괘를 뽑고 있어요" />}
        {!showForm && q.error && !badInput && <ErrorState title={t('error.server.title')} onRetry={() => q.refetch()} />}
        {!showForm && badInput && (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-lg font-semibold">이 생년월일로는 괘를 뽑을 수 없어요</p>
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
        <p className="text-sm font-semibold text-ink-3">무료 · 144괘</p>
        <h2 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[34px]">{year}년, 나의 한 해를 괘 하나로 읽어요</h2>
        <p className="prose-reading mt-3 text-[16px] leading-relaxed text-ink-2">
          토정비결은 음력 생년월일과 그해의 간지로 144괘 가운데 하나를 뽑아 한 해의 흐름과 열두 달을 살피는 세시 풍속이에요. 태어난 시간은 쓰지 않아요.
        </p>
        <form onSubmit={submit} noValidate className="mt-6 space-y-6 lg:max-w-md">
          <Field label={t('form.calendar.label')} required error={error} helper="양력으로 넣어도 음력으로 바꿔 계산해요." htmlFor="tojeong-date">
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
        <h3 className="font-semibold">괘는 이렇게 뽑아요</h3>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-2">
          <li>
            <b className="text-ink">상괘</b> 그해 나이(세는나이)와 그해 간지의 수를 더해 8로 나눈 나머지
          </li>
          <li>
            <b className="text-ink">중괘</b> 그해 생월의 날수(큰달 30·작은달 29)와 그달 간지의 수를 더해 6으로 나눈 나머지
          </li>
          <li>
            <b className="text-ink">하괘</b> 생일과 그해 생일 간지의 수를 더해 3으로 나눈 나머지
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-3">8 × 6 × 3 = 144괘. 결과 화면에서 내 괘의 계산 과정을 그대로 보여 드려요.</p>
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
              {d.year} {d.yearPillar.hangul}({d.yearPillar.hanja})년 토정비결
            </p>
            {onEdit && (
              <button type="button" onClick={onEdit} className="shrink-0 text-sm font-medium text-ink-2 underline underline-offset-4">
                다른 생년월일
              </button>
            )}
          </div>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="tabular font-serif text-[44px] font-semibold leading-none lg:text-[56px]">{d.gwae.code}</span>
            <span className="text-sm text-ink-3">괘</span>
          </p>
          <p className="mt-4 font-serif text-[22px] tracking-wide lg:text-[26px]">{d.gwae.verse}</p>
          <p className="mt-1 text-sm text-ink-3">{d.gwae.reading}</p>
          <h2 className="mt-5 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">{d.gwae.title}</h2>
          <p className="mt-2 text-[17px] leading-relaxed text-ink-2">{d.gwae.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.gwae.keywords.map((k) => (
              <Badge key={k}>{k}</Badge>
            ))}
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
            괘를 뽑은 방법
            <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-3 text-sm text-ink-2">
            {lunarLabel(d.basis.lunarBirth)} · {d.year}년 세는나이 {d.basis.age}세
          </p>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="rounded-xl bg-subtle p-3">
              <dt className="font-semibold">
                상괘 {d.gwae.upper} <span className="font-normal text-ink-3">· 나이 + 태세수</span>
              </dt>
              <dd className="tabular mt-1 text-ink-2">
                {d.basis.age} + {d.basis.upper.value}({d.basis.upper.ganzhi}) = {d.basis.upper.sum} → 8로 나눈 나머지 {d.gwae.upper}
              </dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="font-semibold">
                중괘 {d.gwae.middle} <span className="font-normal text-ink-3">· 생월 날수 + 월건수</span>
              </dt>
              <dd className="tabular mt-1 text-ink-2">
                {d.basis.middle.monthDays} + {d.basis.middle.value}({d.basis.middle.ganzhi}월) = {d.basis.middle.sum} → 6으로 나눈 나머지 {d.gwae.middle}
              </dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="font-semibold">
                하괘 {d.gwae.lower} <span className="font-normal text-ink-3">· 생일 + 일진수</span>
              </dt>
              <dd className="tabular mt-1 text-ink-2">
                {d.basis.lower.birthDay} + {d.basis.lower.value}({d.basis.lower.ganzhi}일) = {d.basis.lower.sum} → 3으로 나눈 나머지 {d.gwae.lower}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">나머지가 0이면 나눈 수(8·6·3)로 봐요. 월건·일진은 {d.year}년 달력의 생월·생일 간지예요.</p>
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
                토정비결이 한 해의 큰 그림이라면, 신년운세는 내 사주팔자와 {d.yearPillar.hanja}년의 기운이 만나는 자리를 재물·애정·직장·건강과 열두 달로 풀어요. 총운과 첫 두 달은 무료로 볼 수 있어요.
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
