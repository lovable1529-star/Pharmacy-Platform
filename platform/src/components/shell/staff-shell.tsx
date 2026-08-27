'use client';

/**
 * Staff frame.
 *
 * Holds the active branch and hands it to the shell. Branch lives in a cookie
 * rather than component state so it survives navigation and a refresh — a
 * pharmacist who set the branch to Kirk Michael this morning should not find
 * themselves silently recording against Onchan after a page reload.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AppShell, type BranchOption, type ShellUser } from './app-shell';

const COOKIE = 'karsons.branch';

function readCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function StaffShell({
  user,
  organisationName,
  branches,
  badges,
  children,
}: {
  user: ShellUser;
  organisationName: string;
  branches: BranchOption[];
  badges?: Partial<Record<string, number>>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [activeBranchId, setActiveBranchId] = useState(branches[0]?.id ?? '');

  useEffect(() => {
    const stored = readCookie();
    if (stored && branches.some((b) => b.id === stored)) setActiveBranchId(stored);
  }, [branches]);

  const changeBranch = useCallback((branchId: string) => {
    setActiveBranchId(branchId);
    // A year is fine — this is a convenience, not a security control. Every
    // request re-checks the caller actually holds access at this branch.
    document.cookie = `${COOKIE}=${encodeURIComponent(branchId)};path=/;max-age=31536000;samesite=lax`;
    window.location.reload();
  }, []);

  return (
    <AppShell
      user={user}
      organisationName={organisationName}
      branches={branches}
      activeBranchId={activeBranchId}
      onBranchChange={changeBranch}
      currentPath={pathname}
      badges={badges}
    >
      {children}
    </AppShell>
  );
}
