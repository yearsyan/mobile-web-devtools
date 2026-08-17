import type { DevtoolsSocket, DevtoolsTarget } from '../devtools/discovery';
import { onLocaleChange, t } from './i18n';
import { CHEVRON_ICON } from './icons';
import { normalizePackageName } from './packages';

/**
 * 侧栏二级树：一级是应用（WebView 调试 socket），二级是其中可调试的
 * 页面。页面只对当前已建立 forward 的应用拉取（每个 socket 一个 forward
 * 代价高，不并发展开多个应用），切换应用时重新映射并展开。
 */

export interface TreeHandlers {
  /** 点击应用节点：建立 forward 并展开页面列表 */
  onOpenSocket(socket: DevtoolsSocket): void;
  /** 点击页面节点：切换当前调试的页面 */
  onSelectTarget(target: DevtoolsTarget): void;
}

let handlers: TreeHandlers | null = null;
let sockets: DevtoolsSocket[] = [];
let scanPending = false;
/** PID → 原始进程名（扫描后批量解析） */
const packagesByPid = new Map<string, string>();
let activeSocketName: string | null = null;
/** 当前展开了页面列表的 socket（即已映射 forward 的那个） */
let pagesSocketName: string | null = null;
let pages: DevtoolsTarget[] = [];
let activeTargetId: string | null = null;
/** 已映射应用被用户手动折叠的集合 */
const collapsedSockets = new Set<string>();

export function initTree(next: TreeHandlers): void {
  handlers = next;
}

/** 扫描进行中的占位状态。 */
export function setTreeScanPending(): void {
  scanPending = true;
  render();
}

export function renderTreeApps(next: DevtoolsSocket[]): void {
  scanPending = false;
  sockets = next;
  if (next.length === 0) {
    packagesByPid.clear();
  }
  render();
}

/** PID → 进程名解析完成后更新一级节点标题。 */
export function applyTreePackages(packages: Map<string, string>): void {
  packagesByPid.clear();
  for (const [pid, name] of packages) {
    packagesByPid.set(pid, name);
  }
  render();
}

/** 高亮当前正在调试的应用（null 取消高亮并收起页面）。 */
export function setTreeActiveSocket(name: string | null): void {
  activeSocketName = name;
  if (name === null) {
    setTreePages(null, [], null);
    return;
  }
  render();
}

/** 更新已映射应用的页面列表（映射成功、轮询刷新、切换页面时调用）。 */
export function setTreePages(
  socketName: string | null,
  targets: DevtoolsTarget[],
  activeId: string | null,
): void {
  if (socketName && socketName !== pagesSocketName) {
    // 只有新映射的应用才恢复展开；轮询刷新 / 切换页面不覆盖手动折叠。
    collapsedSockets.delete(socketName);
  }
  pagesSocketName = socketName;
  pages = targets;
  activeTargetId = activeId;
  render();
}

function treeRoot(): HTMLElement | null {
  // renderShell 之前（模块加载期的 locale 回调）节点尚不存在。
  return document.querySelector<HTMLElement>('#app-tree');
}

function placeholder(text: string): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'side-placeholder';
  item.textContent = text;
  return item;
}

function pageTitle(target: DevtoolsTarget): string {
  const title = target.title.trim();
  return title && title !== 'Untitled' ? title : target.url || target.id;
}

interface AppTitles {
  title: string;
  titleTooltip: string;
  sub: string;
}

function appTitles(socket: DevtoolsSocket): AppTitles {
  const rawName = socket.pid ? (packagesByPid.get(socket.pid) ?? '') : '';
  const pkg = normalizePackageName(rawName);
  if (pkg.includes('.')) {
    return {
      title: pkg,
      titleTooltip: rawName || pkg,
      sub: socket.pid ? `PID ${socket.pid} · ${socket.name}` : socket.name,
    };
  }
  if (socket.pid) {
    return {
      title: `WebView · PID ${socket.pid}`,
      titleTooltip: socket.name,
      sub: rawName
        ? t('sockets.noPackage', { name: socket.name })
        : socket.name,
    };
  }
  return {
    title: 'WebView DevTools',
    titleTooltip: socket.name,
    sub: socket.name,
  };
}

function appNode(socket: DevtoolsSocket): HTMLLIElement {
  const item = document.createElement('li');
  const expanded =
    socket.name === pagesSocketName &&
    pages.length > 0 &&
    !collapsedSockets.has(socket.name);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'side-item tree-app';
  row.dataset.socketName = socket.name;
  row.classList.toggle('active', socket.name === activeSocketName);
  row.classList.toggle('expanded', expanded);

  const chevron = document.createElement('span');
  chevron.className = 'tree-chevron';
  chevron.innerHTML = CHEVRON_ICON;

  const body = document.createElement('span');
  body.className = 'tree-app-body';
  const titles = appTitles(socket);
  const title = document.createElement('strong');
  title.className = 'side-item-title';
  title.textContent = titles.title;
  title.title = titles.titleTooltip;
  const sub = document.createElement('small');
  sub.className = 'side-item-sub';
  sub.textContent = titles.sub;
  sub.title = socket.raw;
  body.append(title, sub);
  row.append(chevron, body);

  row.addEventListener('click', () => {
    if (socket.name === activeSocketName && pages.length > 0) {
      // 已映射的应用再次点击只折叠/展开，不重建 forward。
      if (collapsedSockets.has(socket.name)) {
        collapsedSockets.delete(socket.name);
      } else {
        collapsedSockets.add(socket.name);
      }
      render();
      return;
    }
    handlers?.onOpenSocket(socket);
  });

  item.append(row);
  if (expanded) {
    item.append(pagesNode());
  }
  return item;
}

function pagesNode(): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'tree-pages';
  for (const target of pages) {
    const item = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'side-item tree-page';
    row.dataset.targetId = target.id;
    row.classList.toggle('active', target.id === activeTargetId);
    const title = document.createElement('strong');
    title.className = 'side-item-title';
    title.textContent = pageTitle(target);
    title.title = target.url || target.id;
    const sub = document.createElement('small');
    sub.className = 'side-item-sub';
    sub.textContent = target.type;
    row.append(title, sub);
    row.addEventListener('click', () => handlers?.onSelectTarget(target));
    item.append(row);
    list.append(item);
  }
  return list;
}

function render(): void {
  const root = treeRoot();
  if (!root) {
    return;
  }
  root.replaceChildren();
  if (scanPending) {
    root.append(placeholder(t('scan.reading')));
    return;
  }
  if (sockets.length === 0) {
    root.append(placeholder(t('sockets.empty')));
    return;
  }
  for (const socket of sockets) {
    root.append(appNode(socket));
  }
}

onLocaleChange(render);
