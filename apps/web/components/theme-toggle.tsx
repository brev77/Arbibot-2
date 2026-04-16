'use client';

import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';

import { Button } from './ui/button';

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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      suppressHydrationWarning
      className="text-xs"
      aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
    >
      {mode === 'dark' ? 'Light' : 'Dark'}
    </Button>
  );
}
