import type {
  HdcUsbDevice,
  HdcUsbInTransferResult,
  HdcUsbOutTransferResult,
} from '@webhdc/core';
import type {
  AdbDaemonConnection,
  AdbPacketData,
  AdbPacketInit,
} from '@yume-chan/adb';
import { ByteQueue } from '../utils/bytes';
import { ADB_USB_INTERFACE } from './constants';
import type { AdbUsbInterfaceInfo } from './types';

const ADB_PACKET_HEADER_SIZE = 24;
const DEFAULT_READ_CHUNK_SIZE = 64 * 1024;
const MAX_ADB_PAYLOAD_SIZE = 1024 * 1024;

type Bytes = Uint8Array<ArrayBuffer>;

export interface AdbPacketDataEx extends AdbPacketData {
  payload: Uint8Array;
}

interface ParsedAdbPacket {
  command: number;
  arg0: number;
  arg1: number;
  payloadLength: number;
  checksum: number;
  magic: number;
  payload: Bytes;
}

interface ConsumableLike<T> {
  tryConsume(callback: (value: T) => unknown | Promise<unknown>): unknown;
}

interface SerializedAdbPacket {
  command: number;
  arg0: number;
  arg1: number;
  payloadLength?: number;
  checksum?: number;
  magic?: number;
  payload: Uint8Array<ArrayBufferLike> | ArrayBuffer;
}

function asUint8Array(value: Uint8Array<ArrayBufferLike> | ArrayBuffer): Bytes {
  return value instanceof Uint8Array ? (value as Bytes) : new Uint8Array(value);
}

/**
 * Parse one or more 24-byte ADB packet headers plus their payloads.
 * Returns the packets plus how many leading bytes they consumed, so callers
 * can drain a `ByteQueue` without copying the unparsed remainder.
 */
export function parseAdbPackets(buffer: Bytes): {
  packets: ParsedAdbPacket[];
  consumed: number;
} {
  const packets: ParsedAdbPacket[] = [];
  let offset = 0;

  while (buffer.byteLength - offset >= ADB_PACKET_HEADER_SIZE) {
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset + offset,
      ADB_PACKET_HEADER_SIZE,
    );
    const command = view.getUint32(0, true);
    const arg0 = view.getUint32(4, true);
    const arg1 = view.getUint32(8, true);
    const payloadLength = view.getUint32(12, true);
    const checksum = view.getUint32(16, true);
    const magic = view.getUint32(20, true);

    if (magic >>> 0 !== (command ^ 0xffffffff) >>> 0) {
      throw new Error(
        `Invalid ADB packet magic (command=0x${command.toString(16)})`,
      );
    }
    if (payloadLength > MAX_ADB_PAYLOAD_SIZE) {
      throw new Error(`ADB payload too large: ${payloadLength} bytes`);
    }
    const total = ADB_PACKET_HEADER_SIZE + payloadLength;
    if (buffer.byteLength - offset < total) {
      break;
    }
    packets.push({
      command,
      arg0,
      arg1,
      payloadLength,
      checksum,
      magic,
      payload: buffer.slice(offset + ADB_PACKET_HEADER_SIZE, offset + total),
    });
    offset += total;
  }

  return { packets, consumed: offset };
}

function serializePacket(packet: SerializedAdbPacket): {
  header: Bytes;
  payload: Bytes;
} {
  const payload = asUint8Array(packet.payload);
  const header = new Uint8Array(ADB_PACKET_HEADER_SIZE);
  const view = new DataView(header.buffer);
  view.setUint32(0, packet.command, true);
  view.setUint32(4, packet.arg0, true);
  view.setUint32(8, packet.arg1, true);
  view.setUint32(12, payload.byteLength, true);
  view.setUint32(16, packet.checksum ?? 0, true);
  view.setUint32(20, packet.magic ?? (packet.command ^ 0xffffffff) >>> 0, true);
  return { header, payload };
}

function isConsumable(value: unknown): value is ConsumableLike<AdbPacketInit> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tryConsume' in value &&
    typeof (value as { tryConsume?: unknown }).tryConsume === 'function'
  );
}

function findAdbInterface(device: HdcUsbDevice): {
  interfaceNumber: number;
  alternateSetting: number;
  inputEndpoint: number;
  outputEndpoint: number;
} {
  for (const usbInterface of device.configuration?.interfaces ?? []) {
    for (const alternate of usbInterface.alternates) {
      if (
        alternate.interfaceClass !== ADB_USB_INTERFACE.classCode ||
        alternate.interfaceSubclass !== ADB_USB_INTERFACE.subclassCode ||
        alternate.interfaceProtocol !== ADB_USB_INTERFACE.protocolCode
      ) {
        continue;
      }
      const input = alternate.endpoints.find(
        (endpoint) => endpoint.direction === 'in' && endpoint.type === 'bulk',
      );
      const output = alternate.endpoints.find(
        (endpoint) => endpoint.direction === 'out' && endpoint.type === 'bulk',
      );
      if (input && output) {
        return {
          interfaceNumber: usbInterface.interfaceNumber,
          alternateSetting: alternate.alternateSetting,
          inputEndpoint: input.endpointNumber,
          outputEndpoint: output.endpointNumber,
        };
      }
    }
  }
  throw new Error('USB 设备没有 ADB 批量端点');
}

/**
 * Wrap WebUSB bulk endpoints as an `AdbDaemonConnection`.
 *
 * ADB-over-USB preserves packet boundaries: the 24-byte header and payload
 * must be written as separate bulk transfers. Incoming transfers are buffered
 * and split back into complete ADB packets.
 */
export class AdbWebUsbConnection {
  readonly device: HdcUsbDevice;
  readonly interfaceInfo: AdbUsbInterfaceInfo;
  readonly readable: ReadableStream<AdbPacketDataEx>;
  readonly writable: WritableStream<unknown>;

  #inputEndpoint: number;
  #outputEndpoint: number;
  #readCancelled = false;
  #readLoop: Promise<void> | null = null;
  #closing = false;

  private constructor(
    device: HdcUsbDevice,
    interfaceInfo: AdbUsbInterfaceInfo,
    inputEndpoint: number,
    outputEndpoint: number,
  ) {
    this.device = device;
    this.interfaceInfo = interfaceInfo;
    this.#inputEndpoint = inputEndpoint;
    this.#outputEndpoint = outputEndpoint;
    this.readable = new ReadableStream<AdbPacketDataEx>({
      start: (controller) => this.#startRead(controller),
      cancel: () => this.#cancelRead(),
    });
    this.writable = new WritableStream<unknown>({
      write: async (chunk) => {
        if (isConsumable(chunk)) {
          await chunk.tryConsume(async (packet) => this.#writePacket(packet));
          return;
        }
        await this.#writePacket(chunk as AdbPacketInit);
      },
      close: () => this.#closeDevice(),
      abort: () => this.#closeDevice(),
    });
  }

  static async open(device: HdcUsbDevice): Promise<AdbWebUsbConnection> {
    if (!device.opened) {
      await device.open();
    }
    if (!device.configuration) {
      await device.selectConfiguration(1);
    }
    const found = findAdbInterface(device);
    await device.claimInterface(found.interfaceNumber);
    if (found.alternateSetting !== 0) {
      await device.selectAlternateInterface(
        found.interfaceNumber,
        found.alternateSetting,
      );
    }
    return new AdbWebUsbConnection(
      device,
      {
        interfaceNumber: found.interfaceNumber,
        alternateSetting: found.alternateSetting,
        inputEndpoint: found.inputEndpoint,
        outputEndpoint: found.outputEndpoint,
      },
      found.inputEndpoint,
      found.outputEndpoint,
    );
  }

  get daemonConnection(): AdbDaemonConnection {
    return {
      readable: this.readable,
      writable: this.writable,
    } as unknown as AdbDaemonConnection;
  }

  #startRead(
    controller: ReadableStreamDefaultController<AdbPacketDataEx>,
  ): Promise<void> {
    if (!this.#readLoop) {
      this.#readLoop = this.#readLoopPromise(controller);
    }
    return this.#readLoop;
  }

  async #readLoopPromise(
    controller: ReadableStreamDefaultController<AdbPacketDataEx>,
  ): Promise<void> {
    const buffer = new ByteQueue();
    try {
      while (!this.#readCancelled) {
        let result: HdcUsbInTransferResult;
        try {
          result = await this.device.transferIn(
            this.#inputEndpoint,
            DEFAULT_READ_CHUNK_SIZE,
          );
        } catch {
          if (this.#readCancelled || this.#closing) {
            controller.close();
            return;
          }
          throw new Error('ADB USB 读取被中断');
        }
        if (this.#readCancelled || this.#closing) {
          controller.close();
          return;
        }
        if (result.status !== 'ok' || !result.data) {
          if (this.#closing) {
            controller.close();
            return;
          }
          throw new Error(`ADB USB 读取失败：${result.status}`);
        }
        const view = result.data;
        const source = new Uint8Array(
          view.buffer as ArrayBuffer,
          view.byteOffset,
          view.byteLength,
        );
        buffer.push(source);
        const { packets, consumed } = parseAdbPackets(buffer.bytes);
        buffer.consume(consumed);
        for (const packet of packets) {
          await controller.enqueue(packet);
        }
      }
      controller.close();
    } catch (error) {
      if (this.#readCancelled) {
        controller.close();
      } else {
        controller.error(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  async #writePacket(packet: AdbPacketInit): Promise<void> {
    if (this.#closing) {
      throw new Error('ADB USB 连接已关闭');
    }
    const { header, payload } = serializePacket(packet);
    let result: HdcUsbOutTransferResult;
    try {
      result = await this.device.transferOut(this.#outputEndpoint, header);
    } catch (error) {
      throw new Error(
        `ADB USB header 写入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (result.status !== 'ok') {
      throw new Error(`ADB USB header 写入失败：${result.status}`);
    }
    if (payload.byteLength > 0) {
      try {
        result = await this.device.transferOut(this.#outputEndpoint, payload);
      } catch (error) {
        throw new Error(
          `ADB USB payload 写入失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (result.status !== 'ok') {
        throw new Error(`ADB USB payload 写入失败：${result.status}`);
      }
    }
  }

  #cancelRead(): void {
    this.#readCancelled = true;
    void this.#closeDevice();
  }

  #closeDevice(): void {
    this.#closing = true;
    void this.device.close().catch(() => {});
  }

  async close(): Promise<void> {
    this.#readCancelled = true;
    this.#closing = true;
    await this.device.close().catch(() => {});
  }
}
