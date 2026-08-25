/**
 * Deterministic fast-path.
 *
 * Not every failure needs an LLM. When the raw code's claim is reliable
 * (see normalize.ts) AND fleet evidence doesn't contradict it, we skip the
 * agent entirely — cheaper, faster, and it keeps the "AI only where
 * judgement is needed" claim honest rather than decorative.
 *
 * The agent is reserved for the ambiguous middle: unreliable codes, or
 * reliable codes that fleet evidence is actively contradicting (e.g. a
 * flood of "mandate revoked" on one issuer in one window is itself
 * suspicious and deserves a second look).
 */

import { Diagnosis, FailureEvent, FleetWindow } from "../types/events";
import { claimedCause } from "./normalize";

export interface RuleResult {
  handled: boolean;
  diagnosis?: Diagnosis;
}

const DEFERRABLE_DAYS_AHEAD = 5;

export function tryRules(event: FailureEvent, fleet: FleetWindow): RuleResult {
  const { claim, reliability } = claimedCause(event.rawCode);

  const fleetContradicts = fleet.isAnomalous;

  if (reliability === "unreliable" || fleetContradicts) {
    return { handled: false };
  }

  // Reliable claim, fleet not anomalous — trust it, no LLM call needed.
  switch (claim) {
    case "CARD_EXPIRED":
      return {
        handled: true,
        diagnosis: {
          eventId: event.id,
          trueCause: "CARD_EXPIRED",
          confidence: 0.95,
          codeIsMisleading: false,
          suppressCustomerMessage: false,
          evidence: [`Raw code ${event.rawCode} reliably means card expiry`, "Fleet not anomalous for this issuer/rail"],
          reasoning: "Reliable decline code, no contradicting fleet signal — trusted directly, no diagnosis agent needed.",
          action: "SEND_PAYMENT_LINK",
        },
      };
    case "MANDATE_REVOKED":
      return {
        handled: true,
        diagnosis: {
          eventId: event.id,
          trueCause: "MANDATE_REVOKED",
          confidence: 0.95,
          codeIsMisleading: false,
          suppressCustomerMessage: false,
          evidence: [`Raw code ${event.rawCode} reliably means mandate cancellation`, "Fleet not anomalous for this issuer/rail"],
          reasoning: "Customer cancelled the mandate. Retrying wastes budget — needs a fresh mandate, not a retry.",
          action: "STOP",
        },
      };
    case "FRAUD_HOLD":
      return {
        handled: true,
        diagnosis: {
          eventId: event.id,
          trueCause: "FRAUD_HOLD",
          confidence: 0.9,
          codeIsMisleading: false,
          suppressCustomerMessage: true, // don't tip off a potential fraudster, and don't alarm a false positive by SMS
          evidence: [`Raw code ${event.rawCode} reliably means a fraud hold`, "Fleet not anomalous for this issuer/rail"],
          reasoning: "Fraud holds need human review, not an automated message or retry.",
          action: "ESCALATE",
        },
      };
    default:
      return { handled: false };
  }
}

/** Used by the planner once the agent (or a rule) has decided INSUFFICIENT_FUNDS is real. */
export function nextLikelySuccessDay(historicalSuccessDays: number[], fromDayOfMonth: number): number {
  if (historicalSuccessDays.length === 0) return fromDayOfMonth + DEFERRABLE_DAYS_AHEAD;
  const upcoming = historicalSuccessDays.filter((d) => d > fromDayOfMonth).sort((a, b) => a - b);
  return upcoming[0] ?? Math.min(...historicalSuccessDays) + 30;
}
