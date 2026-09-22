import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spirit Tips',
  description: 'Tip distribution for Spirit Theater and ACC, synced from Square.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
