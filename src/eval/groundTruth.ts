/**
 * Ground truth resolution — the referee.
 *
 * This is the ONLY module allowed to know whether a retry would actually
 * have succeeded. Neither the diagnosis agent nor the planner may see this;
 * it exists purely for eval.ts and the demo's "what really happened next" step.
 */

import { FailureEvent, RecoveryAction } from "../types/events";
import { OutageWindow, PayerProfile } from "../simulator/simulator";

export function dayOfMonth(atMs: number): number {
  return new Date(atMs).getUTCDate();
}

/**
 * Would this event's payment actually go through if attempted at `atMs` with
 * the given action? Returns false for actions that don't even attempt payment
 * (STOP, ESCALATE, NOTIFY_CUSTOMER-only).
 */
export function wouldSucceed(
  event: FailureEvent,
  action: RecoveryAction,
  atMs: number,
  payer: PayerProfile | undefined,
  outageWindow: OutageWindow | null
): boolean {
  const attemptsPayment = action === "RETRY_NOW" || action === "DEFER" || action === "SWITCH_RAIL" || action === "SEND_PAYMENT_LINK";
  if (!attemptsPayment) return false;

  switch (event.simulatedTrueCause) {
    case "ISSUER_DOWN": {
      if (action === "SWITCH_RAIL") return true; // different rail sidesteps the outage entirely
      const stillDown = outageWindow && outageWindow.issuer === event.issuer && outageWindow.rail === event.rail && atMs < outageWindow.until;
      return !stillDown;
    }
    case "INSUFFICIENT_FUNDS": {
      if (!payer) return false;
      // Succeeds once the payer's simulated "cash-in" day has passed, same
      // cycle or later — not narrowly on the exact date.
      return dayOfMonth(atMs) >= payer.successDay;
    }
    case "CARD_EXPIRED":
      // A retry against the same expired card never succeeds; only a fresh
      // payment method (payment link completed) can recover it.
      return action === "SEND_PAYMENT_LINK";
    case "MANDATE_REVOKED":
      return false; // needs a brand new mandate, out of scope for auto-recovery
    case "FRAUD_HOLD":
      return false; // needs human review by design, never auto-recovered
    case "AMBIGUOUS_DECLINE":
      // A genuine one-off blip, already cleared by the time anyone retries.
      return true;
    default:
      return false;
  }
}

/** Would telling the customer "insufficient funds, please retry" etc. be a TRUE statement right now? */
export function customerMessageWouldBeTrue(event: FailureEvent): boolean {
  return event.simulatedTrueCause === "INSUFFICIENT_FUNDS" || event.simulatedTrueCause === "CARD_EXPIRED" || event.simulatedTrueCause === "MANDATE_REVOKED";
}
