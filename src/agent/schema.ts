/**
 * Structured-output contract for the diagnosis agent.
 *
 * We force the model into this shape rather than parsing free text — a
 * malformed or missing field should fail loudly, not get silently
 * interpreted. See diagnosisAgent.ts for what happens when the model's
 * output doesn't validate (short answer: it does NOT get to pick an action).
 */

import { Type } from "@google/genai";

export const TRUE_CAUSES = [
  "INSUFFICIENT_FUNDS",
  "MANDATE_REVOKED",
  "CARD_EXPIRED",
  "ISSUER_DOWN",
  "RAIL_CONGESTED",
  "FRAUD_HOLD",
  "AMBIGUOUS_DECLINE",
] as const;

export const RECOVERY_ACTIONS = [
  "RETRY_NOW",
  "DEFER",
  "SWITCH_RAIL",
  "SEND_PAYMENT_LINK",
  "NOTIFY_CUSTOMER",
  "ESCALATE",
  "STOP",
] as const;

export const DIAGNOSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    trueCause: {
      type: Type.STRING,
      enum: TRUE_CAUSES as unknown as string[],
      description: "What actually happened, based on the evidence given — may differ from what the raw bank code claims.",
    },
    confidence: {
      type: Type.NUMBER,
      description: "0 to 1. Use ESCALATE as the action when this would be below ~0.5.",
    },
    codeIsMisleading: {
      type: Type.BOOLEAN,
      description: "True if the raw decline code's claim does not match trueCause.",
    },
    suppressCustomerMessage: {
      type: Type.BOOLEAN,
      description: "True if telling the customer the raw code's story would be false or unhelpful.",
    },
    evidence: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Short factual statements. Every one MUST be traceable to a fact given in the input — never invent a number.",
    },
    reasoning: {
      type: Type.STRING,
      description: "One or two sentences, human-readable, for the audit trail.",
    },
    action: {
      type: Type.STRING,
      enum: RECOVERY_ACTIONS as unknown as string[],
    },
  },
  required: ["trueCause", "confidence", "codeIsMisleading", "suppressCustomerMessage", "evidence", "reasoning", "action"],
};
