import { describe, expect, it } from 'vitest';
import {
  encodeWebSocketFrame,
  WebSocketFrameParser,
} from '../src/devtools/websocket';

const encoder = new TextEncoder();

describe('encodeWebSocketFrame', () => {
  it('小于 126 字节使用 7-bit 长度', () => {
    const frame = encodeWebSocketFrame(0x01, encoder.encode('hi'), null);
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(0x02);
    expect(new TextDecoder().decode(frame.subarray(2))).toBe('hi');
  });

  it('126..65535 使用 16-bit 长度', () => {
    const payload = new Uint8Array(300).fill(7);
    const frame = encodeWebSocketFrame(0x02, payload, null);
    expect(frame[1]).toBe(126);
    expect(new DataView(frame.buffer).getUint16(2, false)).toBe(300);
    expect(frame.byteLength).toBe(4 + 300);
  });

  it('超过 65535 使用 64-bit 长度', () => {
    const payload = new Uint8Array(70_000).fill(3);
    const frame = encodeWebSocketFrame(0x02, payload, null);
    expect(frame[1]).toBe(127);
    expect(new DataView(frame.buffer).getBigUint64(2, false)).toBe(70_000n);
  });

  it('客户端帧默认带 4 字节随机掩码且负载被掩码', () => {
    const payload = encoder.encode('mask-me');
    const frame = encodeWebSocketFrame(0x01, payload);
    expect(frame[1] & 0x80).toBe(0x80);
    const mask = frame.subarray(2, 6);
    const masked = frame.subarray(6);
    for (let index = 0; index < payload.byteLength; index += 1) {
      expect(masked[index]).toBe(payload[index] ^ mask[index % 4]);
    }
  });

  it('非法 opcode 与掩码长度抛错', () => {
    expect(() => encodeWebSocketFrame(0x20, new Uint8Array())).toThrow(
      '无效的 WebSocket opcode',
    );
    expect(() =>
      encodeWebSocketFrame(0x01, new Uint8Array(), new Uint8Array(3)),
    ).toThrow('WebSocket mask 必须为 4 字节');
  });
});

describe('WebSocketFrameParser', () => {
  it('解析服务端未掩码文本帧', () => {
    const parser = new WebSocketFrameParser();
    const frames = parser.push(
      encodeWebSocketFrame(0x01, encoder.encode('hello'), null),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ fin: true, opcode: 0x01, masked: false });
    expect(new TextDecoder().decode(frames[0].payload)).toBe('hello');
  });

  it('解析客户端掩码帧并还原负载', () => {
    const parser = new WebSocketFrameParser();
    const frames = parser.push(
      encodeWebSocketFrame(0x02, new Uint8Array([1, 2, 3, 4, 5])),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0].masked).toBe(true);
    expect([...frames[0].payload]).toEqual([1, 2, 3, 4, 5]);
  });

  it('一次 push 解析多帧且互不残留', () => {
    const parser = new WebSocketFrameParser();
    const batch = new Uint8Array([
      ...encodeWebSocketFrame(0x01, encoder.encode('a'), null),
      ...encodeWebSocketFrame(0x02, new Uint8Array([9]), null),
      ...encodeWebSocketFrame(0x08, new Uint8Array([0x03, 0xe8]), null),
    ]);
    const frames = parser.push(batch);
    expect(frames.map((frame) => frame.opcode)).toEqual([0x01, 0x02, 0x08]);
    expect(new TextDecoder().decode(frames[0].payload)).toBe('a');
    expect([...frames[1].payload]).toEqual([9]);
  });

  it('分片到达：先头部后半负载再剩余负载', () => {
    const parser = new WebSocketFrameParser();
    const frame = encodeWebSocketFrame(0x02, new Uint8Array(500).fill(5), null);
    expect(parser.push(frame.subarray(0, 100))).toEqual([]);
    expect(parser.push(frame.subarray(100, 300))).toEqual([]);
    const frames = parser.push(frame.subarray(300));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.byteLength).toBe(500);
    expect(frames[0].payload.every((byte) => byte === 5)).toBe(true);
  });

  it('前一帧的残留与下一次 push 的数据合并解析', () => {
    const parser = new WebSocketFrameParser();
    const first = encodeWebSocketFrame(0x01, encoder.encode('first'), null);
    const second = encodeWebSocketFrame(0x01, encoder.encode('second'), null);
    const partial = parser.push(
      new Uint8Array([...first, ...second.subarray(0, 3)]),
    );
    expect(partial).toHaveLength(1);
    const rest = parser.push(second.subarray(3));
    expect(rest).toHaveLength(1);
    expect(new TextDecoder().decode(rest[0].payload)).toBe('second');
  });

  it('RSV 位非零抛错', () => {
    const parser = new WebSocketFrameParser();
    const frame = encodeWebSocketFrame(0x01, encoder.encode('x'), null);
    frame[0] |= 0x40;
    expect(() => parser.push(frame)).toThrow('未知 RSV 位');
  });

  it('超过 maxFrameSize 抛错', () => {
    const parser = new WebSocketFrameParser(64);
    expect(() =>
      parser.push(encodeWebSocketFrame(0x02, new Uint8Array(100), null)),
    ).toThrow('WebSocket 帧超过 64 字节');
  });

  it('fin=false 时保留分片标志', () => {
    const parser = new WebSocketFrameParser();
    const frame = encodeWebSocketFrame(0x01, encoder.encode('x'), null, false);
    const frames = parser.push(frame);
    expect(frames[0]?.fin).toBe(false);
  });
});
