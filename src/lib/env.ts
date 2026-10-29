// Central place for configuration. Every value has a safe default so the app
// can boot (and show a clear "not configured" state) without secrets.

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export const env = {
  // Vercel's Supabase integration provides POSTGRES_URL (pooled). Locally we use DATABASE_URL.
  databaseUrl: () => str("DATABASE_URL") || str("POSTGRES_URL"),
  geminiKey: () => str("GEMINI_API_KEY") || str("GOOGLE_API_KEY") || str("GOOGLE_GENERATIVE_AI_API_KEY"),
  groqKey: () => str("GROQ_API_KEY"),
  tavilyKey: () => str("TAVILY_API_KEY"),
  cronSecret: () => str("CRON_SECRET"),
  vapidPublic: () => str("NEXT_PUBLIC_VAPID_PUBLIC_KEY") || str("VAPID_PUBLIC_KEY"),
  vapidPrivate: () => str("VAPID_PRIVATE_KEY"),
  vapidSubject: () => str("VAPID_SUBJECT", "mailto:finn@example.com"),
  nseEnabled: () => str("NSE_ENABLED", "false") === "true",
  appUrl: () => str("APP_URL") || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  models: {
    t1: () => list("MODEL_T1", ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]),
    t2: () => list("MODEL_T2", ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-2.5-flash"]),
    t3: () => list("MODEL_T3", ["gemini-3.8-flash", "gemini-2.5-pro", "gemini-3.6-flash"]),
    grounded: () => list("MODEL_GROUNDED", ["gemini-2.5-flash", "gemini-3.6-flash"]),
    groqT1: () => str("GROQ_MODEL_T1", "openai/gpt-oss-20b"),
  },
};

export const IS_SERVERLESS = !!process.env.VERCEL;
