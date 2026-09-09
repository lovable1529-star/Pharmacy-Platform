import { describe, it, expect } from 'vitest';
import { isBookable, notBookableMessage, BOOKING_MODES } from '../src/lib/scheduling/booking-mode';

describe('isBookable', () => {
  it('refuses a service that does not take appointments', () => {
    expect(isBookable('NONE')).toBe(false);
  });

  it('allows the two modes that do', () => {
    expect(isBookable('OPTIONAL')).toBe(true);
    expect(isBookable('REQUIRED')).toBe(true);
  });

  /*
   * The column defaults to OPTIONAL, so anything unrecognised is treated as
   * bookable. A service wrongly offered produces an awkward appointment
   * somebody has to honour; a service wrongly hidden produces a patient who
   * cannot book, gives up, and tells nobody.
   */
  it('treats an unknown or missing mode as bookable, matching the column default', () => {
    expect(isBookable(null)).toBe(true);
    expect(isBookable(undefined)).toBe(true);
    expect(isBookable('')).toBe(true);
    expect(isBookable('SOMETHING_NEW')).toBe(true);
  });

  it('is case-sensitive on purpose, because the column is', () => {
    // 'none' is not a value the column can hold; treating it as NONE would
    // hide a service on the strength of a typo nobody could see.
    expect(isBookable('none')).toBe(true);
  });

  it('covers every declared mode', () => {
    expect(BOOKING_MODES).toEqual(['NONE', 'OPTIONAL', 'REQUIRED']);
    expect(BOOKING_MODES.filter(isBookable)).toEqual(['OPTIONAL', 'REQUIRED']);
  });
});

describe('notBookableMessage', () => {
  it('names the service and offers the route that does work', () => {
    const message = notBookableMessage('Weight Management — Repeat Request');
    expect(message).toContain('Weight Management — Repeat Request');
    expect(message.toLowerCase()).toContain('form');
  });

  it('does not blame the patient or mention a column', () => {
    const message = notBookableMessage('Flu Vaccination').toLowerCase();
    for (const leak of ['booking_mode', 'null', 'invalid', 'error']) {
      expect(message).not.toContain(leak);
    }
  });
});
