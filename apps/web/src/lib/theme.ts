import { create } from 'zustand';
import { IS_TOSS, native } from './platform';
import { STORAGE_KEYS, storage } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  fontScale: number;
  setMode: (m: ThemeMode) => void;
  setFontScale: (s: number) => void;
}

/** 브라우저 주소창·상태바 색 — 밤하늘 남색 / 밝은 화면 흰색 (styles/index.css 의 --canvas) */
export const THEME_COLOR = { dark: '#060B24', light: '#FFFFFF' } as const;

const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

export function applyTheme(mode: ThemeMode, fontScale: number) {
  // 토스 미니앱은 밝은 화면만 쓴다(앱인토스 비게임 체크리스트)
  const dark = !IS_TOSS && (mode === 'dark' || (mode === 'system' && Boolean(media?.matches)));
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--font-scale', String(fontScale));
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light));
  native.setStatusBar?.(dark ? 'dark' : 'light');
}

export const useTheme = create<ThemeState>((set, get) => ({
  // 기본은 흰 바탕의 밝은 화면. 밤하늘·기기 설정은 마이에서 고른다
  mode: (storage.get(STORAGE_KEYS.theme) as ThemeMode | null) ?? 'light',
  fontScale: Number(storage.get(STORAGE_KEYS.fontScale) ?? 1) || 1,
  setMode: (mode) => {
    storage.set(STORAGE_KEYS.theme, mode);
    set({ mode });
    applyTheme(mode, get().fontScale);
  },
  setFontScale: (fontScale) => {
    storage.set(STORAGE_KEYS.fontScale, String(fontScale));
    set({ fontScale });
    applyTheme(get().mode, fontScale);
  },
}));

export function initTheme() {
  const { mode, fontScale } = useTheme.getState();
  applyTheme(mode, fontScale);
  media?.addEventListener?.('change', () => {
    const s = useTheme.getState();
    if (s.mode === 'system') applyTheme('system', s.fontScale);
  });
}
