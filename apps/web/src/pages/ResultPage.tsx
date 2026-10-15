import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookmarkPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { InkLoader } from '@/components/InkLoader';
import { ReadingView } from '@/components/ReadingView';
import { toast } from '@/components/Toast';
import { ErrorState, IconButton, PageHeader } from '@/components/ui';
import { qk } from '@/hooks/queries';
import { ApiError, api } from '@/lib/api';
import type { BirthDraft } from '@/lib/birth';
import { t } from '@/lib/copy';
import { ensureSession } from '@/lib/session';
import { STORAGE_KEYS, storage } from '@/lib/storage';

const MIN_LOADING_MS = 1500;

/** 비회원 결과 (W3 로딩 → W4 결과) */
export function ResultPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const draft = storage.getJSON<BirthDraft>(STORAGE_KEYS.birthDraft);
  const [minWaitDone, setMinWaitDone] = useState(false);
  const savedId = useRef<string | null>(storage.get('yd.savedDraftProfile'));
  useEffect(() => {
    const id = setTimeout(() => setMinWaitDone(true), MIN_LOADING_MS);
    return () => clearTimeout(id);
  }, []);
  const q = useQuery({ queryKey: ['reading', 'draft', draft?.dto, draft?.form.name], queryFn: () => api.reading({ birth: draft!.dto, name: draft!.form.name.trim() || undefined }), enabled: Boolean(draft), retry: 1 });
  if (!draft) return <Navigate to="/input" replace />;
  const name = draft.form.name.trim() || t('common.me');

  /** 결제/저장 전에 비회원 입력을 프로필로 저장 */
  const ensureProfile = async (): Promise<string> => {
    if (savedId.current) return savedId.current;
    await ensureSession();
    const p = await api.createProfile({ name, relation: 'self', birth: draft.dto });
    savedId.current = p.id;
    storage.set('yd.savedDraftProfile', p.id);
    await qc.invalidateQueries({ queryKey: qk.profiles });
    return p.id;
  };

  const save = async () => {
    try {
      const id = await ensureProfile();
      toast(t('result.actions.saved'));
      navigate(`/saju/${id}`, { replace: true });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('error.server.title'));
    }
  };

  return (
    <div className="min-h-page pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate('/input')}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={t('result.title', { name })}
        width="wide"
        right={
          <IconButton label={t('result.actions.save')} onClick={save}>
            <BookmarkPlus className="size-6" />
          </IconButton>
        }
      />
      <Page width="wide">
        {(q.isLoading || !minWaitDone) && !q.error && <InkLoader name={name} />}
        {q.error && <ErrorState title={q.error instanceof ApiError && q.error.status === 400 ? q.error.message : t('error.server.title')} onRetry={() => q.refetch()} />}
        {q.data && minWaitDone && (
          <div className="animate-fade">
            <ReadingView reading={q.data} name={name} ensureProfile={ensureProfile} editHref="/input" returnTo="/result" />
          </div>
        )}
      </Page>
    </div>
  );
}
