'use strict';

const { validatePayload } = require('./src/payload.validator');
const { NonRetryableError, isRetryable } = require('./src/errors');
const { log } = require('./src/logger');
const h = require('./src/handler');

let pass = 0, fail = 0;

function assert(label, fn) {
  try {
    fn();
    console.log('  PASS', label);
    pass++;
  } catch (e) {
    console.error('  FAIL', label + ':', e.message);
    fail++;
  }
}

// ── validatePayload ───────────────────────────────────────────────────────────
console.log('\n[validatePayload]');
assert('valid payload passes', () => {
  validatePayload({ applicationId: 'a1', applicantName: 'Jane', applicantEmail: 'j@x.com' });
});
assert('null throws NonRetryableError', () => {
  try { validatePayload(null); throw new Error('should have thrown'); }
  catch (e) { if (!(e instanceof NonRetryableError)) throw new Error('wrong type: ' + e.constructor.name); }
});
assert('missing applicantEmail throws NonRetryableError', () => {
  try { validatePayload({ applicationId: 'a1', applicantName: 'Jane' }); throw new Error('should have thrown'); }
  catch (e) { if (!(e instanceof NonRetryableError)) throw new Error('wrong type'); }
});
assert('empty string field throws NonRetryableError', () => {
  try { validatePayload({ applicationId: '', applicantName: 'Jane', applicantEmail: 'j@x.com' }); throw new Error('should have thrown'); }
  catch (e) { if (!(e instanceof NonRetryableError)) throw new Error('wrong type'); }
});

// ── isRetryable ───────────────────────────────────────────────────────────────
console.log('\n[isRetryable]');
assert('no response → retryable',  () => { if (!isRetryable({})) throw new Error('expected true'); });
assert('429 → retryable',          () => { if (!isRetryable({ response: { status: 429 } })) throw new Error('expected true'); });
assert('503 → retryable',          () => { if (!isRetryable({ response: { status: 503 } })) throw new Error('expected true'); });
assert('400 → not retryable',      () => { if (isRetryable({ response: { status: 400 } })) throw new Error('expected false'); });
assert('404 → not retryable',      () => { if (isRetryable({ response: { status: 404 } })) throw new Error('expected false'); });
assert('422 → not retryable',      () => { if (isRetryable({ response: { status: 422 } })) throw new Error('expected false'); });

// ── logger ────────────────────────────────────────────────────────────────────
console.log('\n[logger]');
assert('log info produces valid JSON', () => {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(s);
  log('info', 'hello', { x: 1 });
  console.log = orig;
  const parsed = JSON.parse(lines[0]);
  if (parsed.level !== 'info') throw new Error('wrong level');
  if (parsed.message !== 'hello') throw new Error('wrong message');
  if (parsed.x !== 1) throw new Error('missing field');
  if (!parsed.ts) throw new Error('missing ts');
});
assert('log error produces valid JSON', () => {
  const lines = [];
  const orig = console.error;
  console.error = (s) => lines.push(s);
  log('error', 'boom');
  console.error = orig;
  const parsed = JSON.parse(lines[0]);
  if (parsed.level !== 'error') throw new Error('wrong level');
});

// ── handler exports ───────────────────────────────────────────────────────────
console.log('\n[handler]');
assert('exports.handler is a function', () => {
  if (typeof h.handler !== 'function') throw new Error('not a function');
});
assert('only one export (handler)', () => {
  const keys = Object.keys(h);
  if (keys.length !== 1 || keys[0] !== 'handler') throw new Error('unexpected exports: ' + keys.join(', '));
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? '✓' : '✗'), pass + ' passed,', fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);
