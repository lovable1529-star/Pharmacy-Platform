'use client';

/**
 * Patient-facing repeat request.
 *
 * The GLP-1 reorder flow. Two things are deliberate:
 *
 *   - The patient never sees a dose recommendation, only a status. Showing
 *     "increase to 5mg" to a patient is what pushes this software into medical
 *     device territory. See docs/modules/decision-engine.md.
 *   - Even a GREEN outcome ends with "a pharmacist will review this", because
 *     that is exactly what happens.
 */

import { useState } from 'react';
import { evaluateRuleset } from '@/lib/rules/engine';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';
import { deriveValues } from '@/lib/clinical/derived';
import { DOSE_LADDERS } from '@/lib/clinical/derived';
import { kgToStonesAndPounds, stonesAndPoundsToKg } from '@/lib/units';
import type { Outcome } from '@/types/rule-schema';

const ENROLLED = {
  name: 'Bridget Kelly',
  medicine: 'Mounjaro',
  currentStrength: '5mg',
  heightCm: 172,
  dateOfBirth: new Date('1980-05-10'),
  previousSupplies: [
    { suppliedAt: new Date(Date.now() - 30 * 86_400_000), strength: '5mg', weightKg: 95 },
    { suppliedAt: new Date(Date.now() - 60 * 86_400_000), strength: '5mg', weightKg: 98 },
  ],
};

export default function RepeatRequestPage() {
  const [step, setStep] = useState(0);
  const [stones, setStones] = useState(14);
  const [pounds, setPounds] = useState(7);
  const [doseRequest, setDoseRequest] = useState('Same');
  const [adverseEffects, setAdverseEffects] = useState('None');
  const [missedDoses, setMissedDoses] = useState(0);
  const [healthChanges, setHealthChanges] = useState('No');
  const [question, setQuestion] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const ladder = DOSE_LADDERS[ENROLLED.medicine]!;
  const currentIndex = ladder.indexOf(ENROLLED.currentStrength);

  const requestedStrength =
    doseRequest === 'Increase'
      ? ladder[Math.min(currentIndex + 1, ladder.length - 1)]!
      : doseRequest === 'Decrease'
        ? ladder[Math.max(currentIndex - 1, 0)]!
        : ENROLLED.currentStrength;

  function submit() {
    const weightKg = stonesAndPoundsToKg({ stones, pounds });
    const derived = deriveValues({
      medicine: ENROLLED.medicine,
      currentStrength: ENROLLED.currentStrength,
      requestedStrength,
      weightKg,
      heightCm: ENROLLED.heightCm,
      dateOfBirth: ENROLLED.dateOfBirth,
      previousSupplies: ENROLLED.previousSupplies,
    });

    const result = evaluateRuleset(GLP1_REPEAT_RULESET, {
      answers: {
        medicine: ENROLLED.medicine, doseRequest, supplyMonths: 1,
        pregnant: 'No', breastfeeding: 'No', adverseEffects,
        redFlagSymptoms: 'No', missedDoses, healthChanges,
        appetiteSuppression: 'Mostly suppressed',
        snacking: 'Occasional small snack(s), still controlled',
        hydration: '≥ 2.0 L/day',
        ...(question ? { patientQuestion: question } : {}),
      },
      derived: { ...derived },
    });

    setOutcome(result.outcome);
    setStep(3);
  }

  const inputClass = 'w-full rounded-lg border border-line px-3 py-2.5';

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-brand-900 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-clinical-green-600 to-brand-600 font-display text-sm font-bold">K</div>
          <div>
            <div className="font-display text-sm font-bold">Karsons Pharmacy</div>
            <div className="text-[11px] text-brand-300">Weight management repeat</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        {step < 3 && (
          <>
            <div className="mb-5 flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-2 flex-1 rounded-full ${i < step ? 'bg-clinical-green-600' : i === step ? 'bg-brand-600' : 'bg-brand-100'}`} />
              ))}
            </div>
            <p className="mb-5 text-sm text-ink-soft">Step {step + 1} of 3</p>
          </>
        )}

        <div className="rounded-card border border-line bg-surface p-6">
          {step === 0 && (
            <>
              <h1 className="mb-1 text-xl">Welcome back, {ENROLLED.name.split(' ')[0]}</h1>
              <p className="mb-5 text-sm text-ink-soft">
                You are currently on {ENROLLED.medicine} {ENROLLED.currentStrength}.
              </p>

              <label className="mb-5 block">
                <span className="mb-1.5 block text-sm font-semibold">What do you weigh today?</span>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-ink-soft">Stones</span>
                    <input type="number" value={stones} onChange={(e) => setStones(Number(e.target.value))} className={inputClass} />
                  </div>
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-ink-soft">Pounds</span>
                    <input type="number" value={pounds} onChange={(e) => setPounds(Number(e.target.value))} className={inputClass} />
                  </div>
                </div>
                <span className="mt-1 block text-xs text-ink-soft">
                  Last recorded: {kgToStonesAndPounds(95).stones} st {kgToStonesAndPounds(95).pounds} lb
                </span>
              </label>

              <button type="button" onClick={() => setStep(1)}
                className="w-full rounded-full bg-brand-600 py-3 text-sm font-bold text-white">
                Continue
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="mb-5 text-xl">How have you been getting on?</h1>

              <div className="mb-5">
                <span className="mb-2 block text-sm font-semibold">Any side effects?</span>
                <div className="grid grid-cols-2 gap-2">
                  {['None', 'Mild', 'Moderate', 'Severe'].map((option) => (
                    <button key={option} type="button" aria-pressed={adverseEffects === option}
                      onClick={() => setAdverseEffects(option)}
                      className={`rounded-lg border px-4 py-2.5 font-semibold ${
                        adverseEffects === option ? 'border-brand-600 bg-brand-600 text-white' : 'border-line'
                      }`}>{option}</button>
                  ))}
                </div>
              </div>

              <label className="mb-5 block">
                <span className="mb-1.5 block text-sm font-semibold">
                  How many doses have you missed in the last 4 weeks?
                </span>
                <input type="number" min={0} max={4} value={missedDoses}
                  onChange={(e) => setMissedDoses(Number(e.target.value))} className={inputClass} />
              </label>

              <div className="mb-5">
                <span className="mb-2 block text-sm font-semibold">
                  Any new medicines or health conditions since your last supply?
                </span>
                <div className="flex gap-2">
                  {['Yes', 'No'].map((option) => (
                    <button key={option} type="button" aria-pressed={healthChanges === option}
                      onClick={() => setHealthChanges(option)}
                      className={`flex-1 rounded-lg border px-4 py-2.5 font-semibold ${
                        healthChanges === option ? 'border-brand-600 bg-brand-600 text-white' : 'border-line'
                      }`}>{option}</button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(0)}
                  className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold">Back</button>
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 rounded-full bg-brand-600 py-3 text-sm font-bold text-white">Continue</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="mb-5 text-xl">What would you like this time?</h1>

              <div className="mb-5">
                <span className="mb-2 block text-sm font-semibold">Your strength</span>
                <div className="space-y-2">
                  {[
                    { value: 'Same', label: `Stay on ${ENROLLED.currentStrength}` },
                    { value: 'Increase', label: `Move up to ${ladder[Math.min(currentIndex + 1, ladder.length - 1)]}` },
                    { value: 'Decrease', label: `Move down to ${ladder[Math.max(currentIndex - 1, 0)]}` },
                  ].map((option) => (
                    <button key={option.value} type="button" aria-pressed={doseRequest === option.value}
                      onClick={() => setDoseRequest(option.value)}
                      className={`w-full rounded-lg border px-4 py-3 text-left font-semibold ${
                        doseRequest === option.value ? 'border-brand-600 bg-brand-50' : 'border-line'
                      }`}>{option.label}</button>
                  ))}
                </div>
                {/* Only one step at a time is offered — the safety rule made visible. */}
                <p className="mt-2 text-xs text-ink-soft">
                  Strength can only change one step at a time.
                </p>
              </div>

              <label className="mb-5 block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Anything you would like to ask the pharmacist? (optional)
                </span>
                <textarea value={question} onChange={(e) => setQuestion(e.target.value)}
                  rows={3} className={inputClass} />
              </label>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold">Back</button>
                <button type="button" onClick={submit}
                  className="flex-1 rounded-full bg-brand-600 py-3 text-sm font-bold text-white">
                  Send request
                </button>
              </div>
            </>
          )}

          {step === 3 && outcome && (
            <div className="text-center">
              <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${
                outcome === 'RED' ? 'bg-triage-amber-100 text-triage-amber-700' : 'bg-clinical-green-100 text-clinical-green-700'
              }`}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d={outcome === 'RED' ? 'M12 8v5M12 16h.01' : 'M20 6 9 17l-5-5'}
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/*
                The patient sees a status and a next step. Never a dose
                recommendation, and never the triage colour itself.
              */}
              {outcome === 'RED' ? (
                <>
                  <h1 className="mb-2 text-xl">We need to see you first</h1>
                  <p className="mb-6 text-sm text-ink-soft">
                    Based on your answers, we would like to speak with you before supplying more
                    medication. Please book an appointment and we will go through it together.
                  </p>
                  <button type="button" className="rounded-full bg-brand-600 px-6 py-3 text-sm font-bold text-white">
                    Book an appointment
                  </button>
                </>
              ) : (
                <>
                  <h1 className="mb-2 text-xl">Request received</h1>
                  <p className="mb-6 text-sm text-ink-soft">
                    Thank you. A pharmacist will review your request and you will hear from us shortly.
                    {question && ' We will answer your question when you collect.'}
                  </p>
                  <p className="rounded-lg border border-line bg-canvas p-4 text-xs text-ink-soft">
                    Every request is checked by a pharmacist before anything is supplied.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
