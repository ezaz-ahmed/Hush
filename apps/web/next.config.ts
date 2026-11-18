import type { NextConfig } from 'next';
import { env } from './src/lib/env';

const nextConfig: NextConfig = {
  rewrites: async () => [{ source: '/api/:path*', destination: `${env.API_URL}/:path*` }],
};

export default nextConfig;
