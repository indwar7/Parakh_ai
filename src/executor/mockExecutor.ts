/**
 * Default executor — no real Razorpay calls. Safe with no keys configured,
 * used until RAZORPAY_KEY_ID/SECRET + EXECUTOR_MODE=razorpay are wired up
 * (see razorpayExecutor.ts for what switches on after that).
 */

import { ActionRecord, FailureEvent } from "../types/events";
import { ExecutionResult, RecoveryExecutor } from "./types";

let ref = 0;
function nextRef(): string {
  ref += 1;
  return `mock_ref_${ref}`;
}

export class MockExecutor implements RecoveryExecutor {
  async execute(action: ActionRecord): Promise<ExecutionResult> {
    switch (action.diagnosis.action) {
      case "RETRY_NOW":
      case "DEFER":
      case "SWITCH_RAIL":
        return { status: "executed", razorpayRef: nextRef(), note: "mock: charge retry simulated" };
      case "SEND_PAYMENT_LINK":
        return { status: "executed", razorpayRef: nextRef(), note: "mock: payment link simulated" };
      case "NOTIFY_CUSTOMER":
        return { status: "executed", note: "mock: customer message simulated" };
      case "STOP":
      case "ESCALATE":
        return { status: "skipped", note: "no external action for this decision" };
      default:
        return { status: "skipped" };
    }
  }
}
