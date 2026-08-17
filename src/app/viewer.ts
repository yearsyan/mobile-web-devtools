import type { HdcForward } from '@webhdc/core';
import {
  type DevtoolsSocket,
  type DevtoolsTarget,
  type DevtoolsVersion,
  devtoolsWebSocketPath,
  parseDevtoolsTargets,
  parseDevtoolsVersion,
  resolveDevtoolsFrontendUrl,
} from '../devtools/discovery';
import { decodeHttpBody, requestForwardHttp } from '../devtools/http';
import {
  type DevtoolsBridgeStatus,
  DevtoolsMessageBridge,
} from '../devtools/messageBridge';
import { $, formatError } from './dom';
import { onLocaleChange, t } from './i18n';
import { EXPAND_ICON, MINIMIZE_ICON } from './icons';
import { currentClient } from './state';
import { planTargetRefresh } from './target-refresh';
import { initTree, setTreeActiveSocket, setTreePages } from './tree';
import { hideSlowFrontendDialog, setError, showSlowFrontendDialog } from './ui';

const FORWARD_OPTIONS = { timeout: 15_000, highWaterMark: 32 * 1024 * 1024 };
const TARGET_POLL_INTERVAL = 2_000;
const TARGET_POLL_MAX_FAILURES = 3;
/** 官方 frontend 超过该时长未就绪时弹窗，允许手动切换到内置副本。 */
const SLOW_FRONTEND_PROMPT_MS = 5_000;

let mapSequence = 0;
let mappedForward: HdcForward | null = null;
let mappedSocketName: string | null = null;
let mappedVersion: DevtoolsVersion | null = null;
let mappedTargets: DevtoolsTarget[] = [];
let activeTarget: DevtoolsTarget | null = null;
let bridge: DevtoolsMessageBridge | null = null;
let targetPollTimer: ReturnType<typeof setInterval> | null = null;
let targetPollInFlight = false;
let targetPollFailures = 0;
/** bridge 最近一次状态（open / closed 可在语言切换后重新取词）。 */
let lastBridgeState: { state: string; code?: number } = { state: 'loading' };
let slowFrontendTimer: ReturnType<typeof setTimeout> | null = null;
/** 用户手动选择过内置副本后，本次会话内的新 frame 直接走本地。 */
let localFrontendPreferred = false;

/** 注册树节点的“打开应用 / 切换页面”入口。 */
export function initViewer(): void {
  initTree({
    onOpenSocket: (socket) => void mapSocket(socket),
    onSelectTarget: (target) => selectTarget(target),
  });
}

/** 使进行中的映射失效（断开 / 重扫时调用），过期结果会被丢弃。 */
export function invalidateMap(): void {
  mapSequence += 1;
}

/** 当前是否有已建立的 DevTools forward 会话。 */
export function hasMappedForward(): boolean {
  return mappedForward !== null;
}

/** 打开指定应用的 DevTools（供树节点点击与扫描后自动展开使用）。 */
export function openSocket(socket: DevtoolsSocket): void {
  void mapSocket(socket);
}

async function readJson(forward: HdcForward, path: string): Promise<string> {
  const response = await requestForwardHttp(forward, path);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${path} 返回 HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }
  return decodeHttpBody(response);
}

async function readTargets(forward: HdcForward): Promise<DevtoolsTarget[]> {
  try {
    return parseDevtoolsTargets(await readJson(forward, '/json/list'));
  } catch (error) {
    const fallback = parseDevtoolsTargets(await readJson(forward, '/json'));
    if (fallback.length === 0) {
      throw error;
    }
    return fallback;
  }
}

async function mapSocket(socket: DevtoolsSocket): Promise<void> {
  const sequence = ++mapSequence;
  setError(null);
  await closeMapped();
  let forward: HdcForward | null = null;
  try {
    forward = await currentClient().forward(
      `localabstract:${socket.name}`,
      FORWARD_OPTIONS,
    );
    const targets = await readTargets(forward);
    if (targets.length === 0) {
      throw new Error(t('targets.empty'));
    }
    const version = await readJson(forward, '/json/version')
      .then(parseDevtoolsVersion)
      .catch(() => null);
    if (sequence !== mapSequence) {
      await forward.close().catch(() => {});
      return;
    }
    mappedForward = forward;
    mappedSocketName = socket.name;
    mappedVersion = version;
    mappedTargets = targets;
    activeTarget = targets[0] ?? null;
    setTreeActiveSocket(socket.name);
    renderViewer(socket, targets, version);
    startTargetPolling();
  } catch (error) {
    await forward?.close().catch(() => {});
    if (sequence === mapSequence) {
      setError(
        t('error.mapFailed', {
          name: socket.name,
          error: formatError(error),
        }),
      );
    }
  }
}

function renderViewer(
  socket: DevtoolsSocket,
  targets: DevtoolsTarget[],
  version: DevtoolsVersion | null,
): void {
  const viewer = $('viewer');
  viewer.classList.remove('hidden');
  viewer.dataset.socket = socket.name;
  mappedTargets = targets;
  syncTreePages();
  renderFrame(targets, version);
}

/** 把当前映射应用的页面列表同步到侧栏树。 */
function syncTreePages(): void {
  setTreePages(mappedSocketName, mappedTargets, activeTarget?.id ?? null);
}

/**
 * 轮询 `/json/list` 让新打开的页面出现在列表中、被关闭的页面消失。
 * 新增页面只补列表项；当前调试的页面消失才切换目标并重载 frame。
 */
function startTargetPolling(): void {
  stopTargetPolling();
  targetPollFailures = 0;
  targetPollTimer = setInterval(() => void pollTargets(), TARGET_POLL_INTERVAL);
}

function stopTargetPolling(): void {
  if (targetPollTimer !== null) {
    clearInterval(targetPollTimer);
    targetPollTimer = null;
  }
  targetPollInFlight = false;
}

async function pollTargets(): Promise<void> {
  const forward = mappedForward;
  if (!forward || targetPollInFlight || document.hidden) {
    return;
  }
  targetPollInFlight = true;
  try {
    const targets = await readTargets(forward);
    if (forward !== mappedForward) {
      return;
    }
    targetPollFailures = 0;
    const plan = planTargetRefresh(mappedTargets, activeTarget, targets);
    if (!plan.changed) {
      return;
    }
    mappedTargets = targets;
    activeTarget = plan.active;
    syncTreePages();
    if (targets.length === 0) {
      setBridgeStatus({
        state: 'error',
        message: t('targets.empty'),
      });
    } else if (plan.reloadFrame) {
      renderFrame(targets, mappedVersion);
    }
  } catch {
    targetPollFailures += 1;
    if (targetPollFailures >= TARGET_POLL_MAX_FAILURES) {
      stopTargetPolling();
      setBridgeStatus({
        state: 'error',
        message: t('viewer.pollStopped'),
      });
    }
  } finally {
    targetPollInFlight = false;
  }
}

function targetTitle(target: DevtoolsTarget): string {
  const title = target.title.trim();
  return title && title !== 'Untitled' ? title : target.url || target.id;
}

/** 点击树中的页面节点：切换当前调试的页面并重载 frame。 */
function selectTarget(target: DevtoolsTarget): void {
  if (activeTarget?.id === target.id) {
    return;
  }
  activeTarget = target;
  syncTreePages();
  renderFrame(mappedTargets, mappedVersion);
}

function renderFrame(
  targets: DevtoolsTarget[],
  version: DevtoolsVersion | null,
): void {
  const wrap = $('frame-wrap');
  const errorBox = $('frame-error');
  bridge?.dispose();
  bridge = null;
  clearSlowFrontendTimer();
  hideSlowFrontendDialog();
  wrap.replaceChildren();
  errorBox.classList.add('hidden');
  errorBox.textContent = '';
  const target = activeTarget ?? targets[0];
  if (!target || !mappedForward) {
    $('viewer-title').textContent = 'DevTools';
    return;
  }
  $('viewer-title').textContent = `DevTools · ${targetTitle(target)}`;
  let frontendUrl: string;
  try {
    frontendUrl = resolveDevtoolsFrontendUrl(target, version);
  } catch (error) {
    errorBox.textContent = formatError(error);
    errorBox.classList.remove('hidden');
    return;
  }

  const frame = document.createElement('iframe');
  const frameUrl = new URL('/devtoolsFrame.html', window.location.origin);
  frameUrl.searchParams.set(
    'ws',
    `webhdc.invalid${devtoolsWebSocketPath(target.webSocketDebuggerUrl)}`,
  );
  const frontend = new URL(frontendUrl);
  for (const [name, value] of frontend.searchParams) {
    if (name !== 'ws' && name !== 'wss' && name !== 'remoteBase') {
      frameUrl.searchParams.append(name, value);
    }
  }
  frame.src = frameUrl.toString();
  frame.title = `DevTools · ${targetTitle(target)}`;
  frame.sandbox.add(
    'allow-same-origin',
    'allow-scripts',
    'allow-forms',
    'allow-popups',
    'allow-downloads',
    'allow-modals',
  );
  frame.allow = 'clipboard-read; clipboard-write';
  frame.referrerPolicy = 'no-referrer';
  frame.addEventListener('load', () => {
    if (!mappedForward || !target) {
      return;
    }
    const contentWindow = frame.contentWindow;
    if (!contentWindow) {
      setBridgeStatus({ state: 'error', message: t('viewer.frameAccess') });
      return;
    }
    bridge?.dispose();
    const channel = new MessageChannel();
    bridge = new DevtoolsMessageBridge({
      forward: mappedForward,
      port: channel.port1,
      targetWebSocketUrl: target.webSocketDebuggerUrl,
      onStatus: (status) => {
        setBridgeStatus(status);
        handleFrontendProgress(status);
      },
      // 包装 t：顺带记录可长时间停留的 bridge 状态，供语言切换后重新取词。
      formatMessage: (key, params) => {
        if (key === 'bridge.cdpOpen') {
          lastBridgeState = { state: 'open' };
        } else if (key === 'bridge.cdpClosed') {
          lastBridgeState = {
            state: 'closed',
            code: Number(params?.code ?? 0),
          };
        }
        return t(key, params);
      },
    });
    if (localFrontendPreferred) {
      bridge.preferLocalFrontend();
    }
    contentWindow.postMessage(
      { type: 'webhdc-devtools-init', frontendUrl },
      window.location.origin,
      [channel.port2],
    );
  });
  wrap.append(frame);
  setBridgeStatus({ state: 'loading', message: t('bridge.preparing') });
}

function setBridgeStatus(status: DevtoolsBridgeStatus): void {
  if (status.state !== 'open' && status.state !== 'closed') {
    lastBridgeState = { state: status.state };
  }
  const element = $('bridge-status');
  element.dataset.state = status.state;
  $('bridge-status-text').textContent = status.message;
}

/**
 * 官方 frontend 超过 5s 未就绪时弹窗，可手动切换到内置副本；
 * 切到本地副本（手动或自动）即视为不再等待，关闭弹窗并停表。
 */
function handleFrontendProgress(status: DevtoolsBridgeStatus): void {
  if (status.state !== 'loading') {
    clearSlowFrontendTimer();
    hideSlowFrontendDialog();
    return;
  }
  if (status.detail === 'frontend-loading') {
    startSlowFrontendTimer();
  } else if (
    status.detail === 'frontend-ready' ||
    (status.detail === 'frontend-fallback' &&
      status.fallbackKey === 'bridge.frontendLocalFallback')
  ) {
    clearSlowFrontendTimer();
    hideSlowFrontendDialog();
  }
}

function startSlowFrontendTimer(): void {
  clearSlowFrontendTimer();
  slowFrontendTimer = setTimeout(() => {
    slowFrontendTimer = null;
    showSlowFrontendDialog(() => {
      localFrontendPreferred = true;
      bridge?.preferLocalFrontend();
    });
  }, SLOW_FRONTEND_PROMPT_MS);
}

function clearSlowFrontendTimer(): void {
  if (slowFrontendTimer !== null) {
    clearTimeout(slowFrontendTimer);
    slowFrontendTimer = null;
  }
}

export function toggleFullscreen(): void {
  const viewer = $('viewer');
  viewer.classList.toggle('fullscreen');
  document.body.style.overflow = viewer.classList.contains('fullscreen')
    ? 'hidden'
    : '';
  const button = $('fullscreen-button');
  button.innerHTML = viewer.classList.contains('fullscreen')
    ? MINIMIZE_ICON
    : EXPAND_ICON;
}

export async function closeMapped(): Promise<void> {
  stopTargetPolling();
  bridge?.dispose();
  bridge = null;
  clearSlowFrontendTimer();
  hideSlowFrontendDialog();
  const forward = mappedForward;
  mappedForward = null;
  mappedSocketName = null;
  mappedVersion = null;
  mappedTargets = [];
  activeTarget = null;
  setTreeActiveSocket(null);
  if (forward) {
    await forward.close().catch(() => {});
  }
  $('frame-wrap').replaceChildren();
  $('frame-error').classList.add('hidden');
  $('frame-error').textContent = '';
  $('viewer-title').textContent = 'DevTools';
  $('viewer').classList.add('hidden');
  document.body.style.overflow = '';
  $('fullscreen-button').innerHTML = EXPAND_ICON;
}

onLocaleChange(() => {
  $('viewer-title').textContent = activeTarget
    ? `DevTools · ${targetTitle(activeTarget)}`
    : 'DevTools';
  if (lastBridgeState.state === 'open') {
    setBridgeStatus({ state: 'open', message: t('bridge.cdpOpen') });
  } else if (lastBridgeState.state === 'closed') {
    setBridgeStatus({
      state: 'closed',
      message: t('bridge.cdpClosed', { code: lastBridgeState.code ?? 0 }),
    });
  }
});
