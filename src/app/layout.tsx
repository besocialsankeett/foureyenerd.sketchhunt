import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import Sketchbook from '@/components/Sketchbook';
import { site } from '@/content/site';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });

export const metadata: Metadata = {
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
