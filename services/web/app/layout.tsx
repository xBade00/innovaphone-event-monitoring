import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'InnoMonitor',
  description: 'innovaphone IPVA Event Monitoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-gray-100 min-h-screen">{children}</body>
    </html>
  );
}