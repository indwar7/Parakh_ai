/**
 * Decline-code normalization.
 *
 * This maps a bank's raw code+description to what it CLAIMS happened —
 * not what actually happened. That distinction matters: the whole product
 * is built on the gap between this claim and the fleet-evidence-backed
 * true cause computed by the diagnosis agent.
 */

import { NormalizedCause } from "../types/events";

interface CodeMapping {
  claim: NormalizedCause;
  /** How often, in practice, this raw code turns out to mean something else entirely. */
  reliability: "reliable" | "unreliable";
}

// A small, explicit table. In production this would be maintained per-issuer,
// since the same numeric code can mean different things across banks — that
// inconsistency is itself part of why blind trust in the raw code fails.
const CODE_TABLE: Record<string, CodeMapping> = {
  U31: { claim: "INSUFFICIENT_FUNDS", reliability: "unreliable" }, // frequently overloaded by issuers during outages
  U54: { claim: "CARD_EXPIRED", reliability: "reliable" },
  U96: { claim: "MANDATE_REVOKED", reliability: "reliable" },
  U59: { claim: "FRAUD_HOLD", reliability: "reliable" },
  U05: { claim: "AMBIGUOUS_DECLINE", reliability: "unreliable" }, // "do not honor" — a catch-all
};

export function claimedCause(rawCode: string): { claim: NormalizedCause; reliability: "reliable" | "unreliable" } {
  return CODE_TABLE[rawCode] ?? { claim: "AMBIGUOUS_DECLINE", reliability: "unreliable" };
}
