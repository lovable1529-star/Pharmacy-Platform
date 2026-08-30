/**
 * The vocabulary of a recorded patient contact.
 *
 * Constants and types only, in a plain module rather than beside the server
 * action, because a `'use server'` file may export nothing but async functions
 * — an `export const` there fails the production build, though not typecheck
 * or tests, which is a nasty place to find it.
 */

/** Why a contact happened. The new-patient approval gate reads the first. */
export const NEW_PATIENT_VERIFICATION = 'NEW_PATIENT_VERIFICATION';
export const AMBER_REVIEW = 'AMBER_REVIEW';

export type ContactOutcome =
  | 'COMPLETED'
  | 'NO_ANSWER'
  | 'VOICEMAIL'
  | 'CALLBACK_REQUESTED'
  | 'FAILED'
  | 'INFO_REQUIRED'
  | 'ESCALATED';

/** The outcomes a pharmacist actually reaches from a telephone call. */
export const CALL_OUTCOMES: { value: ContactOutcome; label: string }[] = [
  { value: 'COMPLETED', label: 'Spoke to them' },
  { value: 'NO_ANSWER', label: 'No answer' },
  { value: 'VOICEMAIL', label: 'Left a voicemail' },
  { value: 'CALLBACK_REQUESTED', label: 'They will call back' },
  { value: 'INFO_REQUIRED', label: 'Need more information' },
];

export function outcomeLabel(outcome: string): string {
  return CALL_OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;
}
