/**
 * DevTools frontend 加载源的纯逻辑：官方托管 URL 的校验/归一化、
 * 候选链（设备 revision → 固定兼容版 → 本地内置副本）与资源 allowlist。
 * 保持环境无关（不触碰 window/document），供 frame.ts 与单元测试共用。
 */

/** Chromium 官方托管的 DevTools frontend 域名。 */
export const OFFICIAL_FRONTEND_HOST = 'chrome-devtools-frontend.appspot.com';

// Chrome 132.0.6834.89 的 Chromium DEPS 所固定的 DevTools frontend revision。
// 部分厂商 WebView 返回私有 WebKit revision，官方 serve_rev 不存在该构建，
// 此时用同一浏览器版本的官方 hosted frontend 作为 CDP 兼容回退。
export const PINNED_COMPATIBLE_FRONTEND_URL = `https://${OFFICIAL_FRONTEND_HOST}/serve_rev/@f2f3682c9db8ca427f8c64f0402cc2c5152c6c24/inspector.html`;

/** pnpm run fetch:devtools 下载到 public/devtools/ 的内置兜底副本入口。 */
export const LOCAL_FRONTEND_PATH = '/devtools/inspector.html';

/** 官方源在直连不可达（如中国大陆）时连接会长期挂起而非快速失败。 */
export const OFFICIAL_FETCH_TIMEOUT_MS = 8000;

export type FrontendSource = 'preferred' | 'pinned' | 'local';

export interface FrontendCandidate {
  url: URL;
  source: FrontendSource;
}

function isOfficialHttpUrl(url: URL): boolean {
  return (
    url.hostname === OFFICIAL_FRONTEND_HOST && /^https?:$/u.test(url.protocol)
  );
}

/** 官方 URL 统一升级 https、剥掉 userinfo 与 ws/wss 参数。 */
function normalizeOfficialUrl(url: URL): URL {
  url.protocol = 'https:';
  url.username = '';
  url.password = '';
  url.searchParams.delete('ws');
  url.searchParams.delete('wss');
  return url;
}

/** 只接受 Chromium 官方托管的 frontend，或同源的内置副本；其余返回 null。 */
export function isAllowedFrontendUrl(
  raw: string,
  documentOrigin: string,
): URL | null {
  let url: URL;
  try {
    url = new URL(raw, documentOrigin);
  } catch {
    return null;
  }
  if (isOfficialHttpUrl(url)) {
    return normalizeOfficialUrl(url);
  }
  if (url.origin === documentOrigin) {
    return url;
  }
  return null;
}

/** 候选链：设备 revision → 固定兼容版 → 本地副本；本地恒为最后兜底。 */
export function buildFrontendCandidates(
  preferred: string,
  documentOrigin: string,
): FrontendCandidate[] {
  const preferredEntries: Array<[string, FrontendSource]> = [
    [preferred, 'preferred'],
    [PINNED_COMPATIBLE_FRONTEND_URL, 'pinned'],
  ];
  const candidates: FrontendCandidate[] = [];
  for (const [raw, source] of preferredEntries) {
    const url = isAllowedFrontendUrl(raw, documentOrigin);
    if (url && !candidates.some((item) => item.url.href === url.href)) {
      candidates.push({ url, source });
    }
  }
  const local = isAllowedFrontendUrl(LOCAL_FRONTEND_PATH, documentOrigin);
  if (local) {
    candidates.push({ url: local, source: 'local' });
  }
  return candidates;
}

/** frontend 的子资源只允许来自官方 host（https）或同源（本地副本模式）。 */
export function isAllowedAssetUrl(
  raw: string,
  base: URL,
  documentOrigin: string,
): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.hostname === OFFICIAL_FRONTEND_HOST && url.protocol === 'https:') {
    return url;
  }
  if (url.origin === documentOrigin) {
    return url;
  }
  return null;
}
