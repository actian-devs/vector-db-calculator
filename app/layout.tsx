import type { Metadata, Viewport } from 'next';
import { archivo, jetbrains } from './fonts';
import './globals.css';

// SITE already carries the base path, and Next resolves metadata URLs by
// appending to metadataBase's path, so image paths below must not repeat it.
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://actian-devs.github.io/vector-db-calculator';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Do you need a vector database?',
  description:
    'Describe your agent or RAG workload and get an honest verdict, from a flat file up to a dedicated vector database.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: 'Do you need a vector database?',
    description: 'Find out in 30 seconds. Sometimes the answer is no.',
    url: SITE,
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Do you need a vector database?',
    description: 'Find out in 30 seconds. Sometimes the answer is no.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
