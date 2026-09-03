/**
 * The clinical rules, and whether they still work.
 *
 * Until now these were invisible. Twenty-four rules decided whether a repeat
 * request came back green, amber or red, and the only way to read them was to
 * query the database. A pharmacist asked "why was this amber?" could see the
 * trace on the request but never the rulebook it came from.
 *
 * Read-only on purpose, for now. Editing clinical rules needs the same
 * versioning discipline forms have — an edit must not change what a past RED
 * meant — and that is a larger piece of work than showing them. Seeing them is
 * most of the value and none of the risk.
 *
 * The part that earns its place is the check at the top. Rules read answers by
 * field id, the form is versioned separately, and the pharmacy can republish it
 * from the designer whenever they like. Rename a field and the rule reading it
 * does not error; it silently stops matching, and the request comes back AMBER
 * by default looking like an ordinary cautious result. This screen is where
 * that becomes visible.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, eq, isNull } from 'drizzle-orm';
import { ArrowLeft, Scale, TriangleAlert, PencilLine } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { service, formVersion, rulesetVersion } from '@/lib/db/schema';
import {
  byOutcome, checkRulesetCoverage, describeCondition,
} from '@/lib/rules/coverage';
import type { Condition, RulesetDefinition } from '@/lib/rules/engine';
import type { FormSchema } from '@/types/form-schema';
import { EmptyState, Notice, PageHeader, Panel, Tag } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

const OUTCOME_TONE = { RED: 'stop', AMBER: 'review', GREEN: 'safe' } as const;

const OUTCOME_MEANING = {
  RED: 'Cannot be supplied on the form alone. A pharmacist has to act.',
  AMBER: 'A pharmacist reads it and decides.',
  GREEN: 'Nothing flagged — authorise and supply.',
} as const;

export default async function ServiceRulesPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { actor } = await getStaffContext();

  const [row] = await db
    .select({
      id: service.id,
      name: service.name,
      ruleset: rulesetVersion.definition,
      rulesetVersion: rulesetVersion.version,
      schema: formVersion.schema,
      formVersion: formVersion.version,
    })
    .from(service)
    .leftJoin(rulesetVersion, eq(service.publishedRulesetVersionId, rulesetVersion.id))
    .leftJoin(formVersion, eq(service.publishedFormVersionId, formVersion.id))
    .where(and(
      eq(service.slug, slug),
      eq(service.organisationId, actor.organisationId),
      isNull(service.archivedAt),
    ))
    .limit(1);

  if (!row) notFound();

  const backLink = (
    <Link
      href="/services"
      className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-faint transition-colors hover:text-ink"
    >
      <ArrowLeft size={13} strokeWidth={2.2} />
      Services
    </Link>
  );

  if (!row.ruleset) {
    return (
      <div className="page-shell mx-auto max-w-[calc(940px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
        {backLink}
        <PageHeader
          title="Clinical rules"
          subtitle={`${row.name} has no published ruleset.`}
        />
        <Panel>
          <EmptyState
            title="No rules on this service"
            body={
              'Every request on it is judged by a pharmacist rather than triaged '
              + 'automatically. That is deliberate for a new patient, who is assessed '
              + 'on the telephone — it is a repeat request that a ruleset is for.'
            }
          />
        </Panel>
      </div>
    );
  }

  const definition = row.ruleset as unknown as RulesetDefinition;
  const schema = (row.schema as unknown as FormSchema | null) ?? null;
  const coverage = checkRulesetCoverage(definition, schema);
  const groups = byOutcome(coverage.rules);

  return (
    <div className="page-shell mx-auto max-w-[calc(940px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      {backLink}

      <PageHeader
        title="Clinical rules"
        subtitle={`How ${row.name} decides green, amber or red. Every rule runs on every request; the most severe match wins.`}
        actions={
          <span className="flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 font-mono text-[11.5px] text-ink-faint">
            <Scale size={13} strokeWidth={2} />
            rules v{row.rulesetVersion}
            {row.formVersion !== null ? ` · form v${row.formVersion}` : null}
          </span>
        }
      />

      {/*
        The check, first, because it is the only thing on this page that can be
        WRONG. Everything below is a description of the rulebook; this says
        whether the rulebook still connects to the questionnaire.
      */}
      {coverage.brokenRules.length > 0 ? (
        <Notice
          tone="stop"
          className="mb-4"
          icon={<TriangleAlert size={16} strokeWidth={2.1} />}
          title={`${coverage.brokenRules.length} ${coverage.brokenRules.length === 1 ? 'rule reads a question' : 'rules read questions'} the form no longer asks`}
        >
          <p>
            These cannot match, whatever the patient answers. They do not error —
            the request simply comes back as {definition.defaultOutcome} by default
            and looks like an ordinary result.
          </p>
          <p className="mt-1.5">
            Missing:{' '}
            <span className="font-mono">{coverage.missingKeys.join(', ')}</span>.
            Either the questions were renamed in the designer, or removed. Put the
            field ids back, or the rules need rewriting.
          </p>
        </Notice>
      ) : (
        <Notice tone="safe" className="mb-4">
          Every rule reads a question the published form still asks.
        </Notice>
      )}

      <Panel className="mb-4 px-5 py-[15px]">
        <p className="text-[13.5px] leading-[1.55] text-ink-soft">
          All {coverage.rules.length} rules are evaluated on every request. Any RED
          match makes the request red; otherwise any AMBER makes it amber;
          otherwise it is green. If nothing matches at all the request is{' '}
          <strong className="font-semibold text-ink">
            {definition.defaultOutcome}
          </strong>{' '}
          — silence is not treated as evidence of safety. A rule whose question was
          left unanswered is recorded as skipped, never as passed.
        </p>
      </Panel>

      <div className="grid gap-5">
        {groups.map((group) => (
          <section key={group.outcome}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <Tag tone={OUTCOME_TONE[group.outcome]}>{group.outcome}</Tag>
              <span className="text-[13px] text-ink-faint">
                {OUTCOME_MEANING[group.outcome]}
              </span>
              <span className="tabular ml-auto font-mono text-[11.5px] text-ink-faint">
                {group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}
              </span>
            </div>

            <div className="grid gap-2">
              {group.rules.map((rule) => {
                const source = definition.rules.find((r) => r.id === rule.ruleId);

                return (
                  <Panel
                    key={rule.ruleId}
                    className={`px-5 py-[13px] ${rule.broken ? 'border-stop-200 bg-stop-50/40' : ''}`}
                  >
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[14.5px] font-semibold text-ink">
                          {rule.label}
                        </h3>

                        {/*
                          The condition in words. A pharmacist deciding whether a
                          rule says what they meant cannot answer that from
                          {"op":"lt","field":"derived.bmi","value":23}.
                        */}
                        <p className="mt-1 text-[13px] leading-[1.5] text-ink-soft">
                          when{' '}
                          <span className="text-ink">
                            {source ? describeCondition(source.when as Condition) : '—'}
                          </span>
                        </p>

                        {source?.message ? (
                          <p className="mt-1 text-[12.5px] italic leading-[1.5] text-ink-faint">
                            Staff see: {source.message}
                          </p>
                        ) : null}

                        {rule.broken ? (
                          <p className="mt-1.5 text-[12.5px] font-medium text-stop-700">
                            Never matches — the form does not ask{' '}
                            <span className="font-mono">
                              {rule.dependencies
                                .filter((d) => d.status === 'missing')
                                .map((d) => d.key)
                                .join(', ')}
                            </span>
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {!rule.enabled ? <Tag tone="neutral">off</Tag> : null}
                        <span
                          className="tabular font-mono text-[11px] text-ink-faint"
                          title="Higher is considered first among equally severe matches"
                        >
                          p{rule.priority}
                        </span>
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/*
        Said plainly rather than left for somebody to discover by hunting for an
        edit button that is not there.
      */}
      <p className="mt-6 flex items-start gap-2 text-[12.5px] leading-[1.5] text-ink-faint">
        <PencilLine size={13} strokeWidth={2} className="mt-[2px] shrink-0" />
        <span>
          These are not editable here yet. Changing a clinical rule has to version
          the way a form does, so that what a past red meant does not change
          underneath it — that is being built. Ask for a rule change and it is a
          scripted database update in the meantime.
        </span>
      </p>
    </div>
  );
}
