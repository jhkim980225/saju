/**
 * 예상하지 못한 오류를 로그로 남길 글 — DB 오류(drizzle "Failed query: … params: …")에는 이메일·생년월일·질문 같은
 * 쿼리 값이 들어 있어서 params 와 SQL 본문을 빼고, 원인(cause)의 이름·메시지와 스택 첫 줄들만 남긴다.
 */
export function safeErrorText(err: unknown): string {
  const scrub = (s: string) => s.replace(/params:[\s\S]*$/i, 'params: [생략]').replace(/Failed query:[\s\S]*?(\n|$)/i, 'Failed query: [생략]$1');
  if (!(err instanceof Error)) return scrub(String(err)).slice(0, 500);
  const cause = err.cause instanceof Error ? ` · 원인 ${err.cause.name}: ${scrub(err.cause.message)}` : '';
  const stack = (err.stack ?? '').split('\n').slice(1, 6).join('\n');
  return `${err.name}: ${scrub(err.message).slice(0, 300)}${cause}\n${stack}`;
}
