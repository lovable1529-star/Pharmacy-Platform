/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Demo mode runs entirely in memory — no database required to boot.
  env: { DEMO_MODE: process.env.DEMO_MODE ?? 'true' },
};
export default nextConfig;
