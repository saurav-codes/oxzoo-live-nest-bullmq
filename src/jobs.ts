// Pure pieces shared by the app, the worker, and the migration.
import { createHash } from 'node:crypto';

export const QUEUE = 'zoo-jobs';
export const HEARTBEAT_KEY = 'zoo:worker:heartbeat';
export const HEARTBEAT_EVERY_MS = 5000;
export const HEARTBEAT_STALE_MS = 15000;
export const MAX_TEXT = 200;
export const KEEP_RESULTS = 500;
export const HASH_ROUNDS = 20000;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS job_results (
  id          bigserial PRIMARY KEY,
  job_id      text NOT NULL,
  kind        text NOT NULL,
  input       text NOT NULL,
  output      text NOT NULL,
  worker      text NOT NULL,
  queued_at   timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_results_job_id ON job_results (job_id);
CREATE TABLE IF NOT EXISTS zoo_probe (
  token text PRIMARY KEY,
  at    timestamptz NOT NULL DEFAULT now()
);
`;

// The text of a "hash" job: 1 to 200 printable characters.
export function validText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text.length < 1 || text.length > MAX_TEXT) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

// Deliberately a little CPU work, so the queue has something to do.
export function slowHash(text: string, rounds = HASH_ROUNDS): string {
  let h = text;
  for (let i = 0; i < rounds; i++) h = createHash('sha256').update(h).digest('hex');
  return h;
}

export interface Heartbeat {
  at: number;
  pid: number;
}

export function parseHeartbeat(raw: string | null, now = Date.now()): { ok: boolean; detail: string } {
  if (!raw) return { ok: false, detail: `no worker heartbeat in the last ${HEARTBEAT_STALE_MS / 1000} s` };
  let beat: Heartbeat;
  try {
    beat = JSON.parse(raw) as Heartbeat;
  } catch {
    return { ok: false, detail: 'heartbeat is not JSON' };
  }
  const age = now - Number(beat.at);
  if (!Number.isFinite(age) || age > HEARTBEAT_STALE_MS) return { ok: false, detail: `last heartbeat ${Math.round(age / 1000)} s ago` };
  return { ok: true, detail: `worker pid ${beat.pid}, last beat ${Math.max(0, Math.round(age))} ms ago` };
}

// BullMQ's wait error says "timed out"; say what it means for the operator.
export function waitError(err: unknown, ms: number): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(msg)) return `no worker finished the job within ${ms} ms (is the worker running?)`;
  return msg;
}
