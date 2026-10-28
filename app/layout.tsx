import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ConsentBanner } from '@/components/Consent';
import { GA_MEASUREMENT_ID, analyticsBootstrap, isGaConfigured } from '@/lib/analytics';
import { archivo, jetbrains } from './fonts';
import './globals.css';

const gaBootstrap = analyticsBootstrap(GA_MEASUREMENT_ID);

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
    description: 'Find out in 30 seconds.',
    url: SITE,
    siteName: 'Actian VectorAI DB sizing tool',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Do you need a vector database? A sizing tool whose verdict for 100K items is: you do not need one yet.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Do you need a vector database?',
    description: 'Find out in 30 seconds.',
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
    <html
      lang="en"
      data-analytics={isGaConfigured() ? 'ga4' : 'off'}
      className={`${archivo.variable} ${jetbrains.variable}`}
    >
      <body>
        {gaBootstrap ? (
          <Script id="ga4-bootstrap" strategy="beforeInteractive">
            {gaBootstrap}
          </Script>
        ) : null}
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}
