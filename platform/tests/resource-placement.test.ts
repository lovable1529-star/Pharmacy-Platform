/**
 * Placing leaflets on a form.
 *
 * The property that matters most is the last one in this file: a form
 * published before any of this existed carries no blocks and must keep showing
 * its leaflets exactly where it used to.
 */

import { describe, it, expect } from 'vitest';
import {
  fallbackStepIndex,
  hasResourceBlocks,
  placeResources,
  renderedResources,
  unticked,
  type PlaceableResource,
} from '../src/lib/resources/placement';
import type { FieldType } from '../src/types/form-schema';
import {
  carriesNoAnswer, numberQuestions, validateStep,
} from '../src/lib/forms/runtime';

function field(id: string, type: FieldType, resourceKeys?: string[]) {
  return { id, type, resourceKeys };
}

function resource(over: Partial<PlaceableResource> = {}): PlaceableResource {
  return {
    id: 'r1',
    resourceKey: 'injection-guide',
    title: 'How to inject',
    description: null,
    url: 'https://karsons.im/inject',
    requiresAcknowledgement: true,
    ...over,
  };
}

const INJECT = resource({ id: 'a', resourceKey: 'injection-guide', title: 'How to inject' });
const NAUSEA = resource({ id: 'b', resourceKey: 'nausea', title: 'Feeling sick' });
const SHARPS = resource({ id: 'c', resourceKey: 'sharps', title: 'Needle disposal' });
const ALL = [INJECT, NAUSEA, SHARPS];

describe('placing blocks', () => {
  it('a block that names resources shows exactly those', () => {
    const placement = placeResources(
      [{ fields: [field('r', 'resourceList', ['nausea'])] }],
      ALL,
    );

    expect(placement.get(0)![0]!.resources.map((r) => r.id)).toEqual(['b']);
  });

  it('a block that names none shows everything no other block claimed', () => {
    const placement = placeResources(
      [
        { fields: [field('named', 'resourceList', ['nausea'])] },
        { fields: [field('rest', 'resourceList')] },
      ],
      ALL,
    );

    expect(placement.get(0)![0]!.resources.map((r) => r.id)).toEqual(['b']);
    expect(placement.get(1)![0]!.resources.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('one empty block shows them all', () => {
    const placement = placeResources([{ fields: [field('r', 'resourceList')] }], ALL);
    expect(placement.get(0)![0]!.resources.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('shows them in the order the block names them', () => {
    const placement = placeResources(
      [{ fields: [field('r', 'resourceList', ['sharps', 'injection-guide'])] }],
      ALL,
    );

    expect(placement.get(0)![0]!.resources.map((r) => r.id)).toEqual(['c', 'a']);
  });

  it('lets two blocks name the same resource', () => {
    // "Show the safety leaflet again beside the signature" is reasonable, and
    // refusing it would need a rule nobody could guess.
    const placement = placeResources(
      [
        { fields: [field('one', 'resourceList', ['sharps'])] },
        { fields: [field('two', 'resourceList', ['sharps'])] },
      ],
      ALL,
    );

    expect(placement.get(0)![0]!.resources.map((r) => r.id)).toEqual(['c']);
    expect(placement.get(1)![0]!.resources.map((r) => r.id)).toEqual(['c']);
  });

  it('gives a block naming a resource that no longer exists an empty list', () => {
    const placement = placeResources(
      [{ fields: [field('r', 'resourceList', ['retired-leaflet'])] }],
      ALL,
    );

    expect(placement.get(0)![0]!.resources).toEqual([]);
  });

  it('carries several blocks on one step', () => {
    const placement = placeResources(
      [{
        fields: [
          field('one', 'resourceList', ['nausea']),
          field('two', 'resourceList', ['sharps']),
        ],
      }],
      ALL,
    );

    expect(placement.get(0)!.map((b) => b.fieldId)).toEqual(['one', 'two']);
  });

  it('places nothing when there are no resources to place', () => {
    expect(placeResources([{ fields: [field('r', 'resourceList')] }], []).size).toBe(0);
  });

  it('places nothing when the form has no blocks', () => {
    expect(placeResources([{ fields: [field('q', 'shortText')] }], ALL).size).toBe(0);
  });
});

describe('telling a form with blocks from one without', () => {
  it('sees a block', () => {
    expect(hasResourceBlocks([{ fields: [field('r', 'resourceList')] }])).toBe(true);
  });

  it('sees a form that has none', () => {
    // The already-published forms. They must keep the old behaviour.
    expect(hasResourceBlocks([{ fields: [field('q', 'shortText')] }])).toBe(false);
  });
});

describe('where the fallback block goes', () => {
  const signStep = { fields: [field('sig', 'signature')] };
  const plainStep = { fields: [field('q', 'shortText')] };

  it('sits on the visible signature step', () => {
    expect(fallbackStepIndex([plainStep, signStep], [plainStep, signStep])).toBe(1);
  });

  it('sits on the last step when the form never signs', () => {
    // A repeat request signs nothing, and its leaflets should still be seen.
    expect(fallbackStepIndex([plainStep, plainStep], [plainStep, plainStep])).toBe(1);
  });

  it('waits when the signature exists but is not visible yet', () => {
    // The bug this pins: a ten-step form gated behind an unanswered first
    // question opened with "before you sign, please read" above question one.
    expect(fallbackStepIndex([plainStep], [plainStep, signStep])).toBe(-1);
  });
});

describe('what was actually rendered', () => {
  it('collects across blocks and steps without repeating', () => {
    const placement = placeResources(
      [
        { fields: [field('one', 'resourceList', ['sharps'])] },
        { fields: [field('two', 'resourceList', ['sharps', 'nausea'])] },
      ],
      ALL,
    );

    expect(renderedResources(placement).map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('is empty when nothing was placed', () => {
    expect(renderedResources(new Map())).toEqual([]);
  });
});

describe('what still needs ticking on a step', () => {
  const blocks = [{
    fieldId: 'r',
    resources: [
      resource({ id: 'must', requiresAcknowledgement: true }),
      resource({ id: 'may', requiresAcknowledgement: false }),
    ],
  }];

  it('only the required ones hold the step', () => {
    expect(unticked(blocks, []).map((r) => r.id)).toEqual(['must']);
  });

  it('clears once ticked', () => {
    expect(unticked(blocks, ['must'])).toEqual([]);
  });

  it('does not count the same resource twice when two blocks show it', () => {
    const twice = [
      { fieldId: 'one', resources: [resource({ id: 'x', requiresAcknowledgement: true })] },
      { fieldId: 'two', resources: [resource({ id: 'x', requiresAcknowledgement: true })] },
    ];

    expect(unticked(twice, []).map((r) => r.id)).toEqual(['x']);
  });
});

describe('a block is not a question', () => {
  it('is never validated, so it cannot wedge a form', () => {
    // The trap this closes: a block marked required validates like a question,
    // never has a value, and makes the form impossible to submit.
    const step = {
      id: 's', title: 'Step',
      fields: [
        { id: 'block', type: 'resourceList' as const, label: 'Read these', required: true },
        { id: 'info', type: 'infoBlock' as const, label: 'Note', required: true },
      ],
    };

    expect(validateStep(step, {}).valid).toBe(true);
  });

  it('a real question on the same step still is', () => {
    const step = {
      id: 's', title: 'Step',
      fields: [
        { id: 'block', type: 'resourceList' as const, label: 'Read these', required: true },
        { id: 'q', type: 'shortText' as const, label: 'Your name', required: true },
      ],
    };

    expect(validateStep(step, {}).valid).toBe(false);
  });

  it('is never given a question number', () => {
    const schema = {
      schemaVersion: 1 as const,
      title: 'T',
      numberQuestions: true,
      steps: [{
        id: 's', title: 'Step',
        fields: [
          { id: 'block', type: 'resourceList' as const, label: 'Read these' },
          { id: 'q', type: 'shortText' as const, label: 'Your name' },
        ],
      }],
    };

    const numbered = numberQuestions(schema);
    const [block, question] = numbered.steps[0]!.fields;

    expect(block!.number).toBeUndefined();
    // The question after it is still number one — a block must not consume one.
    expect(question!.number).toBe(1);
  });

  it('names both kinds of block and nothing else', () => {
    expect(carriesNoAnswer({ type: 'resourceList' })).toBe(true);
    expect(carriesNoAnswer({ type: 'infoBlock' })).toBe(true);
    expect(carriesNoAnswer({ type: 'shortText' })).toBe(false);
    expect(carriesNoAnswer({ type: 'signature' })).toBe(false);
  });
});
