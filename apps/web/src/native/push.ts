/**
 * 푸시(FCM) — @capacitor-firebase/messaging 네이티브 구현을 사용한다.
 * iOS 도 APNs 토큰이 아니라 FCM 등록 토큰을 받아야 서버(FCM HTTP v1)가 보낼 수 있다(docs/AUTH_PUSH.md §6-2).
 *
 * 패키지 JS 진입점은 웹 구현(firebase/messaging)을 동적 import 하므로, 그대로 import 하면 번들러가 firebase 패키지를 요구한다.
 * 앱에서는 네이티브 구현만 필요하므로 registerPlugin 으로 같은 이름의 프록시를 직접 만든다(타입만 패키지에서 가져옴).
 */
import { registerPlugin } from '@capacitor/core';
import type { FirebaseMessagingPlugin, Importance, Notification, Visibility } from '@capacitor-firebase/messaging';
import { api } from '../lib/api';
import { nativePlatform } from '../lib/platform';
import { useSession } from '../lib/session';
import { storage } from '../lib/storage';

export const FirebaseMessaging = registerPlugin<FirebaseMessagingPlugin>('FirebaseMessaging');

/** 마지막으로 서버에 등록한 `${userId}|${platform}|${token}` — 같은 값이면 재등록하지 않는다 */
const PUSH_TOKEN_KEY = 'yd.native.pushToken';

/** 안드로이드 알림 채널 — AndroidManifest 의 default_notification_channel_id 와 같은 값으로 둔다 */
export const ANDROID_CHANNEL_ID = 'yd_default';

const storePlatform = (): 'ios' | 'android' => (nativePlatform() === 'ios' ? 'ios' : 'android');

async function ensureAndroidChannel() {
  if (storePlatform() !== 'android') return;
  await FirebaseMessaging.createChannel({
    id: ANDROID_CHANNEL_ID,
    name: '달빛사주 알림',
    description: '오늘의 운세, 리포트 완성 등 안내',
    importance: 4 as Importance, // High — 헤드업 알림
    visibility: 1 as Visibility, // Public
  }).catch(() => undefined);
}

/**
 * NativeBridge.requestPush — OS 권한 요청 → FCM 토큰 반환(거부·오류 시 null).
 * 권한 요청 전 프리프롬프트(무엇을·언제·얼마나 자주)는 화면 쪽에서 먼저 보여 준다(UX 문서 §7.14-13).
 */
export async function requestPushToken(): Promise<string | null> {
  try {
    let { receive } = await FirebaseMessaging.checkPermissions();
    if (receive === 'prompt' || receive === 'prompt-with-rationale') ({ receive } = await FirebaseMessaging.requestPermissions());
    if (receive !== 'granted') return null;
    await ensureAndroidChannel();
    const { token } = await FirebaseMessaging.getToken();
    return token || null;
  } catch (e) {
    console.warn('[native] 푸시 토큰을 받지 못했어요', e);
    return null;
  }
}

/** 토큰을 서버(/push/tokens)에 등록. 세션이 없으면 건너뛰고, 같은 사용자·토큰이면 중복 등록하지 않는다 */
export async function syncPushToken(token: string): Promise<void> {
  const { accessToken, user } = useSession.getState();
  if (!token || !accessToken || !user) return;
  const platform = storePlatform();
  const mark = `${user.id}|${platform}|${token}`;
  if (storage.get(PUSH_TOKEN_KEY) === mark) return;
  try {
    await api.registerPush(token, platform);
    storage.set(PUSH_TOKEN_KEY, mark);
  } catch (e) {
    console.warn('[native] 푸시 토큰 등록 실패', e);
  }
}

/** 권한이 이미 있을 때만 현재 토큰을 동기화(시작 시·로그인 계정 변경 시) */
async function syncIfGranted(): Promise<void> {
  try {
    const { receive } = await FirebaseMessaging.checkPermissions();
    if (receive !== 'granted') return;
    const { token } = await FirebaseMessaging.getToken();
    await syncPushToken(token);
  } catch {
    /* Firebase 미설정 등 — 무시 */
  }
}

/** 알림 data.link (서버 push.sendToUser 의 link) */
export function notificationLink(n: Notification | undefined): string | null {
  const data = (n?.data ?? {}) as Record<string, unknown>;
  if (typeof data.link === 'string' && data.link) return data.link;
  return n?.link || null;
}

/** 시작 시 1회: 토큰 갱신 → 서버 등록, 알림 탭 → 딥링크 라우팅 */
export async function initPush(onLink: (link: string) => void): Promise<void> {
  await FirebaseMessaging.addListener('tokenReceived', ({ token }) => void syncPushToken(token));
  await FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) => {
    const link = notificationLink(notification);
    if (link) onLink(link);
  });
  void syncIfGranted();
  // 게스트 → 회원 전환, 다른 계정 로그인 시 토큰을 새 사용자에 다시 묶는다
  useSession.subscribe((s, prev) => {
    if (s.accessToken && s.user?.id && s.user.id !== prev.user?.id) void syncIfGranted();
  });
}
