/**
 * Real, test-mode Razorpay executor.
 *
 * We call the official `razorpay` SDK directly rather than shelling out to
 * the Razorpay MCP server, because MCP is a tool-calling protocol for an AI
 * host (Claude Desktop, Cursor, an agent runtime) — it isn't meant to be
 * imported as a library inside our own backend process. The MCP server's
 * `create_payment_link` / `fetch_payment` tools wrap these exact same REST
 * calls; this is the equivalent surface, callable directly.
 *
 * Payment Links are a well-documented, stable API — safe to call for real.
 *
 * Subscription-charge retry is NOT wired to a real endpoint yet: Razorpay's
 * exact API for retrying a specific failed subscription charge needs to be
 * confirmed against current docs/dashboard before the live demo (see
 * BREAKAGE.md). Until then it logs the intent and returns "skipped" rather
 * than silently pretending a charge was retried.
 */

import Razorpay from "razorpay";
import { ActionRecord, FailureEvent } from "../types/events";
import { env } from "../config/env";
import { ExecutionResult, RecoveryExecutor } from "./types";

export class RazorpayExecutor implements RecoveryExecutor {
  private client: Razorpay;

  constructor() {
    if (!env.razorpayConfigured) {
      throw new Error("RazorpayExecutor requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test mode).");
    }
    this.client = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
  }

  async execute(action: ActionRecord, event: FailureEvent): Promise<ExecutionResult> {
    switch (action.diagnosis.action) {
      case "SEND_PAYMENT_LINK": {
        try {
          const link = await this.client.paymentLink.create({
            amount: event.amount,
            currency: "INR",
            description: `Parakh recovery — ${event.payerId} (${action.diagnosis.trueCause})`,
            notes: { payerId: event.payerId, eventId: event.id, arm: action.arm },
          } as any);
          return { status: "executed", razorpayRef: link.id, note: link.short_url };
        } catch (err) {
          return { status: "failed", note: `Razorpay paymentLink.create failed: ${(err as Error).message}` };
        }
      }

      case "RETRY_NOW":
      case "DEFER":
      case "SWITCH_RAIL":
        // TODO(BREAKAGE.md): wire to the real subscription-charge retry
        // endpoint once confirmed against Razorpay's current API docs.
        return { status: "skipped", note: "subscription-charge retry endpoint not yet wired — see BREAKAGE.md" };

      case "NOTIFY_CUSTOMER":
        // Out of scope for this scaffold — would call an SMS/email provider.
        return { status: "skipped", note: "customer messaging channel not wired in this scaffold" };

      case "STOP":
      case "ESCALATE":
        return { status: "skipped", note: "no external action for this decision" };

      default:
        return { status: "skipped" };
    }
  }
}
