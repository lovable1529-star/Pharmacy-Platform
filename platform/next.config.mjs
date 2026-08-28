/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['postgres'],

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
