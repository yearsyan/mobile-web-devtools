import { describe, expect, it } from 'vitest';
import {
  buildCmdlineBatchCommand,
  cleanTerminalText,
  normalizePackageName,
  parseCmdlineBatchOutput,
  parseProcessTable,
} from '../src/app/packages';

describe('cleanTerminalText', () => {
  it('剥离 ANSI CSI 序列', () => {
    expect(cleanTerminalText('\u001b[31mred\u001b[0m')).toBe('red');
    expect(cleanTerminalText('a\u001b[2Jb')).toBe('ab');
  });

  it('统一换行为 LF', () => {
    expect(cleanTerminalText('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

describe('parseProcessTable', () => {
  it('解析 Android ps -A -o PID,NAME', () => {
    const table = parseProcessTable(
      ['PID NAME', '1 init', '4321 com.example.app', '5000 com.foo:web'].join(
        '\n',
      ),
    );
    expect(table.get('4321')).toBe('com.example.app');
    expect(table.get('5000')).toBe('com.foo:web');
    expect(table.get('1')).toBe('init');
  });

  it('解析 HarmonyOS ps -ef（CMD 列含空格）', () => {
    const table = parseProcessTable(
      [
        'UID PID PPID C STIME TTY TIME CMD',
        'root 42 1 0 12:00 ? 00:00:01 com.example.app --flag',
      ].join('\n'),
    );
    expect(table.get('42')).toBe('com.example.app --flag');
  });

  it('头部出现前跳过无关行', () => {
    const table = parseProcessTable('try again\r\nPID NAME\r\n7 com.app');
    expect(table.get('7')).toBe('com.app');
  });

  it('PID 非数字的行被忽略', () => {
    expect(parseProcessTable('PID NAME\nx com.app').size).toBe(0);
  });
});

describe('normalizePackageName', () => {
  it('保留普通包名', () => {
    expect(normalizePackageName('com.example.app')).toBe('com.example.app');
  });

  it('去掉进程前缀路径', () => {
    expect(normalizePackageName('/system/bin/appspawn')).toBe('appspawn');
    expect(normalizePackageName('a/b/com.app')).toBe('com.app');
  });

  it('去掉 :subprocess 后缀', () => {
    expect(normalizePackageName('com.app:privileged')).toBe('com.app');
  });

  it('空值返回空串', () => {
    expect(normalizePackageName('  ')).toBe('');
  });
});

describe('buildCmdlineBatchCommand / parseCmdlineBatchOutput', () => {
  it('生成单条 for 循环命令，过滤非数字 PID', () => {
    expect(buildCmdlineBatchCommand(['123', '456'])).toBe(
      'for p in 123 456; do echo ===$p===; cat /proc/$p/cmdline; echo; done 2>/dev/null',
    );
    expect(buildCmdlineBatchCommand(['123', 'abc', '456'])).toBe(
      'for p in 123 456; do echo ===$p===; cat /proc/$p/cmdline; echo; done 2>/dev/null',
    );
    expect(buildCmdlineBatchCommand([])).toBe('');
  });

  it('解析标记切分的 cmdline 输出（NUL 分隔参数）', () => {
    const output = [
      '===123===',
      'com.example.app\0--arg\0',
      '===456===',
      '',
      '===789===',
      '/system/bin/hdf\0',
      '',
    ].join('\n');
    const packages = parseCmdlineBatchOutput(output);
    expect(packages.get('123')).toBe('com.example.app --arg');
    expect(packages.has('456')).toBe(false);
    expect(packages.get('789')).toBe('/system/bin/hdf');
  });

  it('命令与解析器往返一致', () => {
    const command = buildCmdlineBatchCommand(['321', '654']);
    // 模拟 shell 执行输出：标记行 + NUL 结尾的 cmdline + 空行。
    const simulated =
      '===321===\ncom.round.trip\0\n===654===\nvendor.pkg\0\n\n';
    expect(command).toContain('321 654');
    const packages = parseCmdlineBatchOutput(simulated);
    expect(packages.get('321')).toBe('com.round.trip');
    expect(packages.get('654')).toBe('vendor.pkg');
  });

  it('无标记输出返回空映射', () => {
    expect(parseCmdlineBatchOutput('random stdout\n')).toEqual(new Map());
  });
});
