import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarRange, FileText, Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { ReadingView } from '@/components/ReadingView';
import { Chip, EmptyState, ErrorState, IconButton, PageHeader, Spinner, Button } from '@/components/ui';
import { useProfiles } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { api } from '@/lib/api';
import { targetFortuneYear } from '@/lib/format';
import { t } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { STORAGE_KEYS, storage } from '@/lib/storage';

/** 탭: 내 사주 — 대표(또는 선택한) 프로필의 풀이 */
export function MySajuPage() {
  const navigate = useNavigate();
  const params = useParams();
  const token = useSession((s) => s.accessToken);
  const user = useSession((s) => s.user);
  const gate = useSessionGate();
  const profiles = useProfiles();
  const list = profiles.data ?? [];
  const selectedId = params.profileId ?? storage.get(STORAGE_KEYS.activeProfile) ?? list[0]?.id;
  const profile = list.find((p) => p.id === selectedId) ?? list[0];

  const reading = useQuery({
    queryKey: ['reading', 'profile', profile?.id, user?.id],
    queryFn: () => api.reading({ profileId: profile!.id }),
    enabled: Boolean(profile && token),
  });

  const select = (id: string) => {
    storage.set(STORAGE_KEYS.activeProfile, id);
    navigate(`/saju/${id}`, { replace: true });
  };

  const isDetail = Boolean(params.profileId);
  return (
    <div className="min-h-page pb-10">
      <PageHeader
        left={
          isDetail ? (
            <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
              <ArrowLeft className="size-6" />
            </IconButton>
          ) : undefined
        }
        title={profile ? t('result.title', { name: profile.name }) : t('tabs.mySaju')}
        width="wide"
        right={
          <IconButton label={t('my.addProfile')} onClick={() => navigate('/profiles/new?save=1&relation=family&next=/saju')}>
            <Plus className="size-6" />
          </IconButton>
        }
      />
      <Page width="wide">
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        {(profiles.isLoading || (!token && !profiles.data)) && <Spinner />}
        {profiles.data && list.length === 0 && (
          <EmptyState title={t('today.noProfileTitle')} body={t('today.noProfileBody')} action={<Button onClick={() => navigate('/profiles/new?save=1&relation=self&next=/saju')}>{t('today.noProfileCta')}</Button>} />
        )}
        {list.length > 1 && (
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pt-2 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
            {list.map((p) => (
              <Chip key={p.id} active={p.id === profile?.id} onClick={() => select(p.id)}>
                {p.name} · {p.zodiac}띠
              </Chip>
            ))}
          </div>
        )}
        {profile && (
          <div className="mt-3 grid grid-cols-2 gap-2 lg:flex lg:gap-3">
            <Link to={`/yearly/${profile.id}`} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-sm font-semibold lg:px-5">
              <CalendarRange className="size-5 text-ink-2" aria-hidden />
              {targetFortuneYear()} 신년운세
            </Link>
            <Link to="/my/reports" className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-sm font-semibold lg:px-5">
              <FileText className="size-5 text-ink-2" aria-hidden />
              내 리포트 보관함
            </Link>
          </div>
        )}
        {reading.isLoading && <Spinner />}
        {reading.error && <ErrorState title={t('error.server.title')} onRetry={() => reading.refetch()} />}
        {reading.data && profile && (
          <ReadingView
            reading={reading.data}
            name={profile.name}
            profileId={profile.id}
            editHref={`/profiles/${profile.id}/edit`}
            returnTo={`/saju/${profile.id}`}
            isPremiumUser={user?.isPremium}
          />
        )}
      </Page>
    </div>
  );
}
