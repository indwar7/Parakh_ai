# Parakh (परख)

*"परख" — to discern, to tell truth from imitation.*

**A decline code is a claim, not a fact. Parakh checks the claim before anyone
acts on it — a customer gets blamed, a retry gets wasted, a payment gets
written off.**

Built for the Razorpay AI Buildathon 2026 — Track 3: AI Revenue Recovery.

## The problem

A failed subscription payment (UPI Autopay, eNACH) comes back with a raw
decline code: `U31`, "insufficient funds". Every dunning tool in the industry
takes that at face value — it emails the customer, retries on a fixed
schedule, and moves on.

The code is frequently wrong. The same generic code an issuer sends for a
genuinely low balance is often the *exact same code* an issuer sends when its
own systems are degraded and it's silently declining everyone. Nobody's
balance dropped — the bank did. Blindly trusting the code means:

- blaming a customer for something that isn't their fault
- retrying into a bank that's still down, wasting a scarce retry attempt
- missing the one detail that would have told you to wait 90 minutes instead
  of a week

## What Parakh does

For every failed payment, it looks at three things a raw decline code cannot
see on its own:

1. **The row** — code, rail, issuer, amount
2. **This payer's history** — have they failed before, when do they usually succeed
3. **Fleet health right now** — is this issuer+rail failing at many times its
   normal rate, across many unrelated payers, in the last few minutes

A cheap, deterministic rules cascade handles the clear-cut cases (expired
card, cancelled mandate, fraud hold) without ever calling an LLM. Only the
genuinely ambiguous middle — where a code's claim and the fleet evidence
might disagree — goes to a Gemini-based diagnosis agent, which returns a
structured verdict: the true cause, whether the code was misleading, whether
a customer message would currently be *true*, and the single best recovery
action. A guardrailed planner then turns that into an execution: a retry, a
payment link, a deferral, or a stop — with retry budgets and message
frequency enforced in code, never left to the model.

**Where AI is used, and where it deliberately isn't:**

| Layer | AI? | Why |
|---|---|---|
| Fleet anomaly detection | No — plain statistics | Must be cheap, deterministic, auditable |
| Diagnosis of ambiguous cases | **Yes — Gemini, structured output** | Requires weighing conflicting evidence a lookup table can't |
| Retry caps, message frequency, defer timing | No — code | Safety must never be probabilistic |
| Decline-code → claimed-cause mapping | No — a table | Clear-cut, no judgement needed |

## Architecture

```
Traffic Simulator (ground-truth labelled)
        │
        ▼
Fleet Health Registry ──────► Diagnosis Agent (rules cascade → Gemini)
        │                            │
        ▼                            ▼
  Payer History ────────────► Recovery Planner (guardrails, defer timing)
                                      │
                                      ▼
                            Executor (Razorpay test-mode / mock)
                                      │
                                      ▼
                              Eval (vs ground truth, vs control arm)
```

Every event runs through **two independent arms** on the exact same input:
`parakh` (the system above) and `control` (today's realistic baseline — stops
on a cancelled mandate, escalates fraud, sends a card-update link, but
retries everything else blindly and never checks fleet health). The
difference between the two arms *is* the product's claim, measured, not
asserted.

## Why the simulator, not real traffic

Because we generate the traffic, we also know the ground truth — whether an
event was a genuine low balance or a disguised outage. That's what makes
`src/eval/evaluate.ts` possible: a real confusion matrix, precision/recall for
"was the code actually misleading", and a false-blame count, instead of just
a demo that looks convincing. See `src/eval/groundTruth.ts` — the one module
that's allowed to know the answer.

## Running it

```bash
cp .env.example .env
# GEMINI_API_KEY is required to see the real diagnosis story — without it,
# every ambiguous case safely degrades to ESCALATE rather than guess (see
# BREAKAGE.md, Day 1). RAZORPAY_KEY_ID/SECRET are optional; EXECUTOR_MODE
# defaults to "mock" so the whole pipeline runs with zero external calls.

npm install
npm run demo
```

This runs a scripted scenario: a handful of everyday failures, then an
injected HDFC UPI Autopay outage disguised as `U31 insufficient funds`,
processed through both arms, ending in a side-by-side summary — recovery
rate, retry attempts used, and false-blame messages avoided.

## Current status

- Pipeline runs end-to-end (see `BREAKAGE.md` for the day-1 run and what it
  did and didn't prove).
- `SEND_PAYMENT_LINK` calls the real Razorpay Payment Links API in test mode.
  Subscription-charge retry is intentionally **not** wired to a real endpoint
  yet — see `src/executor/razorpayExecutor.ts` and `BREAKAGE.md`.
- The recovery-rate delta between arms is only meaningful once
  `GEMINI_API_KEY` is set — a stub run cannot show it by design.

## Repository

<https://github.com/indwar7/Parakh_ai>
