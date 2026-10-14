#!/usr/bin/env node
/**
 * 로컬 개발 서버 동시 실행 — API(:4000) + Web(:5173). Windows/macOS/Linux 공통.
 *   npm run dev
 */
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: '\x1b[36m', args: ['run', 'dev', '-w', '@saju/api'] },
  { name: 'web', color: '\x1b[35m', args: ['run', 'dev', '-w', '@saju/web'] },
];

const children = procs.map(({ name, color, args }) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}종료 (code ${code})\n`);
    shutdown();
  });
  return child;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const c of children) if (!c.killed) c.kill();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
