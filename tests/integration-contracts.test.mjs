import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=fs.readFileSync('api/index.js','utf8');
const web=fs.readFileSync('webapp.html','utf8');
const enable=fs.readFileSync('webapp-enable.js','utf8');
test('Paddle webhook verifies signature before processing',()=>{
 const at=api.indexOf('if (key === "POST /billing/paddle/webhook")');
 assert.ok(at>=0);
 const block=api.slice(at,at+900);
 assert.ok(block.includes('sig(rawBody, req.headers["paddle-signature"])'));
 assert.ok(block.indexOf('sig(rawBody')<block.indexOf('JSON.parse(rawBody'));
});
test('Enable Banking private key remains server side',()=>{
 assert.ok(api.includes('/etc/secrets/enablebanking-private.pem'));
 assert.ok(api.includes('RSA-SHA256'));
 assert.ok(!web.includes('BEGIN PRIVATE KEY'));
 assert.ok(!enable.includes('BEGIN PRIVATE KEY'));
});
test('Bank authorization requires user and state',()=>{
 assert.ok(api.includes('enable_bank_pending'));
 assert.ok(api.includes('invalid_or_expired_state'));
 assert.ok(enable.includes('enableBankState'));
});
test('Legacy YAXI routes retired',()=>{assert.ok(!api.includes('/bank-connect/ticket'));assert.ok(!api.includes('YAXI_API_KEY'));});
test('Web app includes Enable Banking UI',()=>{
 assert.ok(web.includes('id="enableBankConnect"'));
 assert.ok(web.includes('webapp-enable.js'));
});
test('Feature usage and item checks exist',()=>{
 assert.ok(api.includes('POST /feature-usage/consume'));
 assert.ok(api.includes('POST /feature-items/add'));
 assert.ok(api.includes('feature_limit_reached'));
});
