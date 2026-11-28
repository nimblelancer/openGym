import {adapter,publish,recordPath,inventory} from './storage.mjs';
import {parse,decode} from './contract.mjs';
const [root,mode,raw]=process.argv.slice(2);
if(mode==='publish'){const bytes=Buffer.from(raw,'base64'),r=parse(bytes,{exact:true});decode(bytes,r.id);await publish(adapter(root),recordPath(r.id),bytes);console.log(JSON.stringify({pid:process.pid}))}
else {const inv=await inventory(adapter(root));console.log(JSON.stringify({pid:process.pid,complete:inv.complete,count:inv.records.size,held:inv.held.length}))}
