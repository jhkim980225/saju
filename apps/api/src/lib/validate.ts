import type { z } from 'zod';
import { badRequest } from './errors.js';

/** zod 스키마로 요청 데이터 검증 — 실패 시 400 + 필드별 메시지 */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(first?.message ?? '요청 형식이 올바르지 않아요.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}
