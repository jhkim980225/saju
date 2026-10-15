import { create } from 'zustand';
import { native } from './platform';
import { STORAGE_KEYS, storage } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  fontScale: number;
  setMode: (m: ThemeMode) => void;
  setFontScale: (s: number) => void;
}

/** 브라우저 주소창·상태바 색 — 밤하늘 남색 / 밝은 화면 상아색 (styles/index.css 의 --canvas) */
export const THEME_COLOR = { dark: '#0A1029', light: '#F5F1E8' } as const;

const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

export function applyTheme(mode: ThemeMode, fontScale: number) {
  const dark = mode === 'dark' || (mode === 'system' && Boolean(media?.matches));
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--font-scale', String(fontScale));
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light));
  native.setStatusBar?.(dark ? 'dark' : 'light');
}

export const useTheme = create<ThemeState>((set, get) => ({
  // 기본은 로고와 같은 밤하늘(남색). 밝은 화면·기기 설정은 마이에서 고른다
  mode: (storage.get(STORAGE_KEYS.theme) as ThemeMode | null) ?? 'dark',
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
