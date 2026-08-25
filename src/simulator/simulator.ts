/**
 * Traffic simulator.
 *
 * This exists for one reason: because we generate the traffic, we know the
 * ground truth (`simulatedTrueCause`) for every failure. That's what makes
 * eval.ts possible — confusion matrix, precision/recall, false-blame rate —
 * instead of just vibes. Design changes here should be made with that eval
 * loop in mind, not just "realistic-looking" numbers.
 *
 * Time model: the whole demo runs on a simulated clock (`atMs`), advanced
 * explicitly by the orchestrator/scenario script, not the wall clock. This
 * keeps runs reproducible and lets a "day later" retry be modeled honestly.
 */

import { FailureEvent, NormalizedCause, Rail } from "../types/events";

const ISSUERS = ["HDFC", "SBI", "ICICI", "AXIS", "KOTAK"] as const;
const RAILS: Rail[] = ["UPI_AUTOPAY", "ENACH", "CARD"];

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

/** Simple seeded RNG so a scenario run is reproducible when needed. */
function makeRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export interface PayerProfile {
  id: string;
  homeIssuer: string;
  homeRail: Rail;
  amount: number; // paise
  /** Day of month this payer's salary/cash-in typically lands, and a genuine INSUFFICIENT_FUNDS retry would succeed. */
  successDay: number;
}

export interface Scenario {
  trueCause: NormalizedCause;
  targetIssuer?: string;
  targetRail?: Rail;
  rawCode: string;
  rawDescription: string;
  weight: number;
}

export const NORMAL_SCENARIOS: Scenario[] = [
  { trueCause: "INSUFFICIENT_FUNDS", rawCode: "U31", rawDescription: "insufficient funds", weight: 5 },
  { trueCause: "CARD_EXPIRED", rawCode: "U54", rawDescription: "expired card", weight: 1 },
  { trueCause: "MANDATE_REVOKED", rawCode: "U96", rawDescription: "mandate cancelled by customer", weight: 1 },
  { trueCause: "FRAUD_HOLD", rawCode: "U59", rawDescription: "suspected fraud", weight: 1 },
  // The trap: "do not honor" is genuinely ambiguous in the real world, and
  // separately, it's also the code an issuer-side outage often hides behind.
  { trueCause: "AMBIGUOUS_DECLINE", rawCode: "U05", rawDescription: "do not honor", weight: 2 },
];

export function outageScenario(issuer: string, rail: Rail): Scenario {
  return {
    trueCause: "ISSUER_DOWN",
    targetIssuer: issuer,
    targetRail: rail,
    // This is the whole point: the bank reports it identically to an
    // everyday insufficient-funds decline. The row alone cannot tell them apart.
    rawCode: "U31",
    rawDescription: "insufficient funds",
    weight: 0,
  };
}

export interface OutageWindow {
  issuer: string;
  rail: Rail;
  until: number;
}

export class TrafficSimulator {
  private rng: () => number;
  private payers: PayerProfile[] = [];
  private activeOutage: Scenario | null = null;
  private outageUntil = 0;

  constructor(seed = 42, payerCount = 60) {
    this.rng = makeRng(seed);
    for (let i = 0; i < payerCount; i++) {
      this.payers.push({
        id: `payer_${i}`,
        homeIssuer: ISSUERS[Math.floor(this.rng() * ISSUERS.length)],
        homeRail: RAILS[Math.floor(this.rng() * RAILS.length)],
        amount: 900_00 + Math.floor(this.rng() * 5) * 100_00,
        successDay: 1 + Math.floor(this.rng() * 5),
      });
    }
  }

  injectOutage(issuer: string, rail: Rail, ms: number, atMs: number) {
    this.activeOutage = outageScenario(issuer, rail);
    this.outageUntil = atMs + ms;
  }

  clearOutage() {
    this.activeOutage = null;
    this.outageUntil = 0;
  }

  /** Ground truth for eval: is issuer+rail mid-outage at this exact instant? */
  getOutageWindow(): OutageWindow | null {
    if (!this.activeOutage || !this.activeOutage.targetIssuer || !this.activeOutage.targetRail) return null;
    return { issuer: this.activeOutage.targetIssuer, rail: this.activeOutage.targetRail, until: this.outageUntil };
  }

  private pickNormalScenario(): Scenario {
    const total = NORMAL_SCENARIOS.reduce((s, x) => s + x.weight, 0);
    let r = this.rng() * total;
    for (const s of NORMAL_SCENARIOS) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return NORMAL_SCENARIOS[0];
  }

  /** Force the next failure to come from a specific payer, for scripted/curated scenarios. */
  forcedEvent(payerId: string, scenario: Scenario, atMs: number): FailureEvent {
    const payer = this.payers.find((p) => p.id === payerId) ?? this.payers[0];
    return {
      id: nextId("evt"),
      payerId: payer.id,
      issuer: scenario.targetIssuer ?? payer.homeIssuer,
      rail: scenario.targetRail ?? payer.homeRail,
      rawCode: scenario.rawCode,
      rawDescription: scenario.rawDescription,
      amount: payer.amount,
      at: atMs,
      simulatedTrueCause: scenario.trueCause,
    };
  }

  /** Produce a batch of failure events, biased toward the active outage (if any) so a burst is visible. */
  tick(atMs: number, count = 3): FailureEvent[] {
    const events: FailureEvent[] = [];
    const outageLive = this.activeOutage && atMs < this.outageUntil;

    for (let i = 0; i < count; i++) {
      const payer = this.payers[Math.floor(this.rng() * this.payers.length)];
      let scenario: Scenario;

      if (outageLive && payer.homeIssuer === this.activeOutage!.targetIssuer && payer.homeRail === this.activeOutage!.targetRail) {
        scenario = this.activeOutage!;
      } else if (outageLive && this.rng() < 0.6) {
        scenario = this.activeOutage!;
      } else {
        scenario = this.pickNormalScenario();
      }

      const issuer = scenario.targetIssuer ?? payer.homeIssuer;
      const rail = scenario.targetRail ?? payer.homeRail;

      events.push({
        id: nextId("evt"),
        payerId: payer.id,
        issuer,
        rail,
        rawCode: scenario.rawCode,
        rawDescription: scenario.rawDescription,
        amount: payer.amount,
        at: atMs,
        simulatedTrueCause: scenario.trueCause,
      });
    }

    return events;
  }

  getPayerProfile(payerId: string): PayerProfile | undefined {
    return this.payers.find((p) => p.id === payerId);
  }

  allPayerIds(): string[] {
    return this.payers.map((p) => p.id);
  }
}
