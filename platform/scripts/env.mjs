/**
 * Environment loading for standalone scripts.
 *
 * Next.js loads `.env.local` automatically; plain Node scripts do not — bare
 * `dotenv/config` reads `.env` and nothing else. Since `.env.local` is the file
 * that actually holds the secrets (and the one that is gitignored), a script
 * relying on the default silently gets no DATABASE_URL and then fails with
 * "password authentication failed for user ADMIN", which points nowhere useful.
 *
 * So: load `.env.local` first, then `.env` as a fallback, matching what Next
 * does. Import this at the top of any script that needs configuration.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });
