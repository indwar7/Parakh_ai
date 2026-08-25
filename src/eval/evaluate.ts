/**
 * Eval — turns simulated ground truth into numbers a judge can check.
 *
 * This is only possible because the simulator hands us `simulatedTrueCause`
 * for every event (simulator.ts). Nothing here is estimated from the demo's
 * own output — it's compared against that separately-known ground truth.
 */

import { Diagnosis, FailureEvent, NormalizedCause, Outcome } from "../types/events";
import { claimedCause } from "../agent/normalize";

export interface EvalRecord {
  event: FailureEvent;
  diagnosis?: Diagnosis; // absent for the control arm, which doesn't diagnose
  outcome: Outcome;
}

export interface ArmSummary {
  arm: "parakh" | "control";
  events: number;
  recovered: number;
  recoveryRate: number;
  amountRecovered: number; // paise
  totalAttemptsUsed: number;
  falseBlameMessages: number;
  falseBlameRate: number;
}

export interface DiagnosisSummary {
  confusionMatrix: Record<string, Record<string, number>>; // actual -> predicted -> count
  accuracy: number;
  misleadingDetection: { truePositive: number; falsePositive: number; falseNegative: number; trueNegative: number; precision: number; recall: number };
}

function summarizeArm(records: EvalRecord[], arm: "parakh" | "control"): ArmSummary {
  const armRecords = records.filter((r) => r.outcome.arm === arm);
  const recovered = armRecords.filter((r) => r.outcome.recovered);
  const amountRecovered = recovered.reduce((s, r) => s + r.outcome.amount, 0);
  const totalAttemptsUsed = armRecords.reduce((s, r) => s + r.outcome.attemptsUsed, 0);
  const falseBlame = armRecords.filter((r) => r.outcome.falseBlameMessageSent);

  return {
    arm,
    events: armRecords.length,
    recovered: recovered.length,
    recoveryRate: armRecords.length ? recovered.length / armRecords.length : 0,
    amountRecovered,
    totalAttemptsUsed,
    falseBlameMessages: falseBlame.length,
    falseBlameRate: armRecords.length ? falseBlame.length / armRecords.length : 0,
  };
}

function summarizeDiagnosis(records: EvalRecord[]): DiagnosisSummary {
  const withDiagnosis = records.filter((r) => r.diagnosis);
  const confusionMatrix: Record<string, Record<string, number>> = {};
  let correct = 0;

  let tp = 0, fp = 0, fn = 0, tn = 0;

  for (const r of withDiagnosis) {
    const actual = r.event.simulatedTrueCause as NormalizedCause;
    const predicted = r.diagnosis!.trueCause;

    confusionMatrix[actual] ??= {};
    confusionMatrix[actual][predicted] = (confusionMatrix[actual][predicted] ?? 0) + 1;
    if (actual === predicted) correct += 1;

    const claim = claimedCause(r.event.rawCode).claim;
    const actuallyMisleading = actual !== claim;
    const flaggedMisleading = r.diagnosis!.codeIsMisleading;

    if (actuallyMisleading && flaggedMisleading) tp += 1;
    else if (!actuallyMisleading && flaggedMisleading) fp += 1;
    else if (actuallyMisleading && !flaggedMisleading) fn += 1;
    else tn += 1;
  }

  return {
    confusionMatrix,
    accuracy: withDiagnosis.length ? correct / withDiagnosis.length : 0,
    misleadingDetection: {
      truePositive: tp,
      falsePositive: fp,
      falseNegative: fn,
      trueNegative: tn,
      precision: tp + fp ? tp / (tp + fp) : 0,
      recall: tp + fn ? tp / (tp + fn) : 0,
    },
  };
}

export function summarize(records: EvalRecord[]) {
  return {
    parakh: summarizeArm(records, "parakh"),
    control: summarizeArm(records, "control"),
    diagnosis: summarizeDiagnosis(records),
  };
}

export function formatSummary(summary: ReturnType<typeof summarize>): string {
  const { parakh, control, diagnosis } = summary;
  const rupees = (paise: number) => `Rs.${(paise / 100).toFixed(2)}`;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const lines: string[] = [];
  lines.push("=== Parakh vs Control ===");
  lines.push(
    `${"arm".padEnd(10)}${"events".padEnd(8)}${"recovered".padEnd(11)}${"recovery%".padEnd(11)}${"amount".padEnd(14)}${"attempts".padEnd(10)}${"false-blame"}`
  );
  for (const s of [parakh, control]) {
    lines.push(
      `${s.arm.padEnd(10)}${String(s.events).padEnd(8)}${String(s.recovered).padEnd(11)}${pct(s.recoveryRate).padEnd(11)}${rupees(s.amountRecovered).padEnd(14)}${String(s.totalAttemptsUsed).padEnd(10)}${s.falseBlameMessages} (${pct(s.falseBlameRate)})`
    );
  }
  lines.push("");
  lines.push(`Diagnosis accuracy (Parakh arm): ${pct(diagnosis.accuracy)}`);
  lines.push(
    `codeIsMisleading detection — precision ${pct(diagnosis.misleadingDetection.precision)}, recall ${pct(diagnosis.misleadingDetection.recall)} ` +
      `(tp=${diagnosis.misleadingDetection.truePositive} fp=${diagnosis.misleadingDetection.falsePositive} fn=${diagnosis.misleadingDetection.falseNegative} tn=${diagnosis.misleadingDetection.trueNegative})`
  );
  lines.push("");
  lines.push(
    `Extra revenue recovered by Parakh: ${rupees(parakh.amountRecovered - control.amountRecovered)}, ` +
      `false-blame messages avoided: ${control.falseBlameMessages - parakh.falseBlameMessages}`
  );
  return lines.join("\n");
}
