'use client';

/**
 * Renders children into `document.body`, outside the page's own DOM.
 *
 * Every dialog and drawer in the system is `position: fixed; inset: 0`, which
 * should mean "cover the viewport". It did not, and the reason is a genuinely
 * nasty CSS trap.
 *
 * Every page wraps its content in `.animate-rise`, whose keyframes animate
 * `transform`. An element with a transform animation attached becomes the
 * containing block for its fixed descendants — and it STAYS one after the
 * animation finishes, even though the computed transform is then `none`.
 * Measured in the browser rather than guessed:
 *
 *     transform: "none", playState: "running"  →  fixed child is 300px tall
 *     animation removed entirely               →  fixed child is 720px tall
 *
 * So `inset: 0` was resolving against the page shell, not the viewport. The
 * scrim covered only the article, the drawer was cut off partway down, and it
 * looked like a layout bug in whichever dialog you happened to open.
 *
 * Chasing it per-dialog would fix today's eight and none of tomorrow's. A
 * portal takes the overlay out of the page entirely, so no ancestor — animated,
 * transformed, filtered or clipped — can contain it. That is what a modal layer
 * is for.
 *
 * Mounted-gated because `createPortal` needs a real document: rendering nothing
 * on the server and on the first client pass keeps the markup identical across
 * both, so React does not report a hydration mismatch.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
