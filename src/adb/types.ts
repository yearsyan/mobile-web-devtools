export interface AdbUsbInterfaceInfo {
  interfaceNumber: number;
  alternateSetting: number;
  inputEndpoint: number;
  outputEndpoint: number;
}

export interface AdbDaemonBannerInfo {
  product: string;
  model: string;
  device: string;
  features: string[];
}

export interface AdbDeviceInfo {
  serialNumber: string;
  manufacturerName: string;
  productName: string;
  vendorId: number;
  productId: number;
  vendorIdHex: string;
  productIdHex: string;
  interface: AdbUsbInterfaceInfo;
  banner: AdbDaemonBannerInfo;
  protocolVersion: number;
}

export type AdbStatusState =
  | 'opening'
  | 'handshake'
  | 'authorizing'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface AdbStatus {
  state: AdbStatusState;
  message: string;
}
