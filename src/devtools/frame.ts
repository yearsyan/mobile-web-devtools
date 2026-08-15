import type { MessageKey } from '../app/i18n';
import type { FrontendSource } from './frontend-source';
import {
  buildFrontendCandidates,
  isAllowedAssetUrl,
  OFFICIAL_FETCH_TIMEOUT_MS,
  OFFICIAL_FRONTEND_HOST,
} from './frontend-source';

interface FrameInitMessage {
  type: 'webhdc-devtools-init';
  frontendUrl: string;
}

interface ParentMessage {
  type: string;
  id?: string;
  data?: unknown;
  code?: number;
  reason?: string;
  wasClean?: boolean;
  message?: string;
}

type EventHandler<T extends Event> =
  | ((this: MessageChannelWebSocket, event: T) => unknown)
  | null;

let bridgePort: MessagePort | null = null;
const sockets = new Map<string, MessageChannelWebSocket>();

/** frontend 加载阶段与手动切换请求，用于中断官方源的尝试。 */
let frontendPhase: 'idle' | 'loading' | 'done' = 'idle';
let switchToLocal = false;
let activeOfficialFetch: AbortController | null = null;

/** 收到父页面请求：放弃官方源，立即改用本地内置副本。 */
function requestLocalFrontend(): void {
  if (frontendPhase !== 'loading' || switchToLocal) {
    return;
  }
  switchToLocal = true;
  activeOfficialFetch?.abort();
}

function post(
  message: Record<string, unknown>,
  transfer: Transferable[] = [],
): void {
  bridgePort?.postMessage(message, transfer);
}

function normalizeProtocols(protocols?: string | string[]): string[] {
  if (protocols === undefined) {
    return [];
  }
  return Array.isArray(protocols) ? [...protocols] : [protocols];
}

function copyBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input.slice(0);
  }
  return input.buffer.slice(
    input.byteOffset,
    input.byteOffset + input.byteLength,
  ) as ArrayBuffer;
}

class MessageChannelWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = MessageChannelWebSocket.CONNECTING;
  readonly OPEN = MessageChannelWebSocket.OPEN;
  readonly CLOSING = MessageChannelWebSocket.CLOSING;
  readonly CLOSED = MessageChannelWebSocket.CLOSED;
  readonly url: string;
  readonly extensions = '';
  readonly protocol = '';
  readonly #id: string;
  readonly #protocols: string[];
  readyState = MessageChannelWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = 'blob';
  onopen: EventHandler<Event> = null;
  onmessage: EventHandler<MessageEvent> = null;
  onerror: EventHandler<Event> = null;
  onclose: EventHandler<CloseEvent> = null;
  #sendQueue = Promise.resolve();

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    if (!bridgePort) {
      throw new DOMException('WebHDC bridge 尚未初始化', 'InvalidStateError');
    }
    this.url = new URL(url, window.location.href).href;
    this.#protocols = normalizeProtocols(protocols);
    this.#id = crypto.randomUUID();
    sockets.set(this.#id, this);
    post({
      type: 'ws-connect',
      id: this.#id,
      url: this.url,
      protocols: this.#protocols,
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== MessageChannelWebSocket.OPEN) {
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    }
    const size =
      typeof data === 'string'
        ? new TextEncoder().encode(data).byteLength
        : data instanceof Blob
          ? data.size
          : ArrayBuffer.isView(data)
            ? data.byteLength
            : data.byteLength;
    this.bufferedAmount += size;
    this.#sendQueue = this.#sendQueue
      .then(async () => {
        if (typeof data === 'string') {
          post({ type: 'ws-send', id: this.#id, data });
        } else {
          const buffer =
            data instanceof Blob
              ? await data.arrayBuffer()
              : copyBuffer(data as ArrayBuffer | ArrayBufferView);
          post({ type: 'ws-send', id: this.#id, data: buffer }, [buffer]);
        }
      })
      .catch((error: unknown) =>
        this.receiveError(
          error instanceof Error ? error.message : String(error),
        ),
      )
      .finally(() => {
        this.bufferedAmount = Math.max(0, this.bufferedAmount - size);
      });
  }

  close(code = 1000, reason = ''): void {
    if (
      this.readyState === MessageChannelWebSocket.CLOSING ||
      this.readyState === MessageChannelWebSocket.CLOSED
    ) {
      return;
    }
    if (code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException(
        'Invalid WebSocket close code',
        'InvalidAccessError',
      );
    }
    if (new TextEncoder().encode(reason).byteLength > 123) {
      throw new DOMException(
        'WebSocket close reason is too long',
        'SyntaxError',
      );
    }
    this.readyState = MessageChannelWebSocket.CLOSING;
    void this.#sendQueue.then(() =>
      post({ type: 'ws-close', id: this.#id, code, reason }),
    );
  }

  receiveOpen(): void {
    if (this.readyState !== MessageChannelWebSocket.CONNECTING) {
      return;
    }
    this.readyState = MessageChannelWebSocket.OPEN;
    this.emit(new Event('open'), this.onopen);
  }

  receiveMessage(data: unknown): void {
    if (this.readyState !== MessageChannelWebSocket.OPEN) {
      return;
    }
    let eventData = data;
    if (data instanceof ArrayBuffer) {
      eventData = this.binaryType === 'arraybuffer' ? data : new Blob([data]);
    }
    this.emit(new MessageEvent('message', { data: eventData }), this.onmessage);
  }

  receiveError(message: string): void {
    console.error(`[webhdc-devtools] ${message}`);
    this.emit(new Event('error'), this.onerror);
  }

  receiveClose(code: number, reason: string, wasClean: boolean): void {
    if (this.readyState === MessageChannelWebSocket.CLOSED) {
      return;
    }
    this.readyState = MessageChannelWebSocket.CLOSED;
    sockets.delete(this.#id);
    this.emit(
      new CloseEvent('close', { code, reason, wasClean }),
      this.onclose,
    );
  }

  private emit<T extends Event>(event: T, handler: EventHandler<T>): void {
    try {
      handler?.call(this, event);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
    this.dispatchEvent(event);
  }
}

function receiveParentMessage(value: unknown): void {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return;
  }
  const message = value as ParentMessage;
  if (message.type === 'frontend-prefer-local') {
    requestLocalFrontend();
    return;
  }
  if (typeof message.id !== 'string') {
    return;
  }
  const socket = sockets.get(message.id);
  if (!socket) {
    return;
  }
  if (message.type === 'ws-open') {
    socket.receiveOpen();
  } else if (message.type === 'ws-message') {
    socket.receiveMessage(message.data);
  } else if (message.type === 'ws-error') {
    socket.receiveError(message.message ?? 'WebHDC WebSocket bridge error');
  } else if (message.type === 'ws-close') {
    socket.receiveClose(
      message.code ?? 1006,
      message.reason ?? '',
      message.wasClean ?? false,
    );
  }
}

function installWebSocketBridge(port: MessagePort): void {
  bridgePort = port;
  port.onmessage = (event: MessageEvent<unknown>) =>
    receiveParentMessage(event.data);
  port.start();
  Object.defineProperty(window, 'WebSocket', {
    configurable: true,
    writable: true,
    value: MessageChannelWebSocket,
  });
}

/** 让官方远端 ES module worker 通过同源 blob 壳启动。 */
function installCrossOriginWorkerBridge(): void {
  const NativeWorker = window.Worker;
  class CrossOriginWorker extends NativeWorker {
    constructor(scriptURL: string | URL, options: WorkerOptions = {}) {
      const resolved = new URL(scriptURL, document.baseURI);
      if (
        resolved.origin === window.location.origin ||
        resolved.protocol === 'blob:' ||
        resolved.protocol === 'data:' ||
        resolved.hostname !== OFFICIAL_FRONTEND_HOST
      ) {
        super(resolved, options);
        return;
      }
      const source =
        options.type === 'module'
          ? `import ${JSON.stringify(resolved.href)};`
          : `importScripts(${JSON.stringify(resolved.href)});`;
      const blobUrl = URL.createObjectURL(
        new Blob([source], { type: 'text/javascript' }),
      );
      super(blobUrl, options);
      const release = () => URL.revokeObjectURL(blobUrl);
      this.addEventListener('message', release, { once: true });
      this.addEventListener('error', release, { once: true });
      window.setTimeout(release, 60_000);
    }
  }
  Object.defineProperty(window, 'Worker', {
    configurable: true,
    writable: true,
    value: CrossOriginWorker,
  });
}

/** frontend 子资源只允许官方 host（https）或同源内置副本。 */
function resolveFrontendAsset(raw: string, base: URL): string {
  const asset = isAllowedAssetUrl(raw, base, window.location.origin);
  if (!asset) {
    throw new Error(`DevTools frontend 引用了非官方/非同源资源：${raw}`);
  }
  return asset.href;
}

function bootstrapElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#webhdc-bootstrap');
}

async function loadFrontend(rawUrl: string): Promise<void> {
  post({ type: 'frontend-loading' });
  const { frontendUrl, html, source } = await fetchFrontendEntry(rawUrl);
  if (source !== 'preferred') {
    const reason =
      source === 'local'
        ? '官方 frontend 不可达，使用内置副本'
        : '设备版本 frontend 不可用，切换到 Chromium 官方兼容版本';
    console.warn(`[webhdc-devtools] ${reason}`);
    const key: MessageKey =
      source === 'local'
        ? 'bridge.frontendLocalFallback'
        : 'bridge.frontendCompatFallback';
    post({ type: 'frontend-fallback', key });
  }
  await warmCriticalFrontendAssets(frontendUrl);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts = [
    ...parsed.querySelectorAll<HTMLScriptElement>('script[src]'),
  ];
  if (scripts.length === 0) {
    throw new Error('DevTools frontend 入口中没有可加载的脚本');
  }

  const base = document.createElement('base');
  base.href = new URL('.', frontendUrl).href;
  document.head.prepend(base);
  document.title = parsed.title || 'DevTools';

  for (const sourceStyle of parsed.querySelectorAll<HTMLStyleElement>(
    'style',
  )) {
    const style = document.createElement('style');
    style.textContent = sourceStyle.textContent;
    document.head.append(style);
  }
  for (const sourceLink of parsed.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"][href]',
  )) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = resolveFrontendAsset(
      sourceLink.getAttribute('href') ?? '',
      frontendUrl,
    );
    document.head.append(link);
  }

  const parsedBody = parsed.body;
  document.body.className = parsedBody.className || 'undocked';
  document.body.id = parsedBody.id || '-blink-dev-tools';
  bootstrapElement()?.remove();

  await Promise.all(
    scripts.map(
      (sourceScript) =>
        new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.type = sourceScript.type || 'text/javascript';
          script.src = resolveFrontendAsset(
            sourceScript.getAttribute('src') ?? '',
            frontendUrl,
          );
          script.referrerPolicy = 'no-referrer';
          script.onload = () => resolve();
          script.onerror = () =>
            reject(new Error(`加载 DevTools 脚本失败：${script.src}`));
          document.head.append(script);
        }),
    ),
  );
  post({ type: 'frontend-ready' });
}

/**
 * DevTools 会给 locale 请求设置很短的超时。先在模块图开始并发下载前填充
 * HTTP cache，避免远端 serve_rev 连接繁忙时 locale 初始化直接失败。
 */
async function warmCriticalFrontendAssets(frontendUrl: URL): Promise<void> {
  const localeUrl = new URL(
    'core/i18n/locales/en-US.json',
    new URL('.', frontendUrl),
  );
  try {
    const response = await fetch(localeUrl, {
      cache: 'force-cache',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await response.arrayBuffer();
  } catch (error) {
    console.warn(
      '[webhdc-devtools] 预取 en-US locale 失败，将由 frontend 重试',
      error,
    );
  }
}

interface FrontendEntry {
  frontendUrl: URL;
  html: string;
  source: FrontendSource;
}

/** 依次尝试候选链：设备 revision → 固定兼容版 → 本地内置副本。 */
async function fetchFrontendEntry(preferred: string): Promise<FrontendEntry> {
  const candidates = buildFrontendCandidates(preferred, window.location.origin);
  const failures: string[] = [];
  let localFailed = false;

  for (const candidate of candidates) {
    if (switchToLocal && candidate.source !== 'local') {
      continue;
    }
    try {
      const html = await fetchEntryHtml(
        candidate.url,
        candidate.source === 'local',
      );
      return { frontendUrl: candidate.url, html, source: candidate.source };
    } catch (error) {
      if (switchToLocal) {
        continue;
      }
      failures.push(
        `${candidate.url.href}：${error instanceof Error ? error.message : String(error)}`,
      );
      if (candidate.source === 'local') {
        localFailed = true;
      }
    }
  }

  const hint = localFailed
    ? '；内置副本缺失时请先运行 pnpm run fetch:devtools 下载'
    : '';
  throw new Error(
    `下载 DevTools frontend 入口失败：${failures.join('；')}${hint}`,
  );
}

async function fetchEntryHtml(url: URL, isLocal: boolean): Promise<string> {
  const response = await fetchWithTimeout(
    url,
    isLocal ? 0 : OFFICIAL_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

/** 挂起的连接必须主动 abort，否则官方源不可达时要等到系统级超时。 */
async function fetchWithTimeout(
  url: URL,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  }
  const controller = new AbortController();
  activeOfficialFetch = controller;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
  } catch (error) {
    if (switchToLocal) {
      throw new Error('已切换到内置副本');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`连接超时（>${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    if (activeOfficialFetch === controller) {
      activeOfficialFetch = null;
    }
  }
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[webhdc-devtools] DevTools frontend 启动失败', error);
  const element =
    bootstrapElement() ??
    document.body.appendChild(document.createElement('pre'));
  element.id = 'webhdc-bootstrap';
  element.dataset.error = 'true';
  element.textContent = `DevTools frontend 启动失败\n${message}`;
  post({ type: 'frontend-error', message });
}

function isInitMessage(value: unknown): value is FrameInitMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'webhdc-devtools-init' &&
    'frontendUrl' in value &&
    typeof value.frontendUrl === 'string'
  );
}

function initialize(event: MessageEvent<unknown>): void {
  if (
    event.source !== window.parent ||
    event.origin !== window.location.origin ||
    !isInitMessage(event.data) ||
    !event.ports[0]
  ) {
    return;
  }
  window.removeEventListener('message', initialize);
  installWebSocketBridge(event.ports[0]);
  installCrossOriginWorkerBridge();
  post({ type: 'frame-ready' });
  frontendPhase = 'loading';
  loadFrontend(event.data.frontendUrl)
    .catch(showError)
    .finally(() => {
      frontendPhase = 'done';
    });
}

window.addEventListener('message', initialize);
