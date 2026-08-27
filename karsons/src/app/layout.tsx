import type { Metadata } from 'next';
import '@/styles/globals.css';
import { ShellProvider } from '@/components/shell/shell-provider';

export const metadata: Metadata = {
  title: 'Karsons Pharmacy Platform',
  description: 'Clinical services platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ShellProvider>{children}</ShellProvider>
      </body>
    </html>
  );
}
