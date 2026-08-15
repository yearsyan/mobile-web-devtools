import { describe, expect, it } from 'vitest';
import {
  devtoolsWebSocketPath,
  parseDevtoolsSockets,
  parseDevtoolsTargets,
  parseDevtoolsVersion,
  resolveDevtoolsFrontendUrl,
} from '../src/devtools/discovery';

const PROC_NET_UNIX = `Num       RefCount Protocol Flags    Type St Inode Path
1e2e0000: 00000002 00000000 00000000 0001 01  1234 /dev/socket/zygote
2f3f1111: 00000002 00000000 00010000 0001 01  5678 @webview_devtools_remote_4321
3a4b2222: 00000002 00000000 00010000 0001 01  6789 @chrome_devtools_remote_999
4b5c3333: 00000002 00000000 00010000 0001 01  7890 @com.example.app_devtools_remote_42
5c6d4444: 00000002 00000000 00010000 0001 01  8901 @random_abstract_socket
`;

describe('parseDevtoolsSockets', () => {
  it('提取 devtools abstract socket 并解析 PID', () => {
    const sockets = parseDevtoolsSockets(PROC_NET_UNIX);
    expect(sockets.map((socket) => socket.name)).toEqual([
      'chrome_devtools_remote_999',
      'com.example.app_devtools_remote_42',
      'webview_devtools_remote_4321',
    ]);
    expect(sockets[0]).toMatchObject({ pid: '999' });
    expect(sockets[1]).toMatchObject({ pid: '42' });
    expect(sockets[2]).toMatchObject({ pid: '4321' });
  });

  it('忽略非 abstract 与不含 devtools 的行', () => {
    const sockets = parseDevtoolsSockets(
      [
        'aa: 1 2 3 0001 01 1 /dev/socket/zygote',
        'bb: 1 2 3 0001 01 2 @random_abstract_socket',
        'cc: 1 2 3 0001 01 3 webview_devtools_remote_1',
        'dd: 1 2 3 0001 01 4 @',
        '',
      ].join('\n'),
    );
    expect(sockets).toEqual([]);
  });

  it('同名 socket 去重', () => {
    const sockets = parseDevtoolsSockets(
      [
        'a: 1 2 3 0001 01 1 @webview_devtools_remote_7',
        'b: 1 2 3 0001 01 2 @webview_devtools_remote_7',
      ].join('\n'),
    );
    expect(sockets).toHaveLength(1);
  });

  it('没有 PID 后缀时 pid 为 null', () => {
    const sockets = parseDevtoolsSockets(
      'a: 1 2 3 0001 01 1 @weird_devtools_socket',
    );
    expect(sockets[0]?.pid).toBeNull();
    expect(sockets[0]?.name).toBe('weird_devtools_socket');
  });

  it('raw 保留原始行内容', () => {
    const line = 'a: 1 2 3 0001 01 1 @webview_devtools_remote_7';
    expect(parseDevtoolsSockets(line)[0]?.raw).toBe(line);
  });
});

describe('parseDevtoolsTargets', () => {
  it('解析目标数组并保留字段', () => {
    const targets = parseDevtoolsTargets(
      JSON.stringify([
        {
          description: 'desc',
          devtoolsFrontendUrl:
            '/devtools/inspector.html?ws=localhost:9222/devtools/page/abc',
          id: 'abc',
          title: '页面标题',
          type: 'page',
          url: 'https://example.com/',
          webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/abc',
        },
      ]),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      id: 'abc',
      type: 'page',
      title: '页面标题',
      url: 'https://example.com/',
      webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/abc',
    });
  });

  it('缺少 id 时从 webSocketDebuggerUrl 路径回退', () => {
    const targets = parseDevtoolsTargets(
      JSON.stringify([
        {
          type: 'page',
          webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/target-1',
        },
      ]),
    );
    expect(targets[0]?.id).toBe('target-1');
  });

  it('过滤缺少 webSocketDebuggerUrl 的条目', () => {
    expect(parseDevtoolsTargets(JSON.stringify([{ id: 'x' }]))).toEqual([]);
  });

  it('接受单个对象响应', () => {
    const targets = parseDevtoolsTargets(
      JSON.stringify({
        id: 'y',
        webSocketDebuggerUrl: 'ws://localhost/devtools/page/y',
      }),
    );
    expect(targets).toHaveLength(1);
  });

  it('拒绝非法 JSON 与标量', () => {
    expect(() => parseDevtoolsTargets('not json')).toThrow();
    expect(parseDevtoolsTargets('42')).toEqual([]);
  });
});

describe('parseDevtoolsVersion', () => {
  it('读取 Browser / Protocol-Version / WebKit-Version', () => {
    expect(
      parseDevtoolsVersion(
        JSON.stringify({
          Browser: 'Chrome/120.0.0.0',
          'Protocol-Version': '1.3',
          'WebKit-Version': '537.36 (@abc1234)',
        }),
      ),
    ).toEqual({
      browser: 'Chrome/120.0.0.0',
      protocolVersion: '1.3',
      webKitVersion: '537.36 (@abc1234)',
    });
  });

  it('非对象输入返回空对象', () => {
    expect(parseDevtoolsVersion('[]')).toEqual({});
  });
});

describe('resolveDevtoolsFrontendUrl', () => {
  const target = {
    id: 'abc',
    type: 'page',
    title: '',
    url: '',
    description: '',
    faviconUrl: '',
    webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/abc',
  };

  it('优先使用 compat URL 并强制 https、剥离 ws 参数', () => {
    const url = resolveDevtoolsFrontendUrl(
      {
        ...target,
        devtoolsFrontendUrlCompat:
          'http://chrome-devtools-frontend.appspot.com/serve_rev/@c0mpat00/inspector.html?ws=localhost:9222/devtools/page/abc',
        devtoolsFrontendUrl:
          'https://chrome-devtools-frontend.appspot.com/serve_rev/@deadbeef/inspector.html?wss=x',
      },
      null,
    );
    expect(url).toBe(
      'https://chrome-devtools-frontend.appspot.com/serve_rev/@c0mpat00/inspector.html',
    );
  });

  it('接受协议相对 // 前缀', () => {
    const url = resolveDevtoolsFrontendUrl(
      {
        ...target,
        devtoolsFrontendUrl:
          '//chrome-devtools-frontend.appspot.com/serve_rev/@1234567/inspector.html',
      },
      null,
    );
    expect(url).toBe(
      'https://chrome-devtools-frontend.appspot.com/serve_rev/@1234567/inspector.html',
    );
  });

  it('私有 frontend URL 被拒绝时从 webKitVersion 提取 revision', () => {
    const url = resolveDevtoolsFrontendUrl(
      {
        ...target,
        devtoolsFrontendUrl: 'https://vendor.example.com/inspector.html',
      },
      { webKitVersion: '537.36 (@abcdef1234)' },
    );
    expect(url).toBe(
      'https://chrome-devtools-frontend.appspot.com/serve_rev/@abcdef1234/inspector.html',
    );
  });

  it('无法确定 revision 时抛错', () => {
    expect(() => resolveDevtoolsFrontendUrl(target, null)).toThrow(
      '设备没有提供可用的 Chrome DevTools frontend revision',
    );
  });
});

describe('devtoolsWebSocketPath', () => {
  it('返回路径与查询串', () => {
    expect(devtoolsWebSocketPath('ws://host:9222/devtools/page/abc?x=1')).toBe(
      '/devtools/page/abc?x=1',
    );
    expect(devtoolsWebSocketPath('wss://host/devtools/page/a')).toBe(
      '/devtools/page/a',
    );
  });

  it('非 ws/wss 协议抛错', () => {
    expect(() => devtoolsWebSocketPath('https://host/devtools')).toThrow(
      '不支持的 WebSocket 调试地址',
    );
  });

  it('非法 URL 抛错', () => {
    expect(() => devtoolsWebSocketPath('::::')).toThrow(
      '无效的 WebSocket 调试地址',
    );
  });
});
