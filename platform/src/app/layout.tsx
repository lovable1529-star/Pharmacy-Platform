import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Karsons Pharmacy Platform',
  description: 'Clinical services platform for Karsons Pharmacy Group',
};

/**
 * Resolve the theme before the browser paints anything.
 *
 * This has to be a blocking inline script rather than a React effect. An effect
 * runs after hydration, which is several hundred milliseconds after first
 * paint — long enough that somebody on the dark theme gets a full-brightness
 * white flash on every navigation. On a screen being read in a dispensary at
 * seven in the morning that is genuinely unpleasant, and it makes the whole
 * product feel unfinished.
 *
 * Order of precedence:
 *   1. What the person explicitly chose, if they ever chose.
 *   2. Otherwise the operating system preference, read once as a default.
 *
 * The system preference is read here and then written to the attribute, so the
 * CSS never has to consult `prefers-color-scheme` itself. That matters: if the
 * stylesheet also reacted to the OS, somebody who deliberately picked light
 * would be flipped to dark anyway the moment their laptop dimmed at dusk.
 *
 * Wrapped in try/catch because a private window, cleared site data, or a
 * browser set to block storage all THROW on localStorage access rather than
 * returning null — and the application must still render if they do.
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('karsons.theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The script above sets `data-theme` before React hydrates, so the server
    // markup and the client markup legitimately differ on this one attribute.
    // Suppressing the warning here is the documented way to say "this is
    // intentional" — it is scoped to <html>'s own attributes, not its subtree.
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Archivo 400 was added for the large display numerals on stat cards,
            which read as heavy and cramped at 600 once they got bigger. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
