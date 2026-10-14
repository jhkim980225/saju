import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { RELATION_LABEL } from '@saju/shared';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { toast } from '@/components/Toast';
import { Badge, Button, Card, PageHeader, Segmented, Toggle } from '@/components/ui';
import { qk, useProfiles, useWallet } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { native, nativePlatform } from '@/lib/platform';
import { storage } from '@/lib/storage';
import { isMember, useSession } from '@/lib/session';
import { useTheme, type ThemeMode } from '@/lib/theme';

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
    toast('탈퇴가 완료됐어요. 그동안 고마웠어요.');
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
                  <p className="text-sm text-ink-3">{user!.email ?? `${user!.provider} 로그인`}</p>
                </div>
                {user!.isPremium && <Badge tone="gold">플러스</Badge>}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="font-semibold">로그인하면 저장한 사주와 구매 내역을 안전하게 보관해요</p>
                <p className="text-sm text-ink-2">지금 쓰던 사주 정보는 그대로 이어져요.</p>
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
                    <p className="font-serif text-sm text-ink-3">
                      {p.birth.calendar === 'lunar' ? '음' : '양'} {p.birth.year}.{p.birth.month}.{p.birth.day} · {p.dayPillar}일주
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
              ['/manse', '만세력'],
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
                  { value: 'system', label: t('my.theme.system') },
                  { value: 'light', label: t('my.theme.light') },
                  { value: 'dark', label: t('my.theme.dark') },
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
        <p className="mt-2 text-sm text-ink-3">결제 기록은 전자상거래법에 따라 5년간 익명으로 보관돼요.</p>
      </BottomSheet>
    </div>
  );
}
