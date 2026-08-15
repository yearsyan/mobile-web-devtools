import { describe, expect, it, vi } from 'vitest';
import {
  currentLocale,
  onLocaleChange,
  setLocale,
  t,
  toggleLocale,
} from '../src/app/i18n';

describe('i18n', () => {
  it('默认取中文文案', () => {
    expect(t('common.connect')).toBe('连接设备');
    expect(t('status.waiting')).toBe('等待连接');
  });

  it('切换 locale 后取对应语言', () => {
    setLocale('en');
    expect(t('common.connect')).toBe('Connect device');
    setLocale('zh');
    expect(t('common.connect')).toBe('连接设备');
  });

  it('插值参数替换', () => {
    setLocale('en');
    expect(t('status.connected.adb', { name: 'Pixel 8', serial: '123' })).toBe(
      'ADB connected · Pixel 8 · 123',
    );
    setLocale('zh');
    expect(t('bridge.cdpClosed', { code: 1006 })).toBe('CDP 已断开（1006）');
  });

  it('frontend 回退文案在两种语言下都有定义', () => {
    setLocale('zh');
    expect(t('bridge.frontendCompatFallback')).toBe(
      '设备版本 frontend 不可用，已切换到 Chromium 官方兼容版本',
    );
    expect(t('bridge.frontendLocalFallback')).toContain('内置副本');
    setLocale('en');
    expect(t('bridge.frontendCompatFallback')).toContain('pinned Chromium');
    expect(t('bridge.frontendLocalFallback')).toContain('bundled copy');
    setLocale('zh');
  });

  it('慢加载弹窗文案在两种语言下都有定义', () => {
    setLocale('zh');
    expect(t('dialog.slowFrontend.title')).toContain('响应缓慢');
    expect(t('dialog.slowFrontend.useLocal')).toBe('使用内置副本');
    expect(t('dialog.slowFrontend.wait')).toBe('继续等待');
    setLocale('en');
    expect(t('dialog.slowFrontend.title')).toContain('slow to respond');
    expect(t('dialog.slowFrontend.useLocal')).toBe('Use bundled copy');
    setLocale('zh');
  });

  it('未知占位符保持原样', () => {
    expect(t('status.connected.adb', {})).toContain('{name}');
  });

  it('setLocale 通知订阅者，取消订阅后不再通知', () => {
    const listener = vi.fn();
    const unsubscribe = onLocaleChange(listener);
    setLocale('en');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLocale('zh');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('toggleLocale 在两种语言间切换', () => {
    const before = currentLocale();
    expect(toggleLocale()).not.toBe(before);
    expect(currentLocale()).not.toBe(before);
    toggleLocale();
    expect(currentLocale()).toBe(before);
  });

  it('重复设置同一 locale 不触发通知', () => {
    const listener = vi.fn();
    const unsubscribe = onLocaleChange(listener);
    const locale = currentLocale();
    setLocale(locale);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
