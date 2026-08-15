import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../src/utils/timeout';

class CustomError extends Error {}

describe('withTimeout', () => {
  it('超时前完成则透传结果', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, '超时')).resolves.toBe(
      42,
    );
  });

  it('超时前失败则透传拒绝', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1000, '超时'),
    ).rejects.toThrow('boom');
  });

  it('超时后以指定消息拒绝', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 5000, '等待超时');
    const assertion = expect(pending).rejects.toThrow('等待超时');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    vi.useRealTimers();
  });

  it('支持自定义错误类型', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(
      new Promise(() => {}),
      5000,
      '等待超时',
      (message) => new CustomError(message),
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(CustomError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    vi.useRealTimers();
  });

  it('非正超时直接透传原 promise', async () => {
    const source = new Promise<number>(() => {});
    expect(withTimeout(source, 0, '不应超时')).toBe(source);
    expect(withTimeout(source, Number.NaN, '不应超时')).toBe(source);
  });
});
