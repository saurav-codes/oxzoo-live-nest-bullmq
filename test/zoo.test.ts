import assert from 'node:assert/strict';
import { test } from 'node:test';
import { corsHeaders, describeVars, fp, health, isZooCorsPath, parseOrigins, preflightHeaders, Prober, RateLimit, serverLabel, validTrace } from '../src/zoo.ts';

const meta = { name: 'nest-bullmq', stack: 'NestJS + BullMQ' };

test('fingerprint matches the DESIGN.md test vector', () => {
  assert.equal(fp('zoo-test-key-0123456789abcdef'), '915a');
});

test('server label comes from PUBLIC_HOST', () => {
  assert.equal(serverLabel('nest-bullmq.s1.zoo.sorv.dev'), 's1');
  assert.equal(serverLabel('localhost'), 'local');
  assert.equal(serverLabel(undefined), 'local');
});

test('health shape', () => {
  const started = new Date('2026-10-09T10:00:00.123Z');
  const h = health(meta, { OX_RELEASE: '3f9c2a1b4c5d6e7f', OX_ENV: 'production', PUBLIC_HOST: 'nest-bullmq.s1.zoo.sorv.dev' }, started,
    { runtime: 'node 24.0.0', built_at: '2026-10-09T09:58:00Z' }, new Date('2026-10-09T10:20:34Z'));
  assert.deepEqual(h, {
    name: 'nest-bullmq', stack: 'NestJS + BullMQ', server: 's1', release: '3f9c2a1b4c5d', env: 'production',
    uptime_s: 1233, started_at: '2026-10-09T10:00:00Z', build: { runtime: 'node 24.0.0', built_at: '2026-10-09T09:58:00Z' },
  });
  const local = health(meta, {}, started, { runtime: 'node' });
  assert.equal(local.release, 'unknown');
  assert.equal(local.env, 'local');
  assert.equal(local.server, 'local');
});

test('CORS echoes only listed origins, never *', () => {
  const allowed = parseOrigins(' https://zoo-control.s1.zoo.sorv.dev , http://localhost:5173,');
  assert.deepEqual(allowed, ['https://zoo-control.s1.zoo.sorv.dev', 'http://localhost:5173']);
  assert.deepEqual(corsHeaders('http://localhost:5173', allowed), { 'Access-Control-Allow-Origin': 'http://localhost:5173', Vary: 'Origin' });
  assert.deepEqual(corsHeaders('https://evil.example', allowed), {});
  assert.deepEqual(corsHeaders(undefined, allowed), {});
  assert.deepEqual(corsHeaders('http://localhost:5173', parseOrigins(undefined)), {});
  const pre = preflightHeaders('https://zoo-control.s1.zoo.sorv.dev', allowed);
  assert.equal(pre['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS');
  assert.equal(pre['Access-Control-Allow-Headers'], 'Content-Type');
  assert.equal(pre['Access-Control-Max-Age'], '600');
  assert.equal(pre['Access-Control-Allow-Credentials'], undefined);
  assert.deepEqual(preflightHeaders('https://evil.example', allowed), {});
  assert.ok(isZooCorsPath('/_zoo/probe') && isZooCorsPath('/_zoo/trace/x') && !isZooCorsPath('/api/queue'));
});

test('vars show fingerprints for secrets and values for plain config', () => {
  const vars = describeVars(
    [{ name: 'DATABASE_URL', role: 'service', secret: true }, { name: 'ZOO_PANEL_ORIGIN', role: 'plain' }, { name: 'REDIS_URL', role: 'service', secret: true }],
    { DATABASE_URL: 'zoo-test-key-0123456789abcdef', ZOO_PANEL_ORIGIN: 'https://zoo-control.s1.zoo.sorv.dev' },
  );
  assert.deepEqual(vars, [
    { name: 'DATABASE_URL', role: 'service', fp: '915a' },
    { name: 'ZOO_PANEL_ORIGIN', role: 'plain', value: 'https://zoo-control.s1.zoo.sorv.dev' },
    { name: 'REDIS_URL', role: 'service', missing: true },
  ]);
});

test('trace ids', () => {
  assert.ok(validTrace('0f8fad5b-d9cb-469f-a165-70867728950e'));
  for (const bad of ['0F8FAD5B-D9CB-469F-A165-70867728950E', '0f8fad5b-d9cb-469f-a165-70867728950', '../etc/passwd', 42, null]) assert.ok(!validTrace(bad));
});

test('rate limit allows 10 a minute', () => {
  const rl = new RateLimit(10, 60000);
  for (let i = 0; i < 10; i++) assert.ok(rl.allow(1000));
  assert.ok(!rl.allow(1000));
  assert.ok(rl.allow(61001));
});

test('probe: missing vars, timeouts, failures, and secrets kept out of errors', async () => {
  const p = new Prober();
  const env = { REDIS_URL: 'redis://:hunter2secret@127.0.0.1:1/0', PUBLIC_HOST: 'nest-bullmq.s1.zoo.sorv.dev' };
  const { status, body } = await p.probe(meta, env, [
    { id: 'postgres', label: 'pg', env: ['DATABASE_URL'], run: async () => 'never' },
    { id: 'redis', label: 'redis', env: ['REDIS_URL'], run: async () => { throw new Error(`cannot reach ${env.REDIS_URL}`); } },
    { id: 'slow', label: 'slow', env: [], timeoutMs: 30, run: () => new Promise(() => {}) },
    { id: 'fine', label: 'fine', env: [], run: async () => 'done' },
  ], [{ name: 'REDIS_URL', role: 'service', secret: true }]);
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  const checks = body.checks as { id: string; ok: boolean; error?: string; detail?: string; hops: string[] }[];
  assert.equal(checks[0].error, 'DATABASE_URL is not set');
  assert.ok(!checks[1].error!.includes('hunter2secret'));
  assert.equal(checks[2].error, 'timeout after 30 ms');
  assert.equal(checks[3].ok, true);
  assert.deepEqual(checks[3].hops, ['nest-bullmq@s1']);
});

test('probe: one at a time, a second waits, then 429', async () => {
  const p = new Prober();
  const slow = [{ id: 's', label: 's', env: [], run: () => new Promise<string>((r) => setTimeout(() => r('ok'), 80)) }];
  const [a, b, c] = await Promise.all([p.probe(meta, {}, slow, []), p.probe(meta, {}, slow, [], 200), p.probe(meta, {}, slow, [], 20)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 429);
  assert.deepEqual(c.body, { error: 'probe busy' });
});
