/**
 * The control arm: today's industry-standard baseline, not a strawman.
 *
 * It already does the things every real dunning tool does — stop on a
 * cancelled mandate, escalate a fraud hold, send a card-update link on
 * expiry. It does NOT have the two things Parakh adds: fleet-anomaly
 * awareness and per-payer timing. Those two gaps are where the demo's
 * numbers should actually come from — everywhere else the arms should look
 * similar, which is the honest comparison.
 */

import { Diagnosis, FailureEvent } from "../types/events";
import { claimedCause } from "../agent/normalize";

export function controlDiagnose(event: FailureEvent): Diagnosis {
  const { claim } = claimedCause(event.rawCode);

  const base = {
    eventId: event.id,
    trueCause: claim, // control has no way to doubt the code — it just believes the claim
    confidence: 1,
    codeIsMisleading: false, // by construction: control never questions the code
    suppressCustomerMessage: false, // control has no fleet signal to justify suppressing anything
    evidence: [`Raw code ${event.rawCode} taken at face value — no fleet check, no payer-specific timing.`],
  };

  switch (claim) {
    case "MANDATE_REVOKED":
      return { ...base, reasoning: "Cancelled mandate — no point retrying.", action: "STOP" };
    case "FRAUD_HOLD":
      return { ...base, reasoning: "Fraud flag — escalate to a human.", action: "ESCALATE" };
    case "CARD_EXPIRED":
      return { ...base, reasoning: "Expired card — send a generic update-payment-method link.", action: "SEND_PAYMENT_LINK" };
    case "INSUFFICIENT_FUNDS":
    case "AMBIGUOUS_DECLINE":
    default:
      return { ...base, reasoning: "Soft decline — retry on the fixed schedule, same as always.", action: "RETRY_NOW" };
  }
}
