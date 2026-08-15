#!/usr/bin/env node
/**
 * 下载内置的 Chrome DevTools frontend 兜底副本到 public/devtools/。
 *
 * 官方托管源 chrome-devtools-frontend.appspot.com 在中国大陆直连不可达，
 * 运行时会在官方源失败后自动回退到这份副本（见 src/devtools/frame.ts）。
 *
 * 默认从 npmmirror 下载（大陆可直连），可用 --registry 覆盖：
 *   node scripts/fetch-devtools-frontend.mjs --registry https://registry.npmjs.org
 *
 * 版本与 sha512 固定在本脚本内，避免 registry 侧内容变化引入供应链风险。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'chrome-devtools-frontend-prebuilt';
const PACKAGE_VERSION = '1.0.975442';
const PACKAGE_INTEGRITY =
  'sha512-vKGn3em2JxrtWhyzPYPaOdggYMrTjpHmnHEmteTFzbRBTb8/TWVc7IUqWPGLCoWMbkv7qyHpgw3h8PLlDZY/jQ==';
const DEFAULT_REGISTRY = 'https://registry.npmmirror.com';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const targetDir = path.join(projectRoot, 'public', 'devtools');

function parseRegistry(args) {
  const index = args.indexOf('--registry');
  if (index !== -1 && args[index + 1]) {
    return args[index + 1].replace(/\/$/u, '');
  }
  return DEFAULT_REGISTRY;
}

function summarize(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = summarize(full);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += statSync(full).size;
    }
  }
  return { files, bytes };
}

const registry = parseRegistry(process.argv.slice(2));
const tarballUrl = `${registry}/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`;
const workDir = mkdtempSync(path.join(tmpdir(), 'webhdc-devtools-'));

try {
  process.stdout.write(`正在下载 ${tarballUrl} …\n`);
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (integrity !== PACKAGE_INTEGRITY) {
    throw new Error(
      `sha512 校验失败\n期望 ${PACKAGE_INTEGRITY}\n实际 ${integrity}`,
    );
  }

  const tarball = path.join(workDir, 'frontend.tgz');
  const extractDir = path.join(workDir, 'extract');
  writeFileSync(tarball, bytes);
  mkdirSync(extractDir, { recursive: true });
  const tar = spawnSync('tar', ['-xzf', tarball, '-C', extractDir], {
    stdio: 'inherit',
  });
  if (tar.error) {
    throw new Error(`无法调用 tar：${tar.error.message}`);
  }
  if (tar.status !== 0) {
    throw new Error(`tar 解压失败（exit ${tar.status}）`);
  }

  const packagePublic = path.join(extractDir, 'package', 'public');
  if (!existsSync(path.join(packagePublic, 'inspector.html'))) {
    throw new Error(`包结构与预期不符：缺少 ${packagePublic}/inspector.html`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(path.dirname(targetDir), { recursive: true });
  cpSync(packagePublic, targetDir, { recursive: true });

  const { files, bytes: size } = summarize(targetDir);
  process.stdout.write(
    `已安装 ${PACKAGE_NAME}@${PACKAGE_VERSION} → public/devtools/` +
      `（${files} 个文件，${(size / 1_048_576).toFixed(1)} MB）\n` +
      '官方 DevTools 前端不可达时将自动回退到该内置副本。\n',
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
