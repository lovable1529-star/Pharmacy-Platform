/**
 * Message templates — §15.
 *
 * The rule that matters: SMS must not carry clinical detail. Enforcing it in
 * the substitution rather than in the sender means a second sender cannot
 * quietly break it.
 */

import { describe, it, expect } from 'vitest';
import { render, hasUnfilled, type Template } from '../src/lib/notifications/templates';

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
