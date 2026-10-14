/** E2E 포트·주소 — 개발 서버(API 4000 / Web 5173)와 겹치지 않게 분리 */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5180);
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_BASE = `${API_ORIGIN}/api/v1`;
