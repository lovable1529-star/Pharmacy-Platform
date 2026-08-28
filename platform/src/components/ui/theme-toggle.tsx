'use client';

/**
 * Light / dark switch for the top bar.
 *
 * Presentation only — it writes one attribute on <html> and one key in
 * localStorage. No server call, no user record, nothing that leaves the
 * browser. Two people sharing a counter terminal can therefore each have their
 * own preference on their own machine without it being an account setting
 * anybody has to administer.
 *
 * The initial value comes from the attribute the bootstrap script in
 * `layout.tsx` already set, NOT from a fresh read of localStorage. Reading the
 * DOM keeps one source of truth: whatever the page is actually displaying is
 * what this button reports, even if storage is unreadable.
 */

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  /*
   * Starts as null and is filled in after mount.
   *
   * The server cannot know the theme — it lives in the browser — so rendering
   * a specific icon on the server would guarantee a hydration mismatch for
   * half the users. Instead the button renders at its final SIZE immediately
   * and its icon appears a frame later, so nothing in the top bar shifts.
   */
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem('karsons.theme', next);
    } catch {
      // Preference not persisted. The theme still applies for this session,
      // which is the part the person asked for.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Both label and title, because this is an icon-only control: the title
      // serves the mouse, the aria-label serves a screen reader.
      aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-faint transition-colors hover:border-brand-300 hover:text-brand-600"
    >
      {theme === 'dark' ? (
        <Sun size={16} strokeWidth={1.9} />
      ) : theme === 'light' ? (
        <Moon size={16} strokeWidth={1.9} />
      ) : (
        // Pre-mount placeholder. Holds the exact icon box so the row of top-bar
        // buttons does not visibly reflow once the theme is known.
        <span className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
