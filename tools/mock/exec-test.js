#!/usr/bin/env node
const { spawn } = require('child_process');

const cmd = process.argv.slice(2).join(' ') || (process.platform === 'win32' ? 'timeout 5' : 'sleep 5');
const timeoutMs = Number(process.env.EXEC_TEST_TIMEOUT_MS || '2000');

console.log('Exec test running command:', cmd, 'with timeout', timeoutMs);
const child = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

let stdout = '';
let stderr = '';
child.stdout.on('data', (b) => { stdout += b.toString(); process.stdout.write(b); });
child.stderr.on('data', (b) => { stderr += b.toString(); process.stderr.write(b); });

const killHandle = setTimeout(() => {
  try { child.kill('SIGKILL'); console.log('Killed child due to timeout'); } catch (e) {}
}, timeoutMs);

child.on('close', (code, signal) => {
  clearTimeout(killHandle);
  console.log('Child exited', { code, signal, stdout, stderr });
  process.exit(code === 0 ? 0 : 2);
});
