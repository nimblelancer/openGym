// Disposable localhost manual acceptance only. No remote deploy, no persistent user data.
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {localRunner} from './local-runner.mjs';
const page=await readFile(new URL('./manual-passkey.html',import.meta.url));
const js=await readFile(new URL('./manual-passkey-ui.js',import.meta.url));
const setup=randomBytes(32).toString('hex'),secret=randomBytes(32).toString('hex');
let runner,origin,closed=false;
const server=createServer((req,res)=>{
  const send=(status,type,body)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(body);};
  if(!origin||req.headers.host!==new URL(origin).host){send(403,'text/plain','Local host required');return;}
  if(req.method==='GET'&&req.url==='/'){send(200,'text/html; charset=utf-8',page);return;}
  if(req.method==='GET'&&req.url==='/manual-passkey-ui.js'){send(200,'text/javascript; charset=utf-8',js);return;}
  if(!runner||!req.url?.startsWith('/api/')){send(404,'text/plain','Not found');return;}
  const headers={...req.headers};delete headers.host;delete headers.connection;
  const upstream=request(runner.base+req.url,{method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)send(503,'application/json','{"error":"local worker unavailable"}');else res.destroy();});
  req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
const cleanup=async()=>{if(closed)return;closed=true;server.closeAllConnections();server.close();await runner?.cleanup();};
process.once('SIGINT',()=>{cleanup().finally(()=>process.exit(0));});
process.once('SIGTERM',()=>{cleanup().finally(()=>process.exit(0));});
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://localhost:'+server.address().port;
  runner=await localRunner('wrangler.api.jsonc',{health:'/api/health',privateLogs:true,vars:()=>({AUTH_SECRET:secret,SETUP_CODE:setup,API_ORIGIN:origin,RP_ID:'localhost'})});
  await runner.start();
  console.log('Open in a separate browser profile:',origin);
  console.log('Disposable setup code (local terminal only):',setup);
  console.log('Ctrl+C stops both servers and deletes the temporary SQLite state. Remove only the test passkey from your authenticator afterwards.');
}catch(e){await cleanup();throw e;}
