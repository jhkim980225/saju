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

const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

export function applyTheme(mode: ThemeMode, fontScale: number) {
  const dark = mode === 'dark' || (mode === 'system' && Boolean(media?.matches));
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--font-scale', String(fontScale));
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#14130F' : '#F7F3EC'));
  native.setStatusBar?.(dark ? 'dark' : 'light');
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: (storage.get(STORAGE_KEYS.theme) as ThemeMode | null) ?? 'system',
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
