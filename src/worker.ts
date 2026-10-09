// The BullMQ worker, its own process ([workers] worker). Results go to Postgres.
import { Job, Worker } from 'bullmq';
import { pgPool, redis } from './conn';
import { HEARTBEAT_EVERY_MS, HEARTBEAT_KEY, HEARTBEAT_STALE_MS, KEEP_RESULTS, QUEUE, slowHash, validText } from './jobs';

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!dbUrl || !redisUrl) {
  console.error('worker: DATABASE_URL and REDIS_URL must be set');
  process.exit(1);
}

const pool = pgPool(dbUrl);
const beats = redis(redisUrl);
const me = `pid ${process.pid}`;

async function handle(job: Job): Promise<string> {
  let input: string;
  let output: string;
  if (job.name === 'probe') {
    input = String(job.data.token ?? '');
    if (!/^[0-9a-f-]{36}$/.test(input)) throw new Error('bad probe token');
    output = input;
  } else if (job.name === 'hash') {
    const text = validText(job.data.text);
    if (!text) throw new Error('bad text');
    input = text;
    output = slowHash(text);
  } else {
    throw new Error(`unknown job ${job.name}`);
  }
  await pool.query(
    'INSERT INTO job_results (job_id, kind, input, output, worker, queued_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))',
    [job.id, job.name, input, output, me, job.timestamp],
  );
  if (job.name === 'hash') {
    await pool.query(
      `DELETE FROM job_results WHERE kind = 'hash' AND id < (SELECT id FROM job_results WHERE kind = 'hash' ORDER BY id DESC OFFSET $1 LIMIT 1)`,
      [KEEP_RESULTS],
    );
  }
  return output;
}

const worker = new Worker(QUEUE, handle, { connection: redis(redisUrl, true), concurrency: 2 });
worker.on('failed', (job, err) => console.error(`job ${job?.id} (${job?.name}) failed: ${err.message}`));
worker.on('error', (err) => console.error('worker error:', err.message));

async function beat() {
  try {
    await beats.set(HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), pid: process.pid }), 'PX', HEARTBEAT_STALE_MS);
  } catch (err) {
    console.error('heartbeat failed:', err instanceof Error ? err.message : err);
  }
}
void beat();
const timer = setInterval(beat, HEARTBEAT_EVERY_MS);
console.log(`worker ${me} consuming ${QUEUE}`);

async function shutdown(sig: string) {
  console.log(`worker: ${sig}, closing`);
  clearInterval(timer);
  await worker.close();
  await beats.del(HEARTBEAT_KEY);
  beats.disconnect();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
