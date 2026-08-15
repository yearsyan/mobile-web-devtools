export const AUTO_SCAN_MAX_ATTEMPTS = 20;
const INITIAL_DELAY = 500;
const MAX_DELAY = 30_000;

/**
 * 连接后 WebView 调试 socket 可能晚于设备会话就绪；第 0 次重试间隔
 * 500ms，随后指数退避，单次间隔上限 30s。
 */
export function nextAutoScanDelay(attempt: number): number {
  if (attempt === 0) {
    return INITIAL_DELAY;
  }
  return Math.min(INITIAL_DELAY * 2 ** attempt, MAX_DELAY);
}
