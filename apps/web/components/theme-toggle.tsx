'use client';

import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'arbibot-theme';

function readMode(): 'dark' | 'light' {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return 'dark';
}

function applyTheme(mode: 'dark' | 'light'): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  if (mode === 'light') {
    root.classList.add('theme-light');
  } else {
    root.classList.remove('theme-light');
  }
}

function subscribeTheme(cb: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handler = (): void => cb();
  window.addEventListener('arbibot-theme', handler);
  return () => window.removeEventListener('arbibot-theme', handler);
}

function getThemeSnapshot(): 'dark' | 'light' {
  return readMode();
}

function getServerSnapshot(): 'dark' | 'light' {
  return 'dark';
}

export function ThemeToggle(): ReactNode {
  const mode = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerSnapshot,
  );

  useLayoutEffect(() => {
    applyTheme(mode);
  }, [mode]);

  const toggle = useCallback((): void => {
    const next = mode === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event('arbibot-theme'));
  }, [mode]);

  return (
    <button
      type="button"
      onClick={toggle}
      suppressHydrationWarning
      style={{
        padding: '0.35rem 0.65rem',
        fontSize: 12,
        borderRadius: 6,
        border: '1px solid #334155',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      }}
      aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
    >
      {mode === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
