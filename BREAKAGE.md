# BREAKAGE.md

Running log of what broke during the build and how it was resolved — kept
live per day, not written after the fact. The buildathon submission asks for
this explicitly.

## Day 1 — 26 Aug 2026

**Scaffold + first end-to-end run, no external keys.**

- Ran the full pipeline (simulator → fleet stats → diagnosis → planner →
  executor → eval) with no `GEMINI_API_KEY` and `EXECUTOR_MODE=mock`. It
  completed without crashing, which is the important thing on day 1 — but the
  Parakh arm's recovery rate came out *lower* than control's (10.5% vs 31.6%).
  This is not a bug: with no Gemini key, every ambiguous case falls back to
  `ESCALATE` by design (see `diagnosisAgent.ts` — a missing key is treated the
  same as a validation failure, never a silent guess). `ESCALATE` never
  attempts a recovery, so the recovery-rate number is meaningless until a real
  key is wired in. The false-blame-avoided number (10) is real regardless,
  since it comes from control's behavior, not Parakh's stub behavior — that
  was a useful thing to notice on day 1 rather than assume.
  **Action item:** get `GEMINI_API_KEY` in before re-running the real numbers.

- Deliberately did NOT wire the Razorpay subscription-charge retry endpoint
  into `razorpayExecutor.ts` yet — I don't want to guess at an API shape I
  haven't confirmed against current docs. `SEND_PAYMENT_LINK` is wired for
  real (Payment Links API is stable and well-documented); `RETRY_NOW` /
  `DEFER` / `SWITCH_RAIL` currently return `skipped` with a clear note rather
  than pretending to call something. **Needs:** confirm the exact endpoint
  before the live demo, or keep this arm mock-only and say so on stage.

- Chose a scripted scenario (`index.ts`'s named "moments") over a continuous
  randomized traffic loop. A hackathon demo needs a bounded, narratable
  sequence — and every ambiguous event is a real (costed, rate-limited) LLM
  call, so "run forever" wasn't free. `TrafficSimulator.tick()` still supports
  continuous mode if it's needed later.

## Template for future entries

**What broke:**
**Why:**
**Fix / decision:**
**Follow-up needed:**
