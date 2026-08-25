/**
 * Prompt construction for the diagnosis agent.
 *
 * Deliberately compact and tabular rather than prose — the model reasons
 * over row + payer + fleet evidence, and the prompt's job is to make the
 * conflict between "what the code claims" and "what the fleet shows"
 * impossible to miss.
 */

import { FailureEvent, FleetWindow, PayerHistory } from "../types/events";
import { claimedCause } from "./normalize";

export const SYSTEM_INSTRUCTION = `You are Parakh's diagnosis agent for failed subscription payments.

A bank's decline code is a CLAIM, not a fact. Your job is to decide whether that
claim actually holds up, using only the evidence given to you:
  - the row itself (code, rail, issuer, amount)
  - this specific payer's history
  - fleet-wide health for this issuer+rail right now

Rules you must follow:
1. Never cite a fact that was not given to you. Every item in "evidence" must be
   traceable to the input. Do not invent numbers, dates, or prior incidents.
2. If fleet evidence shows this issuer+rail is anomalous right now, treat that as
   strong grounds to doubt a generic or "unreliable" code claim (e.g. a burst of
   identical declines across many different payers on one issuer/rail almost
   never means many individual people ran out of money at the same moment —
   it means the issuer or rail is degraded).
3. If suppressCustomerMessage is false, whatever you'd tell the customer must be
   literally true given the evidence. When you are not sure it's true, suppress it.
4. When confidence would be below ~0.5, set action to ESCALATE rather than guessing.
5. Output must match the provided schema exactly. No prose outside the JSON.`;

function fleetSummary(fleet: FleetWindow): string {
  const codes = Object.entries(fleet.codeDistribution)
    .map(([code, n]) => `${code}:${n}`)
    .join(", ") || "none";
  return [
    `issuer=${fleet.issuer} rail=${fleet.rail}`,
    `window=${Math.round(fleet.windowMs / 60000)}min attempts=${fleet.attempts} failures=${fleet.failures}`,
    `observedFailureRate=${(fleet.observedFailureRate * 100).toFixed(1)}% baselineFailureRate=${(fleet.baselineFailureRate * 100).toFixed(1)}%`,
    `anomalyScore=${fleet.anomalyScore === Infinity ? "inf" : fleet.anomalyScore.toFixed(1)}x isAnomalous=${fleet.isAnomalous}`,
    `codeDistributionInWindow={${codes}}`,
  ].join("\n  ");
}

function payerSummary(history: PayerHistory | undefined, event: FailureEvent): string {
  if (!history || history.pastAttempts.length === 0) {
    return "No prior history for this payer.";
  }
  const recent = history.pastAttempts.slice(-8);
  const successDays = history.historicalSuccessDays.length
    ? history.historicalSuccessDays.join(", ")
    : "none recorded";
  const lines = recent.map((a) => `  - ${new Date(a.at).toISOString()}: ${a.outcome}${a.cause ? ` (${a.cause})` : ""}`);
  return [`Past attempts (most recent last):`, ...lines, `Historical success days-of-month: ${successDays}`].join("\n");
}

export function buildDiagnosisPrompt(event: FailureEvent, fleet: FleetWindow, history: PayerHistory | undefined): string {
  const { claim, reliability } = claimedCause(event.rawCode);

  return `## Failure row
payerId=${event.payerId} issuer=${event.issuer} rail=${event.rail}
rawCode=${event.rawCode} rawDescription="${event.rawDescription}"
amount=${(event.amount / 100).toFixed(2)} INR
at=${new Date(event.at).toISOString()}

## What the code claims
claimedCause=${claim} (known reliability of this code in general: ${reliability})

## Payer history
${payerSummary(history, event)}

## Fleet health for this issuer+rail right now
  ${fleetSummary(fleet)}

## Task
Decide the true cause, whether the code's claim is misleading, whether a
customer message would currently be true, and the single best recovery action.
Respond only with the JSON object matching the schema.`;
}
