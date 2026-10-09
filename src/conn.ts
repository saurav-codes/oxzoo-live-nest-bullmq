import IORedis from 'ioredis';
import { Pool } from 'pg';

export function pgPool(url: string): Pool {
  return new Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 5000,
  });
}

// Workers and QueueEvents block on Redis, so BullMQ needs maxRetriesPerRequest null there.
export function redis(url: string, blocking = false): IORedis {
  return new IORedis(url, {
    connectTimeout: 3000,
    maxRetriesPerRequest: blocking ? null : 2,
  });
}
