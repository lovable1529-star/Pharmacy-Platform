/**
 * The leaflets that go out with a prescription.
 *
 * A resource marked AFTER_RX (or BOTH) is one the pharmacy wants in a
 * patient's hands once they actually have the medicine — how to store the
 * pens, what to do about nausea, how to dispose of a needle. Those are exactly
 * the things nobody reads while filling in a form and everybody wants on the
 * evening they open the box.
 *
 * Built as its own block appended to the message rather than as template
 * substitutions, because the list is a different length for every patient and
 * a template cannot hold a variable number of links without the pharmacy
 * editing wording every time they add one.
 *
 * The channel rule is enforced by the caller, not here: a title like "How to
 * inject your Mounjaro" names the medicine, so this block is clinical detail
 * and never belongs on SMS. See `queueFromTemplate`.
 */

import type { Resource } from './applicable';

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * An HTML block listing the resources, or null when there are none.
 *
 * Null rather than an empty heading: a message that says "Helpful links" and
 * then lists nothing looks broken, and the pharmacy has not necessarily
 * configured any resources at all.
 *
 * Inline styles because email clients drop stylesheets, and the same reason
 * the rest of `lib/email` is written that way.
 */
export function resourceAppendixHtml(
  resources: readonly Pick<Resource, 'title' | 'description' | 'url'>[],
): string | null {
  if (resources.length === 0) return null;

  const items = resources
    .map((r) => {
      const description = r.description?.trim()
        ? `<div style="font-size:12.5px;color:#7C7594;margin-top:2px;">${escape(r.description.trim())}</div>`
        : '';

      return `<li style="margin:0 0 10px;">
      <a href="${escape(r.url)}" style="font-size:14px;font-weight:600;color:#5B3A8E;">${escape(r.title)}</a>
      ${description}
    </li>`;
    })
    .join('\n');

  return `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #DEDAE9;">
  <div style="font-size:13px;font-weight:600;color:#191428;margin-bottom:10px;">While you are taking this</div>
  <ul style="margin:0;padding-left:18px;">
${items}
  </ul>
</div>`;
}

/**
 * The same thing as plain text, for a message that is not HTML.
 *
 * Kept beside the HTML rather than derived from it, because stripping tags out
 * of markup to make a text version is the kind of thing that works until a
 * title contains an angle bracket.
 */
export function resourceAppendixText(
  resources: readonly Pick<Resource, 'title' | 'description' | 'url'>[],
): string | null {
  if (resources.length === 0) return null;

  const lines = resources.map((r) => `- ${r.title.trim()}: ${r.url.trim()}`);
  return ['While you are taking this:', ...lines].join('\n');
}
