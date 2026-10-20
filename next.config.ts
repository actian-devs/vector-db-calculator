import type { NextConfig } from 'next';

/**
 * Static export. The build produces plain files in out/ with no server, so it
 * deploys to GitHub Pages, any CDN, or an air-gapped host.
 *
 * BASE_PATH is set by the Pages workflow to the repository name. Locally it is
 * empty so the dev server and Playwright run at the root.
 */
const basePath = process.env.BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  reactStrictMode: true,
};

export default nextConfig;
