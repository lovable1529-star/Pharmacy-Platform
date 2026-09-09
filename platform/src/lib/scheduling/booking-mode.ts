/**
 * Whether a service takes appointments at all.
 *
 * Appointment modality is independent of what kind of service it is. Flu is
 * appointment-capable and also takes walk-ins; both Weight Management services
 * have no internal booking — a repeat request is a form, not a visit, and a new
 * patient is assessed on the telephone.
 *
 * The column has existed since the first migration and both Weight Management
 * services are correctly set to NONE in the database. Nothing read it. The
 * public booking page listed every service that was not archived, so a patient
 * could book an appointment for a service the pharmacy does not run
 * appointments for — and would then be sent a confirmation for a slot no
 * pharmacist expects to see.
 *
 * Pure, so the rule can be tested without a database.
 */

export type BookingMode = 'NONE' | 'OPTIONAL' | 'REQUIRED';

export const BOOKING_MODES: readonly BookingMode[] = ['NONE', 'OPTIONAL', 'REQUIRED'] as const;

/**
 * Can a patient book this service?
 *
 * Unknown values are treated as bookable, matching the column's own default of
 * OPTIONAL. That is the deliberate direction to fail in: a service wrongly
 * offered is a patient who arrives to a slot somebody has to honour, which is
 * awkward. A service wrongly hidden is a patient who cannot book at all and
 * gives up, and nobody finds out.
 */
export function isBookable(mode: string | null | undefined): boolean {
  return mode !== 'NONE';
}

/** What to tell somebody who reached a service that does not take appointments. */
export function notBookableMessage(serviceName: string): string {
  return `${serviceName} does not use appointments. Complete the form online, or `
    + 'call the pharmacy and we will help.';
}
