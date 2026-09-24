import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spirit Tips',
  description: 'Tip distribution for Spirit Theater and ACC, synced from Square.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href={
            'https://fonts.googleapis.com/css2' +
            '?family=Fraunces:opsz,wght@9..144,500;9..144,600' +
            '&family=IBM+Plex+Sans:wght@400;500;600' +
            '&family=IBM+Plex+Mono:wght@400;500' +
            '&display=swap'
          }
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
