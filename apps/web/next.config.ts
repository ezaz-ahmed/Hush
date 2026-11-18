import type { NextConfig } from 'next';
import { apiUrl } from './src/lib/api-url';

const nextConfig: NextConfig = {
  rewrites: async () => [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }],
};

export default nextConfig;
