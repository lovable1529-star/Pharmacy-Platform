'use client';

/**
 * Application shell.
 *
 * Two things matter here beyond layout:
 *
 * 1. **The branch switcher is always visible.** A pharmacist working across
 *    Onchan and Kirk Michael must never be uncertain which branch they are
 *    recording against — stock decrements and NHS claims both depend on it.
 *
 * 2. **Navigation is filtered by permission, not hidden by CSS.** A link the
 *    user cannot use is not rendered at all. Showing a disabled Compliance link
 *    to a receptionist teaches them the system is full of dead ends.
 */

import { useMemo, useState } from 'react';
import type { Permission } from '@/lib/auth/scope';

export interface BranchOption {
  id: string;
  name: string;
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
  /** Count shown as a badge, e.g. outstanding reviews. */
  badge?: number;
}

const NAV: NavItem[] = [
  { href: '/dashboard',      label: 'Dashboard',      permission: 'patient.read' },
  { href: '/patients',       label: 'Patients',       permission: 'patient.read' },
  { href: '/consultations',  label: 'Consultations',  permission: 'consultation.read' },
  { href: '/appointments',   label: 'Appointments',   permission: 'appointment.read' },
  { href: '/repeat-care',    label: 'Repeat care',    permission: 'repeat.review' },
  { href: '/inventory',      label: 'Inventory',      permission: 'inventory.read' },
  { href: '/services',       label: 'Services',       permission: 'service.read' },
  { href: '/communications', label: 'Communications', permission: 'patient.read' },
  { href: '/reports',        label: 'Reports',        permission: 'patient.read' },
  { href: '/compliance',     label: 'Compliance',     permission: 'audit.read' },
  { href: '/settings',       label: 'Settings',       permission: 'staff.manage' },
];

export function AppShell({
  user,
  branches,
  activeBranchId,
  onBranchChange,
  currentPath,
  badges = {},
  children,
}: {
  user: ShellUser;
  branches: BranchOption[];
  activeBranchId: string;
  onBranchChange: (branchId: string) => void;
  currentPath: string;
  badges?: Record<string, number>;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const permissions = useMemo(() => new Set(user.permissions), [user.permissions]);

  const visibleNav = NAV.filter((item) => permissions.has(item.permission));
  const activeBranch = branches.find((b) => b.id === activeBranchId);

  // Only show the company name when the group has more than one — otherwise it
  // is noise on every screen.
  const showCompany = new Set(branches.map((b) => b.companyId)).size > 1;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <aside
        className={`${mobileOpen ? 'block' : 'hidden'} bg-brand-900 text-white lg:block`}
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-clinical-green-600 to-brand-600 font-display text-sm font-bold">
            K
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-bold">Karsons Pharmacy</div>
            <div className="text-[11px] text-brand-300">Clinical services</div>
          </div>
        </div>

        <div className="px-3 pb-3">
          <label htmlFor="branch-switcher" className="mb-1 block px-2 text-[11px] text-brand-300">
            Working at
          </label>
          <select
            id="branch-switcher"
            value={activeBranchId}
            onChange={(event) => onBranchChange(event.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id} className="text-ink">
                {showCompany ? `${branch.companyName} — ${branch.name}` : branch.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="px-3 pb-6">
          <ul className="space-y-0.5">
            {visibleNav.map((item) => {
              const active = currentPath.startsWith(item.href);
              const count = badges[item.href];

              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      active ? 'bg-white/15 font-semibold' : 'text-brand-100 hover:bg-white/8'
                    }`}
                  >
                    <span>{item.label}</span>
                    {count ? (
                      <span className="rounded-full bg-triage-amber-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-triage-amber-700">
                        {count}
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
            className="rounded-lg border border-line px-3 py-1.5 text-sm lg:hidden"
          >
            Menu
          </button>

          {/*
            Repeating the branch in the header is deliberate duplication. On a
            tablet the sidebar is collapsed, and a pharmacist must be able to see
            at a glance where they are recording.
          */}
          <div className="hidden items-center gap-2 text-sm text-ink-soft lg:flex">
            <span className="h-2 w-2 rounded-full bg-clinical-green-600" aria-hidden />
            {activeBranch ? `${activeBranch.name}` : 'No branch selected'}
          </div>

          <div className="flex items-center gap-3 text-right">
            <div className="leading-tight">
              <div className="text-sm font-semibold">{user.fullName}</div>
              <div className="text-[11px] text-ink-soft">{user.roleLabel}</div>
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
