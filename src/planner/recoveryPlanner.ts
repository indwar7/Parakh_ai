/**
 * Recovery planner — turns a Diagnosis into a guardrailed ActionRecord.
 *
 * The diagnosis agent picks the action TYPE (judgement — what should happen).
 * This module decides the mechanics and enforces limits (safety — what is
 * ALLOWED to happen): retry budgets, message frequency, and the exact defer
 * timestamp. None of that is delegated to the model, on purpose.
 */

import { ActionRecord, Diagnosis, FailureEvent, RecoveryAction } from "../types/events";
import { GuardrailStore } from "../store/memoryStore";
import { nextLikelySuccessDay } from "../agent/rules";

let actionSeq = 0;
function nextActionId(): string {
  actionSeq += 1;
  return `act_${actionSeq}`;
}

/** Short re-probe interval for a suspected issuer/rail outage — not a payer-timing question. */
const ISSUER_DOWN_RETRY_DELAY_MS = 90 * 60 * 1000; // 90 simulated minutes

export interface PlanResult {
  action: ActionRecord;
  deferUntil?: number;
}

export function plan(
  event: FailureEvent,
  diagnosis: Diagnosis,
  arm: "parakh" | "control",
  atMs: number,
  guardrails: GuardrailStore,
  historicalSuccessDays: number[]
): PlanResult {
  let action: RecoveryAction = diagnosis.action;
  let note: string | undefined;
  let deferUntil: number | undefined;

  const wantsToRetry = action === "RETRY_NOW" || action === "DEFER" || action === "SWITCH_RAIL";

  if (wantsToRetry && !guardrails.canRetry(event.payerId)) {
    action = "ESCALATE";
    note = `Retry budget exhausted (${guardrails.retriesUsed(event.payerId)} used) — handing to a human instead of spending another attempt.`;
  } else if (action === "DEFER") {
    if (diagnosis.trueCause === "ISSUER_DOWN" || diagnosis.trueCause === "RAIL_CONGESTED") {
      // Deferring because a rail is degraded is a re-probe question, not a
      // payer-timing one — a short delay, not "wait for salary day".
      deferUntil = atMs + ISSUER_DOWN_RETRY_DELAY_MS;
    } else {
      const day = nextLikelySuccessDay(historicalSuccessDays, new Date(atMs).getUTCDate());
      const base = new Date(atMs);
      base.setUTCDate(day);
      if (day < new Date(atMs).getUTCDate()) base.setUTCMonth(base.getUTCMonth() + 1);
      deferUntil = base.getTime();
    }
  }

  const wantsToMessage = action === "NOTIFY_CUSTOMER" || (!diagnosis.suppressCustomerMessage && action === "SEND_PAYMENT_LINK");
  if (wantsToMessage && !guardrails.canMessage(event.payerId, atMs)) {
    note = (note ? note + " " : "") + "Message suppressed — one already sent to this payer in the last 24h.";
  }

  if (action === "RETRY_NOW" || action === "DEFER" || action === "SWITCH_RAIL") {
    guardrails.recordRetry(event.payerId);
  }

  const record: ActionRecord = {
    id: nextActionId(),
    eventId: event.id,
    diagnosis: { ...diagnosis, action },
    arm,
    status: "pending",
    note,
  };

  return { action: record, deferUntil };
}
