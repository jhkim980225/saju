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
import { draftProfileFields, sameBirth, type BirthDraft } from '@/lib/birth';
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
  /** 이 화면에서 진행 중인 저장 — 저장·결제를 연달아 눌러도 프로필을 하나만 만든다 */
  const saving = useRef<Promise<string> | null>(null);
  useEffect(() => {
    // 예전 버전이 남긴 '처음 저장한 프로필 ID' — 다른 생년월일·다른 계정에도 재사용되던 값이라 지운다
    storage.remove('yd.savedDraftProfile');
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setMinWaitDone(true), MIN_LOADING_MS);
    return () => clearTimeout(id);
  }, []);
  const q = useQuery({ queryKey: ['reading', 'draft', draft?.dto, draft?.form.name], queryFn: () => api.reading({ birth: draft!.dto, name: draft!.form.name.trim() || undefined }), enabled: Boolean(draft), retry: 1 });
  if (!draft) return <Navigate to="/input" replace />;
  const name = draft.form.name.trim() || t('common.me');

  /**
   * 결제/저장 전에 비회원 입력을 프로필로 저장 — 지금 계정에 같은 이름·출생 정보의 사주가 있으면 그것을 쓴다.
   * 기억해 둔 ID 대신 지금 계정의 목록으로 판단하므로, 다른 생년월일을 새로 넣었거나 계정이 바뀌어도 엉뚱한 사주로 가지 않는다
   */
  const ensureProfile = (): Promise<string> => {
    saving.current ??= (async () => {
      await ensureSession();
      // 캐시가 아닌 지금 계정의 목록을 받는다(방금 게스트 세션을 만들었거나 계정이 바뀌었을 수 있다)
      const list = await qc.fetchQuery({ queryKey: qk.profiles, queryFn: api.profiles, staleTime: 0 });
      // 이름을 비웠으면 출생 정보만으로, 이름을 넣었으면 이름까지 같은 사주를 찾는다
      const typed = draft.form.name.trim();
      const same = list.find((p) => sameBirth(p.birth, draft.dto) && (!typed || p.name === typed));
      if (same) return same.id;
      const p = await api.createProfile({ ...draftProfileFields(typed, list), birth: draft.dto });
      await qc.invalidateQueries({ queryKey: qk.profiles });
      return p.id;
    })().finally(() => {
      saving.current = null;
    });
    return saving.current;
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
            <ReadingView reading={q.data} name={name} ensureProfile={ensureProfile} editHref="/input" returnTo="/result" summaryHref="/result/summary" />
          </div>
        )}
      </Page>
    </div>
  );
}
