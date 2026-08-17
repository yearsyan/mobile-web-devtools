import { $ } from './dom';
import { currentLocale, type MessageKey, onLocaleChange, t } from './i18n';
import { EXPAND_ICON } from './icons';
import { currentClient, state } from './state';

export interface ShellHandlers {
  onConnect(): void;
  onDisconnect(): void;
  onScan(): void;
  onFullscreen(): void;
  onToggleTheme(): void;
  onToggleLocale(): void;
}

export interface DeviceStatusInfo {
  name: string;
  serial: string;
}

let shellHandlers: ShellHandlers | null = null;

export function renderShell(handlers: ShellHandlers): void {
  shellHandlers = handlers;
  const root = document.querySelector<HTMLElement>('#root');
  if (!root) {
    return;
  }
  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <strong class="brand-title">Web DevTools</strong>
          </div>
          <div class="topbar-actions">
            <button type="button" id="theme-toggle" class="icon-button" title=""></button>
            <button type="button" id="lang-toggle" class="icon-button lang-toggle" title=""></button>
            <span id="support-note" class="support-note"></span>
            <span id="error-line" class="error-line"></span>
            <span id="status-pill" class="status-pill">
              <i id="status-dot" class="status-dot"></i>
              <span id="status-text"></span>
            </span>
            <button type="button" id="connect-button" class="button primary"></button>
          </div>
        </div>
      </header>
      <main class="page">
        <section id="empty-state" class="empty-state">
          <h1 id="empty-title"></h1>
          <p id="empty-desc"></p>
          <button type="button" id="empty-connect" class="button primary"></button>
          <p id="empty-hint" class="hint"></p>
        </section>
        <section id="workspace" class="workspace hidden">
          <div class="workspace-layout">
            <aside class="sidebar">
              <section class="sidebar-section sidebar-section-grow">
                <header class="sidebar-head">
                  <div>
                    <p class="kicker">WEBVIEW DEBUGGING</p>
                    <h2 id="sidebar-apps-title"></h2>
                  </div>
                  <button type="button" id="scan-button" class="button secondary"></button>
                </header>
                <ul id="app-tree" class="side-list"></ul>
              </section>
            </aside>
            <section id="viewer" class="viewer hidden">
              <header class="viewer-head">
                <div id="viewer-title" class="viewer-title">DevTools</div>
                <div class="viewer-side">
                  <span id="bridge-status" class="bridge-status"><i></i><span id="bridge-status-text"></span></span>
                  <button type="button" id="fullscreen-button" class="icon-button" title="">${EXPAND_ICON}</button>
                </div>
              </header>
              <div id="frame-wrap" class="frame-wrap"></div>
              <div id="frame-error" class="frame-error hidden"></div>
            </section>
          </div>
        </section>
      </main>
      <footer class="footer">CDP over WebUSB · HDC / ADB</footer>
      <dialog id="slow-frontend-dialog" class="slow-dialog">
        <form method="dialog" class="slow-dialog-body">
          <h3 id="slow-dialog-title"></h3>
          <p id="slow-dialog-desc"></p>
          <div class="slow-dialog-actions">
            <button type="submit" value="wait" id="slow-dialog-wait" class="button secondary"></button>
            <button type="submit" value="local" id="slow-dialog-local" class="button primary"></button>
          </div>
        </form>
      </dialog>
    </div>
  `;

  $('theme-toggle').addEventListener('click', () =>
    shellHandlers?.onToggleTheme(),
  );
  $('lang-toggle').addEventListener('click', () =>
    shellHandlers?.onToggleLocale(),
  );
  $('connect-button').addEventListener('click', () => {
    if (state.connected) {
      shellHandlers?.onDisconnect();
    } else {
      shellHandlers?.onConnect();
    }
  });
  $('empty-connect').addEventListener('click', () =>
    shellHandlers?.onConnect(),
  );
  $('scan-button').addEventListener('click', () => shellHandlers?.onScan());
  $('fullscreen-button').addEventListener('click', () =>
    shellHandlers?.onFullscreen(),
  );
  const slowDialog = $('slow-frontend-dialog') as HTMLDialogElement;
  slowDialog.addEventListener('close', () => {
    // ESC / 关闭等同“继续等待”；只有显式点击“使用内置副本”才触发回调。
    if (slowDialog.returnValue === 'local') {
      onSlowDialogUseLocal?.();
    }
    onSlowDialogUseLocal = null;
  });
  updateShellTexts();
}

/**
 * 静态文案统一在这里取词（而不是写进模板）：切换语言时只更新文本节点，
 * 不重建 DOM——否则会把正在运行的 DevTools iframe 一并销毁。
 */
function updateShellTexts(): void {
  $('empty-title').textContent = t('empty.title');
  $('empty-desc').textContent = t('empty.desc.auto');
  $('empty-hint').textContent = t('empty.hint.auto');
  $('support-note').textContent = currentClient().isSupported()
    ? ''
    : t('support.noWebUsb');
  $('sidebar-apps-title').textContent = t('sidebar.apps');
  $('fullscreen-button').title = t('viewer.fullscreen');
  $('slow-dialog-title').textContent = t('dialog.slowFrontend.title');
  $('slow-dialog-desc').textContent = t('dialog.slowFrontend.desc');
  $('slow-dialog-wait').textContent = t('dialog.slowFrontend.wait');
  $('slow-dialog-local').textContent = t('dialog.slowFrontend.useLocal');
  // 初始兜底；扫描期间与语言切换后的文案由 connection 按 scanning 状态维护。
  const scanButton = $('scan-button') as HTMLButtonElement;
  if (scanButton.textContent === '') {
    scanButton.textContent = t('scan.rescan');
  }
  const langButton = $('lang-toggle');
  langButton.textContent = currentLocale() === 'zh' ? 'EN' : '中';
  langButton.title = t('lang.title');
  syncConnectButton();
  applyStatus();
}

function sideListButtons(selector: string): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(`${selector} .side-item`),
  ];
}

export function setBusy(next: boolean): void {
  state.connecting = next;
  const connectButton = $('connect-button') as HTMLButtonElement;
  const emptyConnect = $('empty-connect') as HTMLButtonElement;
  const scanButton = $('scan-button') as HTMLButtonElement;
  connectButton.disabled = state.connecting;
  emptyConnect.disabled = state.connecting;
  scanButton.disabled = state.connecting;
  for (const button of sideListButtons('#app-tree')) {
    button.disabled = state.connecting;
  }
}

type StatusState = 'offline' | 'connecting' | 'connected' | 'error';

let lastStatus: {
  state: StatusState;
  key?: MessageKey;
  params?: Record<string, string | number>;
  raw?: string;
} = { state: 'offline', key: 'status.waiting' };

function applyStatus(): void {
  $('status-text').textContent =
    lastStatus.raw ?? t(lastStatus.key ?? 'status.waiting', lastStatus.params);
  $('status-dot').dataset.state = lastStatus.state;
}

/** 状态胶囊使用可翻译的消息 key（带插值参数），语言切换后自动重取词。 */
export function setStatusKey(
  key: MessageKey,
  state: StatusState,
  params?: Record<string, string | number>,
): void {
  lastStatus = { state, key, params };
  applyStatus();
}

/** 直接展示原始文本（通常是设备返回的内容）。 */
export function setStatus(message: string, state: StatusState): void {
  lastStatus = { state, raw: message };
  applyStatus();
}

export function setError(message: string | null): void {
  $('error-line').textContent = message ?? '';
  $('error-line').classList.toggle('hidden', !message);
}

let onSlowDialogUseLocal: (() => void) | null = null;

/** 官方 frontend 长时间未响应时的手动切换弹窗。 */
export function showSlowFrontendDialog(useLocal: () => void): void {
  onSlowDialogUseLocal = useLocal;
  const dialog = $('slow-frontend-dialog') as HTMLDialogElement;
  if (!dialog.open) {
    dialog.returnValue = '';
    dialog.showModal();
  }
}

export function hideSlowFrontendDialog(): void {
  const dialog = $('slow-frontend-dialog') as HTMLDialogElement;
  if (dialog.open) {
    dialog.close();
  }
  onSlowDialogUseLocal = null;
}

export function setConnectLabel(label: string): void {
  $('connect-button').textContent = label;
  $('empty-connect').textContent = label;
}

/** 右上角按钮在「连接设备」与「断开」之间切换（设备信息由状态胶囊展示）。 */
export function syncConnectButton(): void {
  const button = $('connect-button') as HTMLButtonElement;
  button.textContent = state.connected
    ? t('common.disconnect')
    : t('common.connect');
  $('empty-connect').textContent = t('common.connect');
}

export function showConnected(info: DeviceStatusInfo): void {
  state.connected = true;
  $('empty-state').classList.add('hidden');
  $('workspace').classList.remove('hidden');
  setStatusKey(
    currentClient().platform === 'android'
      ? 'status.connected.adb'
      : 'status.connected.hdc',
    'connected',
    { name: info.name, serial: info.serial || '—' },
  );
  syncConnectButton();
}

export function showDisconnected(): void {
  state.connected = false;
  $('workspace').classList.add('hidden');
  $('empty-state').classList.remove('hidden');
  setStatusKey('status.waiting', 'offline');
  syncConnectButton();
}

onLocaleChange(() => {
  updateShellTexts();
});
