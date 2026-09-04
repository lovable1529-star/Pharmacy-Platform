/**
 * Message templates — §15.
 *
 * The rule that matters: SMS must not carry clinical detail. Enforcing it in
 * the substitution rather than in the sender means a second sender cannot
 * quietly break it.
 */

import { describe, it, expect } from 'vitest';
import {
  render, hasUnfilled, composeBody, type Template,
} from '../src/lib/notifications/templates';

const emailTemplate: Template = {
  key: 'prescription.ready', channel: 'EMAIL',
  subject: 'Ready to collect',
  body: 'Hello {firstName}, your {medicine} is ready at {branch}.',
  clinicalDetailAllowed: true,
};

const smsTemplate: Template = {
  key: 'prescription.ready', channel: 'SMS',
  subject: null,
  body: 'Hello {firstName}, there is an update. Please log in.',
  clinicalDetailAllowed: false,
};

const values = {
  safe: { firstName: 'Bridget', branch: 'Onchan' },
  clinical: { medicine: 'Mounjaro 7.5mg' },
};

describe('substitution', () => {
  it('fills safe values everywhere', () => {
    expect(render(smsTemplate, values)).toContain('Bridget');
    expect(render(emailTemplate, values)).toContain('Onchan');
  });

  it('gives clinical detail to a template allowed it', () => {
    expect(render(emailTemplate, values)).toContain('Mounjaro 7.5mg');
  });

  it('never gives clinical detail to one that is not', () => {
    // The whole point. A text naming somebody's weight-loss medication is a
    // disclosure nobody notices.
    const sms: Template = { ...smsTemplate, body: 'Your {medicine} is ready.' };
    expect(render(sms, values)).not.toContain('Mounjaro');
  });

  it('leaves a forbidden placeholder visibly unfilled', () => {
    // The safe failure: "{medicine}" is obviously wrong and gets fixed.
    const sms: Template = { ...smsTemplate, body: 'Your {medicine} is ready.' };
    const out = render(sms, values);
    expect(out).toContain('{medicine}');
    expect(hasUnfilled(out)).toBe(true);
  });

  it('leaves an unknown placeholder alone rather than emptying it', () => {
    const t: Template = { ...emailTemplate, body: 'Hello {nickname}.' };
    expect(render(t, values)).toBe('Hello {nickname}.');
  });

  it('reports a fully filled message as clean', () => {
    expect(hasUnfilled(render(emailTemplate, values))).toBe(false);
  });

  it('replaces every occurrence, not just the first', () => {
    const t: Template = { ...emailTemplate, body: '{firstName}, {firstName}.' };
    expect(render(t, values)).toBe('Bridget, Bridget.');
  });
});

describe('attaching the leaflet block', () => {
  const BODY = 'Your prescription is ready to collect.';
  const LEAFLET = 'How to inject your Mounjaro: https://karsons.im/inject';

  it('attaches it to a template allowed clinical detail', () => {
    expect(composeBody(BODY, LEAFLET, true)).toBe(`${BODY}\n${LEAFLET}`);
  });

  it('withholds it from one that is not', () => {
    /*
     * The disclosure this prevents. A link title names the medicine as surely
     * as a {medicine} token would, and a text message sits unencrypted on a
     * phone that other people pick up.
     */
    expect(composeBody(BODY, LEAFLET, false)).toBe(BODY);
  });

  it('withholds it however the caller passes it', () => {
    // The caller does not get to decide. Whatever reaches this function, an
    // SMS template comes back with the wording alone.
    for (const passed of [LEAFLET, '  ' + LEAFLET + '  ', 'anything at all']) {
      expect(composeBody(BODY, passed, false)).toBe(BODY);
    }
  });

  it('leaves the body alone when there is no appendix', () => {
    expect(composeBody(BODY, null, true)).toBe(BODY);
    expect(composeBody(BODY, undefined, true)).toBe(BODY);
  });

  it('treats whitespace as no appendix rather than a blank line', () => {
    expect(composeBody(BODY, '   \n  ', true)).toBe(BODY);
  });

  it('trims what it does attach', () => {
    expect(composeBody(BODY, `\n  ${LEAFLET}  \n`, true)).toBe(`${BODY}\n${LEAFLET}`);
  });

  it('separates the two with exactly one newline', () => {
    const composed = composeBody(BODY, LEAFLET, true);
    expect(composed.split('\n')).toEqual([BODY, LEAFLET]);
  });
});
