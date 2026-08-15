export function cleanTerminalText(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI escape sequence
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
      .replaceAll('\r\n', '\n')
      .replace(/\r(?!\n)/gu, '\n')
  );
}

export function parseProcessTable(output: string): Map<string, string> {
  const packages = new Map<string, string>();
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  let pidIndex = -1;
  let nameIndex = -1;

  for (const line of lines) {
    const columns = line.split(/\s+/u);
    if (pidIndex < 0) {
      pidIndex = columns.indexOf('PID');
      nameIndex = columns.findIndex(
        (column) =>
          column === 'NAME' || column === 'CMD' || column === 'COMMAND',
      );
      if (pidIndex < 0 || nameIndex < 0) {
        continue;
      }
    }
    const pid = columns[pidIndex];
    if (!/^\d+$/u.test(pid ?? '')) {
      continue;
    }
    const name = columns.slice(nameIndex).join(' ').trim();
    if (name && name !== 'CMD' && name !== 'NAME') {
      packages.set(pid, name);
    }
  }
  return packages;
}

export function normalizePackageName(value: string): string {
  const name = value.trim();
  if (!name) {
    return '';
  }
  const withoutPath = name.includes('/')
    ? (name.split('/').at(-1) ?? name)
    : name;
  return withoutPath.split(':', 1)[0] ?? withoutPath;
}

/**
 * 构造一条命令批量读取多个 PID 的 cmdline：逐个 `cat` 是 N 次 USB 往返，
 * 拼成单次 exec 后只有一次。`===<pid>===` 标记行用于切分各 PID 的内容；
 * 不使用引号，兼容只做空白分词的 shell 通道。
 */
export function buildCmdlineBatchCommand(pids: string[]): string {
  const list = pids.filter((pid) => /^\d+$/u.test(pid)).join(' ');
  if (!list) {
    return '';
  }
  return `for p in ${list}; do echo ===$p===; cat /proc/$p/cmdline; echo; done 2>/dev/null`;
}

export function parseCmdlineBatchOutput(output: string): Map<string, string> {
  const packages = new Map<string, string>();
  let current: string | null = null;
  const parts: string[] = [];
  const flush = (): void => {
    if (current === null) {
      return;
    }
    const name = parts.join(' ').replaceAll('\0', ' ').trim();
    if (name) {
      packages.set(current, name);
    }
  };
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^===(\d+)===$/u);
    if (match) {
      flush();
      current = match[1] ?? null;
      parts.length = 0;
    } else if (current !== null && line) {
      parts.push(line);
    }
  }
  flush();
  return packages;
}
