// Isolated adapter experiment: failure cannot prevent the Fetch/DO POC from booting.
import { handleAsNodeRequest } from 'cloudflare:node';
import { createServer } from 'node:http';
const nodeServer = createServer(async (req, res) => {
  let data = '';
  for await (const part of req) {
    data += part;
    if (Buffer.byteLength(data) > 4096) { res.statusCode = 413; res.end('too large'); return; }
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Set-Cookie', ['poc-a=1; HttpOnly', 'poc-b=2; HttpOnly']);
  res.end(JSON.stringify({ method: req.method, url: req.url, header: req.headers['x-poc'], data }));
});
nodeServer.listen(9090);


export default {
  fetch(request) {
    const url = new URL(request.url);
    if (!['localhost','127.0.0.1'].includes(url.hostname)) return new Response('local only', {status:403});
    if (request.method === 'GET' && url.pathname === '/__poc/health') return Response.json({ok:true});
    if (request.method !== 'POST' || url.pathname !== '/__poc/node') return new Response('not found', {status:404});
    return handleAsNodeRequest(9090,request);
  }
};
