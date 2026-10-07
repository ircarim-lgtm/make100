'use strict';
const assert = require('node:assert');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bombas-'));
const server = require('./server');

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const call = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  try {
    let r = await call('/api/state');
    assert.ok(r.data.sectors.includes('Centro de Tratamento Intensivo - 3'));
    r = await call('/api/pumps/HMMKB-234-0285');
    assert.strictEqual(r.status, 404);
    r = await call('/api/pumps', 'POST', { code: 'HMMKB-234-0285', name: 'B. Braun', serial: 'C24377', calibrationDue: '2026-03-12', sector: 'Centro de Tratamento Intensivo - 3', who: 'Ana' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual((await call('/api/pumps', 'POST', { code: 'HMMKB-234-0285' })).status, 409);
    assert.strictEqual((await call('/api/pumps/HMMKB-234-0285/move', 'POST', { sector: 'Inexistente' })).status, 400);
    r = await call('/api/pumps/HMMKB-234-0285/move', 'POST', { sector: 'Manutenção', who: 'Bia', note: 'Calibração' });
    assert.strictEqual(r.data.sector, 'Manutenção');
    assert.strictEqual(r.data.history.length, 2);
    assert.strictEqual(r.data.history[0].sector, 'Manutenção');
    assert.strictEqual((await call('/api/sectors/Manuten%C3%A7%C3%A3o', 'DELETE')).status, 409);
    r = await call('/api/state');
    assert.strictEqual(r.data.pumps[0].history, undefined);
    assert.strictEqual((await call('/api/pumps/HMMKB-234-0285', 'DELETE')).status, 200);
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/../server.js')).status !== 500, true);
    console.log('OK');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
});
