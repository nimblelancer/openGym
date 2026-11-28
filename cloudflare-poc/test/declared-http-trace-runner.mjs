import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { classifyDeliveryError } from './delivery-error-class.mjs';

export async function traceRunner(config='wrangler.jsonc',opts={}) {
  const dir = await mkdtemp(join(tmpdir(), 'opengym-poc-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const origin='http://localhost:'+port;
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
    const vars=opts.vars?.(origin)||{};
    child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js','dev','--config',config,'--local','--ip','127.0.0.1',
      '--port',String(port),'--persist-to',dir,...Object.entries(vars).flatMap(([k,v])=>['--var',k+':'+v])], { env, ...(opts.cwd?{cwd:opts.cwd}:{}), detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', b => { log = (log + b).slice(-20000); });
    child.stderr.on('data', b => { log = (log + b).slice(-20000); });
    for (let i=0; i<120; i++) {
      if (child.exitCode !== null) break;
      try { const res = await fetch(base + (opts.health||'/__poc/health'), { signal: AbortSignal.timeout(1000) }); if (res.ok || (opts.allowUnavailable&&res.status===503)) return; } catch {}
      await sleep(500);
    }
    if(opts.syntheticDiagnostics){
      // Only this disposable Phase 5 harness opts in. Never print supplied variable values.
      let safe=log;
      for(const value of Object.values(vars))if(typeof value==='string'&&value.length>=8)safe=safe.split(value).join('[redacted]');
      safe=safe.replace(/[a-f0-9]{64}/gi,'[redacted]').replace(/(Bearer\s+)\S+/gi,'$1[redacted]');
      console.error('Phase 5 redacted startup tail:',safe.slice(-6000));
    }
    throw new Error(opts.privateLogs?'local Worker failed to start (private logs suppressed)':'local Worker failed to start: '+log);
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
  return { start, stop, call, base, origin, dir, deliveryClasses(){return classifyDeliveryError(log)}, controlSummary(){return [...log.matchAll(/P7CONTROL:(early|drain):return:413/g)].map(m=>m[1])}, traceSummary(){
    // Only fixed marker grammar is exposed, never raw Wrangler logs.
    const events=[...log.matchAll(/P7TRACE:(OUTER|DO):(entry|return|throw)(?::([1-5][0-9][0-9]))?/g)].map(m=>({layer:m[1],event:m[2],...(m[3]?{status:Number(m[3])}:{})}));
    return events.slice(-32);
  }, async cleanup() { await stop(); await rm(dir,{recursive:true,force:true}); if(log&&!opts.privateLogs) console.log('Wrangler tail:',log); } };
}
