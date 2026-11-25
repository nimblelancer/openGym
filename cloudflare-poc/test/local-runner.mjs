import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

export async function localRunner(config='wrangler.jsonc') {
  const dir = await mkdtemp(join(tmpdir(), 'opengym-poc-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  let child, log = '';
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
  for (const k of Object.keys(env)) if (/^(CLOUDFLARE_|CF_API_|CF_ACCOUNT_)/.test(k)) delete env[k];
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json', 'X-POC': 'fixture' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    console.log(method, path, res.status, 'local DO wall ms:', res.headers.get('x-poc-wall-ms'));
    return { status: res.status, data, cookies: res.headers.getSetCookie() };
  };
  async function start() {
    child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js','dev','--config',config,'--local','--ip','127.0.0.1',
      '--port',String(port),'--persist-to',dir], { env, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', b => { log = (log + b).slice(-20000); });
    child.stderr.on('data', b => { log = (log + b).slice(-20000); });
    for (let i=0; i<120; i++) {
      if (child.exitCode !== null) break;
      try { const res = await fetch(base + '/__poc/health', { signal: AbortSignal.timeout(1000) }); if (res.ok) return; } catch {}
      await sleep(500);
    }
    throw new Error('local Worker failed to start: ' + log);
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill();
    await Promise.race([exited, sleep(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL');
      await exited;
    }
  }
  return { start, stop, call, async cleanup() { await stop(); await rm(dir,{recursive:true,force:true}); if(log) console.log('Wrangler tail:',log); } };
}
