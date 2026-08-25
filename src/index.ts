/**
 * Demo orchestrator — a scripted scenario, not an open-ended traffic loop.
 *
 * Why scripted: this is a 10-day hackathon build, and every "ambiguous" event
 * costs a real Gemini call. A curated sequence of named moments (i) keeps the
 * LLM call count bounded and predictable, (ii) matches the pitch video's demo
 * script beat-for-beat, and (iii) still runs both arms — Parakh and the
 * industry-standard control — against the exact same events, so the numbers
 * at the end are a fair comparison rather than cherry-picked traffic.
 *
 * A continuous/randomized traffic mode can reuse TrafficSimulator.tick()
 * directly (see the outage burst below, which already does this) — this file
 * just chooses to narrate a specific story instead of a long random run.
 */

import { FailureEvent } from "./types/events";
import { TrafficSimulator, NORMAL_SCENARIOS } from "./simulator/simulator";
import { FleetHealthRegistry } from "./fleet/fleetStats";
import { PayerHistoryStore, GuardrailStore } from "./store/memoryStore";
import { diagnose } from "./agent/diagnosisAgent";
import { controlDiagnose } from "./planner/controlPolicy";
import { plan } from "./planner/recoveryPlanner";
import { createExecutor } from "./executor";
import { wouldSucceed, customerMessageWouldBeTrue } from "./eval/groundTruth";
import { EvalRecord, summarize, formatSummary } from "./eval/evaluate";
import { env } from "./config/env";

const SIM_START_MS = Date.parse("2026-08-01T09:00:00Z");
const HISTORY_SEED_MONTHS = 2;

async function main() {
  const simulator = new TrafficSimulator();
  const fleet = new FleetHealthRegistry();
  const payerHistory = new PayerHistoryStore();
  const guardrails = { parakh: new GuardrailStore(), control: new GuardrailStore() };
  const executor = createExecutor();
  const records: EvalRecord[] = [];

  console.log(`Parakh demo — executor mode: ${env.executorMode}, Gemini configured: ${env.geminiConfigured}\n`);

  // Seed each payer's "prior months" — the same successDay ground truth the
  // simulator will judge against, reflected into history so the agent has
  // something real to reason over (not fabricated, just observed earlier).
  for (const payerId of simulator.allPayerIds()) {
    const profile = simulator.getPayerProfile(payerId)!;
    for (let m = 1; m <= HISTORY_SEED_MONTHS; m++) {
      const d = new Date(SIM_START_MS);
      d.setUTCMonth(d.getUTCMonth() - m);
      d.setUTCDate(profile.successDay);
      payerHistory.record(payerId, d.getTime(), "success");
    }
  }
  fleet.setBaseline("HDFC", "UPI_AUTOPAY", 0.05);

  async function runBothArms(event: FailureEvent) {
    for (const arm of ["parakh", "control"] as const) {
      const diagnosis = arm === "parakh" ? await diagnose(event, fleet.getWindow(event.issuer, event.rail, event.at), payerHistory.get(event.payerId)) : controlDiagnose(event);

      const history = payerHistory.get(event.payerId);
      const planResult = plan(event, diagnosis, arm, event.at, guardrails[arm], history?.historicalSuccessDays ?? []);

      const execResult = await executor.execute(planResult.action, event);
      planResult.action.status = execResult.status === "failed" ? "failed" : execResult.status === "skipped" ? "skipped" : "executed";
      planResult.action.razorpayRef = execResult.razorpayRef;
      planResult.action.executedAt = event.at;

      const resolutionAtMs = planResult.deferUntil ?? event.at;
      const payer = simulator.getPayerProfile(event.payerId);
      const finalAction = planResult.action.diagnosis.action;
      const recovered = wouldSucceed(event, finalAction, resolutionAtMs, payer, simulator.getOutageWindow());

      const attemptsAttempted = finalAction === "RETRY_NOW" || finalAction === "DEFER" || finalAction === "SWITCH_RAIL" || finalAction === "SEND_PAYMENT_LINK";

      // Control always narrates a generic message alongside any attempted
      // action (that's the realistic failure mode we're contrasting).
      // Parakh only messages when the diagnosis says the message is true.
      const messageSent =
        arm === "control"
          ? attemptsAttempted
          : (finalAction === "NOTIFY_CUSTOMER" || finalAction === "SEND_PAYMENT_LINK") && !diagnosis.suppressCustomerMessage;

      const falseBlameMessageSent = messageSent && !customerMessageWouldBeTrue(event);

      records.push({
        event,
        diagnosis: arm === "parakh" ? diagnosis : undefined,
        outcome: {
          actionId: planResult.action.id,
          eventId: event.id,
          arm,
          recovered,
          amount: recovered ? event.amount : 0,
          attemptsUsed: attemptsAttempted ? 1 : 0,
          falseBlameMessageSent,
        },
      });

      console.log(
        `  [${arm.padEnd(7)}] ${event.payerId.padEnd(9)} ${event.issuer}/${event.rail.padEnd(11)} code=${event.rawCode} ` +
          `→ cause=${diagnosis.trueCause.padEnd(17)} action=${finalAction.padEnd(16)} ` +
          `misleading=${String(diagnosis.codeIsMisleading).padEnd(5)} recovered=${recovered}${planResult.action.note ? `  (${planResult.action.note})` : ""}`
      );
    }
  }

  // ---- Moment 1: everyday failures, one of each kind -------------------
  console.log("=== Moment 1: everyday failures ===");
  const payers = simulator.allPayerIds();
  await runBothArms(simulator.forcedEvent(payers[0], NORMAL_SCENARIOS.find((s) => s.trueCause === "INSUFFICIENT_FUNDS")!, SIM_START_MS));
  await runBothArms(simulator.forcedEvent(payers[1], NORMAL_SCENARIOS.find((s) => s.trueCause === "CARD_EXPIRED")!, SIM_START_MS));
  await runBothArms(simulator.forcedEvent(payers[2], NORMAL_SCENARIOS.find((s) => s.trueCause === "MANDATE_REVOKED")!, SIM_START_MS));
  await runBothArms(simulator.forcedEvent(payers[3], NORMAL_SCENARIOS.find((s) => s.trueCause === "FRAUD_HOLD")!, SIM_START_MS));

  // ---- Moment 2: an issuer-side outage, disguised as insufficient funds --
  console.log("\n=== Moment 2: HDFC UPI Autopay goes down (reported as U31 'insufficient funds') ===");
  const outageStart = SIM_START_MS + 2 * 60 * 60 * 1000;
  simulator.injectOutage("HDFC", "UPI_AUTOPAY", 60 * 60 * 1000, outageStart); // 60-minute outage
  fleet.recordAttempts("HDFC", "UPI_AUTOPAY", outageStart, 20); // background traffic volume for this window

  const burst = simulator.tick(outageStart, 15);
  for (const evt of burst) {
    fleet.recordFailure(evt); // fleet sees this failure before either arm diagnoses it
    await runBothArms(evt);
  }
  simulator.clearOutage();

  // ---- Summary -----------------------------------------------------------
  console.log("\n" + formatSummary(summarize(records)));
}

main().catch((err) => {
  console.error("Demo run failed:", err);
  process.exit(1);
});
