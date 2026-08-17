import {
  HdcClient,
  type HdcDeviceInfo,
  type HdcForward,
  type HdcUsbDevice,
} from '@webhdc/core';
import { AdbClient } from '../adb/client';
import type { AdbDeviceInfo } from '../adb/types';
import { DEVTOOLS_SOCKET_COMMAND } from '../devtools/discovery';
import type { DeviceStatusInfo } from './ui';

export type Platform = 'harmony' | 'android';

export interface DeviceExecOptions {
  timeout?: number;
}

export interface DeviceExecResult {
  stdout: string;
}

export interface DeviceForwardOptions {
  timeout?: number;
  highWaterMark?: number;
}

/**
 * 平台无关的设备客户端：HDC 与 ADB 实现同一套接口，调用方（连接、扫描、
 * 映射）不出现平台分支。UI 文案以消息 key 暴露，由 i18n 取词。
 */
export interface DeviceClient {
  readonly platform: Platform;
  /** 连接握手阶段的 UI 状态消息 key */
  readonly statusSessionKey: 'status.session.adb' | 'status.session.hdc';
  /** 扫描 WebView 调试 socket 的命令 */
  readonly scanCommand: string;
  /** 进程表命令，用于把 socket PID 解析为应用包名 */
  readonly processTableCommand: string;
  isSupported(): boolean;
  getDevices(): Promise<HdcUsbDevice[]>;
  requestDevice(): Promise<HdcUsbDevice>;
  /** 连接设备，返回用于状态展示的设备名与序列号 */
  connect(device?: HdcUsbDevice): Promise<DeviceStatusInfo>;
  disconnect(): Promise<void>;
  /** 当前已连接的 USB 设备，用于匹配 WebUSB disconnect 事件 */
  getDevice(): HdcUsbDevice | null;
  exec(command: string, options?: DeviceExecOptions): Promise<DeviceExecResult>;
  forward(remote: string, options?: DeviceForwardOptions): Promise<HdcForward>;
}

function hdcDeviceStatus(info: HdcDeviceInfo): DeviceStatusInfo {
  return {
    name: info.daemon?.name || info.productName || 'HarmonyOS',
    serial: info.serialNumber || '—',
  };
}

function adbDeviceStatus(info: AdbDeviceInfo): DeviceStatusInfo {
  return {
    name: info.banner.model || info.productName || 'Android',
    serial: info.serialNumber || '—',
  };
}

export function createHdcDeviceClient(): DeviceClient {
  const client = new HdcClient({
    logger(level, message, detail) {
      if (level === 'error') {
        console.error(`[hdc] ${message}`, detail ?? '');
      }
    },
  });
  return {
    platform: 'harmony',
    statusSessionKey: 'status.session.hdc',
    scanCommand: DEVTOOLS_SOCKET_COMMAND,
    processTableCommand: 'ps -ef',
    isSupported: () => HdcClient.isSupported(),
    getDevices: () => client.getDevices(),
    requestDevice: () => client.requestDevice(),
    connect: async (device) => hdcDeviceStatus(await client.connect(device)),
    disconnect: () => client.disconnect(),
    getDevice: () => client.device,
    exec: (command, options) => client.exec(command, options),
    forward: (remote, options) => client.forward(remote, options),
  };
}

export function createAdbDeviceClient(): DeviceClient {
  const client = new AdbClient({ appName: 'mobile-web-devtools' });
  return {
    platform: 'android',
    statusSessionKey: 'status.session.adb',
    scanCommand: 'cat /proc/net/unix',
    processTableCommand: 'ps -A -o PID,NAME',
    isSupported: () => AdbClient.isSupported(),
    getDevices: () => client.getDevices(),
    requestDevice: () => client.requestDevice(),
    connect: async (device) => adbDeviceStatus(await client.connect(device)),
    disconnect: () => client.disconnect(),
    getDevice: () => client.device,
    exec: (command, options) => client.exec(command, options),
    forward: (remote, options) => client.forward(remote, options),
  };
}
