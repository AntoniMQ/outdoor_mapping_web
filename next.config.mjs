/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Tile providers frequently serve the style from one host and the tiles,
 * sprites and glyphs from sibling subdomains, so allow both the exact origin
 * and a wildcard for its registrable domain.
 */
const mapStyleSources = (() => {
  const fallback = ['https://tiles.openfreemap.org', 'https://*.openfreemap.org'];
  const configured = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  if (!configured || configured === 'offline') return fallback;
  try {
    const url = new URL(configured);
    const labels = url.hostname.split('.');
    const wildcard = labels.length > 2 ? `${url.protocol}//*.${labels.slice(-2).join('.')}` : null;
    return [url.origin, ...(wildcard ? [wildcard] : [])];
  } catch {
    return fallback;
  }
})();

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  `connect-src 'self' blob: data: ${mapStyleSources.join(' ')} https://demotiles.maplibre.org`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
