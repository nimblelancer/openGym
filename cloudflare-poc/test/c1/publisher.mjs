import {adapter,publish,recordPath,inventory} from './storage.mjs';
import {parse,decode} from './contract.mjs';
const [root,mode,raw]=process.argv.slice(2);
if(mode==='publish'){const fs=adapter(root),writes=[];const write=fs.writeFile;fs.writeFile=async o=>{writes.push(o.path);if(!o.path.startsWith('p7-c1-records/'))throw Error('outside record namespace');return write(o)};const bytes=Buffer.from(raw,'base64'),r=parse(bytes,{exact:true});decode(bytes,r.id);await publish(fs,recordPath(r.id),bytes);console.log(JSON.stringify({pid:process.pid,writes:writes.length,recordOnly:writes.every(p=>p===recordPath(r.id))}))}
else {const inv=await inventory(adapter(root));console.log(JSON.stringify({pid:process.pid,complete:inv.complete,count:inv.records.size,held:inv.held.length}))}
