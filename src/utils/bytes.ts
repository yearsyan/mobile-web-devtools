/**
 * 可增长字节队列：追加按摊还 O(1) 拷贝，队头消费只移动偏移量。
 *
 * 替代 `buffer = concatBytes(buffer, chunk)` 这种每来一个 chunk 就整段
 * 重拷的写法——CDP 的 screencast 帧 / 大数组序列化动辄数 MB，逐块全量
 * 拷贝是平方级的。`bytes` 返回零拷贝视图，供增量解析器使用；视图只在
 * 下一次 push/consume/clear 前有效，解析器需要持有数据时必须自行
 * `slice()` 拷出。
 */
export class ByteQueue {
  #store: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  #start = 0;
  #end = 0;

  get byteLength(): number {
    return this.#end - this.#start;
  }

  /** 缓冲数据的零拷贝视图；任何变更操作后失效。 */
  get bytes(): Uint8Array<ArrayBuffer> {
    return this.#store.subarray(this.#start, this.#end);
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) {
      return;
    }
    if (this.#end + chunk.byteLength > this.#store.byteLength) {
      this.#compact();
      if (this.#end + chunk.byteLength > this.#store.byteLength) {
        this.#grow(this.#end + chunk.byteLength);
      }
    }
    this.#store.set(chunk, this.#end);
    this.#end += chunk.byteLength;
  }

  /** 丢弃队头的 count 字节（超出缓冲长度时清空）。 */
  consume(count: number): void {
    this.#start += Math.min(count, this.byteLength);
    if (this.#start === this.#end) {
      this.#start = 0;
      this.#end = 0;
    }
  }

  clear(): void {
    this.#start = 0;
    this.#end = 0;
  }

  #compact(): void {
    if (this.#start === 0) {
      return;
    }
    this.#store.copyWithin(0, this.#start, this.#end);
    this.#end -= this.#start;
    this.#start = 0;
  }

  #grow(minCapacity: number): void {
    let capacity = Math.max(4096, this.#store.byteLength * 2);
    while (capacity < minCapacity) {
      capacity *= 2;
    }
    const next = new Uint8Array(capacity);
    next.set(this.#store.subarray(this.#start, this.#end), 0);
    this.#end -= this.#start;
    this.#start = 0;
    this.#store = next;
  }
}

export function concatBytes(
  left: Uint8Array,
  right: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left, 0);
  output.set(right, left.byteLength);
  return output;
}

export function joinBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
