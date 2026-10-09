import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHeartbeat, slowHash, validText, waitError } from '../src/jobs.ts';
import { esc, page } from '../src/page.ts';

test('job text is 1 to 200 printable characters', () => {
  assert.equal(validText('  hello  '), 'hello');
  assert.equal(validText(''), null);
  assert.equal(validText('   '), null);
  assert.equal(validText('x'.repeat(201)), null);
  assert.equal(validText('a\u0000b'), null);
  assert.equal(validText(42), null);
});

test('slow hash is deterministic', () => {
  assert.equal(slowHash('zoo', 1), '24fe93c9e17cb80452e5d86f1c186fc2fda2482cd5f81d7d305c2295bdab0aec');
  assert.equal(slowHash('zoo', 3), slowHash(slowHash('zoo', 2), 1));
  assert.match(slowHash('zoo', 10), /^[0-9a-f]{64}$/);
});

test('heartbeat freshness', () => {
  const now = 1_000_000;
  assert.deepEqual(parseHeartbeat(null, now).ok, false);
  assert.equal(parseHeartbeat('not json', now).ok, false);
  assert.equal(parseHeartbeat(JSON.stringify({ at: now - 2000, pid: 7 }), now).detail, 'worker pid 7, last beat 2000 ms ago');
  assert.equal(parseHeartbeat(JSON.stringify({ at: now - 20000, pid: 7 }), now).ok, false);
});

test('a BullMQ wait timeout reads as a missing worker', () => {
  assert.equal(waitError(new Error('Job wait probe timed out before finishing, no finish notification arrived after 4500ms (id=1)'), 4500),
    'no worker finished the job within 4500 ms (is the worker running?)');
  assert.equal(waitError(new Error('bad probe token'), 4500), 'bad probe token');
});

test('page escapes user text', () => {
  assert.equal(esc('<b>"x"&\''), '&#60;b&#62;&#34;x&#34;&#38;&#39;');
  const html = page({ waiting: 1 }, [{ job_id: '1', input: '<script>alert(1)</script>', output: 'ab'.repeat(32), worker: 'pid 1', queued_at: new Date(0), finished_at: new Date(5) }]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('5 ms'));
});
