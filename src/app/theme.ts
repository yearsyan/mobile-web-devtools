import { onLocaleChange, t } from './i18n';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mobile-web-devtools-theme';

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 存储不可用时退化为会话内切换。
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveTheme(): Theme {
  return readStoredTheme() ?? systemTheme();
}

function applyTheme(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (button) {
    button.textContent = theme === 'dark' ? '🌙' : '☀️';
    button.title = theme === 'dark' ? t('theme.toLight') : t('theme.toDark');
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0b1118' : '#f4f6f9');
}

let current: Theme = 'light';

/** 初始化主题：默认跟随系统，用户手动切换后以存储为准。 */
export function initTheme(): void {
  applyTheme(resolveTheme());
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (readStoredTheme() === null) {
        applyTheme(systemTheme());
      }
    });
  onLocaleChange(() => applyTheme(current));
}

export function toggleTheme(): void {
  const next: Theme = resolveTheme() === 'dark' ? 'light' : 'dark';
  writeStoredTheme(next);
  applyTheme(next);
}
