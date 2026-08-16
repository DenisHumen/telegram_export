import { useEffect, useState } from 'react';
import { create } from 'zustand';

/**
 * Theme preference: dark (default) → light → system.
 * `system` follows `prefers-color-scheme` live; the resolved value is written
 * to <html data-theme="…">, which is what index.css keys off.
 */
export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'tgvault.theme';
/** Browser chrome colour — must mirror --bg literally; <meta> cannot read CSS vars. */
const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#262624', light: '#FAF9F5' };

function isMode(value: string | null): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

/**
 * `?theme=light|dark` forces a theme for this page load only — used by
 * headless screenshot runs, where localStorage is empty. It never writes to
 * storage, so the user's saved preference survives untouched.
 */
function urlOverride(): ThemeMode | null {
  try {
    const value = new URLSearchParams(window.location.search).get('theme');
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

function readMode(): ThemeMode {
  const override = urlOverride();
  if (override) return override;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isMode(raw)) return raw;
  } catch {
    /* localStorage unavailable */
  }
  return 'dark';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode;
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', THEME_COLOR[resolved]);
}

interface ThemeStore {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** dark → light → system → dark */
  cycle: () => void;
  /** Internal: called by the media-query listener while mode === 'system'. */
  syncSystem: () => void;
}

const initialMode = readMode();

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: initialMode,
  resolved: resolveTheme(initialMode),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
    const resolved = resolveTheme(mode);
    apply(resolved);
    set({ mode, resolved });
  },
  cycle: () => {
    const order: ThemeMode[] = ['dark', 'light', 'system'];
    const next = order[(order.indexOf(get().mode) + 1) % order.length];
    get().setMode(next);
  },
  syncSystem: () => {
    if (get().mode !== 'system') return;
    const resolved = systemTheme();
    apply(resolved);
    set({ resolved });
  },
}));

/** Mount once at the app root: keeps `system` in sync with the OS setting. */
export function useThemeSync(): void {
  const syncSystem = useThemeStore((state) => state.syncSystem);
  const resolved = useThemeStore((state) => state.resolved);

  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => syncSystem();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [syncSystem]);
}

/* --------------------------------------------------------------- tokens */

const TOKEN_NAMES = [
  'accent',
  'success',
  'warning',
  'danger',
  'text',
  'text-dim',
  'text-muted',
  'surface',
  'surface-2',
  'bg',
  'border',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type TokenColors = Record<TokenName, string>;

function readTokens(): TokenColors {
  const styles = getComputedStyle(document.documentElement);
  const out = {} as TokenColors;
  for (const name of TOKEN_NAMES) {
    out[name] = styles.getPropertyValue(`--${name}`).trim() || '#888888';
  }
  return out;
}

/**
 * Resolved token colours for consumers that need concrete strings rather than
 * CSS classes (charts). Re-read whenever the theme flips.
 */
export function useTokenColors(): TokenColors {
  const resolved = useThemeStore((state) => state.resolved);
  const [tokens, setTokens] = useState<TokenColors>(() => readTokens());

  useEffect(() => {
    setTokens(readTokens());
  }, [resolved]);

  return tokens;
}

/** Chart series palette — warm, muted, derived from the accent hue family. */
export function chartSeries(tokens: TokenColors): string[] {
  return [
    tokens.accent,
    tokens.success,
    tokens.warning,
    tokens['text-dim'],
    tokens.danger,
    tokens['text-muted'],
  ];
}
