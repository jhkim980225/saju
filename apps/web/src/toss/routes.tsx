/**
 * 토스 미니앱의 라우트 — App.tsx 의 라우트 표에서 토스 첫 버전에 없는 화면을 빼고, 화면 틀을 토스용으로 바꾼다.
 * 뺀 화면: 랜딩, 로그인·가입·비밀번호, 웹 결제 결과, 타로, AI 상담, AI 꿈풀이.
 * (화면 모듈 자체도 toss/vite-plugin.ts 가 빈 컴포넌트로 바꿔서 번들에 들어가지 않는다)
 */
import { getSchemeUri } from '@apps-in-toss/web-framework';
import type { ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { AiNoticeGate } from './AiNotice';
import { resolveTossEntry } from './entry';
import { TossTabLayout } from './TossTabLayout';

export const TOSS_EXCLUDED_PATHS = new Set([
  '/login',
  '/signup',
  '/password/forgot',
  '/password/reset',
  '/auth/callback/:provider',
  '/payments/success',
  '/payments/fail',
  '/ask',
  '/tarot',
  '/tarot/ask',
  '/tarot/draw',
  '/tarot/daily',
  '/tarot/r/:id',
  '/tarot/history',
  '/dream/ask',
]);

/** 생성형 AI 가 다듬은 글이 나올 수 있는 화면 — 처음 열 때 한 번 알린다 */
const AI_NOTICE_PATHS = new Set(['/reports/:id']);

function initialScheme(): string | undefined {
  try {
    return getSchemeUri();
  } catch {
    return undefined; // 토스앱 밖(브라우저 확인)
  }
}

/** 처음 화면('/')과 모르는 경로 — 진입 스킴이 가리키는 화면, 없으면 오늘의 운세로 */
export function TossEntry() {
  return <Navigate to={resolveTossEntry(initialScheme(), window.location.search)} replace />;
}

export function tossRoutes(routes: RouteObject[]): RouteObject[] {
  const out: RouteObject[] = [];
  for (const r of routes) {
    if (r.path && TOSS_EXCLUDED_PATHS.has(r.path)) continue;
    let next: RouteObject = r;
    if (r.path === '/' || r.path === '*') next = { ...r, element: <TossEntry /> };
    else if (r.path && AI_NOTICE_PATHS.has(r.path)) next = { ...r, element: <AiNoticeGate>{r.element as ReactNode}</AiNoticeGate> };
    if (r.children) {
      const children = tossRoutes(r.children);
      // 하단 탭 화면 묶음(오늘 탭을 품은 경로 없는 레이아웃)은 토스용 떠 있는 탭바로 바꾼다
      const isTabs = !r.path && r.children.some((c) => c.path === '/today');
      next = isTabs ? ({ ...next, element: <TossTabLayout />, children } as RouteObject) : ({ ...next, children } as RouteObject);
    }
    out.push(next);
  }
  return out;
}
