import type { DevtoolsTarget } from '../devtools/discovery';

/**
 * DevTools target 列表的变化由轮询 `/json/list` 发现。这里决定轮询结果
 * 如何落到 UI：列表没变就什么都不做；新增页面只补 tab；当前调试的
 * 页面消失才切换目标并重载 DevTools frame（重载代价高，尽量避免）。
 */

export interface TargetRefreshPlan {
  /** 列表（id / 类型 / 标题）是否发生变化 */
  changed: boolean;
  /** 刷新后应作为当前目标的页面 */
  active: DevtoolsTarget | null;
  /** 当前目标是否被替换，需要重载 DevTools frame */
  reloadFrame: boolean;
}

function targetsSignature(targets: DevtoolsTarget[]): string {
  return targets
    .map((target) => `${target.id}\t${target.type}\t${target.title}`)
    .join('\n');
}

export function planTargetRefresh(
  current: DevtoolsTarget[],
  previousActive: DevtoolsTarget | null,
  next: DevtoolsTarget[],
): TargetRefreshPlan {
  if (targetsSignature(next) === targetsSignature(current)) {
    return { changed: false, active: previousActive, reloadFrame: false };
  }
  const active =
    previousActive && next.some((target) => target.id === previousActive.id)
      ? previousActive
      : (next[0] ?? null);
  return {
    changed: true,
    active,
    reloadFrame: active?.id !== previousActive?.id,
  };
}
