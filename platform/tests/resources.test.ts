/**
 * Patient resources.
 *
 * Two things must hold. A patient is only shown material that applies to them,
 * and an edit to a resource never retrospectively changes what somebody's
 * acknowledgement claimed they read.
 */

import { describe, it, expect } from 'vitest';
import {
  applicableResources,
  blockingResources,
  missingAcknowledgements,
  needsNewVersion,
  nextVersion,
  resourceKeyFrom,
  resourceProblems,
  isLive,
  type Resource,
  type ResourceDraft,
} from '../src/lib/resources/applicable';
import {
  acknowledgementValues,
  requestedIds,
} from '../src/lib/workflow/resources';

const MOUNJARO = '11111111-1111-1111-1111-111111111111';
const WEGOVY = '22222222-2222-2222-2222-222222222222';

function resource(over: Partial<Resource> = {}): Resource {
  return {
    id: 'r1',
    resourceKey: 'injection-guide',
    version: 1,
    title: 'How to inject',
    description: null,
    url: 'https://karsons.im/inject',
    displayStage: 'BOTH',
    requiresAcknowledgement: true,
    sortOrder: 0,
    active: true,
    archivedAt: null,
    medicineId: null,
    ...over,
  };
}

function draft(over: Partial<ResourceDraft> = {}): ResourceDraft {
  return {
    title: 'How to inject',
    description: null,
    url: 'https://karsons.im/inject',
    displayStage: 'BOTH',
    requiresAcknowledgement: true,
    sortOrder: 0,
    medicineId: null,
    ...over,
  };
}

describe('which resources apply', () => {
  it('leaves out the ones switched off', () => {
    const shown = applicableResources(
      [resource({ id: 'a' }), resource({ id: 'b', active: false })],
      { stage: 'BEFORE_SUBMISSION' },
    );
    expect(shown.map((r) => r.id)).toEqual(['a']);
  });

  it('leaves out the ones retired', () => {
    const shown = applicableResources(
      [resource({ id: 'a' }), resource({ id: 'b', archivedAt: new Date() })],
      { stage: 'BEFORE_SUBMISSION' },
    );
    expect(shown.map((r) => r.id)).toEqual(['a']);
  });

  it('treats inactive and archived as different states', () => {
    expect(isLive({ active: false, archivedAt: null })).toBe(false);
    expect(isLive({ active: true, archivedAt: new Date() })).toBe(false);
    expect(isLive({ active: true, archivedAt: null })).toBe(true);
  });

  it('respects the stage', () => {
    const all = [
      resource({ id: 'before', displayStage: 'BEFORE_SUBMISSION' }),
      resource({ id: 'after', displayStage: 'AFTER_RX' }),
      resource({ id: 'both', displayStage: 'BOTH' }),
    ];

    expect(applicableResources(all, { stage: 'BEFORE_SUBMISSION' }).map((r) => r.id).sort())
      .toEqual(['before', 'both']);
    expect(applicableResources(all, { stage: 'AFTER_RX' }).map((r) => r.id).sort())
      .toEqual(['after', 'both']);
  });

  it('shows a medicine-specific resource only to patients on that medicine', () => {
    const all = [
      resource({ id: 'general', medicineId: null }),
      resource({ id: 'mounjaro', medicineId: MOUNJARO }),
      resource({ id: 'wegovy', medicineId: WEGOVY }),
    ];

    const shown = applicableResources(all, {
      stage: 'BEFORE_SUBMISSION',
      medicineId: MOUNJARO,
    });

    expect(shown.map((r) => r.id).sort()).toEqual(['general', 'mounjaro']);
  });

  it('shows only the general ones when the medicine is not yet known', () => {
    const all = [
      resource({ id: 'general', medicineId: null }),
      resource({ id: 'mounjaro', medicineId: MOUNJARO }),
    ];

    // A new patient who has not chosen. Handing them the injection guide for a
    // medicine they were not prescribed is not a neutral act.
    expect(applicableResources(all, { stage: 'BEFORE_SUBMISSION' }).map((r) => r.id))
      .toEqual(['general']);
    expect(applicableResources(all, { stage: 'BEFORE_SUBMISSION', medicineId: null })
      .map((r) => r.id)).toEqual(['general']);
  });

  it('keeps the order the client set', () => {
    const shown = applicableResources(
      [
        resource({ id: 'third', sortOrder: 30, title: 'C' }),
        resource({ id: 'first', sortOrder: 10, title: 'A' }),
        resource({ id: 'second', sortOrder: 20, title: 'B' }),
      ],
      { stage: 'BEFORE_SUBMISSION' },
    );

    expect(shown.map((r) => r.id)).toEqual(['first', 'second', 'third']);
  });

  it('breaks ties on title so the order never wobbles between renders', () => {
    const all = [
      resource({ id: 'z', sortOrder: 0, title: 'Zebra' }),
      resource({ id: 'a', sortOrder: 0, title: 'Aardvark' }),
    ];

    expect(applicableResources(all, { stage: 'BEFORE_SUBMISSION' }).map((r) => r.id))
      .toEqual(['a', 'z']);
    // Same answer from the other input order.
    expect(applicableResources(all.slice().reverse(), { stage: 'BEFORE_SUBMISSION' })
      .map((r) => r.id)).toEqual(['a', 'z']);
  });

  it('does not mutate what it was given', () => {
    const all = [resource({ id: 'b', sortOrder: 20 }), resource({ id: 'a', sortOrder: 10 })];
    applicableResources(all, { stage: 'BEFORE_SUBMISSION' });
    expect(all.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('what blocks submission', () => {
  it('only the required ones block', () => {
    const shown = [
      resource({ id: 'must', requiresAcknowledgement: true }),
      resource({ id: 'may', requiresAcknowledgement: false }),
    ];
    expect(blockingResources(shown).map((r) => r.id)).toEqual(['must']);
  });

  it('names what is still unticked', () => {
    const shown = [
      resource({ id: 'a', requiresAcknowledgement: true }),
      resource({ id: 'b', requiresAcknowledgement: true }),
      resource({ id: 'c', requiresAcknowledgement: false }),
    ];

    expect(missingAcknowledgements(shown, ['a']).map((r) => r.id)).toEqual(['b']);
    expect(missingAcknowledgements(shown, ['a', 'b'])).toEqual([]);
    // An optional one left unticked never blocks.
    expect(missingAcknowledgements(shown, ['a', 'b', 'c'])).toEqual([]);
  });

  it('ticking something that is not shown does not unblock anything', () => {
    const shown = [resource({ id: 'a', requiresAcknowledgement: true })];
    expect(missingAcknowledgements(shown, ['somethingelse']).map((r) => r.id)).toEqual(['a']);
  });
});

describe('validating an edit', () => {
  it('accepts a sound draft', () => {
    expect(resourceProblems(draft())).toEqual([]);
  });

  it('insists on a title', () => {
    expect(resourceProblems(draft({ title: '   ' }))).toHaveLength(1);
  });

  it('insists on a link', () => {
    expect(resourceProblems(draft({ url: '' }))).toHaveLength(1);
  });

  it('refuses a link that would run code in the patient browser', () => {
    // The title is rendered as a tappable link, so this is the one that matters.
    expect(resourceProblems(draft({ url: 'javascript:alert(1)' }))).toHaveLength(1);
    expect(resourceProblems(draft({ url: 'data:text/html,<script>' }))).toHaveLength(1);
  });

  it('refuses something that is not a web address at all', () => {
    expect(resourceProblems(draft({ url: 'karsons.im/inject' }))).toHaveLength(1);
  });

  it('allows plain http as well as https', () => {
    expect(resourceProblems(draft({ url: 'http://karsons.im/inject' }))).toEqual([]);
  });

  it('refuses a required tick on something shown only after the prescription', () => {
    const problems = resourceProblems(
      draft({ displayStage: 'AFTER_RX', requiresAcknowledgement: true }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('already submitted');
  });

  it('allows an optional resource shown only after the prescription', () => {
    expect(resourceProblems(
      draft({ displayStage: 'AFTER_RX', requiresAcknowledgement: false }),
    )).toEqual([]);
  });

  it('reports every fault at once rather than the first', () => {
    expect(resourceProblems(draft({ title: '', url: '' }))).toHaveLength(2);
  });
});

describe('versioning', () => {
  it('a new title mints a new version, because an acknowledgement quotes it', () => {
    expect(needsNewVersion(
      { title: 'How to inject', url: 'https://karsons.im/inject' },
      draft({ title: 'Injecting your medicine' }),
    )).toBe(true);
  });

  it('a new link mints a new version', () => {
    expect(needsNewVersion(
      { title: 'How to inject', url: 'https://karsons.im/inject' },
      draft({ url: 'https://karsons.im/injecting-v2' }),
    )).toBe(true);
  });

  it('reordering or restaging does not, because no record quotes those', () => {
    expect(needsNewVersion(
      { title: 'How to inject', url: 'https://karsons.im/inject' },
      draft({ sortOrder: 90, displayStage: 'AFTER_RX', requiresAcknowledgement: false }),
    )).toBe(false);
  });

  it('ignores whitespace either side', () => {
    expect(needsNewVersion(
      { title: 'How to inject', url: 'https://karsons.im/inject' },
      draft({ title: '  How to inject  ' }),
    )).toBe(false);
  });

  it('counts up from the highest version of that key alone', () => {
    const existing = [
      { resourceKey: 'injection-guide', version: 1 },
      { resourceKey: 'injection-guide', version: 2 },
      { resourceKey: 'nausea', version: 7 },
    ];

    expect(nextVersion(existing, 'injection-guide')).toBe(3);
    expect(nextVersion(existing, 'nausea')).toBe(8);
    expect(nextVersion(existing, 'brand-new')).toBe(1);
  });
});

describe('resource keys', () => {
  it('reads as a slug of the title', () => {
    expect(resourceKeyFrom('How to inject Mounjaro')).toBe('how-to-inject-mounjaro');
  });

  it('survives punctuation and casing', () => {
    expect(resourceKeyFrom("  What if I'm sick? (nausea)  ")).toBe('what-if-i-m-sick-nausea');
  });

  it('never collides with one already in use', () => {
    expect(resourceKeyFrom('How to inject', ['how-to-inject'])).toBe('how-to-inject-2');
    expect(resourceKeyFrom('How to inject', ['how-to-inject', 'how-to-inject-2']))
      .toBe('how-to-inject-3');
  });

  it('falls back rather than producing an empty key', () => {
    expect(resourceKeyFrom('!!!')).toBe('resource');
  });
});

describe('what an acknowledgement records', () => {
  const context = {
    organisationId: 'org-1',
    submissionId: 'sub-1',
    patientId: 'pat-1',
  };

  const resolved = [{
    id: 'r1',
    resourceKey: 'injection-guide',
    version: 3,
    title: 'How to inject',
    url: 'https://karsons.im/inject-v3',
  }];

  it('copies the title, link and version rather than pointing at them', () => {
    const [row] = acknowledgementValues(resolved, context);

    // These four are the whole point. A record that only carried resourceId
    // would change meaning every time somebody edited the link.
    expect(row!.titleSnapshot).toBe('How to inject');
    expect(row!.urlSnapshot).toBe('https://karsons.im/inject-v3');
    expect(row!.resourceVersionSnapshot).toBe(3);
    expect(row!.resourceKeySnapshot).toBe('injection-guide');
  });

  it('keeps the pointer as well, so the resource is still reachable', () => {
    expect(acknowledgementValues(resolved, context)[0]!.resourceId).toBe('r1');
  });

  it('records the tick as given', () => {
    expect(acknowledgementValues(resolved, context)[0]!.acknowledged).toBe(true);
  });

  it('carries the tenancy and the submission it belongs to', () => {
    const [row] = acknowledgementValues(resolved, context);
    expect(row!.organisationId).toBe('org-1');
    expect(row!.submissionId).toBe('sub-1');
    expect(row!.patientId).toBe('pat-1');
  });

  it('accepts a submission with no patient matched yet', () => {
    const [row] = acknowledgementValues(resolved, { ...context, patientId: null });
    expect(row!.patientId).toBeNull();
  });

  it('writes nothing when nothing was resolved', () => {
    expect(acknowledgementValues([], context)).toEqual([]);
  });
});

describe('ids arriving from the browser', () => {
  it('drops duplicates, so a resubmission does not double up', () => {
    expect(requestedIds(['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops blanks, which would widen the lookup rather than narrow it', () => {
    expect(requestedIds(['a', '', 'b'])).toEqual(['a', 'b']);
  });

  it('returns nothing for nothing', () => {
    expect(requestedIds([])).toEqual([]);
  });
});
