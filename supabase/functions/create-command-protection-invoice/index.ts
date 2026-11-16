import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const PRICE_STARS = 15;
const PERIOD_DAYS = 5;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

async function telegram(method: string, body: Record<string, unknown>) {
  const result = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await result.json();
  if (!result.ok || !data.ok) throw new Error(data.description ?? ("Telegram API " + method + " failed"));
  return data.result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return response({ error: "Требуется авторизация FLAMEXBOT." }, 401);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY || !BOT_TOKEN) {
    return response({ error: "Сервис оплаты дополнений пока не настроен." }, 503);
  }

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Сессия FLAMEXBOT недействительна." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned,ban_reason,command_protection_expires_at")
      .eq("id", authData.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return response({ error: "Профиль FLAMEXBOT не найден." }, 404);
    if (profile.is_banned) return response({
      error: profile.ban_reason || "Этот аккаунт заблокирован администрацией FLAMEXBOT.",
    }, 403);
    if (!profile.telegram_id) return response({
      error: "Сначала привяжи Telegram в профиле FLAMEXBOT.",
    }, 400);

    const payload = "flamexbot_addon:command_protection:" + profile.id + ":" + crypto.randomUUID();
    const validUntil = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const { error: orderError } = await admin.from("flamexbot_addon_star_payments").insert({
      user_id: profile.id,
      telegram_user_id: String(profile.telegram_id),
      addon_code: "command_protection",
      invoice_payload: payload,
      currency: "XTR",
      total_amount: PRICE_STARS,
      period_days: PERIOD_DAYS,
      status: "pending",
      valid_until: validUntil,
    });
    if (orderError) throw orderError;

    try {
      const invoiceLink = await telegram("createInvoiceLink", {
        title: "Защита от команд",
        description: "Запрет команд FLAMEXBOT на ваш аккаунт на 5 дней.",
        payload,
        currency: "XTR",
        prices: [{ label: "Защита · 5 дней", amount: PRICE_STARS }],
      });
      return response({
        ok: true,
        invoice_link: invoiceLink,
        price_stars: PRICE_STARS,
        period_days: PERIOD_DAYS,
        valid_until: validUntil,
        current_expires_at: profile.command_protection_expires_at ?? null,
      });
    } catch (error) {
      await admin.from("flamexbot_addon_star_payments")
        .update({ status: "failed" }).eq("invoice_payload", payload);
      throw error;
    }
  } catch (error) {
    console.error("create-command-protection-invoice:", error?.message ?? error);
    return response({ error: error?.message ?? "Не удалось создать счёт Telegram Stars." }, 500);
  }
});
