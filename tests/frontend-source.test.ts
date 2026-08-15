import { describe, expect, it } from 'vitest';
import {
  buildFrontendCandidates,
  isAllowedAssetUrl,
  isAllowedFrontendUrl,
  LOCAL_FRONTEND_PATH,
  OFFICIAL_FRONTEND_HOST,
  PINNED_COMPATIBLE_FRONTEND_URL,
} from '../src/devtools/frontend-source';

const ORIGIN = 'https://debug.example.com';

describe('isAllowedFrontendUrl', () => {
  it('接受官方 host 并强制 https、剥掉 userinfo 与 ws/wss 参数', () => {
    const url = isAllowedFrontendUrl(
      `http://user:pass@${OFFICIAL_FRONTEND_HOST}/serve_rev/@abc/inspector.html?ws=ws%3A%2F%2Fdevtools%2Fpage%2F1&wss=x&panel=console`,
      ORIGIN,
    );
    expect(url).not.toBeNull();
    expect(url?.protocol).toBe('https:');
    expect(url?.username).toBe('');
    expect(url?.searchParams.get('ws')).toBeNull();
    expect(url?.searchParams.get('wss')).toBeNull();
    expect(url?.searchParams.get('panel')).toBe('console');
  });

  it('拒绝官方 host 之外的服务器', () => {
    expect(
      isAllowedFrontendUrl('https://evil.example.com/inspector.html', ORIGIN),
    ).toBeNull();
    expect(isAllowedFrontendUrl('file:///etc/passwd', ORIGIN)).toBeNull();
  });

  it('接受同源 URL（内置副本），且不强制升级 https（兼容 http dev server）', () => {
    expect(isAllowedFrontendUrl(LOCAL_FRONTEND_PATH, ORIGIN)?.href).toBe(
      `${ORIGIN}${LOCAL_FRONTEND_PATH}`,
    );
    expect(
      isAllowedFrontendUrl('/devtools/inspector.html', 'http://localhost:3000')
        ?.href,
    ).toBe('http://localhost:3000/devtools/inspector.html');
  });
});

describe('buildFrontendCandidates', () => {
  it('候选链为：设备 revision → 固定兼容版 → 本地副本', () => {
    const candidates = buildFrontendCandidates(
      `https://${OFFICIAL_FRONTEND_HOST}/serve_rev/@deadbeef/inspector.html`,
      ORIGIN,
    );
    expect(candidates.map((item) => item.source)).toEqual([
      'preferred',
      'pinned',
      'local',
    ]);
    expect(candidates[0]?.url.pathname).toContain('@deadbeef');
    expect(candidates[1]?.url.href).toBe(PINNED_COMPATIBLE_FRONTEND_URL);
    expect(candidates[2]?.url.href).toBe(`${ORIGIN}${LOCAL_FRONTEND_PATH}`);
  });

  it('设备 revision 与固定兼容版相同时去重', () => {
    const candidates = buildFrontendCandidates(
      PINNED_COMPATIBLE_FRONTEND_URL,
      ORIGIN,
    );
    expect(candidates.map((item) => item.source)).toEqual([
      'preferred',
      'local',
    ]);
  });

  it('非法 preferred 被丢弃，仍保留固定兼容版与本地兜底', () => {
    const candidates = buildFrontendCandidates(
      'https://evil.example.com/inspector.html',
      ORIGIN,
    );
    expect(candidates.map((item) => item.source)).toEqual(['pinned', 'local']);
  });
});

describe('isAllowedAssetUrl', () => {
  it('相对路径基于官方 base 解析到 https 官方资源', () => {
    const base = new URL(PINNED_COMPATIBLE_FRONTEND_URL);
    expect(
      isAllowedAssetUrl('./entrypoints/inspector/inspector.js', base, ORIGIN)
        ?.href,
    ).toBe(
      `https://${OFFICIAL_FRONTEND_HOST}/serve_rev/@f2f3682c9db8ca427f8c64f0402cc2c5152c6c24/entrypoints/inspector/inspector.js`,
    );
  });

  it('本地副本模式下允许同源资源', () => {
    const base = new URL(`${ORIGIN}${LOCAL_FRONTEND_PATH}`);
    expect(
      isAllowedAssetUrl('./entrypoints/inspector/inspector.js', base, ORIGIN)
        ?.href,
    ).toBe(`${ORIGIN}/devtools/entrypoints/inspector/inspector.js`);
  });

  it('拒绝第三方资源与 http 的官方资源', () => {
    const base = new URL(PINNED_COMPATIBLE_FRONTEND_URL);
    expect(
      isAllowedAssetUrl('https://evil.example.com/x.js', base, ORIGIN),
    ).toBeNull();
    expect(
      isAllowedAssetUrl(`http://${OFFICIAL_FRONTEND_HOST}/x.js`, base, ORIGIN),
    ).toBeNull();
  });
});
