/**
 * The shared visual vocabulary.
 *
 * Every one of these existed already — hand-written, slightly differently, on
 * each screen that needed it. The panel on Today had a 10px radius and no
 * shadow; the one on Communications had 12px and a border-only header; three
 * screens each invented their own "amber pill". That is the specific thing
 * that makes software look assembled rather than designed, and it is invisible
 * until you put two screens side by side.
 *
 * Consolidating them here is a presentation change only: no component below
 * fetches, computes or decides anything. They take what they are given and
 * render it.
 *
 * ── On tone ───────────────────────────────────────────────────────────────
 *
 * `tone` is the one prop worth being strict about, because it carries clinical
 * meaning rather than decoration:
 *
 *   neutral  informational. The default, and the right answer most of the time.
 *   brand    a system state — a version, a reference, "you".
 *   safe     clinically safe, complete, approved.
 *   review   needs a human decision. Triage AMBER, expiring stock.
 *   stop     unsafe, blocked, failed. Triage RED.
 *
 * safe / review / stop are NOT free colours. A pharmacist scanning a screen has
 * to be able to trust that amber means somebody must look at this. Reach for
 * `neutral` or `brand` for anything that is merely a category.
 */

import Link from 'next/link';

import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'brand' | 'safe' | 'review' | 'stop';

/* ── Panels ─────────────────────────────────────────────────────────────── */

/**
 * The standard content container: one surface, one border, one shadow.
 *
 * `overflow-hidden` is not incidental. Nearly every panel in the product ends
 * with a list whose rows carry their own bottom border and hover fill, and
 * without clipping those square corners poke through the rounded ones.
 */
export function Panel({
  as: Tag = 'div',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  /**
   * The element to render.
   *
   * A panel wrapping a chronological history should be an <ol>, and one
   * wrapping a self-contained region should be a <section>. Making the caller
   * reach for a raw div and re-type the classes is how the two drift apart, so
   * the escape hatch lives here instead.
   */
  as?: 'div' | 'section' | 'ol' | 'ul';
}) {
  return (
    <Tag
      className={cn(
        'overflow-hidden rounded-panel border border-line bg-surface shadow-panel',
        // Lists get their browser default padding and bullets stripped, since
        // every list inside a panel is a row stack rather than prose.
        (Tag === 'ol' || Tag === 'ul') && 'm-0 list-none p-0',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A panel's title bar: icon, heading, and an optional action pushed right.
 *
 * `tone` tints the whole bar, which is how a panel says "the thing inside me is
 * a problem" without every row inside it having to shout.
 */
export function PanelHeader({
  icon,
  title,
  action,
  tone = 'neutral',
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
  tone?: Tone;
}) {
  const toned = tone !== 'neutral' && tone !== 'brand';
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-b px-4 py-3',
        toned
          ? {
              safe: 'border-safe-100 bg-safe-50',
              review: 'border-review-100 bg-review-50',
              stop: 'border-stop-100 bg-stop-50',
            }[tone as 'safe' | 'review' | 'stop']
          : 'border-line',
      )}
    >
      {icon ? (
        <span
          className={cn(
            'flex shrink-0 items-center',
            {
              neutral: 'text-ink-faint',
              brand: 'text-brand-600',
              safe: 'text-safe-700',
              review: 'text-review-700',
              stop: 'text-stop-700',
            }[tone],
          )}
        >
          {icon}
        </span>
      ) : null}
      <h2
        className={cn(
          'font-display text-[14.5px] font-semibold',
          {
            neutral: 'text-ink',
            brand: 'text-brand-700',
            safe: 'text-safe-700',
            review: 'text-review-700',
            stop: 'text-stop-700',
          }[tone],
        )}
      >
        {title}
      </h2>
      {action ? <div className="ml-auto flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

/**
 * One row inside a panel's list.
 *
 * Shared so that row height, padding and hover fill are identical on Today,
 * Communications and the patient timeline. `last:border-b-0` stops the final
 * row drawing a line onto the panel's own bottom edge.
 */
export function PanelRow({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-line-soft px-4 py-2.5 transition-colors last:border-b-0',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── Labels and tags ────────────────────────────────────────────────────── */

/**
 * The small mono heading used above a list or a group of fields.
 *
 * Uppercase monospace at 10.5px reads as a system label rather than as content,
 * which is exactly the distinction wanted: it names the region without
 * competing with the patient's name inside it.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        'font-mono text-[10.5px] font-medium uppercase tracking-[0.09em] text-ink-faint',
        className,
      )}
    >
      {children}
    </h2>
  );
}

const TAG_TONES: Record<Tone, string> = {
  neutral: 'bg-sunk text-ink-faint',
  brand: 'bg-brand-50 text-brand-600',
  safe: 'bg-safe-100 text-safe-700',
  review: 'bg-review-100 text-review-700',
  stop: 'bg-stop-100 text-stop-700',
};

/**
 * A status pill.
 *
 * Deliberately fill-only with no border: a bordered pill next to a bordered
 * button next to a bordered input turns a table row into a stack of boxes.
 */
export function Tag({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[5px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.05em]',
        TAG_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Stats ──────────────────────────────────────────────────────────────── */

/**
 * A single headline number.
 *
 * The label is mono-uppercase and the value is Archivo at 26px — a deliberate
 * contrast in both family and size, so the eye lands on the number first and
 * reads what it means second. `tabular` matters more than it looks: without it
 * a row of four counters visibly jitters as the digits change.
 */
export function StatCard({
  label,
  value,
  tone = 'neutral',
  footnote,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  footnote?: React.ReactNode;
}) {
  return (
    <div className="rounded-panel border border-line bg-surface px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </div>
      <div
        className={cn(
          'tabular mt-0.5 font-display text-[26px] font-semibold leading-[1.1]',
          {
            neutral: 'text-ink',
            brand: 'text-brand-700',
            safe: 'text-safe-700',
            review: 'text-review-700',
            stop: 'text-stop-700',
          }[tone],
        )}
      >
        {value}
      </div>
      {footnote ? (
        <div className="mt-2 text-[11.5px] text-ink-faint">{footnote}</div>
      ) : null}
    </div>
  );
}

/* ── Messages ───────────────────────────────────────────────────────────── */

/**
 * A callout above the content it concerns.
 *
 * Used for the things a pharmacist must read before acting on the screen —
 * unroutable GP addresses, a service with no published form. Tone here is
 * load-bearing, so it has no default: the caller has to decide whether this is
 * information or a problem.
 */
export function Notice({
  tone,
  icon,
  title,
  children,
  className,
}: {
  tone: Tone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const skin = {
    neutral: 'border-line bg-sunk text-ink-soft',
    brand: 'border-brand-200 bg-brand-50 text-brand-700',
    safe: 'border-safe-200 bg-safe-50 text-safe-700',
    review: 'border-review-200 bg-review-50 text-review-700',
    stop: 'border-stop-200 bg-stop-50 text-stop-700',
  }[tone];

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-panel border px-4 py-3.5',
        skin,
        className,
      )}
    >
      {icon ? <span className="mt-0.5 flex shrink-0 items-center">{icon}</span> : null}
      <div className="min-w-0">
        {title ? <p className="text-[15px] font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn('text-[13.5px] leading-[1.5]', title && 'mt-0.5')}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What a list says when it is empty.
 *
 * Two lines, always: what is not here, and what to do about it. A bare
 * "No results" tells somebody the screen is broken; naming the next action
 * tells them the screen is working and they have not done the thing yet.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-6 py-14 text-center', className)}>
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {body ? <p className="mt-1 text-[13.5px] text-ink-faint">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ── Page furniture ─────────────────────────────────────────────────────── */

/*
 * PageHeader and ActionLink moved here from data-table.tsx.
 *
 * That file carries a 'use client' directive because the table itself is
 * stateful — it sorts, filters and paginates in the browser. These two are not:
 * they render text and a link. Left where they were, every server-rendered page
 * that wanted a heading was pulling a client boundary and the whole table
 * module into its bundle to get one <h1>.
 */

/** Consistent page heading across every staff screen. */
/**
 * The primary action on a list page.
 *
 * Shared rather than hand-rolled per screen: an "Add patient" that sits in a
 * different place, or is missing entirely, on each list is the single loudest
 * signal that software was assembled screen by screen rather than designed.
 */
export function ActionLink({
  href, children, icon,
}: { href: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex shrink-0 items-center gap-[7px] rounded-control bg-brand-600 px-[14px] py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-700"
    >
      {icon}
      {children}
    </Link>
  );
}

/**
 * The heading every staff screen opens with.
 *
 * The subtitle is capped at 78 characters rather than the container width. A
 * line of body text much past that is measurably harder to track back to the
 * start of the next line, and on a 1440px monitor an uncapped subtitle ran the
 * full width of the page as a single thin ribbon.
 */
export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-[1.15] text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-[5px] max-w-[78ch] text-[14px] text-ink-faint">{subtitle}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
