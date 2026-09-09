/**
 * A public URL that does not exist.
 *
 * Separate from the staff one because the audience is different: this is a
 * patient who has mistyped a link, or followed a questionnaire link that has
 * since been withdrawn. They have no navigation to offer them and no account to
 * sign in to, so the only useful thing is to say plainly that the address is
 * wrong and point them at a human.
 */

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-[420px] text-center">
        <div className="mb-6 inline-flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-600 font-display text-[15px] font-bold text-white">
            K
          </div>
          <div className="text-left leading-tight">
            <div className="font-display text-[16px] font-semibold text-ink">Karsons Pharmacy</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint">
              Clinical Services
            </div>
          </div>
        </div>

        <div className="rounded-panel border border-line bg-surface p-6 shadow-panel">
          <h1 className="mb-2 text-[19px] text-ink">This link does not work</h1>
          <p className="text-[14px] leading-relaxed text-ink-soft">
            The address may have been mistyped, or the form it pointed to may have
            closed. Links we email are single-use and time-limited by design.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
            If you were sent here to complete a questionnaire, please contact the
            pharmacy and we will send you a new link.
          </p>
        </div>
      </div>
    </div>
  );
}
