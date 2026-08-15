import { t } from './i18n';

export function $(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (!element) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') {
      return t('error.noDevice');
    }
    if (error.name === 'NetworkError') {
      return t('error.usbBusy');
    }
  }
  return error instanceof Error ? error.message : String(error);
}
