/**
 * Database client.
 *
 * Two connections, and using the wrong one is the single most common way to
 * lose an afternoon on Supabase:
 *
 *   DATABASE_URL  port 6543  — pgBouncer transaction pooling. What the app uses.
 *   DIRECT_URL    port 5432  — a real session. What migrations need.
 *
 * Transaction pooling does not support prepared statements, so `prepare` is
 * false. Without that you get "prepared statement already exists" under load,
 * intermittently, which is a miserable thing to debug.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __karsonsDb: ReturnType<typeof createClient> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in from your Supabase project — see SETUP.md.',
    );
  }

  const sql = postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(sql, { schema });
}

/**
 * Reused across hot reloads in development, otherwise every file save opens a
 * new pool and Supabase starts refusing connections.
 */
export const db = globalThis.__karsonsDb ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__karsonsDb = db;
}

export { schema };
export type Database = typeof db;
