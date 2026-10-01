import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  // Basic protection: no framing by other sites (the admin Design preview frames our own wall),
  // no MIME sniffing, camera only for this site (guest page).
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      ],
    }];
  },
};
export default nextConfig;
