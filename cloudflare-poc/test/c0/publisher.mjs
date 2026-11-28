// Independent Node process, same publication protocol, no shared memory.
import { readFileSync } from 'node:fs';
import { diskAdapter } from './disk-adapter.mjs';
import { makeRecord, publish, inventory } from './records.mjs';
const [root,mode]=process.argv.slice(2);
if (mode==='inventory') {
  const found=await inventory(diskAdapter(root));
  process.stdout.write(JSON.stringify({pid:process.pid,...found}));
} else {
  const record=makeRecord(JSON.parse(readFileSync(0,'utf8')));
  const result=await publish(diskAdapter(root),record);
  process.stdout.write(JSON.stringify({pid:process.pid,...result}));
}
