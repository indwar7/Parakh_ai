import { env } from "../config/env";
import { RecoveryExecutor } from "./types";
import { MockExecutor } from "./mockExecutor";
import { RazorpayExecutor } from "./razorpayExecutor";

export function createExecutor(): RecoveryExecutor {
  if (env.executorMode === "razorpay" && env.razorpayConfigured) {
    return new RazorpayExecutor();
  }
  return new MockExecutor();
}

export * from "./types";
