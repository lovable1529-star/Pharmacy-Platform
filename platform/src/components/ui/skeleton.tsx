/**
 * Loading skeletons.
 *
 * The `--skel` gradient and the `shimmer` keyframe were designed into
 * `globals.css` from the start and never used by anything. Nothing in the app
 * had a `loading.tsx`, so a navigation held the OLD page on screen, frozen and
 * still interactive-looking, until the next one had fully rendered on the
 * server. Nothing acknowledged the click.
 *
 * That reads as slowness far more than the milliseconds do. A page that answers
 * in 300ms with no feedback feels broken; one that responds instantly and fills
 * in 300ms later feels immediate. These are the same 300ms.
 *
 * The shapes below deliberately mirror the real layouts — a table skeleton has
 * a filter bar and rows of the right height, a card skeleton has the right card
 * height. Getting that wrong produces a visible jolt when the content arrives,
 * which is worse than no skeleton at all.
 */

/**
 * One shimmering bar.
 *
 * `delay` staggers the sweep. It has to live on the shimmering element itself —
 * `animation-delay` on a parent does nothing for a child's own animation, which
 * is the easy way to write a stagger that silently does not stagger.
 */
export function Skeleton({
  className = '',
  width,
  delay = 0,
}: {
  className?: string;
  width?: number | string;
  delay?: number;
}) {
  return (
    <div
      className={`bg-skel animate-shimmer rounded-[5px] ${className}`}
      style={{ width, animationDelay: delay ? `${delay}ms` : undefined }}
    />
  );
}

/**
 * The title block every page opens with.
 *
 * Rendered at the real `PageHeader` proportions so the heading does not jump
 * when the server payload replaces this.
 */
export function PageHeaderSkeleton({ actions = true }: { actions?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-[26px]" width={190} />
        <Skeleton className="mt-2.5 h-[13px] max-w-[430px]" width="100%" delay={80} />
      </div>
      {actions ? <Skeleton className="h-[36px] rounded-control" width={132} delay={140} /> : null}
    </div>
  );
}

/** Widths that read as a table rather than as a row of identical blocks. */
const COLUMNS = [150, 110, 90, 120, 70];

/**
 * A `DataTable` before its data.
 *
 * Matches the real thing: filter bar across the top, then rows. The row count
 * is a guess at a screenful — enough to fill the fold, not so many that a short
 * list collapses noticeably when it lands.
 */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Skeleton className="h-[36px] min-w-[200px] flex-1 rounded-control" />
        <Skeleton className="h-[13px]" width={52} delay={120} />
      </div>

      {/* Column headings */}
      <div className="flex items-center gap-4 border-b border-line px-4 py-2.5">
        {COLUMNS.map((w, i) => (
          <Skeleton key={i} className="h-[11px]" width={w} delay={i * 60} />
        ))}
      </div>

      {/* Rows. Each starts its sweep later than the one above, so the shimmer
          travels down the table instead of every row pulsing in lockstep — the
          latter looks like a rendering fault rather than loading. */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-line-soft px-4 py-[13px] last:border-b-0"
        >
          {COLUMNS.map((w, j) => (
            <Skeleton key={j} className="h-[13px]" width={w} delay={i * 90 + j * 40} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A stack of Panel-shaped cards — Services, Repeat care. */
export function CardListSkeleton({ cards = 5, height = 96 }: { cards?: number; height?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="rounded-panel border border-line bg-surface px-5 py-[17px] shadow-panel"
          style={{ minHeight: height }}
        >
          <Skeleton className="h-[16px]" width={210} delay={i * 90} />
          <Skeleton className="mt-2 h-[13px] max-w-[360px]" width="100%" delay={i * 90 + 50} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-[18px] rounded-full" width={64} delay={i * 90 + 100} />
            <Skeleton className="h-[18px] rounded-full" width={78} delay={i * 90 + 140} />
            <Skeleton className="h-[18px] rounded-full" width={96} delay={i * 90 + 180} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The standard page wrapper, so a skeleton sits exactly where content will.
 *
 * `width` matters: the five pages use four different max-widths (980 to 1200),
 * and a skeleton at the wrong one shifts the whole column sideways the moment
 * real content arrives. Passed as an inline style rather than a Tailwind class
 * because an interpolated arbitrary value is not a literal the compiler can
 * find, so `max-w-[calc(${w}px...)]` would produce no CSS at all.
 */
export function PageShellSkeleton({
  children,
  width = 1000,
}: {
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      className="page-shell mx-auto px-7 pb-11 pt-7"
      style={{ maxWidth: `calc(${width}px + var(--nav-freed, 0px))` }}
    >
      {children}
    </div>
  );
}

/**
 * The row of counters across the top of Today.
 *
 * Drawn at the real StatCard proportions. A placeholder that is the wrong
 * height is worse than none: the numbers arrive and shove everything below them
 * down the page, which is the exact jolt a skeleton exists to prevent.
 */
export function StatRowSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="mt-[18px] grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-panel border border-line bg-surface px-4 py-3.5">
          <Skeleton className="h-[10px]" width="55%" delay={i * 60} />
          <Skeleton className="mt-3 h-[26px]" width="38%" delay={i * 60 + 30} />
          <Skeleton className="mt-2.5 h-[10px]" width="70%" delay={i * 60 + 60} />
        </div>
      ))}
    </div>
  );
}

/**
 * The panel Today opens with — greeting, date, and the search box that is the
 * point of the screen.
 */
export function HeroSkeleton() {
  return (
    <section className="rounded-[16px] border border-line bg-wash px-[26px] pb-[22px] pt-[26px] shadow-panel">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-[10px]" width={190} />
          <Skeleton className="mt-3 h-[30px]" width={280} />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-[36px] rounded-control" width={132} delay={60} />
          <Skeleton className="h-[36px] rounded-control" width={108} delay={90} />
        </div>
      </div>
      <Skeleton className="mt-[22px] h-[44px] rounded-control" width="100%" delay={120} />
    </section>
  );
}

/** A stack of panels, for the screens built from them rather than from a table. */
export function PanelStackSkeleton({
  panels = 2,
  rows = 4,
  columns = 1,
}: {
  panels?: number;
  rows?: number;
  /**
   * Match the real page. Today lays its two panels side by side on a wide
   * screen; a skeleton that stacks them is the wrong height, so the content
   * jumps when it arrives — the exact thing this is here to prevent.
   */
  columns?: 1 | 2;
}) {
  return (
    <div className={`mt-[18px] grid gap-4 ${columns === 2 ? 'lg:grid-cols-2' : ''}`}>
      {Array.from({ length: panels }, (_, p) => (
        <div key={p} className="rounded-panel border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-[13px]" width={160} delay={p * 80} />
          </div>
          <div className="space-y-3 px-4 py-4">
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="flex items-center justify-between gap-4">
                <Skeleton className="h-[12px]" width={`${45 + ((r * 13) % 30)}%`} delay={p * 80 + r * 40} />
                <Skeleton className="h-[12px]" width={64} delay={p * 80 + r * 40 + 20} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
