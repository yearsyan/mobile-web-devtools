import {
  HdcError,
  type HdcExecOptions,
  type HdcExecResult,
  HdcForward,
  type HdcForwardOptions,
  HdcForwardStream,
  type HdcMessage,
  HdcTimeoutError,
  type HdcUsbApi,
  type HdcUsbDevice,
  parseForwardEndpoint,
} from '@webhdc/core';
import {
  Adb,
  type AdbCredentialStore,
  AdbDaemonTransport,
  type AdbSocket,
} from '@yume-chan/adb';
import { joinBytes } from '../utils/bytes';
import { withTimeout } from '../utils/timeout';
import { ADB_USB_FILTERS } from './constants';
import { AdbWebCredentialStore } from './credential-store';
import type { AdbDeviceInfo } from './types';
import { AdbWebUsbConnection } from './usb-transport';

const DEFAULT_EXEC_TIMEOUT = 30_000;
const DEFAULT_FORWARD_TIMEOUT = 30_000;
const DEFAULT_FORWARD_HIGH_WATER_MARK = 32 * 1024 * 1024;
const DEFAULT_AUTH_TIMEOUT = 120_000;

export interface AdbClientOptions {
  usb?: HdcUsbApi;
  credentialStore?: AdbCredentialStore;
  appName?: string;
  authTimeout?: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface InternalStream {
  contextId: number;
  remote: string;
  socket: AdbSocket;
  state: 'open' | 'closed';
  closeError: Error | null;
  closed: Deferred<void>;
  wrapper: HdcForwardStream | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  chunks: Uint8Array[];
  buffered: number;
  highWaterMark: number;
  dataListeners: Set<(data: Uint8Array) => void>;
  closeListeners: Set<(error: Error | null) => void>;
  errorListeners: Set<(error: Error) => void>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withTimeoutError(message: string): Error {
  return new HdcTimeoutError(message);
}

async function ignoreClose(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch {
    // Close failures are non-fatal.
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function makeDeviceInfo(
  device: HdcUsbDevice,
  transport: AdbDaemonTransport,
  interfaceInfo: AdbWebUsbConnection['interfaceInfo'],
): AdbDeviceInfo {
  const banner = transport.banner;
  return {
    serialNumber: device.serialNumber ?? '',
    manufacturerName: device.manufacturerName ?? '',
    productName: device.productName ?? '',
    vendorId: device.vendorId,
    productId: device.productId,
    vendorIdHex: `0x${device.vendorId.toString(16).padStart(4, '0')}`,
    productIdHex: `0x${device.productId.toString(16).padStart(4, '0')}`,
    interface: { ...interfaceInfo },
    banner: {
      product: banner.product ?? '',
      model: banner.model ?? '',
      device: banner.device ?? '',
      features: [...banner.features],
    },
    protocolVersion: transport.protocolVersion,
  };
}

function isAdbDevice(device: HdcUsbDevice): boolean {
  if (!device.configuration) {
    // 未 open 的 USBDevice 可能还没有 configuration，交给 connect 后再校验。
    return true;
  }
  return device.configuration.interfaces.some((usbInterface) =>
    usbInterface.alternates.some(
      (alternate) =>
        alternate.interfaceClass === ADB_USB_FILTERS[0]?.classCode &&
        alternate.interfaceSubclass === ADB_USB_FILTERS[0]?.subclassCode &&
        alternate.interfaceProtocol === ADB_USB_FILTERS[0]?.protocolCode,
    ),
  );
}

/**
 * Android ADB-over-WebUSB client exposing the CDP path only:
 * `exec` for `/proc/net/unix` discovery and `forward` returning the exact
 * `HdcForward` / `HdcForwardStream` types from `@webhdc/core`.
 */
export class AdbClient {
  #usb?: HdcUsbApi;
  #credentialStore: AdbCredentialStore;
  #authTimeout: number;
  #adb: Adb | null = null;
  #connection: AdbWebUsbConnection | null = null;
  #device: HdcUsbDevice | null = null;
  #deviceInfo: AdbDeviceInfo | null = null;
  #connected = false;
  #connecting = false;
  #nextForwardId = 1;
  #nextStreamId = 1;
  #streams = new Set<InternalStream>();

  constructor({
    usb,
    credentialStore,
    appName = 'mobile-web-devtools',
    authTimeout = DEFAULT_AUTH_TIMEOUT,
  }: AdbClientOptions = {}) {
    this.#usb = usb;
    this.#credentialStore =
      credentialStore ?? new AdbWebCredentialStore(appName);
    this.#authTimeout = authTimeout;
  }

  static isSupported(usb?: HdcUsbApi): boolean {
    return (
      typeof (
        usb ?? (globalThis.navigator as Navigator & { usb?: HdcUsbApi }).usb
      ) !== 'undefined'
    );
  }

  get connected(): boolean {
    return this.#connected;
  }

  get connecting(): boolean {
    return this.#connecting;
  }

  get device(): HdcUsbDevice | null {
    return this.#device;
  }

  get deviceInfo(): AdbDeviceInfo | null {
    return this.#deviceInfo;
  }

  async requestDevice(): Promise<HdcUsbDevice> {
    return this.#resolveUsb().requestDevice({ filters: [...ADB_USB_FILTERS] });
  }

  async getDevices(): Promise<HdcUsbDevice[]> {
    return (await this.#resolveUsb().getDevices()).filter(isAdbDevice);
  }

  async connect(device?: HdcUsbDevice): Promise<AdbDeviceInfo> {
    if (this.#connected) {
      if (!this.#deviceInfo) {
        throw new HdcError('ADB 已连接但缺少设备信息', {
          code: 'ADB_INVALID_STATE',
        });
      }
      return this.#deviceInfo;
    }
    if (this.#connecting) {
      throw new HdcError('ADB 正在连接中', { code: 'ADB_CONNECTING' });
    }
    if (!device) {
      const devices = await this.getDevices();
      if (devices.length !== 1) {
        throw new HdcError(
          devices.length === 0
            ? '没有已授权的 Android ADB USB 设备，请先调用 requestDevice()'
            : '存在多个已授权的 ADB 设备，请明确传入 USBDevice',
          { code: 'USB_DEVICE_REQUIRED' },
        );
      }
      [device] = devices;
    }

    this.#connecting = true;
    try {
      const connection = await AdbWebUsbConnection.open(device);
      this.#connection = connection;
      this.#device = device;
      const transport = await withTimeout(
        AdbDaemonTransport.authenticate({
          serial: device.serialNumber ?? '',
          connection: connection.daemonConnection,
          credentialStore: this.#credentialStore,
        }),
        this.#authTimeout,
        '等待 Android 设备 ADB 授权超时，请在设备上确认“允许 USB 调试”',
        withTimeoutError,
      );
      this.#adb = new Adb(transport);
      const info = makeDeviceInfo(device, transport, connection.interfaceInfo);
      this.#deviceInfo = info;
      this.#connected = true;
      return info;
    } catch (error) {
      await this.#connection?.close().catch(() => {});
      this.#connection = null;
      this.#device = null;
      this.#adb = null;
      this.#deviceInfo = null;
      throw error;
    } finally {
      this.#connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#connecting = false;
    for (const stream of [...this.#streams]) {
      this.#settleStream(
        stream,
        new HdcError('ADB 会话已主动断开', { code: 'ADB_DISCONNECTED' }),
      );
    }
    this.#streams.clear();
    if (this.#adb) {
      await ignoreClose(() => this.#adb?.close());
    }
    await this.#connection?.close().catch(() => {});
    this.#adb = null;
    this.#connection = null;
    this.#device = null;
    this.#deviceInfo = null;
  }

  /**
   * 执行命令。走 legacy `shell:` 服务（`/system/bin/sh -c`）而非 `exec:`，
   * 以便使用管道 / for 循环等 shell 语法；stdout/stderr 会合并，调用方
   * 需容忍 stderr 混入。
   */
  async exec(
    command: string,
    { timeout = DEFAULT_EXEC_TIMEOUT, signal }: HdcExecOptions = {},
  ): Promise<HdcExecResult> {
    this.#assertConnected();
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new HdcError('操作已取消');
    }
    const socket = await withTimeout(
      this.#createSocket(`shell:${command}`),
      timeout,
      `启动 ADB 命令超时：${command}`,
      withTimeoutError,
    );
    const chunks: Uint8Array[] = [];
    const reader = socket.readable.getReader();
    const readAll = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    })();
    try {
      await withTimeout(
        readAll,
        timeout,
        `ADB 命令执行超时：${command}`,
        withTimeoutError,
      );
    } catch (error) {
      await ignoreClose(() => socket.close());
      throw error;
    }
    const data = joinBytes(chunks);
    return {
      channelId: this.#nextStreamId++,
      stdout: decodeUtf8(data),
      data,
      messages: [] satisfies HdcMessage[],
    };
  }

  async forward(
    remote: string,
    {
      timeout = DEFAULT_FORWARD_TIMEOUT,
      signal,
      highWaterMark = DEFAULT_FORWARD_HIGH_WATER_MARK,
    }: HdcForwardOptions = {},
  ): Promise<HdcForward> {
    this.#assertConnected();
    parseForwardEndpoint(remote);
    const channelId = this.#nextForwardId++;
    const streams = new Set<InternalStream>();
    const closed = deferred<void>();
    let finished = false;

    const finish = (reason: unknown): void => {
      if (finished) {
        return;
      }
      finished = true;
      const error =
        reason instanceof Error ? reason : new HdcError('ADB forward 已关闭');
      for (const stream of streams) {
        this.#settleStream(stream, error);
      }
      closed.resolve();
    };

    return new HdcForward({
      channelId,
      remote,
      closed: closed.promise,
      accept: async () => {
        if (finished || !this.#connected) {
          throw new HdcError('ADB forward 已关闭', {
            code: 'ADB_FORWARD_CLOSED',
          });
        }
        if (signal?.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new HdcError('操作已取消');
        }
        const socket = await withTimeout(
          this.#createSocket(remote),
          timeout,
          `连接 ${remote} 超时`,
          withTimeoutError,
        );
        if (finished) {
          await ignoreClose(() => socket.close());
          throw new HdcError('ADB forward 已关闭', {
            code: 'ADB_FORWARD_CLOSED',
          });
        }
        const stream = this.#createStream(socket, remote, highWaterMark);
        streams.add(stream);
        void stream.closed.promise.then(() => {
          streams.delete(stream);
          this.#streams.delete(stream);
        });
        const wrapper = stream.wrapper;
        if (!wrapper) {
          throw new HdcError('ADB forward 流初始化失败', {
            code: 'ADB_FORWARD_FAILED',
          });
        }
        return wrapper;
      },
      close: async () => {
        finish(undefined);
        await Promise.all(
          [...streams].map((stream) => this.#closeStream(stream, null)),
        );
      },
    });
  }

  async #createSocket(service: string): Promise<AdbSocket> {
    const adb = this.#adb;
    if (!adb) {
      throw new HdcError('ADB 尚未连接', { code: 'ADB_DISCONNECTED' });
    }
    return adb.createSocket(service);
  }

  #createStream(
    socket: AdbSocket,
    remote: string,
    highWaterMark: number,
  ): InternalStream {
    const stream: InternalStream = {
      contextId: this.#nextStreamId++,
      remote,
      socket,
      state: 'open',
      closeError: null,
      closed: deferred<void>(),
      wrapper: null,
      writer: null,
      chunks: [],
      buffered: 0,
      highWaterMark: Math.max(0, highWaterMark),
      dataListeners: new Set(),
      closeListeners: new Set(),
      errorListeners: new Set(),
    };
    stream.writer =
      socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
    stream.wrapper = new HdcForwardStream({
      contextId: stream.contextId,
      remote,
      closed: stream.closed.promise,
      write: (data) => this.#writeStream(stream, data),
      close: () => this.#closeStream(stream, null),
      onData: (listener) => {
        stream.dataListeners.add(listener);
        this.#flushStream(stream);
        return () => stream.dataListeners.delete(listener);
      },
      onClose: (listener) => {
        stream.closeListeners.add(listener);
        if (stream.state === 'closed') {
          queueMicrotask(() => listener(stream.closeError));
        }
        return () => stream.closeListeners.delete(listener);
      },
      onError: (listener) => {
        stream.errorListeners.add(listener);
        return () => stream.errorListeners.delete(listener);
      },
    });
    this.#streams.add(stream);
    void this.#readSocketLoop(stream);
    return stream;
  }

  async #readSocketLoop(stream: InternalStream): Promise<void> {
    const reader = stream.socket.readable.getReader();
    try {
      while (stream.state === 'open') {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        this.#deliverStreamData(stream, value);
      }
      if (stream.state === 'open') {
        this.#settleStream(stream, null);
      }
    } catch (error) {
      this.#failStream(
        stream,
        error instanceof Error
          ? error
          : new HdcError(String(error), { code: 'ADB_STREAM_ERROR' }),
      );
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The stream may already be released while disconnecting.
      }
    }
  }

  #deliverStreamData(stream: InternalStream, data: Uint8Array): void {
    if (stream.state === 'closed') {
      return;
    }
    if (stream.dataListeners.size > 0 && stream.chunks.length === 0) {
      for (const listener of [...stream.dataListeners]) {
        try {
          listener(data);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
      return;
    }
    if (
      stream.highWaterMark > 0 &&
      stream.buffered + data.byteLength > stream.highWaterMark
    ) {
      const error = new HdcError(
        `ADB forward 流接收缓冲超过 ${stream.highWaterMark} 字节`,
        {
          code: 'ADB_FORWARD_OVERFLOW',
        },
      );
      void this.#failStream(stream, error);
      return;
    }
    stream.chunks.push(data);
    stream.buffered += data.byteLength;
  }

  #flushStream(stream: InternalStream): void {
    while (stream.chunks.length > 0 && stream.dataListeners.size > 0) {
      const data = stream.chunks.shift();
      if (!data) {
        break;
      }
      stream.buffered -= data.byteLength;
      for (const listener of [...stream.dataListeners]) {
        try {
          listener(data);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    }
  }

  async #writeStream(
    stream: InternalStream,
    data: Uint8Array,
  ): Promise<number> {
    if (stream.state === 'closed') {
      throw new HdcError('ADB forward 流已关闭', {
        code: 'ADB_FORWARD_CLOSED',
      });
    }
    await stream.writer?.write(data);
    return data.byteLength;
  }

  async #closeStream(
    stream: InternalStream,
    error: Error | null,
  ): Promise<void> {
    if (stream.state === 'closed') {
      return;
    }
    if (error) {
      this.#failStream(stream, error);
      return;
    }
    await ignoreClose(() => stream.socket.close());
    if (stream.state === 'open') {
      this.#settleStream(stream, null);
    }
  }

  #failStream(stream: InternalStream, error: Error): void {
    if (stream.state === 'closed') {
      return;
    }
    void ignoreClose(() => stream.socket.close());
    this.#settleStream(stream, error);
  }

  #settleStream(stream: InternalStream, error: Error | null): void {
    if (stream.state === 'closed') {
      return;
    }
    stream.state = 'closed';
    stream.closeError = error;
    stream.chunks = [];
    stream.buffered = 0;
    if (error) {
      for (const listener of [...stream.errorListeners]) {
        try {
          listener(error);
        } catch (caught) {
          queueMicrotask(() => {
            throw caught;
          });
        }
      }
    }
    for (const listener of [...stream.closeListeners]) {
      try {
        listener(error);
      } catch (caught) {
        queueMicrotask(() => {
          throw caught;
        });
      }
    }
    stream.closed.resolve();
  }

  #resolveUsb(): HdcUsbApi {
    const usb =
      this.#usb ??
      (globalThis.navigator as Navigator & { usb?: HdcUsbApi }).usb;
    if (!usb) {
      throw new HdcError('当前浏览器不支持 WebUSB', {
        code: 'USB_UNSUPPORTED',
      });
    }
    return usb;
  }

  #assertConnected(): void {
    if (!this.#connected || !this.#adb) {
      throw new HdcError('请先连接 ADB 设备', { code: 'ADB_DISCONNECTED' });
    }
  }
}
