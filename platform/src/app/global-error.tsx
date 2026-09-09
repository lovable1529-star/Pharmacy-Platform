'use client';

/**
 * The last resort: the root layout itself failed.
 *
 * This replaces the entire document, `<html>` and `<body>` included, which is
 * why it declares them. Nothing above it survives to render a shell.
 *
 * Styled inline rather than with the application's classes. The stylesheet is
 * imported by the root layout, and the root layout is the thing that has just
 * failed — reaching for Tailwind here risks an unstyled page at the exact
 * moment the person most needs to be able to read it. Every colour is written
 * out so this holds up on its own.
 *
 * Only reachable in production; in development Next.js shows its own overlay.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global] the application failed to render:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: '#F6F5F9' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '440px',
              background: '#FFFFFF',
              border: '1px solid #DEDAE9',
              borderRadius: '12px',
              padding: '28px',
            }}
          >
            <div
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#5B3A8E',
                marginBottom: '18px',
              }}
            >
              Karsons Pharmacy
            </div>

            <h1
              style={{
                margin: '0 0 10px',
                fontSize: '20px',
                lineHeight: 1.3,
                color: '#191428',
              }}
            >
              The application could not start
            </h1>

            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: '#544D6B' }}>
              This is a fault at our end, not something you did, and no patient
              record has been affected. Reloading usually clears it.
            </p>

            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: '22px',
                padding: '11px 20px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#FFFFFF',
                background: '#5B3A8E',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>

            {error.digest ? (
              <p
                style={{
                  margin: '22px 0 0',
                  paddingTop: '16px',
                  borderTop: '1px solid #EAE7F2',
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                  color: '#7C7594',
                }}
              >
                Quote this reference if you report it:{' '}
                <span style={{ fontFamily: 'Consolas, Menlo, monospace', color: '#544D6B' }}>
                  {error.digest}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}
