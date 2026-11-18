import type { NextConfig } from 'next';

// shortcut: unvalidated and read at build time (rewrites are baked into the build); #6 validates it with the rest of the web env.
// `||` so an empty API_URL falls back too; trailing slash stripped to avoid `//path`.
const apiUrl = (process.env.API_URL || 'http://localhost:5555').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  rewrites: async () => [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }],
};

export default nextConfig;
