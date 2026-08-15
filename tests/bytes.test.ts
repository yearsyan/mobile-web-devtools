import { describe, expect, it } from 'vitest';
import { ByteQueue, concatBytes, joinBytes } from '../src/utils/bytes';

function sequenceChunk(start: number, size: number): Uint8Array {
  const chunk = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    chunk[index] = (start + index) % 256;
  }
  return chunk;
}

describe('ByteQueue', () => {
  it('累积推送的字节并暴露零拷贝视图', () => {
    const queue = new ByteQueue();
    queue.push(new Uint8Array([1, 2, 3]));
    queue.push(new Uint8Array([4, 5]));
    expect(queue.byteLength).toBe(5);
    expect([...queue.bytes]).toEqual([1, 2, 3, 4, 5]);
  });

  it('consume 只移动队头偏移', () => {
    const queue = new ByteQueue();
    queue.push(new Uint8Array([1, 2, 3, 4, 5]));
    queue.consume(2);
    expect([...queue.bytes]).toEqual([3, 4, 5]);
    queue.consume(1);
    expect([...queue.bytes]).toEqual([4, 5]);
  });

  it('consume 超出缓冲长度时清空且不抛错', () => {
    const queue = new ByteQueue();
    queue.push(new Uint8Array([1, 2]));
    queue.consume(100);
    expect(queue.byteLength).toBe(0);
    queue.push(new Uint8Array([9]));
    expect([...queue.bytes]).toEqual([9]);
  });

  it('clear 复位缓冲', () => {
    const queue = new ByteQueue();
    queue.push(new Uint8Array([1, 2, 3]));
    queue.consume(1);
    queue.clear();
    expect(queue.byteLength).toBe(0);
    queue.push(new Uint8Array([7]));
    expect([...queue.bytes]).toEqual([7]);
  });

  it('跳过容量增长边界后内容保持连续正确', () => {
    const queue = new ByteQueue();
    let cursor = 0;
    // 用跨越多次扩容与压缩的数据流验证内容完整性。
    for (let round = 0; round < 40; round += 1) {
      const chunkSize = 1000 + round * 37;
      queue.push(sequenceChunk(cursor, chunkSize));
      cursor += chunkSize;
      // 每轮消费一部分，制造 start > 0 的压缩场景。
      const drop = 300;
      const before = queue.byteLength;
      const kept = queue.bytes.slice(drop);
      queue.consume(drop);
      expect(queue.byteLength).toBe(before - drop);
      expect([...queue.bytes]).toEqual([...kept]);
    }
  });

  it('跨扩容与消费后整体内容按序可读', () => {
    const queue = new ByteQueue();
    const expected: number[] = [];
    let value = 0;
    for (let round = 0; round < 30; round += 1) {
      const chunk = sequenceChunk(value, 700);
      queue.push(chunk);
      expected.push(...chunk);
      value += 700;
      if (round % 3 === 0 && expected.length > 500) {
        expected.splice(0, 500);
        queue.consume(500);
      }
    }
    expect([...queue.bytes]).toEqual(expected);
  });

  it('push 空块是 no-op', () => {
    const queue = new ByteQueue();
    queue.push(new Uint8Array(0));
    expect(queue.byteLength).toBe(0);
  });
});

describe('concatBytes / joinBytes', () => {
  it('concatBytes 拼接两段', () => {
    expect([
      ...concatBytes(new Uint8Array([1, 2]), new Uint8Array([3])),
    ]).toEqual([1, 2, 3]);
  });

  it('joinBytes 拼接多段', () => {
    expect([
      ...joinBytes([new Uint8Array([1]), new Uint8Array([2, 3])]),
    ]).toEqual([1, 2, 3]);
    expect(joinBytes([]).byteLength).toBe(0);
  });
});
