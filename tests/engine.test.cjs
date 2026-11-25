const {test} = require('node:test');
const assert = require('node:assert/strict');
const {classify, rpc, transform} = require('../extension/engine.js');
const config = (country = false, age = true) => { const a = Array(34).fill(null); a[0] = 'Привет 🌊'; a[30] = country; a[31] = age; return a; };
const batch = (c = false, a = true) => JSON.stringify([['wrb.fr', 'cPZSdc', JSON.stringify(config(c, a))]]);
const unpack = body => JSON.parse(JSON.parse(body)[0][2]);
test('only exact origin and known endpoints', () => {
  assert.equal(classify('/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=x,cPZSdc'), 'rpc');
  assert.equal(classify(new URL('https://flow.google.com/checkAppAvailability')), 'availability');
  for (const s of ['https://flow.google.com.evil.test/checkAppAvailability', 'https://other.test/checkAppAvailability', '/foo?checkAppAvailability', '/trpc/general.delete', '/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=other']) assert.equal(classify(s), null);
});
test('country only, preserving payload types and other fields', () => {
  for (const value of [false, null, 0]) {
    const r = transform(batch(value), 'rpc');
    assert.equal(r.changed, 1);
    const actual = unpack(r.body), expected = config(value); expected[30] = value === 0 ? 1 : true;
    assert.deepEqual(actual, expected);
    assert.equal(transform(r.body, 'rpc').changed, 0);
  }
});
test('age denial and unknown age remain unchanged', () => {
  for (const age of [false, 0, null, 'unknown']) { const raw = batch(false, age); const r = transform(raw, 'rpc'); assert.equal(r.body, raw); assert.equal(r.blocked, true); }
});
test('unknown schema is unchanged; no array expansion', () => {
  for (const cfg of [[], [1], config('new-schema'), {}]) {
    const raw = JSON.stringify([['wrb.fr', 'cPZSdc', JSON.stringify(cfg)]]);
    assert.equal(transform(raw, 'rpc').body, raw);
    assert.equal(transform(raw, 'rpc').mismatch, true);
  }
});
test('unrelated RPC and malformed data preserved', () => {
  for (const raw of ['bad json', '[]', '{}', batch().replace('cPZSdc','another'), '[ ["wrb.fr","cPZSdc","bad"] ]']) assert.equal(transform(raw, 'rpc').body, raw);
  assert.equal(rpc(null).changed, 0);
});
test('UTF8 and UTF16 framed responses retain exact framing convention', () => {
  for (const measure of [s => Buffer.byteLength(s), s => s.length]) for (const offset of [0, 1, 2]) {
    const raw = batch(); const framed = ")]}'\n\n" + (measure(raw) + offset) + '\n' + raw + '\n';
    const r = transform(framed, 'rpc'); assert.equal(r.changed, 1);
    const lines = r.body.split('\n'); assert.equal(Number(lines[2]), measure(lines[3]) + offset);
    assert.equal(unpack(lines[3])[30], true);
  }
});
test('multiple frames, CRLF and XSSI plain JSON', () => {
  const raw = batch(), chunk = `${Buffer.byteLength(raw)}\r\n${raw}\r\n`;
  const r = transform(")]}'\r\n\r\n" + chunk + chunk, 'rpc'); assert.equal(r.changed, 2);
  assert.equal(transform(")]}'\n\n" + raw, 'rpc').changed, 1);
});
test('invalid frame length rolls back all edits', () => {
  const raw = batch(), input = `1\n${raw}\n`;
  const r = transform(input, 'rpc'); assert.equal(r.body, input); assert.equal(r.changed, 0); assert.equal(r.mismatch, true);
});
test('REST flags and explicit region states', () => {
  const r = transform(JSON.stringify({result: {isCountrySupported: false, availabilityState: 'UNAVAILABLE', isAgeSupported: true, credits: 0}}), 'availability');
  assert.deepEqual(JSON.parse(r.body), {result: {isCountrySupported: true, availabilityState: 'AVAILABLE', isAgeSupported: true, credits: 0}});
  assert.equal(JSON.parse(transform('{"availabilityState":"COUNTRY_UNSUPPORTED"}', 'availability').body).availabilityState, 'AVAILABLE');
});
test('errors, age, quota and auth restrictions preserved', () => {
  for (const data of [{error:{isCountrySupported:false}}, {isCountrySupported:false,isAgeSupported:false}, {isCountrySupported:false,availabilityState:'QUOTA_EXCEEDED'}, {availabilityState:'UNAVAILABLE'}]) {
    const raw = JSON.stringify(data); assert.equal(transform(raw, 'availability').body, raw);
  }
});
test('large body is unchanged', () => { const raw = ' '.repeat(2097153); assert.equal(transform(raw, 'rpc').body, raw); });
