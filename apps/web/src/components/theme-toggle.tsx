'use client';
import { useEffect, useState } from 'react';
import { IconMoon, IconSun } from '@/components/icons';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(t: Theme) {
  if (t === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  try { localStorage.setItem('mxwatch-theme', t); } catch {}
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => { setTheme(readTheme()); }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className={`inline-flex items-center justify-center rounded-md transition ${className}`}
      style={{
        width: 26,
        height: 26,
        background: 'var(--bg2)',
        color: 'var(--text2)',
        border: '1px solid var(--border)',
      }}
    >
      {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
    </button>
  );
}
