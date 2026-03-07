import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
const SUPABASE_FUNCTION_REQUEST_TIMEOUT_MS = 90_000;

function resolveTimeoutMs(input: RequestInfo | URL) {
  const url = typeof input === "string" ? input : String(input);
  if (/\/functions\/v1\//.test(url)) return SUPABASE_FUNCTION_REQUEST_TIMEOUT_MS;
  return SUPABASE_REQUEST_TIMEOUT_MS;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const timeoutMs = resolveTimeoutMs(input);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const handleExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", handleExternalAbort);

  try {
    if (externalSignal?.aborted) controller.abort();

    const response = await fetch(input, {
      ...init,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigError =
  !supabaseUrl || !supabasePublishableKey
    ? "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    : null;

export const isSupabaseConfigured = !supabaseConfigError;

export const supabase =
  isSupabaseConfigured && supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        global: {
          fetch: fetchWithTimeout
        },
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      })
    : null;

export function getSupabaseClient() {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? "Supabase client is not configured");
  }
  return supabase;
}
