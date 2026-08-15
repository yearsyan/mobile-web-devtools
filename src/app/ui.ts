import type { DevtoolsSocket } from '../devtools/discovery';
import type { Platform } from './device-client';
import { $ } from './dom';
import { currentLocale, type MessageKey, onLocaleChange, t } from './i18n';
import { EXPAND_ICON } from './icons';
import { normalizePackageName } from './packages';
import { currentClient, state } from './state';

export interface ShellHandlers {
  onSwitchPlatform(platform: Platform): void;
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
            <div class="platform-switch" role="group" aria-label="设备平台">
              <button type="button" id="platform-harmony" class="platform-button active">HarmonyOS</button>
              <button type="button" id="platform-android" class="platform-button">Android</button>
            </div>
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
              <section class="sidebar-section">
                <header class="sidebar-head">
                  <div>
                    <p class="kicker">WEBVIEW DEBUGGING</p>
                    <h2 id="sidebar-ports-title"></h2>
                  </div>
                  <button type="button" id="scan-button" class="button secondary"></button>
                </header>
                <ul id="socket-list" class="side-list"></ul>
              </section>
              <section class="sidebar-section sidebar-section-grow">
                <header class="sidebar-head">
                  <div>
                    <p class="kicker">PAGES</p>
                    <h2 id="sidebar-pages-title"></h2>
                  </div>
                </header>
                <ul id="target-list" class="side-list"></ul>
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
    </div>
  `;

  $('platform-harmony').addEventListener('click', () =>
    shellHandlers?.onSwitchPlatform('harmony'),
  );
  $('platform-android').addEventListener('click', () =>
    shellHandlers?.onSwitchPlatform('android'),
  );
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
  updateShellTexts();
}

/**
 * 静态文案统一在这里取词（而不是写进模板）：切换语言时只更新文本节点，
 * 不重建 DOM——否则会把正在运行的 DevTools iframe 一并销毁。
 */
function updateShellTexts(): void {
  $('empty-title').textContent = t('empty.title');
  $('sidebar-ports-title').textContent = t('sidebar.ports');
  $('sidebar-pages-title').textContent = t('sidebar.pages');
  $('fullscreen-button').title = t('viewer.fullscreen');
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
  const harmonyButton = $('platform-harmony') as HTMLButtonElement;
  const androidButton = $('platform-android') as HTMLButtonElement;
  connectButton.disabled = state.connecting;
  emptyConnect.disabled = state.connecting;
  scanButton.disabled = state.connecting;
  harmonyButton.disabled = state.connecting;
  androidButton.disabled = state.connecting;
  for (const button of sideListButtons('#socket-list')) {
    button.disabled = state.connecting;
  }
  for (const button of sideListButtons('#target-list')) {
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

export function updatePlatformUi(): void {
  const client = currentClient();
  const android = client.platform === 'android';
  $('platform-harmony').classList.toggle('active', !android);
  $('platform-android').classList.toggle('active', android);
  $('empty-desc').textContent = android
    ? t('empty.desc.android')
    : t('empty.desc.harmony');
  $('empty-hint').textContent = android
    ? t('empty.hint.android')
    : t('empty.hint.harmony');
  $('support-note').textContent = client.isSupported()
    ? ''
    : t('support.noWebUsb');
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

function socketTitle(socket: DevtoolsSocket): string {
  return socket.pid ? `WebView · PID ${socket.pid}` : 'WebView DevTools';
}

/** socket 列表项的“打开 DevTools”回调由 viewer 注入，避免 ui 依赖 viewer。 */
let onOpenSocket: ((socket: DevtoolsSocket) => void) | null = null;

/** name → socket 的映射，供列表项点击时回查目标。 */
const socketByName = new Map<string, DevtoolsSocket>();

/** 已解析的 PID → 原始包名映射，语言切换重绘列表时复用。 */
const resolvedPackages = new Map<string, string>();

/** 当前已映射（正在调试）的 socket 名，用于列表高亮。 */
let activeSocketName: string | null = null;

export function setSocketOpenHandler(
  handler: (socket: DevtoolsSocket) => void,
): void {
  onOpenSocket = handler;
}

function listPlaceholder(text: string): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'side-placeholder';
  item.textContent = text;
  return item;
}

function appendSocketRow(socket: DevtoolsSocket): void {
  const list = $('socket-list');
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'side-item';
  button.dataset.socketName = socket.name;
  button.classList.toggle('active', socket.name === activeSocketName);
  const title = document.createElement('strong');
  title.className = 'side-item-title';
  title.textContent = socketTitle(socket);
  const sub = document.createElement('small');
  sub.className = 'side-item-sub';
  sub.textContent = socket.name;
  sub.title = socket.raw;
  button.append(title, sub);
  button.addEventListener('click', () => {
    const target = socketByName.get(socket.name);
    if (target) {
      onOpenSocket?.(target);
    }
  });
  item.append(button);
  list.append(item);
}

/** 扫描进行中的占位状态。 */
export function setSocketScanPending(): void {
  $('socket-list').replaceChildren(listPlaceholder(t('scan.reading')));
}

export function renderSocketList(sockets: DevtoolsSocket[]): void {
  const list = $('socket-list');
  list.replaceChildren();
  socketByName.clear();
  if (sockets.length === 0) {
    resolvedPackages.clear();
    list.append(listPlaceholder(t('sockets.empty')));
    return;
  }
  for (const socket of sockets) {
    socketByName.set(socket.name, socket);
    appendSocketRow(socket);
  }
}

/** 高亮当前正在调试的 socket（null 取消高亮）。 */
export function setActiveSocket(name: string | null): void {
  activeSocketName = name;
  for (const button of sideListButtons('#socket-list')) {
    button.classList.toggle('active', button.dataset.socketName === name);
  }
}

export function applySocketPackages(packages: Map<string, string>): void {
  resolvedPackages.clear();
  for (const [pid, name] of packages) {
    resolvedPackages.set(pid, name);
  }
  for (const button of sideListButtons('#socket-list')) {
    const socket = socketByName.get(button.dataset.socketName ?? '');
    const title = button.querySelector<HTMLElement>('.side-item-title');
    const sub = button.querySelector<HTMLElement>('.side-item-sub');
    if (!socket?.pid || !title || !sub) {
      continue;
    }
    const rawName = packages.get(socket.pid);
    const packageName = rawName ? normalizePackageName(rawName) : '';
    if (packageName) {
      title.textContent = packageName;
      title.title = rawName ?? packageName;
      sub.textContent = `PID ${socket.pid} · ${socket.name}`;
    } else {
      title.textContent = `WebView · PID ${socket.pid}`;
      sub.textContent = t('sockets.noPackage', { name: socket.name });
    }
  }
}

/** 语言切换后重绘 socket 列表（保留已解析的包名）。 */
function refreshSocketListOnLocale(): void {
  if (socketByName.size === 0) {
    return;
  }
  renderSocketList([...socketByName.values()]);
  applySocketPackages(resolvedPackages);
}

onLocaleChange(() => {
  updateShellTexts();
  updatePlatformUi();
  refreshSocketListOnLocale();
});
