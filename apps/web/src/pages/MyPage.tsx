import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { RELATION_LABEL } from '@saju/shared';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { toast } from '@/components/Toast';
import { Badge, Button, Card, Field, PageHeader, Segmented, TextInput, Toggle } from '@/components/ui';
import { qk, useProfiles, useWallet } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { ApiError, api } from '@/lib/api';
import { t } from '@/lib/copy';
import { native, nativePlatform } from '@/lib/platform';
import { storage } from '@/lib/storage';
import { isMember, useSession } from '@/lib/session';
import { useTheme, type ThemeMode } from '@/lib/theme';

const PROVIDER_LABEL: Record<string, string> = { kakao: '카카오', naver: '네이버', google: '구글', apple: '애플', email: '이메일', guest: '게스트' };

export function MyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const refreshToken = useSession((s) => s.refreshToken);
  const clear = useSession((s) => s.clear);
  const theme = useTheme();
  const gate = useSessionGate();
  const profiles = useProfiles();
  const wallet = useWallet();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changePassword, setChangePassword] = useState(false);
  const closeChangePassword = useCallback(() => setChangePassword(false), []);
  const [pushOn, setPushOn] = useState(true);

  const removeProfile = useMutation({
    mutationFn: (id: string) => api.deleteProfile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.profiles }),
  });
  const member = isMember(user);

  const logout = async () => {
    // 이 기기의 푸시 토큰을 계정에서 해제 (앱 계층이 저장한 "userId|platform|token")
    const mark = storage.get('yd.native.pushToken');
    const token = mark?.split('|').slice(2).join('|');
    if (token) {
      await api.unregisterPush(token).catch(() => undefined);
      storage.remove('yd.native.pushToken');
    }
    if (refreshToken) await api.logout(refreshToken).catch(() => undefined);
    clear();
    qc.clear();
    navigate('/', { replace: true });
  };
  const deleteAccount = async () => {
    await api.deleteMe();
    clear();
    qc.clear();
    toast('탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.');
    navigate('/', { replace: true });
  };
  const togglePush = async (on: boolean) => {
    setPushOn(on);
    if (on && native.requestPush) {
      const token = await native.requestPush();
      const platform = nativePlatform();
      if (token && platform !== 'web') await api.registerPush(token, platform).catch(() => undefined);
    }
    if (member) await api.updateMe({ pushEnabled: on }).catch(() => undefined);
  };

  return (
    <div className="min-h-page">
      <PageHeader title={t('tabs.my')} width="wide" />
      <Page width="wide" className="pb-10 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="space-y-4">
          {gate.failed && <SessionGateError onRetry={gate.retry} />}
          <Card>
            {member ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{t('common.honorific', { name: user!.nickname })}</p>
                  <p className="text-sm text-ink-3">{user!.email ?? `${PROVIDER_LABEL[user!.provider] ?? user!.provider}로 로그인했어요`}</p>
                </div>
                {user!.isPremium && <Badge tone="gold">플러스</Badge>}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="font-semibold">로그인하면 저장한 사주와 구매 내역을 안전하게 보관해요</p>
                <p className="text-sm text-ink-2">지금까지 저장한 사주 정보는 그대로 유지됩니다.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => navigate('/login?next=/my')}>로그인</Button>
                  <Button variant="secondary" onClick={() => navigate('/signup?next=/my')}>
                    가입하기
                  </Button>
                </div>
              </div>
            )}
            {wallet.data && (
              <Link to="/my/payments" className="mt-4 flex items-center justify-between rounded-xl bg-subtle px-4 py-3 text-sm">
                <span>AI 상담 질문권</span>
                <span className="tabular font-semibold">{wallet.data.credits}회</span>
              </Link>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {t('my.savedProfiles')} ({profiles.data?.length ?? 0})
              </h2>
              <Link to="/profiles/new?save=1&relation=family&next=/my" className="text-sm font-semibold text-info">
                + {t('my.addProfile')}
              </Link>
            </div>
            {profiles.data && profiles.data.length === 0 && <p className="mt-3 text-sm text-ink-3">{t('empty.savedProfiles.body')}</p>}
            <ul className="mt-3 divide-y divide-line">
              {profiles.data?.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-3">
                  <Link to={`/saju/${p.id}`} className="flex-1">
                    <p className="font-medium">
                      {p.name} <span className="text-xs text-ink-3">{RELATION_LABEL[p.relation]}</span>
                    </p>
                    <p className="text-sm text-ink-3">
                      {p.birth.calendar === 'lunar' ? '음력' : '양력'} {p.birth.year}.{p.birth.month}.{p.birth.day} · {p.zodiac}띠
                    </p>
                  </Link>
                  <Link to={`/profiles/${p.id}/edit`} aria-label={`${p.name} 수정`} className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-subtle">
                    <Pencil className="size-4" />
                  </Link>
                  <button
                    type="button"
                    aria-label={`${p.name} 삭제`}
                    className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-subtle"
                    onClick={() => {
                      if (window.confirm(`${p.name}님의 사주를 삭제할까요?`)) removeProfile.mutate(p.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="mt-4 space-y-4 lg:mt-0">
          <Card className="divide-y divide-line p-0">
            {[
              ['/my/reports', '내 리포트 보관함'],
              ['/my/payments', t('my.payments')],
              ['/store', '이용권 · 리포트 구매'],
              ['/basics', '사주 기초'],
              ['/manse', '만세력'],
              ['/dream', '꿈해몽'],
              ['/zodiac', '띠별 운세'],
              ['/horoscope', '별자리 운세'],
              ['/taekil', t('taekil.meta.menuLabel')],
            ].map(([to, label]) => (
              <Link key={to} to={to!} className="flex items-center justify-between px-5 py-4">
                {label}
                <ChevronRight className="size-5 text-ink-3" aria-hidden />
              </Link>
            ))}
          </Card>

          <Card className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('my.notifications')}</p>
                <p className="text-sm text-ink-3">{t('my.dailyPushTime')} 08:00</p>
              </div>
              <Toggle checked={pushOn} onChange={togglePush} label={t('my.notifications')} />
            </div>
            <div className="space-y-2">
              <p className="font-medium">{t('my.theme.label')}</p>
              <Segmented<ThemeMode>
                name={t('my.theme.label')}
                value={theme.mode}
                onChange={theme.setMode}
                options={[
                  { value: 'dark', label: t('my.theme.dark') },
                  { value: 'light', label: t('my.theme.light') },
                  { value: 'system', label: t('my.theme.system') },
                ]}
              />
            </div>
            <div className="space-y-2">
              <p className="font-medium">{t('my.fontSize')}</p>
              <Segmented
                name={t('my.fontSize')}
                value={String(theme.fontScale)}
                onChange={(v) => theme.setFontScale(Number(v))}
                options={[
                  { value: '0.9375', label: '작게' },
                  { value: '1', label: '보통' },
                  { value: '1.125', label: '크게' },
                  { value: '1.25', label: '아주 크게' },
                ]}
              />
            </div>
            {user?.provider === 'email' && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">비밀번호</p>
                  <p className="text-sm text-ink-3">이메일 계정의 비밀번호를 바꿉니다</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setChangePassword(true)}>
                  비밀번호 변경
                </Button>
              </div>
            )}
          </Card>

          <Card className="divide-y divide-line p-0 text-[15px]">
            <Link to="/legal/terms" className="block px-5 py-4">
              {t('my.terms')}
            </Link>
            <Link to="/legal/privacy" className="block px-5 py-4">
              {t('my.privacy')}
            </Link>
            <Link to="/legal/disclaimer" className="block px-5 py-4">
              {t('my.disclaimer')}
            </Link>
          </Card>

          {member && (
            <div className="flex justify-between px-1 text-sm text-ink-3">
              <button type="button" onClick={logout} className="underline">
                {t('my.logout')}
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="underline">
                {t('my.deleteAccount')}
              </button>
            </div>
          )}
          <p className="px-1 text-xs text-ink-3">{t('disclaimer.footer')}</p>
        </div>
      </Page>

      <BottomSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('my.deleteConfirmTitle')}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={deleteAccount}>{t('my.deleteAccount')}</Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed text-ink-2">{t('my.deleteConfirmBody')}</p>
        <p className="mt-2 text-sm text-ink-3">결제 기록은 전자상거래법에 따라 5년간 익명으로 보관됩니다.</p>
      </BottomSheet>
      <PasswordChangeSheet open={changePassword} onClose={closeChangePassword} />
    </div>
  );
}

/** 이메일 계정의 비밀번호 변경 — 현재 비밀번호를 확인하고 바꾼다. 현재 기기의 로그인은 유지된다 */
function PasswordChangeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BottomSheet 가 onClose 가 바뀔 때마다 포커스를 옮기므로 입력 중 재생성되지 않게 고정
  const close = useCallback(() => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    onClose();
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError('새 비밀번호가 서로 다릅니다. 같은 비밀번호를 입력해 주세요.');
    if (next === current) return setError('현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      toast('비밀번호를 바꿨어요.');
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.server.title'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title="비밀번호 변경"
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="password-change-form" loading={busy} disabled={!current || next.length < 8 || confirm.length < 8}>
            바꾸기
          </Button>
        </div>
      }
    >
      <form id="password-change-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="현재 비밀번호" htmlFor="pw-current">
          <TextInput id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="새 비밀번호" htmlFor="pw-next" helper="8자 이상으로 입력해 주세요.">
          <TextInput id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </Field>
        <Field label="새 비밀번호 확인" htmlFor="pw-confirm">
          <TextInput id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </Field>
        {error && (
          <p role="alert" className="rounded-xl bg-subtle p-3 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </BottomSheet>
  );
}
