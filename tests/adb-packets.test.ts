import { describe, expect, it } from 'vitest';
import { parseAdbPackets } from '../src/adb/usb-transport';

const ADB_PACKET_HEADER_SIZE = 24;

function buildPacket(
  command: number,
  arg0: number,
  arg1: number,
  payload: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(ADB_PACKET_HEADER_SIZE + payload.byteLength);
  const view = new DataView(packet.buffer);
  view.setUint32(0, command, true);
  view.setUint32(4, arg0, true);
  view.setUint32(8, arg1, true);
  view.setUint32(12, payload.byteLength, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, (command ^ 0xffffffff) >>> 0, true);
  packet.set(payload, ADB_PACKET_HEADER_SIZE);
  return packet;
}

const CMD_OKAY = 0x59414b4f; // "OKAY"
const textEncoder = new TextEncoder();

describe('parseAdbPackets', () => {
  it('解析单个完整包', () => {
    const payload = textEncoder.encode('CNXN');
    const raw = buildPacket(CMD_OKAY, 1, 2, payload);
    const { packets, consumed } = parseAdbPackets(raw);
    expect(consumed).toBe(raw.byteLength);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({
      command: CMD_OKAY,
      arg0: 1,
      arg1: 2,
      payloadLength: payload.byteLength,
      magic: (CMD_OKAY ^ 0xffffffff) >>> 0,
    });
    expect(new TextDecoder().decode(packets[0].payload)).toBe('CNXN');
  });

  it('一次解析多个包并报告总消费字节', () => {
    const first = buildPacket(CMD_OKAY, 0, 0, new Uint8Array([1]));
    const second = buildPacket(CMD_OKAY, 3, 4, new Uint8Array([2, 3]));
    const { packets, consumed } = parseAdbPackets(
      new Uint8Array([...first, ...second]),
    );
    expect(packets).toHaveLength(2);
    expect(consumed).toBe(first.byteLength + second.byteLength);
  });

  it('半包（负载未到齐）只解析完整部分', () => {
    const raw = buildPacket(CMD_OKAY, 0, 0, new Uint8Array(64).fill(9));
    const partial = raw.subarray(0, raw.byteLength - 10);
    const { packets, consumed } = parseAdbPackets(partial);
    expect(packets).toEqual([]);
    expect(consumed).toBe(0);
  });

  it('头部不足 24 字节时不解析', () => {
    expect(parseAdbPackets(new Uint8Array(10))).toEqual({
      packets: [],
      consumed: 0,
    });
    expect(parseAdbPackets(new Uint8Array(0))).toEqual({
      packets: [],
      consumed: 0,
    });
  });

  it('magic 校验失败抛错', () => {
    const raw = buildPacket(CMD_OKAY, 0, 0, new Uint8Array());
    new DataView(raw.buffer).setUint32(20, 0, true);
    expect(() => parseAdbPackets(raw)).toThrow('Invalid ADB packet magic');
  });

  it('负载长度声明超限抛错', () => {
    const raw = buildPacket(CMD_OKAY, 0, 0, new Uint8Array(4));
    new DataView(raw.buffer).setUint32(12, 2 * 1024 * 1024, true);
    expect(() => parseAdbPackets(raw)).toThrow('ADB payload too large');
  });
});
