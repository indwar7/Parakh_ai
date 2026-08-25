import dotenv from "dotenv";

dotenv.config();

export const env = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",

  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),

  /** "mock" (default, safe) or "razorpay" (real test-mode API calls). */
  executorMode: (process.env.EXECUTOR_MODE ?? "mock") as "mock" | "razorpay",
};
