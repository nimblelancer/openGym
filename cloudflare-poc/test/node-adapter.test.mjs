import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRunner } from './local-runner.mjs';
test('isolated local Node HTTP adapter', {timeout:90000}, async () => {
  const runner = await localRunner('wrangler.node.jsonc');
  const { start, call } = runner;
  try {
    await start();
    const echo = await call('/__poc/node?q=1','POST',{ hello:'node' });
    assert.equal(echo.status,200); assert.equal(echo.data.method,'POST'); assert.equal(echo.data.url,'/__poc/node?q=1');
    assert.equal(echo.data.header,'fixture'); assert.deepEqual(JSON.parse(echo.data.data),{hello:'node'});
    assert.equal(echo.cookies.length,2);
  } finally { await runner.cleanup(); }
});
