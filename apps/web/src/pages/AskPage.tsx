import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessageDto, ProductDto } from '@saju/shared';
import { SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { AskSegment } from '@/components/AskSegment';
import { PaywallSheet } from '@/components/PaywallSheet';
import { RewardedAdCard } from '@/components/RewardedAdCard';
import { Button, Chip, EmptyState, PageHeader, Spinner, cx } from '@/components/ui';
import { qk, useConfig, useProfiles, useWallet } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { usePurchase } from '@/hooks/usePurchase';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { STORAGE_KEYS, storage } from '@/lib/storage';

const SUGGESTIONS = ['career', 'money', 'workStyle', 'relationship'] as const;
const CRISIS = /죽고\s*싶|자살|자해|살기\s*싫|사라지고\s*싶/;

export function AskPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gate = useSessionGate();
  const profiles = useProfiles();
  const config = useConfig();
  const wallet = useWallet();
  const list = profiles.data ?? [];
  const [profileId, setProfileId] = useState<string | undefined>(storage.get(STORAGE_KEYS.activeProfile) ?? undefined);
  const profile = list.find((p) => p.id === profileId) ?? list.find((p) => p.isPrimary) ?? list[0];
  const [text, setText] = useState('');
  const [paywall, setPaywall] = useState(false);
  const [optimistic, setOptimistic] = useState<ChatMessageDto | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const purchase = usePurchase();

  const history = useQuery({ queryKey: ['chat', profile?.id], queryFn: () => api.chatHistory(profile!.id), enabled: Boolean(profile) });
  const send = useMutation({
    mutationFn: (message: string) => api.chatSend(profile!.id, message),
    onMutate: (message) => setOptimistic({ id: 'pending', role: 'user', content: message, createdAt: new Date().toISOString() }),
    onSuccess: async () => {
      track('chat_sent');
      await qc.invalidateQueries({ queryKey: ['chat', profile?.id] });
      await qc.invalidateQueries({ queryKey: qk.wallet });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_CREDITS') setPaywall(true);
    },
    onSettled: () => setOptimistic(null),
  });

  const messages = [...(history.data ?? []), ...(optimistic ? [optimistic] : [])];
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, send.isPending]);

  const submit = (msg: string) => {
    const m = msg.trim();
    if (!m || send.isPending || !profile) return;
    setText('');
    send.mutate(m);
  };
  const aiEnabled = config.data?.ai.enabled ?? false;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  const onPurchase = async (product: ProductDto) => {
    await purchase({ product, returnTo: '/ask' });
  };

  return (
    <div className="flex min-h-page flex-col">
      <PageHeader
        title={t('ask.title')}
        width="medium"
        right={
          wallet.data && aiEnabled ? (
            <button type="button" onClick={() => setPaywall(true)} className="tabular rounded-full border border-line-strong px-3 py-1.5 text-sm">
              질문권 {wallet.data.credits}
            </button>
          ) : undefined
        }
      />
      <Page width="medium" className="flex-1 pb-40">
        <div className="mb-3 lg:hidden">
          <AskSegment />
        </div>
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        {profiles.isLoading && <Spinner />}
        {profiles.isFetched && list.length === 0 && (
          <EmptyState title={t('today.noProfileTitle')} body="내 사주를 저장하면, 사주를 기준으로 고민을 함께 정리해 드려요." action={<Button onClick={() => navigate('/profiles/new?save=1&relation=self&next=/ask')}>{t('today.noProfileCta')}</Button>} />
        )}
        {profile && (
          <>
            {list.length > 1 && (
              <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pt-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
                {list.map((p) => (
                  <Chip key={p.id} active={p.id === profile.id} onClick={() => setProfileId(p.id)}>
                    {p.name}
                  </Chip>
                ))}
              </div>
            )}
            <div className="mt-3 rounded-2xl border border-line bg-surface p-4 text-sm">
              <p className="font-semibold">{t('ask.contextCard', { name: profile.name })}</p>
              <p className="mt-1 text-ink-2">
                {profile.birth.calendar === 'lunar' ? '음력' : '양력'} {profile.birth.year}.{profile.birth.month}.{profile.birth.day}생 · {profile.zodiac}띠
              </p>
              <p className="mt-2 text-xs text-ink-3">{aiEnabled ? t('ask.aiNotice') : t('ask.ruleNotice')}</p>
            </div>

            {messages.length === 0 && !history.isLoading && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-ink-2">{t('ask.suggestionsTitle')}</p>
                <div className="mt-3 flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((k) => (
                    <Chip key={k} onClick={() => submit(t(`ask.suggestions.${k}`))}>
                      {t(`ask.suggestions.${k}`)}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            <ol className="mt-6 space-y-4" aria-live="polite">
              {messages.map((m) => (
                <li key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-[15px] leading-relaxed', m.role === 'user' ? 'bg-action text-on-action' : 'border border-line bg-surface')}>{m.content}</div>
                </li>
              ))}
              {send.isPending && (
                <li className="flex justify-start">
                  <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink-3">{t('ask.typing')}…</div>
                </li>
              )}
            </ol>
            {aiEnabled && wallet.data && wallet.data.credits < 1 && <RewardedAdCard />}
            {lastUser && CRISIS.test(lastUser.content) && <p className="mt-4 rounded-xl bg-subtle p-3 text-sm text-info">{t('ask.crisisNote')}</p>}
            {send.error && !(send.error instanceof ApiError && send.error.code === 'INSUFFICIENT_CREDITS') && <p className="mt-3 text-sm text-danger">{send.error.message}</p>}
            <div ref={bottom} />
          </>
        )}
      </Page>
      {profile && (
        <form
          className="safe-bottom fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-canvas lg:bottom-0"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <div className="mx-auto flex max-w-xl items-end gap-2 px-4 py-2 lg:max-w-3xl lg:px-8 lg:py-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit(text);
                }
              }}
              rows={1}
              placeholder={t('ask.placeholder')}
              aria-label={t('ask.placeholder')}
              className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-3 text-base outline-none focus:border-ink"
            />
            <button type="submit" aria-label={t('ask.send')} disabled={!text.trim() || send.isPending} className="grid size-12 shrink-0 place-items-center rounded-full bg-action text-on-action disabled:opacity-40">
              <SendHorizontal className="size-5" />
            </button>
          </div>
        </form>
      )}
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} productIds={['chat_pack_30', 'chat_pack_10']} subtitle="내 사주를 아는 AI 상담가에게 물어보세요. 질문권은 유효기간이 없어요." onPurchase={onPurchase} />
    </div>
  );
}
