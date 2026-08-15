import type { DeviceClient, Platform } from './device-client';
import { createAdbDeviceClient, createHdcDeviceClient } from './device-client';

const harmonyClient = createHdcDeviceClient();
const androidClient = createAdbDeviceClient();

export interface AppState {
  platform: Platform;
  connected: boolean;
  connecting: boolean;
}

export const state: AppState = {
  platform: 'harmony',
  connected: false,
  connecting: false,
};

export function setPlatform(platform: Platform): void {
  state.platform = platform;
}

export function currentClient(): DeviceClient {
  return state.platform === 'android' ? androidClient : harmonyClient;
}
