import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

const FINGERPRINT_KEY = "mobile-client";

export async function captureClientError(error: unknown, context: Record<string, unknown> = {}) {
  if (!isSupabaseConfigured) return;

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  try {
    const supabase = getSupabaseClient();
    await supabase.functions.invoke("log-client-error", {
      headers: { "x-client-fingerprint": FINGERPRINT_KEY },
      body: {
        message,
        stack,
        level: "error",
        path: "mobile",
        userAgent: "expo-native",
        context
      }
    });
  } catch {
    // Ignore monitoring failures.
  }
}
