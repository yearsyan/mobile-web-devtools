import { describe, expect, it } from 'vitest';
import { planTargetRefresh } from '../src/app/target-refresh';
import type { DevtoolsTarget } from '../src/devtools/discovery';

function target(
  id: string,
  title = `页面 ${id}`,
  type = 'page',
): DevtoolsTarget {
  return {
    id,
    type,
    title,
    url: `https://example.com/${id}`,
    description: '',
    faviconUrl: '',
    webSocketDebuggerUrl: `ws://localhost:9222/devtools/page/${id}`,
  };
}

describe('planTargetRefresh', () => {
  it('列表没有变化时不触发刷新', () => {
    const current = [target('a'), target('b')];
    const plan = planTargetRefresh(current, current[1], [
      target('a'),
      target('b'),
    ]);
    expect(plan).toEqual({
      changed: false,
      active: current[1],
      reloadFrame: false,
    });
  });

  it('新增页面只补 tab，不重载 frame', () => {
    const current = [target('a')];
    const next = [target('a'), target('new')];
    const plan = planTargetRefresh(current, current[0], next);
    expect(plan.changed).toBe(true);
    expect(plan.active?.id).toBe('a');
    expect(plan.reloadFrame).toBe(false);
  });

  it('当前页面消失时切换到第一个页面并重载 frame', () => {
    const current = [target('a'), target('b')];
    const next = [target('b'), target('c')];
    const plan = planTargetRefresh(current, current[0], next);
    expect(plan.changed).toBe(true);
    expect(plan.active?.id).toBe('b');
    expect(plan.reloadFrame).toBe(true);
  });

  it('页面全部关闭时目标为空并需要重载', () => {
    const current = [target('a')];
    const plan = planTargetRefresh(current, current[0], []);
    expect(plan.changed).toBe(true);
    expect(plan.active).toBeNull();
    expect(plan.reloadFrame).toBe(true);
  });

  it('标题变化（页面导航）触发刷新但不重载 frame', () => {
    const current = [target('a', '旧标题')];
    const next = [target('a', '新标题')];
    const plan = planTargetRefresh(current, current[0], next);
    expect(plan.changed).toBe(true);
    expect(plan.active?.id).toBe('a');
    expect(plan.reloadFrame).toBe(false);
  });

  it('没有历史目标时取第一个页面', () => {
    const next = [target('x'), target('y')];
    const plan = planTargetRefresh([], null, next);
    expect(plan.changed).toBe(true);
    expect(plan.active?.id).toBe('x');
    expect(plan.reloadFrame).toBe(true);
  });
});
