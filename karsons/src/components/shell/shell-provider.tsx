'use client';

/**
 * Shell provider.
 *
 * Holds the selected branch and makes it available to every page, because
 * almost everything the application shows is branch-scoped: today's
 * appointments, the walk-in queue, stock levels, the daily summary.
 *
 * Patient records are the deliberate exception — they are organisation-scoped
 * and follow the patient across branches. See CLAUDE.md §4.
 *
 * In production the branch list comes from the user's role assignments via
 * `accessibleBranches()`. In demo mode it comes from the seeded data. The
 * component contract is identical either way.
 */

import { createContext, useContext, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { BRANCHES, DEMO_USER, REPEAT_REQUESTS } from '@/lib/demo/data';
import type { Permission } from '@/lib/auth/scope';

interface ShellContextValue {
  branchId: string;
  branchName: string;
  setBranchId: (id: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside ShellProvider');
  return context;
}

/** Demo user is an owner, so every screen is reachable during a walkthrough. */
const DEMO_PERMISSIONS: Permission[] = [
  'patient.read', 'patient.write', 'patient.merge',
  'consultation.read', 'consultation.perform', 'prescription.issue', 'repeat.review',
  'appointment.read', 'appointment.write',
  'inventory.read', 'inventory.write', 'inventory.recall',
  'service.read', 'service.write', 'ruleset.publish',
  'staff.manage', 'company.manage', 'billing.manage',
  'audit.read', 'compliance.manage',
];

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [branchId, setBranchId] = useState(BRANCHES[0]!.id);
  const pathname = usePathname() ?? '/dashboard';

  const value = useMemo(
    () => ({
      branchId,
      branchName: BRANCHES.find((b) => b.id === branchId)?.name ?? '',
      setBranchId,
    }),
    [branchId],
  );

  // Patient-facing forms render without the staff chrome.
  if (pathname.startsWith('/f/')) {
    return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
  }

  const outstanding = REPEAT_REQUESTS.filter((r) => !r.reviewed).length;

  return (
    <ShellContext.Provider value={value}>
      <AppShell
        user={{
          fullName: DEMO_USER.fullName,
          roleLabel: DEMO_USER.roleLabel,
          permissions: DEMO_PERMISSIONS,
        }}
        branches={BRANCHES}
        activeBranchId={branchId}
        onBranchChange={setBranchId}
        currentPath={pathname}
        badges={{ '/repeat-care': outstanding }}
      >
        {children}
      </AppShell>
    </ShellContext.Provider>
  );
}
