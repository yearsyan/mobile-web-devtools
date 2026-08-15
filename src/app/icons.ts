/**
 * 全屏 / 退出全屏按钮的图标。用 SVG 而不是 Unicode 符号（⛶ / 🗕）：
 * 后者在 macOS / Windows 上由 emoji 字体渲染，基线度量因平台而异，
 * 无法通过 CSS 稳定居中；SVG 的几何完全可控。
 */
const ICON_ATTRS =
  'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export const EXPAND_ICON = `<svg ${ICON_ATTRS}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;

export const MINIMIZE_ICON = `<svg ${ICON_ATTRS}><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
