/**
 * Fleet health tracking.
 *
 * Deliberately plain statistics, not a model. This is the sensor the
 * diagnosis agent reasons over — it needs to be cheap, deterministic, and
 * auditable, because "is HDFC UPI degraded right now" should never itself be
 * a probabilistic guess. See BREAKAGE.md for why we don't reach for an LLM here.
 */

import { FailureEvent, FleetWindow, Rail } from "../types/events";

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
/** Below this many attempts in a window, we don't trust the rate — too noisy. */
const MIN_ATTEMPTS_FOR_SIGNAL = 8;
/** observed/baseline ratio above which we call it anomalous. */
const ANOMALY_RATIO_THRESHOLD = 3;

interface Key {
  issuer: string;
  rail: Rail;
}

function keyOf(issuer: string, rail: Rail): string {
  return `${issuer}::${rail}`;
}

interface RawWindowState {
  events: FailureEvent[]; // failures only, within WINDOW_MS
  attemptsEstimate: number; // failures + assumed successes; see note in recordAttempt
}

/**
 * Tracks rolling failure windows per issuer×rail and compares against a
 * baseline failure rate to produce an anomaly score.
 *
 * NOTE on "attempts": this simulator/demo only models failure events (see
 * simulator.ts), so we don't have real success counts to divide by. We track
 * an attemptsEstimate via recordAttempt() calls from the caller, which knows
 * the true attempt volume in the demo loop. In a production system this would
 * be a real denominator from the payment log.
 */
export class FleetHealthRegistry {
  private windows = new Map<string, RawWindowState>();
  private baselines = new Map<string, number>();

  setBaseline(issuer: string, rail: Rail, failureRate: number) {
    this.baselines.set(keyOf(issuer, rail), failureRate);
  }

  private getBaseline(issuer: string, rail: Rail): number {
    return this.baselines.get(keyOf(issuer, rail)) ?? 0.05; // 5% default assumption
  }

  private getOrInit(key: string): RawWindowState {
    let w = this.windows.get(key);
    if (!w) {
      w = { events: [], attemptsEstimate: 0 };
      this.windows.set(key, w);
    }
    return w;
  }

  /** Record that `count` total attempts (success+failure) happened for issuer/rail at `atMs`. */
  recordAttempts(issuer: string, rail: Rail, atMs: number, count: number) {
    const w = this.getOrInit(keyOf(issuer, rail));
    w.attemptsEstimate += count;
    this.pruneAndDecay(w, atMs);
  }

  recordFailure(event: FailureEvent) {
    const w = this.getOrInit(keyOf(event.issuer, event.rail));
    w.events.push(event);
    this.pruneAndDecay(w, event.at);
  }

  /** Drop events older than the window and decay the attempts estimate proportionally. */
  private pruneAndDecay(w: RawWindowState, atMs: number) {
    const cutoff = atMs - WINDOW_MS;
    const before = w.events.length;
    w.events = w.events.filter((e) => e.at >= cutoff);
    // Rough decay: if we dropped failures, assume attempts decayed similarly.
    // Good enough for a bounded demo window; a real system would bucket by time instead.
    if (before > 0 && w.events.length < before) {
      const keepRatio = w.events.length / before;
      w.attemptsEstimate = Math.max(w.events.length, Math.round(w.attemptsEstimate * keepRatio));
    }
  }

  getWindow(issuer: string, rail: Rail, atMs: number): FleetWindow {
    const key = keyOf(issuer, rail);
    const w = this.getOrInit(key);
    this.pruneAndDecay(w, atMs);

    const failures = w.events.length;
    const attempts = Math.max(w.attemptsEstimate, failures); // attempts can't be less than failures
    const observedFailureRate = attempts > 0 ? failures / attempts : 0;
    const baselineFailureRate = this.getBaseline(issuer, rail);
    const anomalyScore = baselineFailureRate > 0 ? observedFailureRate / baselineFailureRate : (failures > 0 ? Infinity : 0);

    const codeDistribution: Record<string, number> = {};
    for (const e of w.events) {
      codeDistribution[e.rawCode] = (codeDistribution[e.rawCode] ?? 0) + 1;
    }

    const isAnomalous = attempts >= MIN_ATTEMPTS_FOR_SIGNAL && anomalyScore >= ANOMALY_RATIO_THRESHOLD;

    return {
      issuer,
      rail,
      bucketStart: atMs - WINDOW_MS,
      windowMs: WINDOW_MS,
      attempts,
      failures,
      codeDistribution,
      baselineFailureRate,
      observedFailureRate,
      anomalyScore,
      isAnomalous,
    };
  }
}
