/**
 * Has this account ever actually been used?
 *
 * Three states, not two, and collapsing them is the mistake this guards
 * against:
 *
 *   · signed in at some point       — nothing to say
 *   · never signed in               — the invitation may never have arrived
 *   · we could not find out         — Supabase Auth did not answer
 *
 * The third is the dangerous one. Read as "never signed in", a brief auth
 * outage paints "not joined" across every colleague in the pharmacy and invites
 * an administrator to re-send a dozen password links to people who never asked
 * for one. Read as "fine", the badge simply does not appear, which is the same
 * as the behaviour before it existed.
 *
 * So the caller passes whether the lookup succeeded for this account at all,
 * separately from what it found.
 *
 * Pure, so this can be tested without an auth server.
 */

export interface SignInState {
  /** Did the lookup return anything for this account? */
  known: boolean;
  /** When they last signed in, or null if never. Meaningless when !known. */
  lastSignInAt: Date | null;
  /** Disabled accounts are not chased — there is no access to restore. */
  disabledAt: Date | null;
}

export function invitationPending(state: SignInState): boolean {
  if (!state.known) return false;
  if (state.disabledAt !== null) return false;
  return state.lastSignInAt === null;
}
