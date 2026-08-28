/**
 * Severity levels for a recorded allergy.
 *
 * Deliberately coarse: a pharmacist about to administer a vaccine needs to know
 * whether this stops them, not a clinical taxonomy. Kept in its own module
 * because a 'use server' file may only export async functions.
 */
export const SEVERITIES = ['Mild', 'Moderate', 'Severe', 'Anaphylaxis'] as const;

export type Severity = (typeof SEVERITIES)[number];
