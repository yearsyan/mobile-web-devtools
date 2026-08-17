/**
 * 极简双语（zh / en）消息字典。t() 在渲染时取词，切换 locale 后通过
 * onLocaleChange 通知各模块重绘文本；设备名、URL 等动态值用 {param} 插值。
 */

export type Locale = 'zh' | 'en';

export type MessageKey = keyof typeof messages.zh;

const STORAGE_KEY = 'mobile-web-devtools-locale';

const messages = {
  zh: {
    'common.connect': '连接设备',
    'common.disconnect': '断开',
    'common.connecting': '连接中…',
    'status.detecting': '正在识别设备调试协议…',
    'status.waiting': '等待连接',
    'status.failed': '连接失败',
    'status.session.adb':
      '正在与设备建立 ADB 会话，首次连接请在手机上允许 USB 调试…',
    'status.session.hdc': '正在与设备建立 HDC 会话…',
    'status.connected.adb': 'ADB 已连接 · {name} · {serial}',
    'status.connected.hdc': 'HDC 已连接 · {name} · {serial}',
    'empty.title': '未连接设备',
    'empty.desc.auto':
      '通过 WebUSB 连接 Android 或 HarmonyOS / OpenHarmony 设备，自动识别 ADB / HDC 协议，映射 WebView DevTools socket 并内嵌 Chrome DevTools。',
    'empty.hint.secure':
      '需要桌面版 Chrome / Edge，并在安全上下文（localhost / HTTPS）中使用。',
    'empty.hint.auto':
      '若 USB 接口被占用，请先退出本机 adb / hdc server、DevEco Studio 或手机助手；首次连接需在设备上允许 USB 调试。',
    'support.noWebUsb': '当前浏览器不支持 WebUSB，请使用桌面版 Chrome 或 Edge',
    'sidebar.apps': '应用与页面',
    'scan.rescan': '重新扫描',
    'scan.scanning': '扫描中…',
    'scan.reading': '正在读取 /proc/net/unix…',
    'sockets.empty':
      '没有发现 WebView 调试 socket，请确认应用中的 WebView 已开启调试并保持页面运行。',
    'sockets.noPackage': '未解析到包名 · {name}',
    'targets.empty': '该 WebView 当前没有可调试页面。',
    'error.scanFailed': '扫描 WebView 调试端口失败 · {error}',
    'error.mapFailed': '映射 {name} 失败 · {error}',
    'error.usbDisconnected': 'USB 设备已断开，请重新连接',
    'error.noDevice': '未选择 USB 设备',
    'error.usbBusy':
      '无法占用 USB 接口，请先停止本机 adb / hdc server 或关闭设备助手',
    'error.unknownProtocol':
      '无法识别设备的调试协议（未找到 ADB 或 HDC USB 接口），请确认设备已开启 USB 调试',
    'bridge.preparing': '准备 DevTools frontend…',
    'bridge.frameReady': 'iframe 通信桥已就绪',
    'bridge.frontendLoading': '正在加载匹配版本的 DevTools frontend…',
    'bridge.frontendReady': 'DevTools frontend 已加载，正在连接 CDP…',
    'bridge.frontendCompatFallback':
      '设备版本 frontend 不可用，已切换到 Chromium 官方兼容版本',
    'bridge.frontendLocalFallback':
      '官方 frontend 不可达，已使用内置副本（可能与设备版本不完全匹配）',
    'bridge.cdpOpen': 'CDP 已通过 WebHDC 连接',
    'bridge.cdpClosed': 'CDP 已断开（{code}）',
    'viewer.frameAccess': '无法访问 DevTools iframe',
    'viewer.pollStopped': '页面列表自动刷新失败，已停止',
    'dialog.slowFrontend.title': '官方 DevTools 前端响应缓慢',
    'dialog.slowFrontend.desc':
      '官方源超过 5 秒未响应（可能是网络无法访问 Google 服务）。可立即切换到内置副本继续调试，本次会话内将直接使用本地副本。',
    'dialog.slowFrontend.useLocal': '使用内置副本',
    'dialog.slowFrontend.wait': '继续等待',
    'theme.toLight': '切换到亮色主题',
    'theme.toDark': '切换到深色主题',
    'lang.title': '切换语言 / Switch language',
    'viewer.fullscreen': '全屏',
  },
  en: {
    'common.connect': 'Connect device',
    'common.disconnect': 'Disconnect',
    'common.connecting': 'Connecting…',
    'status.detecting': 'Detecting device protocol…',
    'status.waiting': 'Waiting for connection',
    'status.failed': 'Connection failed',
    'status.session.adb':
      'Starting ADB session — approve USB debugging on the device if this is the first connection…',
    'status.session.hdc': 'Starting HDC session…',
    'status.connected.adb': 'ADB connected · {name} · {serial}',
    'status.connected.hdc': 'HDC connected · {name} · {serial}',
    'empty.title': 'No device connected',
    'empty.desc.auto':
      'Connect an Android or HarmonyOS / OpenHarmony device over WebUSB — the ADB / HDC protocol is detected automatically. Then map its WebView DevTools socket and embed Chrome DevTools.',
    'empty.hint.secure':
      'Requires desktop Chrome / Edge in a secure context (localhost / HTTPS).',
    'empty.hint.auto':
      'If the USB interface is busy, stop the local adb / hdc server, DevEco Studio or phone assistants first; approve USB debugging on the device for the first connection.',
    'support.noWebUsb':
      'WebUSB is not supported in this browser — use desktop Chrome or Edge',
    'sidebar.apps': 'Apps & pages',
    'scan.rescan': 'Rescan',
    'scan.scanning': 'Scanning…',
    'scan.reading': 'Reading /proc/net/unix…',
    'sockets.empty':
      'No WebView debug sockets found. Make sure WebView debugging is enabled in the app and a page is running.',
    'sockets.noPackage': 'Package unresolved · {name}',
    'targets.empty': 'No debuggable pages in this WebView right now.',
    'error.scanFailed': 'Failed to scan WebView debug ports · {error}',
    'error.mapFailed': 'Failed to map {name} · {error}',
    'error.usbDisconnected': 'USB device disconnected — please reconnect',
    'error.noDevice': 'No USB device selected',
    'error.usbBusy':
      'Cannot claim the USB interface — stop the local adb / hdc server or device assistants first',
    'error.unknownProtocol':
      'Unrecognized device protocol (no ADB or HDC USB interface found) — make sure USB debugging is enabled',
    'bridge.preparing': 'Preparing DevTools frontend…',
    'bridge.frameReady': 'iframe bridge ready',
    'bridge.frontendLoading': 'Loading the matching DevTools frontend…',
    'bridge.frontendReady': 'DevTools frontend loaded, connecting to CDP…',
    'bridge.frontendCompatFallback':
      'Device frontend unavailable — switched to the pinned Chromium build',
    'bridge.frontendLocalFallback':
      'Official frontend unreachable — using the bundled copy (may not exactly match the device)',
    'bridge.cdpOpen': 'CDP connected over WebHDC',
    'bridge.cdpClosed': 'CDP disconnected ({code})',
    'viewer.frameAccess': 'Cannot access the DevTools iframe',
    'viewer.pollStopped':
      'Auto refresh of the page list failed and was stopped',
    'dialog.slowFrontend.title':
      'Official DevTools frontend is slow to respond',
    'dialog.slowFrontend.desc':
      'The official host has not responded for 5 seconds (Google services are often unreachable in mainland China). Switch to the bundled copy to keep debugging — this session will then use it directly.',
    'dialog.slowFrontend.useLocal': 'Use bundled copy',
    'dialog.slowFrontend.wait': 'Keep waiting',
    'theme.toLight': 'Switch to light theme',
    'theme.toDark': 'Switch to dark theme',
    'lang.title': '切换语言 / Switch language',
    'viewer.fullscreen': 'Fullscreen',
  },
} satisfies Record<Locale, Record<string, string>>;

const listeners = new Set<() => void>();
let locale: Locale = 'zh';

function applyDocumentLang(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = messages[locale][key] ?? messages.zh[key] ?? key;
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function currentLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  if (next === locale) {
    return;
  }
  locale = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 存储不可用时仅会话内生效。
  }
  applyDocumentLang();
  for (const listener of [...listeners]) {
    listener();
  }
}

export function toggleLocale(): Locale {
  setLocale(locale === 'zh' ? 'en' : 'zh');
  return locale;
}

/** 读取存储偏好（无则按浏览器语言），并完成首次 locale 设定。 */
export function initLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // 忽略不可用的存储。
  }
  const prefersZh = globalThis.navigator?.language
    ?.toLowerCase()
    .startsWith('zh');
  locale =
    stored === 'zh' || stored === 'en' ? stored : prefersZh ? 'zh' : 'en';
  applyDocumentLang();
  return locale;
}

export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
