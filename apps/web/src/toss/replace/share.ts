/**
 * 공유 (토스 빌드) — lib/share.ts 를 대신한다.
 * 앱인토스 정책: 공유 링크는 자사 웹사이트가 아니라 토스 앱에서 미니앱을 여는 링크여야 한다(intoss:// 스킴).
 * 카카오 SDK 는 넣지 않는다. 생년월일·태어난 시각은 공유 내용에 넣지 않는다(share.privacyNote).
 */
import { getTossShareLink, setClipboardText, share } from '@apps-in-toss/web-framework';
import { track } from '@/lib/analytics';

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  imageUrl?: string;
  buttonTitle?: string;
  buttons?: { title: string; url: string }[];
}

export const TOSS_APP_NAME = 'daldal-saju';

/** 화면 주소(https://…/today?x=1 또는 /today) → intoss://daldal-saju/today?x=1 */
export function tossPath(url: string): string {
  let path = '/today';
  try {
    const u = new URL(url, 'https://app.invalid');
    path = `${u.pathname}${u.search}`;
  } catch {
    /* 기본 경로 */
  }
  return `intoss://${TOSS_APP_NAME}${path === '/' ? '/today' : path}`;
}

async function tossLink(url: string): Promise<string | null> {
  try {
    return await getTossShareLink(tossPath(url));
  } catch {
    return null;
  }
}

export function systemShareAvailable(): boolean {
  return true;
}

export async function shareLink(p: SharePayload): Promise<'shared' | 'copied' | 'cancelled'> {
  const link = await tossLink(p.url);
  if (!link) return 'cancelled';
  try {
    await share({ message: `${p.text}\n${link}` });
    track('share', { channel: 'system' });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}

/** 토스 공유 링크만 복사 */
export async function copyLink(url: string): Promise<boolean> {
  const link = await tossLink(url);
  if (!link) return false;
  const ok = await writeClipboard(link);
  if (ok) track('share', { channel: 'copy_link' });
  return ok;
}

/** 글 복사 — 사주 요약의 '텍스트로 복사' */
export async function copyText(text: string): Promise<boolean> {
  return writeClipboard(text);
}

/** 토스 클립보드(권한 clipboard:write) → 안 되면(토스앱 밖 확인용 브라우저) 브라우저 클립보드 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await setClipboardText(text);
    return true;
  } catch {
    /* 아래 폴백 */
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function kakaoAvailable(): boolean {
  return false;
}

export function preloadKakao(): void {}

export function buildKakaoTemplate(_p: SharePayload): Record<string, unknown> {
  return {};
}

export async function shareKakao(_p: SharePayload): Promise<boolean> {
  return false;
}
