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
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, LayoutDashboard, Users, Stethoscope, CalendarDays, RefreshCw,
  Package, Sparkles, Send, BarChart3, ShieldCheck, Settings, ChevronsUpDown, UserCog,
  Check, Building2, Banknote,
  PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Permission } from '@/lib/tenancy/scope';

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

const NAV: NavItem[] = [
  { href: '/', label: 'Today', permission: 'patients:view', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', permission: 'patients:view', icon: Users },
  { href: '/consultations', label: 'Consultations', permission: 'consultations:view', icon: Stethoscope },
  { href: '/appointments', label: 'Appointments', permission: 'appointments:view', icon: CalendarDays },
  { href: '/repeat-care', label: 'Repeat care', permission: 'repeat_care:view', icon: RefreshCw },
  { href: '/inventory', label: 'Inventory', permission: 'inventory:view', icon: Package },
  { href: '/services', label: 'Services', permission: 'services:view', icon: Sparkles },
  { href: '/payments', label: 'Payments', permission: 'reports:view', icon: Banknote },
  { href: '/communications', label: 'Communications', permission: 'communications:view', icon: Send },
  { href: '/reports', label: 'Reports', permission: 'reports:view', icon: BarChart3 },
  { href: '/compliance', label: 'Compliance', permission: 'compliance:view', icon: ShieldCheck },
  { href: '/users', label: 'Users & Roles', permission: 'users:view', icon: UserCog },
  { href: '/settings', label: 'Settings', permission: 'settings:edit', icon: Settings },
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

  const permitted = useMemo(
    () => NAV.filter((item) => user.permissions.includes(item.permission)),
    [user.permissions],
  );

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? branches[0];

  const initials = user.fullName
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* ── Sidebar ───────────────────────────────────────── */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 md:flex',
          collapsed ? 'w-[60px]' : 'w-[236px]',
        )}
      >
        <div
          className={cn(
            'flex h-[60px] items-center gap-2.5 border-b border-line',
            collapsed ? 'justify-center px-2' : 'px-5',
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-brand-600 font-display text-[13px] font-bold text-white">
            K
          </div>
          {!collapsed ? (
            <div className="min-w-0 leading-tight">
              <div className="font-display text-[14px] font-semibold text-ink">Karsons</div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-faint">
                Clinical Services
              </div>
            </div>
          ) : null}
        </div>

        <nav className={cn('flex flex-1 flex-col gap-0.5 overflow-y-auto', collapsed ? 'p-2' : 'p-3')}>
          {permitted.map((item) => {
            const active = currentPath === item.href;
            const Icon = item.icon;
            const badge = badges[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // Collapsed, the label is gone from the screen but must not be
                // gone from a screen reader — and the tooltip is what makes the
                // icons usable for everyone else.
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center rounded-[7px] py-[7px] text-[13.5px] transition-colors',
                  collapsed ? 'justify-center px-2' : 'gap-2.5 px-3',
                  active
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'font-medium text-ink-soft hover:bg-sunk hover:text-ink',
                )}
              >
                <Icon size={16} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
                {collapsed ? null : <span className="flex-1">{item.label}</span>}
                {badge ? (
                  collapsed ? (
                    // A count nobody can read still says "something is waiting",
                    // which is the part that matters when the rail is narrow.
                    <span className="absolute right-1 top-1 h-[7px] w-[7px] rounded-full bg-review-600" />
                  ) : (
                    <span className="tabular rounded-full bg-review-100 px-1.5 py-px font-mono text-[10px] font-medium text-review-700">
                      {badge}
                    </span>
                  )
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className={cn('border-t border-line', collapsed ? 'p-2' : 'p-3')}>
          <div
            className={cn(
              'flex items-center rounded-[7px] py-1.5',
              collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
            )}
            title={collapsed ? `${user.fullName} · ${user.roleLabel}` : undefined}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 font-mono text-[10.5px] font-medium text-brand-700">
              {initials}
            </div>
            {!collapsed ? (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[13px] font-medium text-ink">{user.fullName}</div>
                <div className="truncate text-[11px] text-ink-faint">{user.roleLabel}</div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
          {/* Lives in the top bar rather than on the sidebar edge: a control
              that moves when you use it is a control people stop using. */}
          <button
            type="button"
            onClick={toggleNav}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
            title={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
            className="hidden shrink-0 rounded-[7px] p-1.5 text-ink-faint transition-colors hover:bg-sunk hover:text-ink md:block"
          >
            <PanelLeft size={17} strokeWidth={1.9} />
          </button>

          {/* Tenancy path — group / company / branch */}
          <div className="hidden min-w-0 items-center gap-1.5 text-[12.5px] text-ink-faint lg:flex">
            <Building2 size={14} strokeWidth={1.8} />
            <span className="truncate">{organisationName}</span>
            {activeBranch ? (
              <>
                <span className="text-line">/</span>
                <span className="truncate">{activeBranch.companyName}</span>
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              className="hidden items-center gap-2 rounded-[7px] border border-line bg-canvas px-3 py-[7px] text-[13px] text-ink-faint transition-colors hover:border-brand-300 hover:text-ink-soft sm:flex"
            >
              <Search size={14} strokeWidth={1.9} />
              <span>Search patients</span>
              <kbd className="ml-2 rounded border border-line bg-surface px-1.5 py-px font-mono text-[10px] text-ink-faint">
                /
              </kbd>
            </button>

            {/* Branch switcher — the most important control in the shell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSwitcherOpen((o) => !o)}
                aria-expanded={switcherOpen}
                aria-haspopup="listbox"
                className="flex items-center gap-2.5 rounded-[7px] border border-brand-200 bg-brand-50 px-3 py-[7px] transition-colors hover:border-brand-300"
              >
                <span className="tabular rounded-[4px] bg-brand-600 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white">
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
                    className="absolute right-0 z-20 mt-1.5 w-[264px] overflow-hidden rounded-[10px] border border-line bg-surface shadow-pop"
                  >
                    <div className="border-b border-line-soft px-3 py-2 font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint">
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
                          <span className="tabular rounded-[4px] border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
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
                            <Check size={15} strokeWidth={2.4} className="text-brand-600" />
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
