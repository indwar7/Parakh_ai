/**
 * Core domain types for Parakh.
 *
 * The central bet of this project: a decline code is a claim, not a fact.
 * Everything below exists to check that claim against fleet-wide evidence
 * before anyone — a customer, a merchant, a retry job — acts on it.
 */

export type Rail = "UPI_AUTOPAY" | "ENACH" | "CARD";

/** Canonical failure reasons, after we've normalized the bank's raw string. */
export type NormalizedCause =
  | "INSUFFICIENT_FUNDS"
  | "MANDATE_REVOKED"
  | "CARD_EXPIRED"
  | "ISSUER_DOWN"
  | "RAIL_CONGESTED"
  | "FRAUD_HOLD"
  | "AMBIGUOUS_DECLINE"; // e.g. raw "do not honor" with no clear signal either way

/** What the agent believes actually happened, which may differ from the raw code. */
export type TrueCause = NormalizedCause;

export type RecoveryAction =
  | "RETRY_NOW"
  | "DEFER" // retry later, at `deferUntil`
  | "SWITCH_RAIL" // e.g. UPI Autopay -> card
  | "SEND_PAYMENT_LINK"
  | "NOTIFY_CUSTOMER" // only when the message would be true
  | "ESCALATE" // low confidence — hand to a human
  | "STOP"; // hard decline, further attempts would waste retry budget

export interface FailureEvent {
  id: string;
  payerId: string;
  issuer: string; // e.g. "HDFC", "SBI", "ICICI"
  rail: Rail;
  rawCode: string; // whatever the bank/network actually sent
  rawDescription: string; // e.g. "do not honor", "insufficient funds"
  amount: number; // paise
  at: number; // unix ms
  /** Ground truth, present ONLY in simulated traffic, for eval. Never shown to the agent. */
  simulatedTrueCause?: NormalizedCause;
}

export interface PayerHistory {
  payerId: string;
  pastAttempts: Array<{ at: number; outcome: "success" | "failure"; cause?: NormalizedCause }>;
  /** Days of month (1-31) on which this payer has previously succeeded. */
  historicalSuccessDays: number[];
}

export interface FleetWindow {
  issuer: string;
  rail: Rail;
  bucketStart: number; // unix ms, start of the rolling window
  windowMs: number;
  attempts: number;
  failures: number;
  codeDistribution: Record<string, number>;
  /** Expected failure rate for this issuer/rail/time-of-week, from historical baseline. */
  baselineFailureRate: number;
  observedFailureRate: number;
  /** observedFailureRate / baselineFailureRate, roughly — see fleetStats.ts */
  anomalyScore: number;
  isAnomalous: boolean;
}

export interface Diagnosis {
  eventId: string;
  trueCause: TrueCause;
  confidence: number; // 0-1
  /** The core product claim: does the raw code's story hold up against the evidence? */
  codeIsMisleading: boolean;
  suppressCustomerMessage: boolean;
  evidence: string[]; // short, factual, must be traceable to inputs given to the agent
  reasoning: string; // human-readable audit trail
  action: RecoveryAction;
  deferUntil?: number; // unix ms, required when action === "DEFER"
}

export interface ActionRecord {
  id: string;
  eventId: string;
  diagnosis: Diagnosis;
  arm: "parakh" | "control";
  status: "pending" | "executed" | "skipped" | "failed";
  razorpayRef?: string;
  executedAt?: number;
  note?: string;
}

export interface Outcome {
  actionId: string;
  eventId: string;
  arm: "parakh" | "control";
  recovered: boolean;
  amount: number;
  attemptsUsed: number;
  /** True if a customer was told something that the fleet evidence contradicts. */
  falseBlameMessageSent: boolean;
}
