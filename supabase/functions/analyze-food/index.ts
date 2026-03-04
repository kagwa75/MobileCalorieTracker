import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { z } from "https://esm.sh/zod@3.23.8";

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 2_000_000;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

const foodItemSchema = z
  .object({
    food_name: z.string().trim().min(1).max(120),
    quantity: z.coerce.number().finite().min(0).max(100),
    serving_size: z.string().trim().min(1).max(120),
    calories: z.coerce.number().finite().min(0).max(5000),
    protein: z.coerce.number().finite().min(0).max(500),
    carbs: z.coerce.number().finite().min(0).max(1000),
    fat: z.coerce.number().finite().min(0).max(500),
  })
  .strict();

const aiResponseSchema = z
  .object({
    items: z.array(foodItemSchema).max(25),
  })
  .strict();

const requestSchema = z
  .object({
    image: z.string().min(16),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    imageBytes: z.number().int().positive().max(MAX_IMAGE_BYTES).optional(),
  })
  .strict();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function isLocalhostUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

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
  // Supabase may inject authenticated user identifiers after JWT verification.
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

  return "unknown-subject";
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function detectImageMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

async function checkRateLimit(subject: string, endpoint: string) {
  if (!supabaseAdmin) return true;

  const { data, error } = await supabaseAdmin.rpc("check_request_rate_limit", {
    p_subject: subject,
    p_endpoint: endpoint,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    p_max_requests: RATE_LIMIT_MAX_REQUESTS,
  });

  if (error) {
    // Fail open if the rpc is unavailable so valid analysis requests are not blocked.
    console.error("rate-limit rpc error", error);
    return true;
  }

  return data === true;
}

async function logErrorEvent(params: {
  source: string;
  level: "error" | "warning" | "info";
  message: string;
  stack?: string | null;
  context?: Record<string, unknown>;
  userId?: string | null;
}) {
  if (!supabaseAdmin) {
    console.error("error-events disabled: missing SUPABASE_SERVICE_ROLE_KEY");
    return;
  }

  const { error } = await supabaseAdmin.from("error_events").insert({
    source: params.source,
    level: params.level,
    message: params.message,
    stack: params.stack ?? null,
    context: params.context ?? {},
    user_id: params.userId ?? null,
  });

  if (error) {
    console.error("failed to write error event", error);
  }
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

  const userId = getUserIdFromRequest(req);
  const rateLimitSubject = getRateLimitSubject(req, userId);

  try {
    let payloadUnknown: unknown;
    try {
      payloadUnknown = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON payload." }, 400);
    }

    const parsedPayload = requestSchema.safeParse(payloadUnknown);
    if (!parsedPayload.success) {
      return jsonResponse({ error: "Invalid request payload." }, 400);
    }

    const { image, mimeType, imageBytes } = parsedPayload.data;

    const normalizedMimeType = mimeType ?? "image/jpeg";
    if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
      return jsonResponse({ error: "Unsupported image type. Use JPEG, PNG, or WEBP." }, 415);
    }

    if (typeof imageBytes === "number" && imageBytes > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "Image too large. Max 2MB allowed." }, 413);
    }

    let imageRawBytes: Uint8Array;
    try {
      imageRawBytes = base64ToBytes(image);
    } catch {
      return jsonResponse({ error: "Invalid base64 image payload." }, 400);
    }

    if (imageRawBytes.length > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "Image too large. Max 2MB allowed." }, 413);
    }

    const detectedMimeType = detectImageMime(imageRawBytes);
    if (!detectedMimeType) {
      return jsonResponse({ error: "Image content is not a valid JPEG, PNG, or WEBP." }, 400);
    }

    if (detectedMimeType !== normalizedMimeType) {
      return jsonResponse({ error: "Image MIME type does not match image content." }, 400);
    }

    const withinLimit = await checkRateLimit(rateLimitSubject, "analyze-food");
    if (!withinLimit) {
      return jsonResponse(
        {
          error: "Too many analysis requests. Please wait about 60 seconds and try again.",
          code: "app_rate_limited",
          retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
        },
        429,
      );
    }

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openrouter/free";
    const OPENROUTER_SITE_URL = Deno.env.get("OPENROUTER_SITE_URL")?.trim() || "";
    const OPENROUTER_SITE_NAME = Deno.env.get("OPENROUTER_SITE_NAME") || "Calorie Tracker";

    const includeReferer = OPENROUTER_SITE_URL && !isLocalhostUrl(OPENROUTER_SITE_URL);

    if (!OPENROUTER_API_KEY) {
      await logErrorEvent({
        source: "edge.analyze-food",
        level: "error",
        message: "OPENROUTER_API_KEY missing",
        userId,
      });
      return jsonResponse({ error: "AI not configured" }, 500);
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": OPENROUTER_SITE_NAME,
        ...(includeReferer ? { "HTTP-Referer": OPENROUTER_SITE_URL } : {}),
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a nutrition analysis AI. Analyze food photos and return structured data about each food item detected. Be accurate with calorie and macro estimates based on typical serving sizes visible in the photo.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this food photo. Identify each food item, estimate the portion size, and provide calorie and macro information.",
              },
              {
                type: "image_url",
                image_url: { url: `data:${normalizedMimeType};base64,${image}` },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_food_items",
              description: "Report the detected food items with their nutritional information",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        food_name: { type: "string", description: "Name of the food item" },
                        quantity: { type: "number", description: "Number of servings detected" },
                        serving_size: { type: "string", description: "Description of the serving size" },
                        calories: { type: "number", description: "Estimated calories" },
                        protein: { type: "number", description: "Estimated protein in grams" },
                        carbs: { type: "number", description: "Estimated carbs in grams" },
                        fat: { type: "number", description: "Estimated fat in grams" },
                      },
                      required: ["food_name", "quantity", "serving_size", "calories", "protein", "carbs", "fat"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["items"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_food_items" } },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      await logErrorEvent({
        source: "edge.analyze-food",
        level: "error",
        message: "OpenRouter request failed",
        context: {
          status: response.status,
          response: text.slice(0, 1200),
        },
        userId,
      });

      if (response.status === 429) {
        return jsonResponse(
          {
            error: "AI provider is currently rate limited. Please retry shortly.",
            code: "provider_rate_limited",
          },
          429,
        );
      }
      if (response.status === 402) {
        return jsonResponse({ error: "Insufficient OpenRouter credits for selected model." }, 402);
      }
      if (response.status === 401 || response.status === 403) {
        return jsonResponse({ error: "Invalid or unauthorized OpenRouter API key." }, 502);
      }
      return jsonResponse({ error: "AI analysis failed" }, 500);
    }

    const data = await response.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      return jsonResponse({ items: [] });
    }

    let aiArguments: unknown;
    try {
      aiArguments = JSON.parse(toolCall.function.arguments);
    } catch {
      await logErrorEvent({
        source: "edge.analyze-food",
        level: "warning",
        message: "AI returned non-JSON tool arguments",
        context: { toolCall },
        userId,
      });
      return jsonResponse({ error: "Invalid AI output format." }, 502);
    }

    const validatedOutput = aiResponseSchema.safeParse(aiArguments);
    if (!validatedOutput.success) {
      await logErrorEvent({
        source: "edge.analyze-food",
        level: "warning",
        message: "AI output failed schema validation",
        context: {
          issues: validatedOutput.error.issues,
        },
        userId,
      });
      return jsonResponse({ error: "AI output validation failed." }, 502);
    }

    return jsonResponse(validatedOutput.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await logErrorEvent({
      source: "edge.analyze-food",
      level: "error",
      message,
      stack: e instanceof Error ? e.stack : null,
      userId,
    });

    return jsonResponse({ error: message }, 500);
  }
});
