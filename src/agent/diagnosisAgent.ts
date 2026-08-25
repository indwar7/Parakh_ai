/**
 * The diagnosis agent — the unique core of Parakh.
 *
 * Cascade, cheapest-first:
 *   1. tryRules() — deterministic, no LLM, for clear-cut cases (rules.ts)
 *   2. Gemini, structured output — only for the ambiguous middle, where a
 *      decline code's claim needs to be weighed against fleet evidence
 *
 * A malformed, missing, or out-of-range model response NEVER falls through
 * to picking an action on its own — it degrades to a low-confidence ESCALATE.
 * That guardrail is deliberate: judgement is AI's job here, but "did this
 * response actually validate" is not something we hand back to the model.
 */

import { GoogleGenAI } from "@google/genai";
import { Diagnosis, FailureEvent, FleetWindow, PayerHistory } from "../types/events";
import { env } from "../config/env";
import { tryRules } from "./rules";
import { buildDiagnosisPrompt, SYSTEM_INSTRUCTION } from "./prompts";
import { DIAGNOSIS_RESPONSE_SCHEMA, RECOVERY_ACTIONS, TRUE_CAUSES } from "./schema";

const REQUEST_TIMEOUT_MS = 20_000;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Gemini request timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function escalate(event: FailureEvent, reason: string): Diagnosis {
  return {
    eventId: event.id,
    trueCause: "AMBIGUOUS_DECLINE",
    confidence: 0.2,
    codeIsMisleading: false,
    suppressCustomerMessage: true,
    evidence: [reason],
    reasoning: `Falling back to ESCALATE: ${reason}`,
    action: "ESCALATE",
  };
}

/** Validates and clamps a raw model response into a trustworthy Diagnosis, or returns null. */
function parseModelResponse(eventId: string, text: string): Diagnosis | null {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const trueCause = TRUE_CAUSES.includes(parsed.trueCause) ? parsed.trueCause : null;
  const action = RECOVERY_ACTIONS.includes(parsed.action) ? parsed.action : null;
  const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : null;
  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.filter((e: unknown) => typeof e === "string") : null;
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : null;
  const codeIsMisleading = typeof parsed.codeIsMisleading === "boolean" ? parsed.codeIsMisleading : null;
  const suppressCustomerMessage = typeof parsed.suppressCustomerMessage === "boolean" ? parsed.suppressCustomerMessage : null;

  if (!trueCause || !action || confidence === null || !evidence || !reasoning || codeIsMisleading === null || suppressCustomerMessage === null) {
    return null;
  }

  // Guardrail: low confidence overrides whatever action the model picked.
  const finalAction = confidence < 0.5 ? "ESCALATE" : action;

  return {
    eventId,
    trueCause,
    confidence,
    codeIsMisleading,
    suppressCustomerMessage: confidence < 0.5 ? true : suppressCustomerMessage,
    evidence,
    reasoning,
    action: finalAction,
  };
}

export async function diagnose(event: FailureEvent, fleet: FleetWindow, history: PayerHistory | undefined): Promise<Diagnosis> {
  const ruleResult = tryRules(event, fleet);
  if (ruleResult.handled && ruleResult.diagnosis) {
    return ruleResult.diagnosis;
  }

  if (!env.geminiConfigured) {
    return escalate(event, "GEMINI_API_KEY not set — running in stub mode, cannot reason over ambiguous case.");
  }

  try {
    const response = await withTimeout(
      getClient().models.generateContent({
        model: env.geminiModel,
        contents: [{ role: "user", parts: [{ text: buildDiagnosisPrompt(event, fleet, history) }] }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.2, // low — this is a judgement call, not creative writing
          responseMimeType: "application/json",
          responseSchema: DIAGNOSIS_RESPONSE_SCHEMA,
        },
      }),
      REQUEST_TIMEOUT_MS
    );

    const text = response.text ?? "";
    const diagnosis = parseModelResponse(event.id, text);
    if (!diagnosis) {
      return escalate(event, "Model response did not validate against the schema.");
    }
    return diagnosis;
  } catch (err) {
    return escalate(event, `Diagnosis agent call failed: ${(err as Error).message}`);
  }
}
