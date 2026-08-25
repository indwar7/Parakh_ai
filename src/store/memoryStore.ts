/**
 * In-memory state for a demo run.
 *
 * A hackathon-appropriate substitute for a database: per-payer history (feeds
 * the diagnosis agent and the rules cascade), and per-payer retry guardrails
 * (the "code guarantees safety" half of the AI/code split — see README).
 */

import { NormalizedCause, PayerHistory } from "../types/events";

const MAX_RETRY_ATTEMPTS_PER_CYCLE = 4;

export class PayerHistoryStore {
  private histories = new Map<string, PayerHistory>();

  private getOrInit(payerId: string): PayerHistory {
    let h = this.histories.get(payerId);
    if (!h) {
      h = { payerId, pastAttempts: [], historicalSuccessDays: [] };
      this.histories.set(payerId, h);
    }
    return h;
  }

  record(payerId: string, at: number, outcome: "success" | "failure", cause?: NormalizedCause) {
    const h = this.getOrInit(payerId);
    h.pastAttempts.push({ at, outcome, cause });
    if (outcome === "success") {
      const day = new Date(at).getUTCDate();
      if (!h.historicalSuccessDays.includes(day)) h.historicalSuccessDays.push(day);
    }
  }

  get(payerId: string): PayerHistory | undefined {
    return this.histories.get(payerId);
  }
}

/**
 * Retry-budget guardrail. Deliberately dumb and deterministic: no matter how
 * confident the agent is, a payer cannot be retried more than N times in a
 * cycle. This is the "code decides safety, AI decides judgement" boundary.
 */
export class GuardrailStore {
  private retryCounts = new Map<string, number>();
  private lastMessageAt = new Map<string, number>();

  canRetry(payerId: string): boolean {
    return (this.retryCounts.get(payerId) ?? 0) < MAX_RETRY_ATTEMPTS_PER_CYCLE;
  }

  recordRetry(payerId: string) {
    this.retryCounts.set(payerId, (this.retryCounts.get(payerId) ?? 0) + 1);
  }

  retriesUsed(payerId: string): number {
    return this.retryCounts.get(payerId) ?? 0;
  }

  /** At most one customer message per payer per 24 simulated hours. */
  canMessage(payerId: string, atMs: number): boolean {
    const last = this.lastMessageAt.get(payerId);
    return !last || atMs - last >= 24 * 60 * 60 * 1000;
  }

  recordMessage(payerId: string, atMs: number) {
    this.lastMessageAt.set(payerId, atMs);
  }

  resetCycle(payerId: string) {
    this.retryCounts.delete(payerId);
  }
}
