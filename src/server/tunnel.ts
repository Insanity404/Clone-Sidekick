/* ────────────────────────────────────────────────────────────────
 *  Cloudflare Tunnel — managed child process
 * ──────────────────────────────────────────────────────────────── */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './configStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tunnelProcess: ChildProcess | null = null;

/** Only log lines that indicate meaningful state changes, not routine chatter. */
function isImportantLine(line: string): boolean {
  const lower = line.toLowerCase();
  // Connection registered / disconnected / errors
  if (lower.includes('registered') || lower.includes('unregistered')) return true;
  if (lower.includes('connection') && (lower.includes('error') || lower.includes('disconnect'))) return true;
  if (lower.includes('err') || lower.includes('failed') || lower.includes('unable')) return true;
  // Tunnel ready / serving
  if (lower.includes('serving') || lower.includes('ready') || lower.includes('initial')) return true;
  return false;
}

export function startTunnel() {
  if (tunnelProcess) return; // already running

  const cfgPath = path.resolve(__dirname, '../../cloudflared.yml');

  console.log(`  🌐 Starting Cloudflare Tunnel → https://${config.tunnel.hostname}`);

  tunnelProcess = spawn('cloudflared', ['tunnel', '--config', cfgPath, 'run'], {
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
      console.warn(`  ⚠  cloudflared exited (code ${code}). Is cloudflared installed?`);
      console.warn(`     Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
    }
  });

  tunnelProcess.on('error', (err: NodeJS.ErrnoException) => {
    tunnelProcess = null;
    if (err.code === 'ENOENT') {
      console.warn(`  ⚠  cloudflared not found. Install it and re-run, or run manually: npm run tunnel`);
      console.warn(`     Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
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
