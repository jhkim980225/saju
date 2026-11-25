import type { z } from 'zod';
import { badRequest } from './errors.js';

/**
 * 응답에 담는 검증 오류 개수 상한 — 큰 배열 입력은 원소마다 오류가 생겨, 다 담으면 응답이 수십 MB 가 되고
 * Worker 메모리(128MB)를 다 쓸 수 있다(보안 점검 2026-11-25). 화면은 첫 오류 메시지만 쓴다.
 */
export const MAX_ISSUE_DETAILS = 20;

/** zod 스키마로 요청 데이터 검증 — 실패 시 400 + 필드별 메시지(앞쪽 MAX_ISSUE_DETAILS 개) */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const details = r.error.issues.slice(0, MAX_ISSUE_DETAILS).map((i) => ({ path: i.path.slice(0, 5).join('.'), message: i.message }));
    throw badRequest(first?.message ?? '요청 형식이 올바르지 않아요.', details);
  }
  return r.data;
}
