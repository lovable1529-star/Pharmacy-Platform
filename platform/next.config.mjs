/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /*
   * Packages Next must NOT bundle.
   *
   * `postgres` opens real sockets. `@react-pdf/renderer` is here because it
   * depends on pdfkit, which reads Adobe font-metric files (.afm) off disk at
   * render time. Bundled, those reads resolve to paths that do not exist inside
   * a serverless function — the PDF route worked locally, where node_modules is
   * still on disk, and returned 500 on Vercel where it is not.
   */
  serverExternalPackages: ['postgres', '@react-pdf/renderer'],

  /*
   * Ship pdfkit's fonts with the PDF route.
   *
   * Marking the package external is not enough on its own: tracing follows
   * `require` calls, and pdfkit resolves these at runtime, so the tracer never
   * sees them and the deployed function has no fonts to render with.
   *
   * ── Both directories, and the second one is the one that matters ────────
   *
   * pdfkit 0.20 carries its standard fonts twice:
   *
   *   js/data/*.afm            15 files, the legacy Adobe metrics
   *   js/standard-fonts/*.cjs  29 files, real modules it require()s
   *
   * Only the first was listed here, so the deployed function had the metrics
   * and not the fonts, and every render died on:
   *
   *   Cannot find module '…/pdfkit/js/standard-fonts/Helvetica.cjs'
   *   MODULE_NOT_FOUND
   *
   * It passed locally because node_modules is still on disk there — the same
   * reason the original .afm bug looked fixed. Both patterns are kept: the
   * .afm files are what an embedded font falls back to.
   *
   * ── Why `pdfkit@*` and not `**` ─────────────────────────────────────────
   *
   * pnpm gives every dependent its own `node_modules/pdfkit`, and those are
   * SYMLINKS back to the one real copy:
   *
   *   .pnpm/@react-pdf+font@4.1.1/node_modules/pdfkit          -> symlink
   *   .pnpm/@react-pdf+renderer@4.8.1_.../node_modules/pdfkit  -> symlink
   *   .pnpm/pdfkit@0.20.1/node_modules/pdfkit                  -> the real one
   *
   * A `**` here matches all three, and the build then fails trying to create a
   * directory where a symlink already is:
   *
   *   ENOTDIR: not a directory, mkdir '…/@react-pdf+font@4.1.1/node_modules/pdfkit'
   */
  outputFileTracingIncludes: {
    '/api/consultations/[id]/pdf': [
      './node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/*',
      './node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/data/*.afm',
    ],
  },

  experimental: {
    /*
     * How long the browser may reuse a route it has already loaded.
     *
     * Next 15 defaults `dynamic` to 0, so every one of these screens — all of
     * them `force-dynamic` — re-rendered on the server on every single visit,
     * including going straight back to the page you were on ten seconds ago.
     * Staff navigate between the same five screens constantly, so most of that
     * work was answering a question the browser already had the answer to.
     *
     * 30 seconds, not longer, and the number is a judgement about staleness
     * rather than about speed. A patient booking online mid-clinic should
     * appear on the worklist while the pharmacist is still standing there, and
     * a minute of invisibility is too long for that. Anything WE change is not
     * subject to the window at all: every staff mutation calls
     * `revalidateStaffViews()`, which clears this cache immediately.
     *
     * This is also what makes `prefetch` on the sidebar links worth anything.
     * With a stale time of 0 a prefetched payload expires on arrival, so the
     * prefetch fires, is discarded, and the click still waits for the server.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};
export default nextConfig;
