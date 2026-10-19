/**
 * 비밀번호 찾기(/password/forgot) · 재설정(/password/reset?token=)
 * 서버에 메일 연동(RESEND_API_KEY·MAIL_FROM)이 없으면 폼 대신 문의 안내를 보여 준다(GET /config 의 features.mail).
 */
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { Button, Card, Field, IconButton, PageHeader, Spinner, TextInput } from '@/components/ui';
import { useConfig } from '@/hooks/queries';
import { ApiError, api } from '@/lib/api';
import { t } from '@/lib/copy';
import { useSession } from '@/lib/session';

const INVALID_LINK = '재설정 링크가 올바르지 않습니다. 메일의 링크를 다시 확인하거나 새로 요청해 주세요.';
/** 서버가 발급하는 토큰은 base64url 43자 — 그보다 짧으면 서버에 묻지 않고 안내 */
const MIN_TOKEN_LENGTH = 16;

function BackHeader({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <PageHeader
      left={
        <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
          <ArrowLeft className="size-6" />
        </IconButton>
      }
      title={title}
    />
  );
}

const BackToLogin = () => (
  <p className="text-center text-sm text-ink-2">
    <Link to="/login" className="font-semibold underline">
      로그인으로 돌아가기
    </Link>
  </p>
);

/** 메일 연동이 없을 때 — 문의 안내 (supportEmail 이 없으면 '문의하기' 링크만) */
function ContactNotice({ supportEmail }: { supportEmail: string | null }) {
  const query = `?subject=${encodeURIComponent('[달빛사주] 비밀번호 재설정 문의')}&body=${encodeURIComponent('가입한 이메일: ')}`;
  return (
    <Card className="space-y-3">
      <p className="font-semibold">지금은 메일로 재설정할 수 없습니다.</p>
      <p className="text-[15px] leading-relaxed text-ink-2">
        {supportEmail ? (
          <>
            <a href={`mailto:${supportEmail}${query}`} className="font-semibold underline">
              {supportEmail}
            </a>
            로 가입한 이메일을 적어 문의해 주세요. 확인한 뒤 안내해 드립니다.
          </>
        ) : (
          <>
            가입한 이메일을 적어{' '}
            <a href={`mailto:${query}`} className="font-semibold underline">
              문의하기
            </a>
            로 알려 주세요. 확인한 뒤 안내해 드립니다.
          </>
        )}
      </p>
    </Card>
  );
}

export function ForgotPasswordPage() {
  const config = useConfig();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // 화면을 연 뒤 서버 설정이 바뀌어 501 이 오면 문의 안내로 전환
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mailOn = config.data?.features.mail === true && !unavailable;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) setUnavailable(true);
      else setError(err instanceof ApiError ? err.message : t('error.server.title'));
    } finally {
      setBusy(false);
    }
  };

  let content: React.ReactNode;
  if (config.isPending) content = <Spinner />;
  else if (!mailOn) content = <ContactNotice supportEmail={config.data?.supportEmail ?? null} />;
  else if (sent)
    content = (
      <Card>
        <div role="status" className="space-y-3">
          <p className="font-semibold">요청을 받았습니다</p>
          <p className="text-[15px] leading-relaxed text-ink-2">입력한 주소가 가입된 계정이면 재설정 링크를 보냈습니다. 30분 안에 메일함을 확인해 주세요.</p>
          <p className="text-sm text-ink-3">메일이 보이지 않으면 스팸함을 확인하거나 잠시 뒤 다시 요청해 주세요.</p>
        </div>
      </Card>
    );
  else
    content = (
      <>
        <p className="text-[15px] leading-relaxed text-ink-2">가입한 이메일 주소를 입력하면 새 비밀번호를 정할 수 있는 링크를 보내 드립니다. 링크는 30분 동안 유효합니다.</p>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label="이메일" htmlFor="forgot-email">
            <TextInput id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {error && (
            <p role="alert" className="rounded-xl bg-subtle p-3 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" block size="lg" loading={busy} disabled={!email.trim()}>
            재설정 링크 보내기
          </Button>
        </form>
      </>
    );

  return (
    <div className="min-h-page">
      <BackHeader title="비밀번호 찾기" />
      <Page className="space-y-6 pb-12 pt-6">
        {content}
        <BackToLogin />
      </Page>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clearSession = useSession((s) => s.clear);
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(token.length >= MIN_TOKEN_LENGTH ? null : INVALID_LINK);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError('두 비밀번호가 서로 다릅니다. 같은 비밀번호를 입력해 주세요.');
    setBusy(true);
    try {
      await api.resetPassword({ token, password });
      // 재설정하면 서버가 모든 로그인을 끊으므로 이 기기의 세션도 지운다
      clearSession();
      qc.clear();
      setDone(true);
    } catch (err) {
      // 토큰 만료·사용됨은 details 없는 400, 비밀번호 형식 오류는 details(필드 목록)가 있는 400
      if (err instanceof ApiError && err.status === 400 && !err.details) setInvalid(err.message);
      else setError(err instanceof ApiError ? err.message : t('error.server.title'));
    } finally {
      setBusy(false);
    }
  };

  let content: React.ReactNode;
  if (done)
    content = (
      <Card>
        <div role="status" className="space-y-4">
          <p className="font-semibold">비밀번호를 바꿨습니다. 다시 로그인해 주세요.</p>
          <p className="text-sm text-ink-3">다른 기기에서 로그인돼 있던 세션도 모두 끊겼습니다.</p>
          <Button block size="lg" onClick={() => navigate('/login', { replace: true })}>
            로그인
          </Button>
        </div>
      </Card>
    );
  else if (invalid)
    content = (
      <Card className="space-y-4">
        <p role="alert" className="text-[15px] leading-relaxed text-ink-2">
          {invalid}
        </p>
        <Link to="/password/forgot" className="block text-center font-semibold underline">
          다시 요청하기
        </Link>
      </Card>
    );
  else
    content = (
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="새 비밀번호" htmlFor="reset-password" helper="8자 이상으로 입력해 주세요.">
          <TextInput id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <Field label="새 비밀번호 확인" htmlFor="reset-confirm">
          <TextInput id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </Field>
        {error && (
          <p role="alert" className="rounded-xl bg-subtle p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" block size="lg" loading={busy} disabled={password.length < 8 || confirm.length < 8}>
          비밀번호 바꾸기
        </Button>
      </form>
    );

  return (
    <div className="min-h-page">
      <BackHeader title="비밀번호 재설정" />
      <Page className="space-y-6 pb-12 pt-6">
        {content}
        {!done && <BackToLogin />}
      </Page>
    </div>
  );
}
