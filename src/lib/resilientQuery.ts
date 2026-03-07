import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryKey } from "@tanstack/react-query";

const QUERY_CACHE_PREFIX = "resilient_query_cache_v1";

type CachedEnvelope<T> = {
  data: T;
  updatedAt: number;
};

export type ResilientQueryMode = "network-first" | "cache-first";

type RunResilientQueryInput<T> = {
  queryKey: QueryKey;
  mode?: ResilientQueryMode;
  maxAgeMs?: number;
  queryFn: () => Promise<T>;
};

function toStorageKey(queryKey: QueryKey) {
  return `${QUERY_CACHE_PREFIX}:${JSON.stringify(queryKey)}`;
}

async function readEnvelope<T>(queryKey: QueryKey) {
  try {
    const raw = await AsyncStorage.getItem(toStorageKey(queryKey));
    if (!raw) return null as CachedEnvelope<T> | null;
    const parsed = JSON.parse(raw) as CachedEnvelope<T>;
    if (!parsed || typeof parsed !== "object" || !("updatedAt" in parsed) || !("data" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function cacheQueryData<T>(queryKey: QueryKey, data: T) {
  const envelope: CachedEnvelope<T> = {
    data,
    updatedAt: Date.now()
  };
  try {
    await AsyncStorage.setItem(toStorageKey(queryKey), JSON.stringify(envelope));
  } catch {
    // Ignore storage write failures and keep serving network data.
  }
}

export async function runResilientQuery<T>({
  queryKey,
  mode = "network-first",
  maxAgeMs = 0,
  queryFn
}: RunResilientQueryInput<T>) {
  const cached = await readEnvelope<T>(queryKey);
  const hasFreshCache =
    !!cached && maxAgeMs > 0 && Date.now() - cached.updatedAt <= maxAgeMs;

  if (mode === "cache-first" && cached && hasFreshCache) {
    return cached.data;
  }

  try {
    const fresh = await queryFn();
    await cacheQueryData(queryKey, fresh);
    return fresh;
  } catch (error) {
    if (cached) return cached.data;
    throw error;
  }
}

export function isRetryableError(error: unknown) {
  if (!error || typeof error !== "object") {
    const message = String(error ?? "");
    return /(network|fetch|internet|offline|timeout|timed? out|connection|429|503|502|504)/i.test(message);
  }

  const status = "status" in error && typeof error.status === "number" ? error.status : null;
  if (status && (status === 408 || status === 409 || status === 429 || status >= 500)) {
    return true;
  }

  const code = "code" in error ? String(error.code ?? "") : "";
  if (/^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)$/i.test(code)) {
    return true;
  }

  const message = "message" in error ? String(error.message ?? "") : String(error);
  return /(network|fetch|internet|offline|timeout|timed? out|connection|temporar|429|503|502|504)/i.test(message);
}

export function retryDelayWithBackoff(attemptIndex: number) {
  const base = 800;
  const max = 10_000;
  const exp = Math.min(base * 2 ** attemptIndex, max);
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}
