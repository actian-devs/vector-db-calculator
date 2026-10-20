import localFont from 'next/font/local';

/**
 * Self-hosted. The page makes no third-party request, which matters for a
 * product sold on data sovereignty and keeps it working inside a locked-down
 * network. Both faces are SIL OFL 1.1, licences in fonts/.
 */

export const archivo = localFont({
  src: [
    { path: '../fonts/archivo-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/archivo-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/archivo-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const jetbrains = localFont({
  src: [
    { path: '../fonts/jetbrains-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/jetbrains-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/jetbrains-mono-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});
