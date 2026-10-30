import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeName = 'light' | 'dim' | 'dark';
export const THEMES: { id: ThemeName; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dim', label: 'Dim' },
  { id: 'dark', label: 'Dark' },
];

const KEY = 'triangulate.theme';

function initialTheme(): ThemeName {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dim' || saved === 'dark') return saved;
  } catch {
    /* storage can be unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dim' : 'light';
}

interface ThemeApi {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* storage can be unavailable */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

export function ThemeSwitch({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={`tabs ${className}`} role="group" aria-label="Colour theme">
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={theme === item.id}
          onClick={() => setTheme(item.id)}
          title={`${item.label} theme`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Theme colours as concrete values, for canvas drawing. Re-read whenever the theme changes. */
export function useThemeColors(): { accent: string; accent2: string; ink: string; bg: string } {
  const { theme } = useTheme();
  const [colors, setColors] = useState({
    accent: '#0b8f7d',
    accent2: '#d98a00',
    ink: '#14171f',
    bg: '#f5f3ec',
  });
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    setColors({
      accent: read('--accent', '#0b8f7d'),
      accent2: read('--accent-2', '#d98a00'),
      ink: read('--ink', '#14171f'),
      bg: read('--bg', '#f5f3ec'),
    });
  }, [theme]);
  return colors;
}
