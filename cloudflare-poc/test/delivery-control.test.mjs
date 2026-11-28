import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {traceRunner} from './declared-http-trace-runner.mjs';
import {classifyDeliveryError} from './delivery-error-class.mjs';

test('Phase 7 local synthetic transport controls: unread vs fully consumed body',{timeout:120000},async()=>{
  const runner=await traceRunner('wrangler.phase7-trace.jsonc',{health:'/api/health',privateLogs:true,vars:origin=>({AUTH_SECRET:randomBytes(32).toString('hex'),SETUP_CODE:randomBytes(32).toString('hex'),API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
  const b=Buffer.alloc(8388609,17);
  const send=mode=>new Promise(resolve=>{
    let done=false,responded=false,offset=0,status=null,received=0,marker=false;const chunks=[];
    const finish=outcome=>{if(done)return;done=true;clearTimeout(deadline);req.destroy();resolve({mode,outcome,status,marker,offeredBytes:offset,responseBytes:received,classes:classifyDeliveryError(Buffer.concat(chunks).toString('utf8'))});};
    const req=request(runner.base+'/__p7/'+mode,{method:'PUT',agent:false,headers:{connection:'close','content-type':'application/octet-stream','content-length':b.length}},res=>{
      responded=true;status=res.statusCode;marker=res.headers['x-p7-control']===mode;
      res.on('data',c=>{received+=c.length;if(received>65536){finish('response-bound');return;}chunks.push(c);});
      res.on('end',()=>finish(res.complete?'complete':'incomplete'));
      res.on('aborted',()=>finish('aborted'));res.on('error',()=>finish('response-error'));
    });
    const deadline=setTimeout(()=>finish('deadline'),15000);
    req.on('error',e=>{if(!responded)finish(['EPIPE','ECONNRESET','ETIMEDOUT'].includes(e.code)?e.code:'transport-error');});
    const write=()=>{if(done||responded)return;if(offset===b.length){req.end();return;}const next=Math.min(offset+65536,b.length),part=b.subarray(offset,next);offset=next;if(req.write(part))setImmediate(write);else req.once('drain',write);};
    req.flushHeaders();setImmediate(write);
  });
  try{
    await runner.start();
    const observations=[];
    for(const mode of ['early','drain','early','drain','early','drain'])observations.push(await send(mode));
    await sleep(250);
    console.log('PHASE7_DELIVERY_CONTROL',JSON.stringify({observations,workerReturns:runner.controlSummary(),logClasses:runner.deliveryClasses()}));
    // This is only a control, not original HTTP acceptance. Require the
    // fully-consumed baseline to really deliver the Worker response.
    for(const o of observations.filter(x=>x.mode==='drain')){assert.equal(o.status,413);assert.equal(o.marker,true);assert.equal(o.outcome,'complete');assert.equal(o.offeredBytes,b.length);}
  }finally{await runner.cleanup();}
});
