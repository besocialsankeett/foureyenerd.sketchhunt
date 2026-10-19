import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import Sketchbook from '@/components/Sketchbook';
import { site } from '@/content/site';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });

export const metadata: Metadata = {
  // Link previews need full addresses: the live site's on Vercel, this machine's otherwise.
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000',
  ),
  title: { default: `${site.name}: ${site.title}`, template: `%s | ${site.name}` },
  description: `${site.line} An interactive sketchbook: pick a project and fish it out of the water.`,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>
        <main>
          <Sketchbook />
          {children}
        </main>
      </body>
    </html>
  );
}
