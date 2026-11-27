import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FOUNDER_TELEGRAM_ID = "7781170049";
const WEBHOOK_URL = "https://yxmfhnbqzudoiwjlrpui.supabase.co/functions/v1/flamexbot-bot";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return response({ error: "Telegram webhook is not configured" }, 503);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return response({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("telegram_id,is_banned").eq("id", authData.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.is_banned) return response({ error: "Account is blocked" }, 403);
    if (String(profile?.telegram_id ?? "") !== FOUNDER_TELEGRAM_ID) {
      return response({ error: "Only the FLAMEXBOT founder can configure the Telegram webhook" }, 403);
    }

    const { data: webhookSecret, error: webhookSecretError } = await admin.rpc(
      "get_flamexbot_telegram_webhook_secret",
    );
    if (webhookSecretError || typeof webhookSecret !== "string" || webhookSecret.length < 32 || webhookSecret.length > 256) {
      throw new Error("Could not read the Telegram webhook secret from Vault");
    }

    const telegramResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/setWebhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        secret_token: webhookSecret,
        allowed_updates: ["message", "callback_query", "pre_checkout_query", "business_connection", "business_message", "edited_business_message", "deleted_business_messages"],
        drop_pending_updates: false,
      }),
    });
    const result = await telegramResponse.json();
    if (!telegramResponse.ok || !result.ok) throw new Error(result.description ?? "Telegram webhook setup failed");
    const { error: retireError } = await admin.rpc("retire_flamexbot_telegram_webhook_legacy_secret");
    if (retireError) console.warn("Legacy Telegram webhook token retirement skipped:", retireError.message);
    else console.info("FLAMEXBOT_TELEGRAM_WEBHOOK_SECRET_ROTATED_FROM_VAULT");
    return response({
      ok: true,
      configured: true,
      allowed_updates: ["message", "callback_query", "pre_checkout_query", "business_connection", "business_message", "edited_business_message", "deleted_business_messages"],
    });
  } catch (error) {
    console.error("setup-flamexbot-webhook:", error?.message ?? error);
    return response({ error: "Could not configure Telegram webhook" }, 502);
  }
});
