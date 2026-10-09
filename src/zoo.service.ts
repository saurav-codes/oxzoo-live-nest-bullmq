import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import type IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { pgPool, redis } from './conn';
import { HEARTBEAT_KEY, parseHeartbeat, QUEUE, waitError } from './jobs';
import { Build, Check, health, Meta, Prober, VarSpec } from './zoo';

export const META: Meta = { name: 'nest-bullmq', stack: 'NestJS + BullMQ' };
const VARS: VarSpec[] = [
  { name: 'DATABASE_URL', role: 'service', secret: true },
  { name: 'REDIS_URL', role: 'service', secret: true },
  { name: 'ZOO_PANEL_ORIGIN', role: 'plain' },
];
const WAIT_MS = 4500;

function buildInfo(): Build {
  const build: Build = { runtime: `node ${process.versions.node}` };
  try {
    const info = JSON.parse(readFileSync(join(__dirname, 'build-info.json'), 'utf8'));
    if (typeof info.built_at === 'string') build.built_at = info.built_at;
  } catch {
    // Not built through `npm run build` (for example under tests): no built_at.
  }
  return build;
}

// Connections open on first use, so /_zoo/health never waits on a dependency.
@Injectable()
export class ZooService implements OnModuleDestroy {
  private readonly log = new Logger('zoo');
  private readonly startedAt = new Date();
  private readonly build = buildInfo();
  private readonly prober = new Prober();
  private db?: Pool;
  private client?: IORedis;
  private q?: Queue;
  private events?: QueueEvents;

  get pool(): Pool {
    return (this.db ??= pgPool(process.env.DATABASE_URL ?? ''));
  }
  get redis(): IORedis {
    return (this.client ??= redis(process.env.REDIS_URL ?? ''));
  }
  get queue(): Queue {
    return (this.q ??= new Queue(QUEUE, {
      connection: redis(process.env.REDIS_URL ?? ''),
      defaultJobOptions: { attempts: 1, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
    }));
  }
  get queueEvents(): QueueEvents {
    return (this.events ??= new QueueEvents(QUEUE, { connection: redis(process.env.REDIS_URL ?? '', true) }));
  }

  health() {
    return health(META, process.env, this.startedAt, this.build);
  }

  async counts() {
    return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }

  async recent(limit = 20) {
    const { rows } = await this.pool.query(
      `SELECT job_id, input, output, worker, queued_at, finished_at FROM job_results
       WHERE kind = 'hash' ORDER BY id DESC LIMIT $1`,
      [limit],
    );
    return rows as { job_id: string; input: string; output: string; worker: string; queued_at: Date; finished_at: Date }[];
  }

  async enqueue(text: string): Promise<string> {
    const job = await this.queue.add('hash', { text });
    return String(job.id);
  }

  probe() {
    return this.prober.probe(META, process.env, this.checks(), VARS);
  }

  private checks(): Check[] {
    return [
      {
        id: 'postgres',
        label: 'Postgres write, read, delete',
        env: ['DATABASE_URL'],
        run: async () => {
          const token = randomUUID();
          await this.pool.query('INSERT INTO zoo_probe (token) VALUES ($1)', [token]);
          const { rows } = await this.pool.query('SELECT token, current_setting($2) AS v FROM zoo_probe WHERE token = $1', [token, 'server_version']);
          await this.pool.query('DELETE FROM zoo_probe WHERE token = $1', [token]);
          if (rows[0]?.token !== token) throw new Error('read back a different row');
          return `zoo_probe row round trip, server ${rows[0].v}`;
        },
      },
      {
        id: 'redis',
        label: 'Redis SET/GET/DEL with TTL',
        env: ['REDIS_URL'],
        run: async () => {
          const key = `zoo:probe:${randomUUID()}`;
          const value = randomUUID();
          await this.redis.set(key, value, 'PX', 10000);
          const got = await this.redis.get(key);
          const ttl = await this.redis.pttl(key);
          await this.redis.del(key);
          if (got !== value) throw new Error('read back a different value');
          if (ttl <= 0) throw new Error('key has no TTL');
          return `round trip with a ${ttl} ms TTL`;
        },
      },
      {
        id: 'bullmq',
        label: 'BullMQ job through the worker into Postgres',
        env: ['REDIS_URL', 'DATABASE_URL'],
        run: async () => {
          const token = randomUUID();
          const events = this.queueEvents;
          await events.waitUntilReady();
          const t0 = Date.now();
          const job = await this.queue.add('probe', { token }, { removeOnComplete: true, removeOnFail: true });
          let out: unknown;
          try {
            out = await job.waitUntilFinished(events, WAIT_MS);
          } catch (err) {
            await job.remove().catch((e: Error) => this.log.warn(`probe job ${job.id} not removed: ${e.message}`));
            throw new Error(waitError(err, WAIT_MS));
          }
          const ms = Date.now() - t0;
          const { rows } = await this.pool.query(
            "DELETE FROM job_results WHERE job_id = $1 AND kind = 'probe' RETURNING output, worker",
            [job.id],
          );
          if (out !== token) throw new Error('worker returned a different value');
          if (rows[0]?.output !== token) throw new Error('worker finished but wrote no matching Postgres row');
          return `job ${job.id} done by worker ${rows[0].worker} in ${ms} ms, its Postgres row read and removed`;
        },
      },
      {
        id: 'worker',
        label: 'Worker heartbeat in Redis',
        env: ['REDIS_URL'],
        run: async () => {
          const beat = parseHeartbeat(await this.redis.get(HEARTBEAT_KEY));
          if (!beat.ok) throw new Error(beat.detail);
          return beat.detail;
        },
      },
    ];
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.events?.close(), this.q?.close(), this.db?.end()]);
    this.client?.disconnect();
  }
}
