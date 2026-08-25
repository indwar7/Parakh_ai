import { ActionRecord, FailureEvent } from "../types/events";

export interface ExecutionResult {
  status: "executed" | "skipped" | "failed";
  razorpayRef?: string;
  note?: string;
}

export interface RecoveryExecutor {
  execute(action: ActionRecord, event: FailureEvent): Promise<ExecutionResult>;
}
