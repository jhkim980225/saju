import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PROFILE_RELATIONS, RELATION_LABEL, type ProfileRelation } from '@saju/shared/profile';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { Button, Chip, Field, IconButton, PageHeader, Segmented, TextInput, cx } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { CITIES, EMPTY_FORM, HOUR_RANGES, cityById, formatDateDigits, formatTimeDigits, profileToForm, requiredProgress, validateBirthForm, type BirthDraft, type BirthFormState, type FormErrors } from '@/lib/birth';
import { t } from '@/lib/copy';
import { targetFortuneYear } from '@/lib/format';
import { ensureSession } from '@/lib/session';
import { STORAGE_KEYS, storage } from '@/lib/storage';

type Mode = 'anonymous' | 'create' | 'edit';

/** 사주 입력 화면(/input, 프로필 추가·수정) */
export function BirthFormPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const editId = params.id;
  const mode: Mode = editId ? 'edit' : search.get('save') ? 'create' : 'anonymous';
  return <BirthForm variant="page" mode={mode} editId={editId} next={search.get('next')} initialRelation={(search.get('relation') as ProfileRelation) || 'self'} />;
}

/**
 * 사주 입력 폼 — 다른 사주 서비스처럼 이름 → 성별 → 생년월일 → 시간 → 출생지 순서로 짧게.
 * - page: 입력 화면. 위에 제목·필수 항목 수, 아래에 고정 버튼
 * - embedded: 첫 화면에 바로 넣는 폼(비회원). 버튼이 폼 안에 있다
 */
export function BirthForm({
  variant,
  mode = 'anonymous',
  editId,
  next,
  initialRelation = 'self',
}: {
  variant: 'page' | 'embedded';
  mode?: Mode;
  editId?: string;
  next?: string | null;
  initialRelation?: ProfileRelation;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [relation, setRelation] = useState<ProfileRelation>(initialRelation);

  const draft = storage.getJSON<BirthDraft & { remember?: boolean }>(STORAGE_KEYS.birthDraft);
  const [form, setForm] = useState<BirthFormState>(mode === 'anonymous' && draft?.remember ? draft.form : EMPTY_FORM);
  const [remember, setRemember] = useState(Boolean(draft?.remember));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [citySheet, setCitySheet] = useState(false);
  const [hourSheet, setHourSheet] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const { data: editing } = useQuery({ queryKey: ['profile', editId], queryFn: () => api.profiles().then((l) => l.find((p) => p.id === editId) ?? null), enabled: mode === 'edit' });
  useEffect(() => {
    if (editing) {
      setForm(profileToForm(editing));
      setRelation(editing.relation);
    }
  }, [editing]);

  const set = <K extends keyof BirthFormState>(k: K, v: BirthFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const progress = requiredProgress(form);
  const city = cityById(form.cityId);
  const page = variant === 'page';

  const onBlurValidate = (field: keyof FormErrors) => {
    const { errors: e } = validateBirthForm(form);
    setErrors((prev) => ({ ...prev, [field]: e[field] }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { errors: errs, dto } = validateBirthForm(form);
    setErrors(errs);
    setServerError(null);
    if (!dto) return;
    track('birth_submitted', { mode, calendar: dto.calendar, timeKnown: dto.hour !== null, from: variant });
    if (mode === 'anonymous') {
      storage.setJSON(STORAGE_KEYS.birthDraft, { form, dto, remember });
      navigate('/confirm');
      return;
    }
    setBusy(true);
    try {
      await ensureSession();
      const name = form.name.trim() || (relation === 'self' ? t('common.me') : RELATION_LABEL[relation]);
      const profile =
        mode === 'edit' && editId
          ? await api.updateProfile(editId, { name, relation, birth: dto })
          : await api.createProfile({ name, relation, birth: dto });
      // 풀이·오늘·신년·궁합 등 이 프로필로 계산된 모든 화면을 다시 불러오도록 전체 무효화
      await qc.invalidateQueries();
      navigate(next ?? `/saju/${profile.id}`, { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('form.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'edit' ? '사주 정보 수정' : mode === 'create' ? '사주 추가하기' : t('form.title');
  const submitLabel = mode === 'anonymous' ? (page ? t('form.submit') : '무료 사주 보기') : t('common.save');

  const fields = (
    <form id="birth-form" onSubmit={submit} noValidate className={page ? 'mt-6 space-y-6' : 'space-y-5'}>
      {mode !== 'anonymous' && (
        <Field label="관계">
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {PROFILE_RELATIONS.map((r) => (
              <Chip key={r} active={relation === r} onClick={() => setRelation(r)}>
                {RELATION_LABEL[r]}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <Field label={t('form.name.label')} error={errors.name} htmlFor="name">
        <TextInput id="name" value={form.name} maxLength={12} placeholder={t('form.name.placeholder')} onChange={(e) => set('name', e.target.value)} onBlur={() => onBlurValidate('name')} invalid={Boolean(errors.name)} />
      </Field>

      <Field label={t('form.gender.label')} required error={errors.gender}>
        <Segmented
          name={t('form.gender.label')}
          value={form.gender}
          onChange={(v) => {
            set('gender', v);
            setErrors((p) => ({ ...p, gender: undefined }));
          }}
          options={[
            { value: 'female', label: t('form.gender.female') },
            { value: 'male', label: t('form.gender.male') },
          ]}
        />
      </Field>

      <Field label="생년월일" required error={errors.date} htmlFor="birthDate">
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
          id="birthDate"
          inputMode="numeric"
          pattern="[0-9.]*"
          autoComplete="bday"
          placeholder={t('form.birthDate.placeholder')}
          value={formatDateDigits(form.date)}
          onChange={(e) => set('date', e.target.value.replace(/\D/g, '').slice(0, 8))}
          onBlur={() => onBlurValidate('date')}
          invalid={Boolean(errors.date)}
        />
        {form.calendar === 'lunar' && (
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" className="size-5 accent-[var(--action)]" checked={form.isLeapMonth} onChange={(e) => set('isLeapMonth', e.target.checked)} />
            {t('form.calendar.leapMonth')}
          </label>
        )}
      </Field>

      <Field label={t('form.birthTime.label')} required error={errors.time} helper={form.timeUnknown ? t('form.birthTime.unknownHelper') : undefined} htmlFor="birthTime">
        {!form.timeUnknown && (
          <TextInput
            id="birthTime"
            inputMode="numeric"
            placeholder={t('form.birthTime.placeholder')}
            value={form.time}
            onChange={(e) => set('time', formatTimeDigits(e.target.value))}
            onBlur={() => onBlurValidate('time')}
            invalid={Boolean(errors.time)}
          />
        )}
        <div className="flex gap-2">
          <Chip onClick={() => setHourSheet(true)}>{t('form.birthTime.pickRange')}</Chip>
          <Chip
            active={form.timeUnknown}
            onClick={() => {
              setForm((f) => ({ ...f, timeUnknown: !f.timeUnknown }));
              setErrors((p) => ({ ...p, time: undefined }));
            }}
          >
            {t('form.birthTime.unknown')}
          </Chip>
        </div>
      </Field>

      <Field label={t('form.birthPlace.label')}>
        <button type="button" onClick={() => setCitySheet(true)} className="flex h-13 w-full items-center justify-between rounded-xl border border-line-strong bg-surface px-4 text-left text-base">
          {city.name}
          <ChevronDown className="size-5 text-ink-3" aria-hidden />
        </button>
      </Field>

      {page && (
        <div>
          <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="flex items-center gap-1 text-[15px] font-medium text-ink-2">
            <ChevronDown className={cx('size-4 transition-transform', advanced && 'rotate-180')} aria-hidden />
            {t('form.advanced.toggle')} <span className="text-sm text-ink-3">({t('form.advanced.toggleHint')})</span>
          </button>
          {advanced && (
            <div className="mt-4 space-y-5 rounded-2xl bg-subtle p-4">
              <Field label={t('form.advanced.longitude')} helper={t('form.advanced.longitudeHelper')}>
                <Segmented
                  name={t('form.advanced.longitude')}
                  value={form.timeCorrection}
                  onChange={(v) => set('timeCorrection', v)}
                  options={[
                    { value: 'lmt', label: t('form.advanced.longitudeLmt') },
                    { value: 'trueSolar', label: t('form.advanced.longitudeTrueSolar') },
                    { value: 'clock', label: t('form.advanced.longitudeClock') },
                  ]}
                />
              </Field>
              <Field label={t('form.advanced.yajasi')} helper={t('form.advanced.yajasiHelper')}>
                <Segmented
                  name={t('form.advanced.yajasi')}
                  value={form.ziHourRule}
                  onChange={(v) => set('ziHourRule', v)}
                  options={[
                    { value: 'nextDay', label: t('form.advanced.yajasiNextDay') },
                    { value: 'midnight', label: t('form.advanced.yajasiMidnight') },
                  ]}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {page && mode === 'anonymous' && (
        <label className="flex items-center gap-2 text-[15px] text-ink-2">
          <input type="checkbox" className="size-5 accent-[var(--action)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('form.remember')}
        </label>
      )}
      {serverError && (
        <p role="alert" className="rounded-xl bg-subtle p-3 text-sm text-danger">
          {serverError}
        </p>
      )}
      {!page && (
        <Button type="submit" block size="lg" loading={busy}>
          {submitLabel}
        </Button>
      )}
    </form>
  );

  const sheets = (
    <>
      <CitySheet open={citySheet} onClose={() => setCitySheet(false)} value={form.cityId} onPick={(id) => set('cityId', id)} />
      <BottomSheet open={hourSheet} onClose={() => setHourSheet(false)} title={t('form.birthTime.rangeSheetTitle')}>
        <p className="text-sm text-ink-2">{t('form.birthTime.rangeSheetHelper')}</p>
        <ul className="mt-3 divide-y divide-line">
          {HOUR_RANGES.map((h) => (
            <li key={h.key}>
              <button
                type="button"
                className="w-full py-3.5 text-left text-[15px]"
                onClick={() => {
                  setForm((f) => ({ ...f, time: h.time, timeUnknown: false }));
                  setErrors((p) => ({ ...p, time: undefined }));
                  setHourSheet(false);
                }}
              >
                {t(`form.birthTime.branches.${h.key}`)}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );

  if (!page) {
    return (
      <>
        {fields}
        {sheets}
      </>
    );
  }

  return (
    <div className="min-h-page pb-32 lg:pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={title}
        right={<span className="tabular text-sm text-ink-3">{t('form.progress', { current: progress, total: 4 })}</span>}
      />
      <Page>
        {next === '/yearly' && <p className="mt-2 text-[15px] text-ink-2">사주를 저장하면 바로 {targetFortuneYear()} 신년운세를 보여 드려요.</p>}
        {fields}
      </Page>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas lg:static lg:border-0 lg:bg-transparent">
        <div className="mx-auto max-w-xl px-5 py-3 lg:pt-8">
          <Button type="submit" form="birth-form" block size="lg" loading={busy} disabled={progress < 4}>
            {submitLabel}
          </Button>
        </div>
      </div>
      {sheets}
    </div>
  );
}

function CitySheet({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => CITIES.filter((c) => c.name.includes(q.trim())), [q]);
  return (
    <BottomSheet open={open} onClose={onClose} title={t('form.birthPlace.label')}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('form.birthPlace.placeholder')} className="pl-10" aria-label={t('form.birthPlace.placeholder')} />
      </div>
      {list.length === 0 && <p className="py-6 text-center text-sm text-ink-3">{t('form.birthPlace.searchEmpty')}</p>}
      <ul className="mt-2 divide-y divide-line">
        {list.map((c, i) => (
          <li key={c.id}>
            {c.abroad && !list[i - 1]?.abroad && <p className="pt-4 text-xs font-semibold text-ink-3">{t('form.birthPlace.abroad')}</p>}
            <button
              type="button"
              className={cx('flex w-full items-center justify-between py-3.5 text-left text-[15px]', c.id === value && 'font-semibold')}
              onClick={() => {
                onPick(c.id);
                onClose();
              }}
            >
              {c.name}
              <span className="tabular text-xs text-ink-3">
                {c.longitude.toFixed(2)}° {c.abroad ? `· ${c.timeZone}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
