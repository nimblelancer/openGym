// Local-only web shell; upstream nginx CSP pinned at the reviewed Dockerfile.
import api,{AuthCoordinator} from './api-worker.js';
export {AuthCoordinator};
const CSP="default-src 'self'; script-src 'self' 'sha256-G6hveK3W3qL6wotsg9mMbpCvPnzXurSHhi8Jb3TS2Vc='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https: http:; worker-src 'self'; manifest-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function headers(response,p){
  const h=new Headers(response.headers);
  h.set('X-Frame-Options','DENY');h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','same-origin');h.set('Content-Security-Policy',CSP);
  h.set('Cache-Control',response.ok&&/^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(js|css)$/.test(p)?'public, max-age=31536000, immutable':response.ok&&/^\/exercise-media\/(still|clip)\/[0-9]+\.(webp|mp4)$/.test(p)?'public, max-age=2592000, immutable':'no-cache, must-revalidate');
  if(p.startsWith('/exercise-media/'))h.set('Cross-Origin-Resource-Policy','same-origin');
  return new Response(response.body,{status:response.status,headers:h});
}
const notFound=()=>Response.json({error:'not found'},{status:404,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {async fetch(req,env){
  const u=new URL(req.url),p=u.pathname;
  if(!['localhost','127.0.0.1'].includes(u.hostname))return new Response('local only',{status:403});
  if(p==='/api'||p.startsWith('/api/'))return api.fetch(req,env);
  if(p==='/mcp'||p.startsWith('/mcp/')||p.startsWith('/.well-known/')||/%|\\/.test(p))return notFound();
  if(!['GET','HEAD'].includes(req.method))return notFound();
  if(!env.ASSETS)return new Response('assets unavailable',{status:503});
  const index=()=>env.ASSETS.fetch(new Request(new URL('/index.html',u),{method:req.method,headers:req.headers}));
  let r=p==='/'?await index():await env.ASSETS.fetch(req);
  if(r.status===404&&!p.startsWith('/assets/')&&!p.startsWith('/exercise-media/')&&!p.split('/').some(x=>x.includes('.'))&&req.headers.get('accept')?.includes('text/html')){
    await r.body?.cancel();r=await index();return headers(r,'/index.html');
  }
  return headers(r,p==='/'?'/index.html':p);
}};
