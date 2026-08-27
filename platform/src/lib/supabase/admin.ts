import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client.
 *
 * This bypasses row-level security entirely, so it exists for exactly one job:
 * inviting a user, which needs the Auth Admin API and cannot be done from the
 * browser at any privilege level.
 *
 * The `server-only` import at the top is not decoration — it makes the build
 * fail if this file is ever pulled into a client component, rather than quietly
 * shipping the key to every visitor.
 *
 * Rules for anything that imports this:
 *
 *   · Authenticate the caller first.
 *   · Authorise the caller first — `users:edit`, checked against the database,
 *     not against anything the request supplied.
 *   · Never return the raw Auth Admin response to the browser.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Inviting users needs it — see SETUP.md.',
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isInviteConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
