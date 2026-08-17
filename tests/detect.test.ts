import type { HdcUsbDevice } from '@webhdc/core';
import { describe, expect, it } from 'vitest';
import { ADB_USB_INTERFACE } from '../src/adb/constants';
import { matchDevicePlatform } from '../src/app/detect';

interface MockAlternate {
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
}

function mockDevice(alternates: MockAlternate[]): HdcUsbDevice {
  return {
    configuration: {
      interfaces: [
        {
          alternates: alternates.map((alternate, index) => ({
            alternateSetting: index,
            ...alternate,
          })),
        },
      ],
    },
  } as unknown as HdcUsbDevice;
}

const ADB_ALTERNATE: MockAlternate = {
  interfaceClass: ADB_USB_INTERFACE.classCode,
  interfaceSubclass: ADB_USB_INTERFACE.subclassCode,
  interfaceProtocol: ADB_USB_INTERFACE.protocolCode,
};

const HDC_ALTERNATE: MockAlternate = {
  interfaceClass: 0xff,
  interfaceSubclass: 0x50,
  interfaceProtocol: 0x01,
};

describe('matchDevicePlatform', () => {
  it('识别 ADB 接口为 Android', () => {
    expect(matchDevicePlatform(mockDevice([ADB_ALTERNATE]))).toBe('android');
  });

  it('识别 HDC 接口为 HarmonyOS', () => {
    expect(matchDevicePlatform(mockDevice([HDC_ALTERNATE]))).toBe('harmony');
  });

  it('双协议设备（旧版 HarmonyOS）优先 HDC', () => {
    expect(
      matchDevicePlatform(mockDevice([ADB_ALTERNATE, HDC_ALTERNATE])),
    ).toBe('harmony');
  });

  it('无 configuration（未打开的设备）返回 null', () => {
    expect(
      matchDevicePlatform({ configuration: null } as unknown as HdcUsbDevice),
    ).toBeNull();
  });

  it('两种接口都不匹配时返回 null', () => {
    expect(
      matchDevicePlatform(
        mockDevice([
          {
            interfaceClass: 0xff,
            interfaceSubclass: 0x42,
            interfaceProtocol: 0x02,
          },
        ]),
      ),
    ).toBeNull();
  });
});
