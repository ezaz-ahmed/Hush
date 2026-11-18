import type { NextConfig } from 'next';

// shortcut: unvalidated and read at build time (rewrites are baked into the build); #6 validates it with the rest of the web env.
const apiUrl = process.env.API_URL ?? 'http://localhost:5555';

const nextConfig: NextConfig = {
  rewrites: async () => [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }],
};

export default nextConfig;
