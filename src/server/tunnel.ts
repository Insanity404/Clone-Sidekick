/* ────────────────────────────────────────────────────────────────
 *  Cloudflare Tunnel — managed child process (token mode only)
 * ──────────────────────────────────────────────────────────────── */

import { spawn, type ChildProcess } from 'child_process';
import { config } from './configStore.js';

let tunnelProcess: ChildProcess | null = null;

/** Only log lines that indicate meaningful state changes, not routine chatter. */
function isImportantLine(line: string): boolean {
  const lower = line.toLowerCase();
  if (lower.includes('registered') || lower.includes('unregistered')) return true;
  if (lower.includes('connection') && (lower.includes('error') || lower.includes('disconnect'))) return true;
  if (lower.includes('err') || lower.includes('failed') || lower.includes('unable')) return true;
  if (lower.includes('serving') || lower.includes('ready') || lower.includes('initial')) return true;
  return false;
}

export function startTunnel() {
  if (tunnelProcess) return;

  if (!config.tunnel.token) {
    console.warn('  ⚠  Tunnel enabled but no token configured. Open Settings and paste your Cloudflare Tunnel token.');
    return;
  }

  console.log(`  🌐 Starting Cloudflare Tunnel → https://${config.tunnel.hostname}`);

  tunnelProcess = spawn('cloudflared', ['tunnel', 'run', '--token', config.tunnel.token], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  tunnelProcess.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line && isImportantLine(line)) console.log(`  [cloudflared] ${line}`);
  });

  tunnelProcess.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line && isImportantLine(line)) console.log(`  [cloudflared] ${line}`);
  });

  tunnelProcess.on('exit', (code, signal) => {
    tunnelProcess = null;
    if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.warn(`  ⚠  cloudflared exited unexpectedly (code ${code}).`);
      console.warn(`     Check that cloudflared is installed and your tunnel token is valid.`);
      console.warn(`     Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
    }
  });

  tunnelProcess.on('error', (err: NodeJS.ErrnoException) => {
    tunnelProcess = null;
    if (err.code === 'ENOENT') {
      console.warn(`  ⚠  cloudflared not found. Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
    } else {
      console.warn(`  ⚠  cloudflared error: ${err.message}`);
    }
  });
}

export function stopTunnel() {
  if (tunnelProcess) {
    tunnelProcess.kill('SIGTERM');
    tunnelProcess = null;
  }
}
