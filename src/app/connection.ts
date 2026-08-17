import type { HdcUsbApi, HdcUsbDevice } from '@webhdc/core';
import {
  type DevtoolsSocket,
  parseDevtoolsSockets,
} from '../devtools/discovery';
import { AUTO_SCAN_MAX_ATTEMPTS, nextAutoScanDelay } from './autoscan';
import { DEVICE_USB_FILTERS, detectDevicePlatform, getUsbApi } from './detect';
import { $, formatError } from './dom';
import { onLocaleChange, t } from './i18n';
import {
  buildCmdlineBatchCommand,
  cleanTerminalText,
  normalizePackageName,
  parseCmdlineBatchOutput,
  parseProcessTable,
} from './packages';
import { currentClient, setPlatform, state } from './state';
import { applyTreePackages, renderTreeApps, setTreeScanPending } from './tree';
import {
  setBusy,
  setConnectLabel,
  setError,
  setStatusKey,
  showConnected,
  showDisconnected,
  syncConnectButton,
} from './ui';
import {
  closeMapped,
  hasMappedForward,
  invalidateMap,
  openSocket,
} from './viewer';

const SCAN_TIMEOUT = 15_000;
/** 连接期间后台重扫调试端口的间隔；让新打开应用的 socket 自动出现在下拉菜单。 */
const SOCKET_REFRESH_INTERVAL = 15_000;

let scanSequence = 0;
let scanning = false;
let lastSocketCount = 0;
let autoScanTimer: ReturnType<typeof setTimeout> | null = null;
let autoScanAttempts = 0;
let socketRefreshTimer: ReturnType<typeof setInterval> | null = null;

export async function connectDevice(): Promise<void> {
  if (state.connecting) {
    return;
  }
  setBusy(true);
  setError(null);
  setStatusKey('status.detecting', 'connecting');
  setConnectLabel(t('common.connecting'));
  try {
    const device = await pickUsbDevice();
    // 安卓走 ADB、鸿蒙走 HDC，按 USB 接口描述符自动识别，无需用户选择。
    const platform = await detectDevicePlatform(device);
    if (!platform) {
      throw new Error(t('error.unknownProtocol'));
    }
    setPlatform(platform);
    const client = currentClient();
    setStatusKey(client.statusSessionKey, 'connecting');
    const info = await client.connect(device);
    showConnected(info);
    await scanSockets();
    startSocketRefresh();
  } catch (error) {
    setStatusKey('status.failed', 'error');
    setError(formatError(error));
  } finally {
    setBusy(false);
    syncConnectButton();
  }
}

/**
 * 选取 USB 设备：已授权设备恰好一台时直接使用，否则弹出浏览器选择器。
 * 选择器过滤器同时包含 ADB 与 HDC 接口，两类设备都会列出。
 */
async function pickUsbDevice(): Promise<HdcUsbDevice> {
  const usb = getUsbApi();
  if (!usb) {
    throw new Error(t('support.noWebUsb'));
  }
  const authorized = await usb.getDevices();
  if (authorized.length === 1 && authorized[0]) {
    return authorized[0];
  }
  return usb.requestDevice({ filters: DEVICE_USB_FILTERS });
}

export async function disconnectDevice(): Promise<void> {
  scanSequence += 1;
  invalidateMap();
  clearAutoScan();
  stopSocketRefresh();
  await closeMapped();
  try {
    await currentClient().disconnect();
  } finally {
    showDisconnected();
  }
}

export function clearAutoScan(): void {
  if (autoScanTimer !== null) {
    clearTimeout(autoScanTimer);
    autoScanTimer = null;
  }
  autoScanAttempts = 0;
}

function scheduleAutoScan(): void {
  if (autoScanTimer !== null) {
    clearTimeout(autoScanTimer);
    autoScanTimer = null;
  }
  if (!state.connected || autoScanAttempts >= AUTO_SCAN_MAX_ATTEMPTS) {
    return;
  }
  const delay = nextAutoScanDelay(autoScanAttempts);
  autoScanAttempts += 1;
  autoScanTimer = setTimeout(() => {
    autoScanTimer = null;
    void scanSockets();
  }, delay);
}

function startSocketRefresh(): void {
  stopSocketRefresh();
  socketRefreshTimer = setInterval(() => {
    if (!state.connected || scanning || document.hidden) {
      return;
    }
    void scanSockets({ quiet: true });
  }, SOCKET_REFRESH_INTERVAL);
}

function stopSocketRefresh(): void {
  if (socketRefreshTimer !== null) {
    clearInterval(socketRefreshTimer);
    socketRefreshTimer = null;
  }
}

/**
 * 扫描调试端口。quiet 模式供后台定时刷新使用：不动扫描按钮和提示
 * 文案、失败时保留现有下拉列表、也不参与自动重试调度，避免打断
 * 正在进行的调试。
 */
export async function scanSockets({
  quiet = false,
}: {
  quiet?: boolean;
} = {}): Promise<void> {
  if (!state.connected || scanning) {
    return;
  }
  scanning = true;
  const sequence = ++scanSequence;
  const client = currentClient();
  const scanButton = $('scan-button') as HTMLButtonElement;
  if (!quiet) {
    scanButton.disabled = true;
    scanButton.textContent = t('scan.scanning');
    setTreeScanPending();
    setError(null);
  }
  try {
    const result = await client.exec(client.scanCommand, {
      timeout: SCAN_TIMEOUT,
    });
    const sockets = parseDevtoolsSockets(cleanTerminalText(result.stdout));
    if (sequence === scanSequence) {
      lastSocketCount = sockets.length;
      renderTreeApps(sockets);
      void resolveSocketPackages(sockets, sequence);
      // 默认展开：尚未映射任何应用时自动打开第一个 socket，
      // 让树直接展开页面列表并加载 DevTools。
      const first = sockets[0];
      if (first && !hasMappedForward()) {
        openSocket(first);
      }
    }
  } catch (error) {
    if (sequence === scanSequence) {
      if (!quiet) {
        lastSocketCount = 0;
        renderTreeApps([]);
        setError(t('error.scanFailed', { error: formatError(error) }));
      }
    }
  } finally {
    scanning = false;
    if (!quiet && sequence === scanSequence) {
      scanButton.disabled = !state.connected;
      scanButton.textContent = t('scan.rescan');
      // 连接后 WebView 调试 socket 可能晚于设备会话就绪；没有结果时自动重试。
      if (state.connected && lastSocketCount === 0 && !hasMappedForward()) {
        scheduleAutoScan();
      } else {
        autoScanAttempts = 0;
      }
    }
  }
}

async function resolveSocketPackages(
  sockets: DevtoolsSocket[],
  sequence: number,
): Promise<void> {
  const client = currentClient();
  const pids = [
    ...new Set(
      sockets
        .map((socket) => socket.pid)
        .filter((pid): pid is string => Boolean(pid)),
    ),
  ];
  if (pids.length === 0) {
    return;
  }

  const packages = new Map<string, string>();
  try {
    const result = await client.exec(client.processTableCommand, {
      timeout: SCAN_TIMEOUT,
    });
    for (const [pid, name] of parseProcessTable(result.stdout)) {
      packages.set(pid, name);
    }
  } catch {
    // 进程表读取失败时退回 /proc/<pid>/cmdline。
  }

  const missing = pids.filter((pid) => {
    const rawName = packages.get(pid);
    if (!rawName) {
      return true;
    }
    const packageName = normalizePackageName(rawName);
    if (packageName.includes('.')) {
      return false;
    }
    // 进程表里可能是 appspawn / zygote 这类通用名，继续用 cmdline 找包名。
    packages.delete(pid);
    return true;
  });
  if (missing.length > 0) {
    // 一次 exec 批量读取所有缺失 PID 的 cmdline，避免 N 次 USB 往返。
    try {
      const result = await client.exec(buildCmdlineBatchCommand(missing), {
        timeout: SCAN_TIMEOUT,
      });
      for (const [pid, name] of parseCmdlineBatchOutput(
        cleanTerminalText(result.stdout),
      )) {
        packages.set(pid, name);
      }
    } catch {
      // 批量读取失败时保留 WebView · PID 展示。
    }
  }

  if (sequence !== scanSequence) {
    return;
  }
  applyTreePackages(packages);
}

/** lib.dom 不含 WebUSB 类型；按 HdcUsbApi 的结构最小化声明事件接口。 */
interface UsbDisconnectEvent {
  device: HdcUsbDevice;
}

type UsbEventSource = EventTarget & {
  addEventListener(
    type: 'disconnect',
    listener: (event: UsbDisconnectEvent) => void,
  ): void;
};

function getUsbEventSource(): UsbEventSource | null {
  const usb = (globalThis.navigator as Navigator & { usb?: HdcUsbApi }).usb;
  // 事件监听需要 lib.dom 之外的 WebUSB 事件类型，结构化断言一次。
  return usb ? (usb as unknown as UsbEventSource) : null;
}

function isSameDevice(
  active: HdcUsbDevice | null,
  incoming: HdcUsbDevice,
): boolean {
  if (!active) {
    return false;
  }
  if (active === incoming) {
    return true;
  }
  if (active.serialNumber && incoming.serialNumber) {
    return active.serialNumber === incoming.serialNumber;
  }
  return (
    active.vendorId === incoming.vendorId &&
    active.productId === incoming.productId
  );
}

/**
 * 监听 WebUSB 拔线事件：不监听时拔线后 UI 会停留在“已连接”，直到下一次
 * 操作失败才暴露。仅在断开的设备就是当前连接设备时主动清理状态。
 */
export function initUsbDisconnectListener(): void {
  const usb = getUsbEventSource();
  if (!usb) {
    return;
  }
  usb.addEventListener('disconnect', (event) => {
    if (!state.connected) {
      return;
    }
    if (!isSameDevice(currentClient().getDevice(), event.device)) {
      return;
    }
    void disconnectDevice()
      .then(() => {
        setError(t('error.usbDisconnected'));
      })
      .catch(() => {
        // 断开清理失败时状态已由 disconnectDevice 复位，忽略。
      });
  });
}

onLocaleChange(() => {
  // 扫描按钮文案随语言刷新；扫描进行中保持“扫描中…”。
  const scanButton = $('scan-button') as HTMLButtonElement;
  scanButton.textContent = scanning ? t('scan.scanning') : t('scan.rescan');
});
