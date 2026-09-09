/**
 * What a pharmacist is told when a screen fails.
 *
 * Until now, nothing. There was no error boundary anywhere in the application,
 * so anything thrown from a server component produced Next.js's own page:
 *
 *   "Application error: a server-side exception has occurred while loading
 *    karsons.vercel.app (see the server logs for more information)."
 *
 * Rendered outside the shell, so no navigation, no way back, and nothing the
 * person reading it can do. `getUsersAndRoles` throws NOT_AUTHORISED as a plain
 * Error, which meant a viewer opening Users got that screen rather than being
 * told they lack permission.
 *
 * Two audiences, and they want opposite things. The pharmacist wants to know
 * whether to try again or fetch somebody. The tester wants a reference they can
 * put in a bug report and we can find in a log. So: plain words for the first,
 * and the digest — never a stack — for the second.
 *
 * Pure, so the wording can be tested without provoking real failures.
 */

export interface DescribedError {
  title: string;
  body: string;
  /** Whether pressing "Try again" stands a chance. */
  retryable: boolean;
  /**
   * True when this is a permission boundary rather than a fault.
   *
   * Worth separating: a locked door is not a broken one, and telling somebody
   * "something went wrong" when the answer is "you are not allowed" sends them
   * to report a bug that does not exist.
   */
  denied: boolean;
}

const GENERIC: DescribedError = {
  title: 'Something went wrong on this screen',
  body:
    'The page could not be loaded. Trying again often works — the connection to '
    + 'the record system is the usual cause. If it keeps happening, quote the '
    + 'reference below.',
  retryable: true,
  denied: false,
};

/**
 * Translate a thrown error.
 *
 * Matched on the message because these are thrown as plain Errors across the
 * application. In production Next.js replaces the message of a server-component
 * error with a generic string and supplies the digest instead, so only the
 * sentinels thrown and caught on the client survive this — which is why the
 * fallback has to be useful on its own rather than a placeholder.
 */
export function describeAppError(message: string | null | undefined): DescribedError {
  const text = (message ?? '').toLowerCase();

  if (text.length === 0) return GENERIC;

  if (text.includes('not_authorised') || text.includes('not authorised')) {
    return {
      title: 'You do not have access to this',
      body:
        'Your role does not include this screen. That is a setting, not a fault '
        + '— an administrator can change it under Users if you should have it.',
      retryable: false,
      denied: true,
    };
  }

  if (text.includes('not signed in') || text.includes('no session')) {
    return {
      title: 'You have been signed out',
      body: 'Sessions end after a period of inactivity. Sign in again to carry on.',
      retryable: false,
      denied: true,
    };
  }

  /*
   * The database lives in Seoul, so a slow or dropped connection is the most
   * likely real failure by some margin, and it is genuinely worth retrying.
   */
  if (
    text.includes('econnrefused') || text.includes('etimedout')
    || text.includes('connection') || text.includes('timeout')
  ) {
    return {
      title: 'Could not reach the record system',
      body:
        'The connection to the database failed or took too long. Nothing has been '
        + 'lost. Try again in a moment.',
      retryable: true,
      denied: false,
    };
  }

  return GENERIC;
}
