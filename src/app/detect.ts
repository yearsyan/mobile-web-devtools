import {
  HDC_USB_INTERFACE,
  type HdcUsbApi,
  type HdcUsbDevice,
} from '@webhdc/core';
import { ADB_USB_INTERFACE } from '../adb/constants';
import type { Platform } from './device-client';

/**
 * requestDevice 过滤器：同时接受 Android（ADB，0xFF/0x42/0x01）与
 * HarmonyOS（HDC，0xFF/0x50/0x01）设备，浏览器选择器会列出两类设备。
 */
export const DEVICE_USB_FILTERS = Object.freeze([
  ADB_USB_INTERFACE,
  HDC_USB_INTERFACE,
]);

interface UsbInterfaceSignature {
  classCode: number;
  subclassCode: number;
  protocolCode: number;
}

function hasInterface(
  device: HdcUsbDevice,
  signature: UsbInterfaceSignature,
): boolean {
  return (device.configuration?.interfaces ?? []).some((usbInterface) =>
    usbInterface.alternates.some(
      (alternate) =>
        alternate.interfaceClass === signature.classCode &&
        alternate.interfaceSubclass === signature.subclassCode &&
        alternate.interfaceProtocol === signature.protocolCode,
    ),
  );
}

/**
 * 从 USB 描述符识别调试协议：鸿蒙走 HDC，安卓走 ADB。
 * 旧版 HarmonyOS（Android 底座）可能同时暴露两种接口，此时优先 HDC。
 * 设备未打开时读不到 configuration，返回 null，由 detectDevicePlatform 处理。
 */
export function matchDevicePlatform(device: HdcUsbDevice): Platform | null {
  if (!device.configuration) {
    return null;
  }
  if (hasInterface(device, HDC_USB_INTERFACE)) {
    return 'harmony';
  }
  if (hasInterface(device, ADB_USB_INTERFACE)) {
    return 'android';
  }
  return null;
}

/**
 * 识别设备平台。WebUSB 只有打开设备后才能读取接口描述符，因此对未打开的
 * 设备临时 open/close 一次来完成识别；识别失败（接口被占用等）返回 null，
 * 由调用方给出错误提示。
 */
export async function detectDevicePlatform(
  device: HdcUsbDevice,
): Promise<Platform | null> {
  const direct = matchDevicePlatform(device);
  if (direct) {
    return direct;
  }
  if (device.configuration) {
    return null;
  }
  if (device.opened) {
    try {
      await device.selectConfiguration(1);
    } catch {
      return null;
    }
    return matchDevicePlatform(device);
  }
  try {
    await device.open();
    if (!device.configuration) {
      await device.selectConfiguration(1).catch(() => {});
    }
    return matchDevicePlatform(device);
  } catch {
    return null;
  } finally {
    await device.close().catch(() => {});
  }
}

export function getUsbApi(): HdcUsbApi | null {
  return (globalThis.navigator as Navigator & { usb?: HdcUsbApi }).usb ?? null;
}
