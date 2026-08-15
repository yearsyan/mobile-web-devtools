import { describe, expect, it } from 'vitest';
import { nextAutoScanDelay } from '../src/app/autoscan';

describe('nextAutoScanDelay', () => {
  it('首次重试 500ms 后指数退避', () => {
    expect(nextAutoScanDelay(0)).toBe(500);
    expect(nextAutoScanDelay(1)).toBe(1000);
    expect(nextAutoScanDelay(2)).toBe(2000);
    expect(nextAutoScanDelay(3)).toBe(4000);
  });

  it('单次间隔上限 30s', () => {
    expect(nextAutoScanDelay(7)).toBe(30_000);
    expect(nextAutoScanDelay(19)).toBe(30_000);
  });
});
