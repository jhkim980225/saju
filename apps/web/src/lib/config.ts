/** 빌드 시점 설정 — API 주소 등 (앱 빌드는 VITE_API_BASE_URL 절대 주소 필수) */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1';
