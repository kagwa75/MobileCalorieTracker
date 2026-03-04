import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { z } from "https://esm.sh/zod@3.23.8";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-client-fingerprint, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const payloadSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    stack: z.string().max(12000).optional(),
    level: z.enum(["error", "warning", "info"]).default("error"),
    path: z.string().max(300).optional(),
    userAgent: z.string().max(500).optional(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(`${normalized}${padding}`);
}

function decodeBase64UrlUtf8(input: string) {
  const binary = decodeBase64Url(input);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getUserIdFromRequest(req: Request) {
  const authUserHeader =
    req.headers.get("x-supabase-auth-user") ??
    req.headers.get("x-supabase-user-id") ??
    req.headers.get("x-auth-user-id");
  if (authUserHeader) return authUserHeader;

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(decodeBase64UrlUtf8(parts[1]));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function getClientIp(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim().slice(0, 64);
  }

  const realIp = req.headers.get("x-real-ip");
  return realIp ? realIp.slice(0, 64) : null;
}

function getRateLimitSubject(req: Request, userId: string | null) {
  if (userId) return `user:${userId}`;

  const fingerprint = req.headers.get("x-client-fingerprint")?.trim();
  if (fingerprint) return `fp:${fingerprint.slice(0, 128)}`;

  const ip = getClientIp(req);
  if (ip) return `ip:${ip}`;

  return null;
}

async function checkRateLimit(subject: string) {
  if (!supabaseAdmin) return false;

  const { data, error } = await supabaseAdmin.rpc("check_request_rate_limit", {
    p_subject: subject,
    p_endpoint: "log-client-error",
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    p_max_requests: RATE_LIMIT_MAX_REQUESTS,
  });

  if (error) {
    console.error("log-client-error rate-limit rpc error", error);
    return false;
  }

  return data === true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!supabaseAdmin) {
    return jsonResponse({ error: "Server misconfiguration: missing Supabase service role key." }, 500);
  }

  let payloadUnknown: unknown;
  try {
    payloadUnknown = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, 400);
  }

  const parsedPayload = payloadSchema.safeParse(payloadUnknown);
  if (!parsedPayload.success) {
    return jsonResponse({ error: "Invalid payload." }, 400);
  }

  const userId = getUserIdFromRequest(req);
  const subject = getRateLimitSubject(req, userId);
  if (!subject) {
    return jsonResponse({ error: "Missing client identifier." }, 400);
  }

  const withinLimit = await checkRateLimit(subject);
  if (!withinLimit) {
    return jsonResponse({ error: "Rate limit exceeded." }, 429);
  }

  const payload = parsedPayload.data;
  const { error } = await supabaseAdmin.from("error_events").insert({
    source: "frontend",
    level: payload.level,
    message: payload.message,
    stack: payload.stack ?? null,
    context: {
      path: payload.path ?? null,
      userAgent: payload.userAgent ?? null,
      subject,
      ...(payload.context ?? {}),
    },
    user_id: userId,
    request_id: req.headers.get("x-request-id"),
  });

  if (error) {
    console.error("log-client-error insert failed", error);
    return jsonResponse({ error: "Failed to write error event." }, 500);
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
