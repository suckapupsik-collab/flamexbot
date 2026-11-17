import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const PREMIUM_PRICE_STARS = 100;
const PERIOD_DAYS = 30;
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
  if (!token) return response({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body?.plan === "pro") return response({ error: "Тариф PRO упразднён. Все его функции входят в Premium." }, 410);
  const plan = "premium";
  const priceStars = PREMIUM_PRICE_STARS;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY || !BOT_TOKEN) {
    return response({ error: "Payment service is not configured" }, 503);
  }

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned,ban_reason").eq("id", authData.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.is_banned) return response({
      error: profile.ban_reason || "Этот аккаунт заблокирован администрацией FLAMEXBOT.",
    }, 403);
    if (!profile?.telegram_id) return response({
      error: "Сначала привяжи Telegram в профиле FLAMEXBOT.",
    }, 400);

    const { data: current, error: subscriptionError } = await admin.from("user_subscriptions")
      .select("plan,expires_at").eq("user_id", authData.user.id).maybeSingle();
    if (subscriptionError) throw subscriptionError;
    const currentIsActive = Boolean(current && (!current.expires_at || new Date(current.expires_at).getTime() > Date.now()));
    const currentIsLifetime = Boolean(current && !current.expires_at
      && ["premium","pro"].includes(current.plan));
    if (currentIsLifetime) {
      return response({ error: "У тебя уже бессрочный тариф — покупка не требуется." }, 409);
    }

    const payload = "flamexbot_" + plan + ":" + authData.user.id + ":" + crypto.randomUUID();
    const title = plan === "pro" ? "FLAMEXBOT PRO" : "FLAMEXBOT Premium";
    const description = "FLAMEXBOT Premium на 30 дней: все возможности прежнего PRO, 2 еженедельные прокрутки колеса, +10% к весам редких наград, экспорт переписки и Premium-инструменты.";
    const invoiceLink = await telegram("createInvoiceLink", {
      title,
      description,
      payload,
      currency: "XTR",
      prices: [{ label: "Premium · 30 дней", amount: priceStars }],
    });
    return response({
      ok: true,
      plan,
      invoice_link: invoiceLink,
      price_stars: priceStars,
      period_days: PERIOD_DAYS,
    });
  } catch (error) {
    console.error("create-premium-invoice:", error?.message ?? error);
    return response({ error: error?.message ?? "Не удалось создать счёт" }, 500);
  }
});
