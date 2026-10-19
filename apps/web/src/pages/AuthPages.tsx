import { useQueryClient } from '@tanstack/react-query';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@saju/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { Wordmark } from '@/components/Seal';
import { Button, ErrorState, Field, IconButton, PageHeader, Spinner, TextInput } from '@/components/ui';
import { useConfig } from '@/hooks/queries';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { appWebOrigin } from '@/native';
import { isInAppBrowser, isNativeApp, native } from '@/lib/platform';
import { storage } from '@/lib/storage';
import { uuid } from '@/lib/uuid';

/** 소셜 로그인 콜백 주소 — 앱 웹뷰 origin(capacitor://localhost)은 제공자에 등록할 수 없으므로 앱에서는 웹 도메인(딥링크) 사용 */
const callbackUri = (provider: string) => `${isNativeApp() ? appWebOrigin() : window.location.origin}/auth/callback/${provider}`;
const OAUTH_KEY = 'yd.oauth';
import { useSession } from '@/lib/session';

const SOCIAL_LABEL: Record<SocialProvider, string> = { kakao: '카카오로 계속하기', naver: '네이버로 계속하기', google: 'Google로 계속하기', apple: 'Apple로 계속하기' };
const SOCIAL_STYLE: Record<SocialProvider, string> = {
  kakao: 'bg-[#FEE500] text-[#191919]',
  naver: 'bg-[#03C75A] text-white',
  google: 'border border-line-strong bg-surface text-ink',
  apple: 'bg-black text-white',
};

function SocialButtons({ next }: { next: string }) {
  const config = useConfig();
  const [error, setError] = useState<string | null>(null);
  const enabled = SOCIAL_PROVIDERS.filter((p) => config.data?.socialLogin[p]);
  if (enabled.length === 0) return null;
  const start = async (p: SocialProvider) => {
    setError(null);
    try {
      const state = uuid();
      storage.setJSON(OAUTH_KEY, { state, next, provider: p });
      const { url } = await api.oauthUrl(p, callbackUri(p), state);
      if (isNativeApp() && native.openExternal) await native.openExternal(url);
      else window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인을 시작하지 못했어요');
    }
  };
  return (
    <div className="space-y-2">
      {enabled.map((p) => (
        <button key={p} type="button" onClick={() => start(p)} className={`h-13 w-full rounded-full text-[15px] font-semibold ${SOCIAL_STYLE[p]}`}>
          {SOCIAL_LABEL[p]}
        </button>
      ))}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3 py-2 text-xs text-ink-3">
        <span className="h-px flex-1 bg-line" /> 또는 이메일로 <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const next = params.get('next') || '/today';
  const reason = params.get('reason');
  const setTokens = useSession((s) => s.setTokens);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agree, setAgree] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && !agree) return setError('이용약관과 개인정보 처리방침에 동의해 주세요.');
    setBusy(true);
    try {
      const tokens = mode === 'login' ? await api.login({ email, password }) : await api.signup({ email, password, nickname: nickname || undefined, marketingConsent: marketing });
      setTokens(tokens);
      track(mode === 'login' ? 'login' : 'signup', { method: 'email' });
      await qc.invalidateQueries();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.server.title'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={mode === 'login' ? '로그인' : '가입하기'}
      />
      <Page className="pb-12">
        <div className="pt-6">
          <Wordmark />
          <p className="mt-4 font-serif text-xl leading-snug">{reason === 'purchase' ? '구매 내역을 안전하게 보관하려면 로그인이 필요해요' : t('brand.slogan')}</p>
          <p className="mt-2 text-sm text-ink-2">게스트로 저장한 사주는 가입 후에도 그대로 이어져요.</p>
        </div>
        {isInAppBrowser() && (
          <p className="mt-4 rounded-xl bg-subtle p-3 text-sm text-ink-2">
            <b>{t('error.inAppBrowser.title')}</b> — {t('error.inAppBrowser.body')}
          </p>
        )}
        <div className="mt-8">
          <SocialButtons next={next} />
        </div>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label="이메일" htmlFor="email">
            <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="비밀번호" htmlFor="password" helper={mode === 'signup' ? '8자 이상으로 입력해 주세요.' : undefined}>
            <TextInput id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            {mode === 'login' && (
              <p className="text-right text-sm text-ink-2">
                <Link to="/password/forgot" className="underline">
                  비밀번호를 잊으셨나요?
                </Link>
              </p>
            )}
          </Field>
          {mode === 'signup' && (
            <>
              <Field label="닉네임" htmlFor="nickname" helper="선택 — 비워 두면 이메일 앞부분을 사용합니다.">
                <TextInput id="nickname" maxLength={20} value={nickname} onChange={(e) => setNickname(e.target.value)} />
              </Field>
              <div className="space-y-2 text-[15px]">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 size-5 accent-[var(--action)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span>
                    (필수){' '}
                    <Link to="/legal/terms" className="underline">
                      이용약관
                    </Link>
                    과{' '}
                    <Link to="/legal/privacy" className="underline">
                      개인정보 처리방침
                    </Link>
                    에 동의합니다
                  </span>
                </label>
                <label className="flex items-start gap-2 text-ink-2">
                  <input type="checkbox" className="mt-1 size-5 accent-[var(--action)]" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                  (선택) 이벤트·혜택 소식 수신에 동의합니다
                </label>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-subtle p-3 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" block size="lg" loading={busy} disabled={!email || password.length < (mode === 'signup' ? 8 : 1)}>
            {mode === 'login' ? '로그인' : '가입하고 계속하기'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-2">
          {mode === 'login' ? (
            <>
              처음이신가요?{' '}
              <Link to={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold underline">
                가입하기
              </Link>
            </>
          ) : (
            <>
              이미 계정이 있나요?{' '}
              <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold underline">
                로그인
              </Link>
            </>
          )}
        </p>
      </Page>
    </div>
  );
}

export const LoginPage = () => <AuthForm mode="login" />;
export const SignupPage = () => <AuthForm mode="signup" />;

/** 소셜 로그인 콜백 — /auth/callback/:provider?code=&state= */
export function OAuthCallbackPage() {
  const { provider } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setTokens = useSession((s) => s.setTokens);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const saved = storage.getJSON<{ state?: string; next?: string }>(OAUTH_KEY) ?? {};
    const code = params.get('code');
    const state = params.get('state') ?? undefined;
    if (params.get('error') || !code) return setError('로그인을 취소했거나 실패했어요.');
    // 로그인 CSRF 방지: 이 기기에서 시작한 로그인(state 일치)만 처리
    if (!saved.state || state !== saved.state) return setError('보안 검증에 실패했어요. 다시 시도해 주세요.');
    storage.remove(OAUTH_KEY);
    api
      .oauthCallback(provider!, { code, state, redirectUri: callbackUri(provider!), name: params.get('name') ?? undefined })
      .then(async (tokens) => {
        setTokens(tokens);
        track('login', { method: provider });
        await qc.invalidateQueries();
        navigate(saved.next || '/today', { replace: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : '로그인에 실패했어요.'));
  }, [navigate, params, provider, qc, setTokens]);
  return <Page>{error ? <ErrorState title={error} onRetry={() => navigate('/login', { replace: true })} /> : <Spinner label="로그인하고 있어요" />}</Page>;
}
