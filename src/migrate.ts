// Runs as [build] migrate, before traffic switches.
import { pgPool } from './conn';
import { SCHEMA } from './jobs';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = pgPool(url);
  try {
    await pool.query(SCHEMA);
    console.log('migrate: schema ready');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('migrate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
