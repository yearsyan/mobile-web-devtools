import { describe, expect, it } from 'vitest';
import { tryParseHttpResponse } from '../src/devtools/http';

const encoder = new TextEncoder();

function response(bytes: Uint8Array, eof = false) {
  return tryParseHttpResponse(bytes, { eof });
}

describe('tryParseHttpResponse', () => {
  it('解析带 Content-Length 的完整响应', () => {
    const raw = encoder.encode(
      'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 5\r\n\r\nhello',
    );
    const parsed = response(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe(200);
    expect(parsed?.statusText).toBe('OK');
    expect(parsed?.headers.get('content-type')).toBe('application/json');
    expect(new TextDecoder().decode(parsed?.body ?? new Uint8Array())).toBe(
      'hello',
    );
    expect(parsed?.consumed).toBe(raw.byteLength);
  });

  it('Content-Length 未满时返回 null', () => {
    const raw = encoder.encode(
      'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial',
    );
    expect(response(raw)).toBeNull();
  });

  it('头部不完整时返回 null', () => {
    expect(response(encoder.encode('HTTP/1.1 200 OK\r\nX: 1'))).toBeNull();
  });

  it('合并重复头部', () => {
    const parsed = response(
      encoder.encode('HTTP/1.1 204 No Content\r\nX-A: 1\r\nX-A: 2\r\n\r\n'),
    );
    expect(parsed?.headers.get('x-a')).toBe('1, 2');
  });

  it('101/204/304 无 body 立即完成', () => {
    for (const status of [101, 204, 304]) {
      const raw = encoder.encode(`HTTP/1.1 ${status} S\r\n\r\n`);
      const parsed = response(raw);
      expect(parsed?.status).toBe(status);
      expect(parsed?.body.byteLength).toBe(0);
      expect(parsed?.consumed).toBe(raw.byteLength);
    }
  });

  it('解析 chunked 响应（含终止块）', () => {
    const raw = encoder.encode(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n',
    );
    const parsed = response(raw);
    expect(new TextDecoder().decode(parsed?.body ?? new Uint8Array())).toBe(
      'Wikipedia',
    );
    expect(parsed?.consumed).toBe(raw.byteLength);
  });

  it('解析带 trailer 的 chunked 响应', () => {
    const raw = encoder.encode(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\nX-Trailer: v\r\n\r\n',
    );
    const parsed = response(raw);
    expect(new TextDecoder().decode(parsed?.body ?? new Uint8Array())).toBe(
      'abc',
    );
    expect(parsed?.consumed).toBe(raw.byteLength);
  });

  it('chunked 数据不完整时返回 null', () => {
    const raw = encoder.encode(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWi',
    );
    expect(response(raw)).toBeNull();
  });

  it('chunk 尾部缺少 CRLF 时抛错', () => {
    const raw = encoder.encode(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWikiXX',
    );
    expect(() => response(raw)).toThrow('chunked HTTP 数据块末尾缺少 CRLF');
  });

  it('无效 chunk 长度抛错', () => {
    const raw = encoder.encode(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n',
    );
    expect(() => response(raw)).toThrow('无效的 chunked HTTP 长度');
  });

  it('eof 时无长度声明的剩余字节作为 body', () => {
    const raw = encoder.encode('HTTP/1.1 200 OK\r\n\r\nrest-body');
    const parsed = response(raw, true);
    expect(new TextDecoder().decode(parsed?.body ?? new Uint8Array())).toBe(
      'rest-body',
    );
  });

  it('无效状态行抛错', () => {
    expect(() => response(encoder.encode('GARBAGE\r\n\r\n'))).toThrow(
      '无效的 HTTP 响应状态行',
    );
  });

  it('无效 Content-Length 抛错', () => {
    expect(() =>
      response(encoder.encode('HTTP/1.1 200 OK\r\nContent-Length: x\r\n\r\n')),
    ).toThrow('无效的 HTTP Content-Length');
  });
});
