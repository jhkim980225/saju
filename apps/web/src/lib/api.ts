/**
 * API 클라이언트 — Bearer 토큰 자동 첨부, 401 시 refresh 토큰으로 1회 재시도.
 * 웹/앱 공용(쿠키에 의존하지 않음). 기본 주소는 VITE_API_BASE_URL, 없으면 같은 출처의 /api/v1.
 */
import type {
  AuthTokensDto,
  ChatMessageDto,
  ChatReplyDto,
  CheckoutDto,
  CompatibilityDto,
  CompatibilityRequestDto,
  DailyFortuneDto,
  LoginDto,
  ManseDto,
  OrderCreateDto,
  OrderDto,
  PaymentConfirmDto,
  PaymentResultDto,
  ProductDto,
  ProfileCreateDto,
  ProfileDto,
  ProfileUpdateDto,
  PublicConfigDto,
  ReadingDto,
  ReportCreateDto,
  ReportDto,
  ReportProgressDto,
  ReportSummaryDto,
  SajuChart,
  SignupDto,
  TarotDrawDto,
  TarotHistoryItemDto,
  TarotReadingDto,
  TarotShuffleDto,
  TarotShuffleResultDto,
  UserDto,
  WalletDto,
  YearlyFortuneDto,
  BirthInputDto,
} from '@saju/shared';
import { API_BASE } from './config';
import { reloadSessionFromStorage, useSession } from './session';

export { API_BASE };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Auth = 'none' | 'optional' | 'required';

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  // 다른 탭이 이미 회전한 토큰이 저장소에 있으면 그것을 쓴다
  reloadSessionFromStorage();
  const { refreshToken, setTokens, clear } = useSession.getState();
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clear();
        return false;
      }
      setTokens((await res.json()) as AuthTokensDto);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function request<T>(method: string, path: string, opts: { body?: unknown; auth?: Auth; retry?: boolean } = {}): Promise<T> {
  const auth = opts.auth ?? 'optional';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const token = useSession.getState().accessToken;
  if (auth !== 'none' && token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', '인터넷 연결이 불안정해요');
  }

  if (res.status === 401 && auth !== 'none' && opts.retry !== false && useSession.getState().refreshToken) {
    if (await refreshTokens()) return request<T>(method, path, { ...opts, retry: false });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? '잠시 문제가 생겼어요', err?.details);
  }
  return data as T;
}

const get = <T>(path: string, auth?: Auth) => request<T>('GET', path, { auth });
const post = <T>(path: string, body?: unknown, auth?: Auth) => request<T>('POST', path, { body: body ?? {}, auth });

export const api = {
  config: () => get<PublicConfigDto>('/config', 'none'),

  // 인증
  guest: (deviceId: string) => post<AuthTokensDto>('/auth/guest', { deviceId }, 'none'),
  signup: (dto: SignupDto) => post<AuthTokensDto>('/auth/signup', dto),
  // 게스트 토큰을 함께 보내면 게스트로 저장한 사주가 로그인 계정으로 옮겨진다
  login: (dto: LoginDto) => post<AuthTokensDto>('/auth/login', dto),
  logout: (refreshToken: string) => post<void>('/auth/logout', { refreshToken }, 'none'),
  oauthUrl: (provider: string, redirectUri: string, state: string) =>
    get<{ url: string }>(`/auth/oauth/${provider}/authorize?redirectUri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`, 'none'),
  oauthCallback: (provider: string, body: { code: string; state?: string; redirectUri?: string; idToken?: string; name?: string }) =>
    post<AuthTokensDto>(`/auth/oauth/${provider}/callback`, body),
  me: () => get<UserDto>('/auth/me', 'required'),
  updateMe: (patch: { nickname?: string; marketingConsent?: boolean; pushEnabled?: boolean }) => request<UserDto>('PATCH', '/auth/me', { body: patch, auth: 'required' }),
  deleteMe: () => request<void>('DELETE', '/auth/me', { auth: 'required' }),

  // 프로필
  profiles: () => get<ProfileDto[]>('/profiles', 'required'),
  createProfile: (dto: ProfileCreateDto) => post<ProfileDto>('/profiles', dto, 'required'),
  updateProfile: (id: string, dto: ProfileUpdateDto) => request<ProfileDto>('PATCH', `/profiles/${id}`, { body: dto, auth: 'required' }),
  deleteProfile: (id: string) => request<void>('DELETE', `/profiles/${id}`, { auth: 'required' }),

  // 사주
  chart: (body: { birth?: BirthInputDto; profileId?: string }) => post<SajuChart>('/saju/chart', body),
  reading: (body: { birth?: BirthInputDto; profileId?: string }) => post<ReadingDto>('/saju/reading', body),
  years: (body: { birth?: BirthInputDto; profileId?: string }) =>
    post<{ year: number; ganzhi: string; hangul: string; tenGod: string; score: number; grade: string }[]>('/saju/years', body),
  manse: (date?: string) => get<ManseDto>(`/saju/manse${date ? `?date=${date}` : ''}`, 'none'),

  // 운세
  dailyByProfile: (profileId?: string, date?: string) => {
    const q = new URLSearchParams();
    if (profileId) q.set('profileId', profileId);
    if (date) q.set('date', date);
    return get<DailyFortuneDto | { needsProfile: true }>(`/fortune/daily?${q}`, 'required');
  },
  dailyByBirth: (birth: BirthInputDto, date?: string) => post<DailyFortuneDto>('/fortune/daily', { birth, date }, 'none'),
  yearly: (profileId: string, year: number) => get<YearlyFortuneDto>(`/fortune/yearly?profileId=${profileId}&year=${year}`, 'required'),
  compatibility: (dto: CompatibilityRequestDto) => post<CompatibilityDto>('/compatibility', dto),

  // 리포트 / 상담
  reports: () => get<ReportSummaryDto[]>('/reports', 'required'),
  report: (id: string) => get<ReportDto>(`/reports/${id}`, 'required'),
  reportProgress: (id: string) => get<ReportProgressDto>(`/reports/${id}/progress`, 'required'),
  createReport: (dto: ReportCreateDto) => post<ReportDto>('/reports', dto, 'required'),
  chatHistory: (profileId: string) => get<ChatMessageDto[]>(`/chat?profileId=${profileId}`, 'required'),
  chatSend: (profileId: string, message: string) => post<ChatReplyDto>('/chat', { profileId, message }, 'required'),

  // 타로
  tarotDaily: (profileId?: string) => get<TarotReadingDto>(`/tarot/daily${profileId ? `?profileId=${profileId}` : ''}`, 'required'),
  tarotShuffle: (dto: TarotShuffleDto) => post<TarotShuffleResultDto>('/tarot/shuffle', dto, 'required'),
  tarotDraw: (dto: TarotDrawDto) => post<TarotReadingDto>('/tarot/readings', dto, 'required'),
  tarotReading: (id: string) => get<TarotReadingDto>(`/tarot/readings/${id}`, 'required'),
  tarotHistory: () => get<TarotHistoryItemDto[]>('/tarot/readings', 'required'),
  tarotDelete: (id: string) => request<void>('DELETE', `/tarot/readings/${id}`, { auth: 'required' }),

  // 커머스
  products: () => get<ProductDto[]>('/products'),
  wallet: () => get<WalletDto>('/wallet', 'required'),
  orders: () => get<OrderDto[]>('/orders', 'required'),
  createOrder: (dto: OrderCreateDto) => post<CheckoutDto>('/orders', dto, 'required'),
  confirmPayment: (dto: PaymentConfirmDto) => post<PaymentResultDto>('/payments/confirm', dto, 'required'),
  failPayment: (orderId: string, code?: string, message?: string) => post<OrderDto>('/payments/fail', { orderId, code, message }, 'required'),
  verifyIap: (body: { platform: 'ios' | 'android'; productId: string; receipt: string; profileId?: string; readingId?: string }) =>
    post<PaymentResultDto>('/payments/iap/verify', body, 'required'),

  // 푸시
  registerPush: (token: string, platform: 'web' | 'ios' | 'android') => post<void>('/push/tokens', { token, platform }, 'required'),
  unregisterPush: (token: string) => request<void>('DELETE', '/push/tokens', { body: { token }, auth: 'required' }),
  rewardStatus: () => get<{ used: number; limit: number; remaining: number; creditsPerReward: number }>('/rewards/status', 'required'),
};
