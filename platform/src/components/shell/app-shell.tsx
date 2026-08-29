'use client';

/**
 * Application shell.
 *
 * Three things matter here beyond layout:
 *
 * 1. The branch switcher is always visible and never ambiguous. Every clinical
 *    action records against a branch, stock moves against a branch, and NHS
 *    claims depend on it. A pharmacist working across sites must never be
 *    uncertain which one they are recording to — so it sits in the top bar at
 *    full contrast, not tucked into a user menu.
 *
 * 2. Navigation is filtered by permission, not disabled by CSS. A link the user
 *    cannot use is not rendered. Showing a receptionist a Compliance link
 *    teaches them the system is full of dead ends.
 *
 * 3. The tenancy path is shown in full — group, company, branch — because with
 *    more than one company the legal entity determines what prints on a
 *    prescription.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * The rail now sits on its own surface (`bg-nav`) rather than sharing #FFFFFF
 * with the content cards, so chrome and content read as two planes instead of
 * being separated by a single hairline.
 *
 * Thirteen destinations in one flat list was a wall. They are now grouped —
 * Clinical, Operations, Administration — which is the split a pharmacist
 * already has in their head: patients in front of you, running the shop,
 * governing the system. Grouping is presentation only; the permission filter
 * still decides what exists, and a group whose every item is filtered out
 * disappears with its heading rather than leaving a stranded label.
 *
 * ── The logo is the collapse control ──────────────────────────────────────
 *
 * There is no separate "Collapse" button any more. The K mark toggles the rail,
 * and swaps to a chevron on hover so it reads as a control rather than as
 * decoration you happened to click.
 *
 * This is the one spot in the rail that never moves and never scrolls, at the
 * corner the eye already goes to. A dedicated button had to live somewhere, and
 * everywhere it could live was either in the scrolling list or below it.
 *
 * ── Collapsing gives the space back ──────────────────────────────────────
 *
 * The rail sets `--nav-freed` on the content column: 0px open, 176px collapsed
 * (248 - 72). Every page adds it to its own max-width, so the room actually
 * reaches the content instead of being absorbed by the margins — see the
 * `.page-shell` note in globals.css.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, LayoutDashboard, Users, Stethoscope, CalendarDays, RefreshCw, Syringe, Pill, FileText,
  Package, Sparkles, Send, BarChart3, ShieldCheck, Settings, ChevronsUpDown, UserCog,
  Check, Building2, Banknote, Bell, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Permission } from '@/lib/tenancy/scope';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export interface BranchOption {
  id: string;
  name: string;
  code: string;
  companyId: string;
  companyName: string;
}

export interface ShellUser {
  fullName: string;
  roleLabel: string;
  permissions: Permission[];
}

interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The destinations, grouped.
 *
 * Order within each group is unchanged from the flat list it replaced — this
 * is a regrouping, not a re-prioritisation, and somebody who had learned the
 * old order should still find things roughly where they left them.
 */
const NAV: NavGroup[] = [
  {
    label: 'Clinical',
    items: [
      { href: '/', label: 'Today', permission: 'patients:view', icon: LayoutDashboard },
      { href: '/patients', label: 'Patients', permission: 'patients:view', icon: Users },
      { href: '/consultations', label: 'Consultations', permission: 'consultations:view', icon: Stethoscope },
      { href: '/appointments', label: 'Appointments', permission: 'appointments:view', icon: CalendarDays },
      { href: '/repeat-care', label: 'Repeat care', permission: 'repeat_care:view', icon: RefreshCw },
      { href: '/vaccinations', label: 'Vaccinations', permission: 'consultations:view', icon: Syringe },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/inventory', label: 'Inventory', permission: 'inventory:view', icon: Package },
      { href: '/services', label: 'Services', permission: 'services:view', icon: Sparkles },
      { href: '/prescriptions', label: 'Prescriptions', permission: 'consultations:view', icon: Pill },
      { href: '/payments', label: 'Payments', permission: 'reports:view', icon: Banknote },
      { href: '/documents', label: 'Documents', permission: 'consultations:view', icon: FileText },
      { href: '/communications', label: 'Communications', permission: 'communications:view', icon: Send },
      { href: '/reports', label: 'Reports', permission: 'reports:view', icon: BarChart3 },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/compliance', label: 'Compliance', permission: 'compliance:view', icon: ShieldCheck },
      { href: '/users', label: 'Users & Roles', permission: 'users:view', icon: UserCog },
      { href: '/settings', label: 'Settings', permission: 'settings:edit', icon: Settings },
    ],
  },
];

interface AppShellProps {
  user: ShellUser;
  organisationName: string;
  branches: BranchOption[];
  activeBranchId: string;
  onBranchChange: (branchId: string) => void;
  currentPath: string;
  badges?: Partial<Record<string, number>>;
  children: React.ReactNode;
}

export function AppShell({
  user,
  organisationName,
  branches,
  activeBranchId,
  onBranchChange,
  currentPath,
  badges = {},
  children,
}: AppShellProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);

  /**
   * Collapsed state is remembered per browser.
   *
   * Somebody who works on a laptop at the counter will collapse this once and
   * expect it to stay collapsed. Reading localStorage lazily in the initialiser
   * rather than in an effect avoids the sidebar visibly snapping shut after the
   * first paint.
   *
   * Every access is guarded: a private window, cleared site data or a browser
   * set to block storage all throw here rather than returning null, and a
   * navigation shell is not worth crashing over a preference.
   */
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('karsons.nav.collapsed') === '1';
    } catch {
      return false;
    }
  });

  function toggleNav() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('karsons.nav.collapsed', next ? '1' : '0');
      } catch {
        // Preference not persisted. The toggle still works for this session.
      }
      return next;
    });
  }

  /**
   * Groups with nothing left in them are dropped entirely.
   *
   * A receptionist holds none of the Administration permissions, and a heading
   * with no items under it looks like a rendering bug rather than a boundary.
   */
  const permittedGroups = useMemo(
    () =>
      NAV.map((group) => ({
        label: group.label,
        items: group.items.filter((item) => user.permissions.includes(item.permission)),
      })).filter((group) => group.items.length > 0),
    [user.permissions],
  );

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? branches[0];

  const initials = user.fullName
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  /*
   * The notification pip reuses the badge counts the shell is already given.
   * Nothing new is fetched: if any nav badge is non-zero there is something
   * waiting, and the bell says so. This keeps the indicator honest — it can
   * never claim attention the navigation itself is not also claiming.
   */
  const hasWaiting = Object.values(badges).some((count) => (count ?? 0) > 0);

  /*
   * Labels fade rather than unmount.
   *
   * Removing them from the DOM made the width transition jump, because the
   * content reflowed halfway through the animation. Fading them while the rail
   * clips its own overflow means the two happen in step. They stay in the
   * accessibility tree throughout, so a screen reader is unaffected by a purely
   * visual collapse.
   */
  const labelFade = cn(
    'whitespace-nowrap transition-opacity duration-200',
    collapsed ? 'opacity-0' : 'opacity-100',
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* ── Sidebar ───────────────────────────────────────── */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-line bg-nav md:flex',
          'transition-[width] duration-[260ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
          collapsed ? 'w-[72px]' : 'w-[248px]',
        )}
      >
        <div className="flex h-[60px] shrink-0 items-center gap-2.5 px-4">
          <button
            type="button"
            onClick={toggleNav}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
            title={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
            className="group relative flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_4px_12px_-5px_rgba(91,58,142,0.75)] transition-shadow hover:shadow-[0_6px_16px_-5px_rgba(91,58,142,0.9)]"
          >
            {/* The mark and the chevron are stacked and cross-fade, so the
                button never changes size and the rail's header does not twitch
                as the pointer crosses it. On touch, where there is no hover,
                it simply stays the logo and still toggles. */}
            <span className="font-display text-[13.5px] font-bold transition-opacity duration-150 group-hover:opacity-0">
              K
            </span>
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            >
              {collapsed ? (
                <ChevronRight size={16} strokeWidth={2.4} />
              ) : (
                <ChevronLeft size={16} strokeWidth={2.4} />
              )}
            </span>
          </button>
          <div className={cn('leading-tight', labelFade)}>
            <div className="font-display text-[14px] font-semibold text-ink">Karsons</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
              Clinical Services
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2.5 pb-2.5 pt-1.5">
          {permittedGroups.map((group) => (
            <div key={group.label} className="contents">
              <div
                className={cn(
                  'px-2.5 pb-1 pt-3.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint',
                  labelFade,
                )}
              >
                {group.label}
              </div>

              {group.items.map((item) => {
                const active = currentPath === item.href;
                const Icon = item.icon;
                const badge = badges[item.href];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    /*
                     * Fetch the whole page, not just its loading state.
                     *
                     * Next's default for a dynamic route prefetches only as far
                     * as the nearest loading boundary, so the click still waits
                     * on the server for the data. `prefetch` fetches the
                     * rendered payload, which is what turns a navigation
                     * between these screens into a paint rather than a request.
                     *
                     * Affordable because the sidebar is a fixed dozen links and
                     * the fetches happen while the user is reading the page
                     * they are already on. It is only useful in combination
                     * with `staleTimes.dynamic` — see next.config.mjs.
                     */
                    prefetch
                    aria-current={active ? 'page' : undefined}
                    // Collapsed, the label is off-screen but still in the DOM,
                    // so the tooltip is what makes the icon rail usable for a
                    // sighted mouse user.
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'relative flex items-center gap-[11px] rounded-control px-2.5 py-2 text-[13.5px] transition-colors',
                      active
                        ? 'bg-brand-50 font-semibold text-brand-700'
                        : 'font-medium text-ink-soft hover:bg-sunk hover:text-ink',
                    )}
                  >
                    {/*
                      The active marker is a bar on the leading edge rather than
                      the fill alone. Collapsed to an icon rail the fill is a
                      small tinted square that reads as a hover state; a bar
                      pinned to the edge still says "you are here".
                    */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-brand-600 transition-all duration-200',
                        active ? 'h-[18px] opacity-100' : 'h-0 opacity-0',
                      )}
                    />
                    <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center">
                      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                    </span>
                    <span className={cn('flex-1', labelFade)}>{item.label}</span>
                    {badge ? (
                      collapsed ? (
                        // A count nobody can read still says "something is
                        // waiting", which is the part that matters at 72px.
                        <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-review-600" />
                      ) : (
                        <span
                          className={cn(
                            'tabular rounded-full bg-review-100 px-[7px] py-px font-mono text-[10px] font-medium text-review-700',
                            labelFade,
                          )}
                        >
                          {badge}
                        </span>
                      )
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-line-soft p-2.5">
          <div
            className="flex items-center gap-2.5 rounded-control px-2 py-1"
            title={collapsed ? `${user.fullName} · ${user.roleLabel}` : undefined}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 font-mono text-[10.5px] font-medium text-brand-700">
              {initials}
            </div>
            <div className={cn('min-w-0 leading-tight', labelFade)}>
              <div className="truncate text-[13px] font-medium text-ink">{user.fullName}</div>
              <div className="truncate text-[11px] text-ink-faint">{user.roleLabel}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────── */}
      {/*
        `--nav-freed` is what makes collapsing worth doing. Pages add it to
        their own max-width rather than sharing one, because a patient record
        should not become as wide as an inventory table just because there is
        room. Below `md` the rail is not rendered at all; the variable is
        harmless there, since the viewport is the binding constraint long
        before any of these caps are.
      */}
      <div
        className="flex min-w-0 flex-1 flex-col"
        style={{ '--nav-freed': collapsed ? '176px' : '0px' } as React.CSSProperties}
      >
        {/*
          Sticky, so the branch you are recording against stays on screen while
          you scroll a long patient list. It is the one piece of context that
          must never scroll out of sight.
        */}
        <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
          {/* Tenancy path — group / company / branch */}
          <div className="hidden min-w-0 items-center gap-1.5 text-[12.5px] text-ink-faint lg:flex">
            <Building2 size={14} strokeWidth={1.8} className="shrink-0" />
            <span className="truncate">{organisationName}</span>
            {activeBranch ? (
              <>
                <span className="text-line">/</span>
                <span className="truncate">{activeBranch.companyName}</span>
                <span className="text-line">/</span>
                <span className="truncate font-medium text-ink-soft">{activeBranch.name}</span>
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            {/*
              Restyled to the design, but deliberately still inert — as it has
              always been. The command palette behind it is not built, and a
              search box that looks ready and then does nothing is worse than
              one that looks like the placeholder it is. Left non-interactive
              (no onClick, not focusable) so nobody discovers it by tabbing.
            */}
            <div
              aria-hidden="true"
              className="hidden items-center gap-2.5 rounded-control border border-line bg-canvas py-[7px] pl-3 pr-2.5 text-[13px] text-ink-faint sm:flex"
            >
              <Search size={14} strokeWidth={1.9} />
              <span>Search patients</span>
              <kbd className="rounded-[5px] border border-line bg-surface px-1.5 py-px font-mono text-[10px] text-ink-faint">
                /
              </kbd>
            </div>

            <ThemeToggle />

            {/*
              A link, not a button — it goes to the outbox that already exists.
              The pip is driven by the same badge counts as the navigation, so
              it cannot claim attention the nav is not also claiming.
            */}
            {user.permissions.includes('communications:view') ? (
              <Link
                href="/communications"
                aria-label={hasWaiting ? 'Notifications — items waiting' : 'Notifications'}
                title="Notifications"
                className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-faint transition-colors hover:border-brand-300 hover:text-brand-600"
              >
                <Bell size={16} strokeWidth={1.9} />
                {hasWaiting ? (
                  <span className="absolute right-[7px] top-[6px] h-1.5 w-1.5 animate-pulsedot rounded-full bg-stop-600" />
                ) : null}
              </Link>
            ) : null}

            {/* Branch switcher — the most important control in the shell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSwitcherOpen((o) => !o)}
                aria-expanded={switcherOpen}
                aria-haspopup="listbox"
                className="flex items-center gap-2.5 rounded-control border border-brand-200 bg-brand-50 px-2.5 py-1.5 transition-colors hover:border-brand-300"
              >
                <span className="tabular rounded-[5px] bg-brand-600 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white">
                  {activeBranch?.code}
                </span>
                <span className="text-[13.5px] font-semibold text-brand-700">
                  {activeBranch?.name}
                </span>
                <ChevronsUpDown size={14} strokeWidth={2} className="text-brand-400" />
              </button>

              {switcherOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setSwitcherOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    role="listbox"
                    className="absolute right-0 z-20 mt-2 w-[272px] origin-top-right animate-pop overflow-hidden rounded-panel border border-line bg-surface shadow-pop"
                  >
                    <div className="border-b border-line-soft px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint">
                      Recording at
                    </div>
                    {branches.map((b) => {
                      const selected = b.id === activeBranchId;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            onBranchChange(b.id);
                            setSwitcherOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                            selected ? 'bg-brand-50' : 'hover:bg-sunk',
                          )}
                        >
                          <span className="tabular rounded-[5px] border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
                            {b.code}
                          </span>
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate text-[13.5px] font-medium text-ink">
                              {b.name}
                            </span>
                            <span className="block truncate text-[11.5px] text-ink-faint">
                              {b.companyName}
                            </span>
                          </span>
                          {selected ? (
                            <Check size={15} strokeWidth={2.4} className="shrink-0 text-brand-600" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
