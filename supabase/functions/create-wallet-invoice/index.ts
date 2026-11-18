import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY || !BOT_TOKEN) return reply({ error: "Unauthorized or service unavailable" }, 401);
  try {
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return reply({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const stars = Number(body?.stars);
    if (!Number.isSafeInteger(stars) || stars < 5 || stars > 5000) return reply({ error: "Можно пополнить от 5 до 5000 звёзд за один раз." }, 400);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("profiles").select("id,telegram_id,is_banned").eq("id", auth.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.telegram_id || profile.is_banned) return reply({ error: "Привяжи Telegram к профилю. Заблокированным аккаунтам пополнение недоступно." }, 403);
    const payload = `flamexbot_wallet:${profile.id}:${stars}:${crypto.randomUUID()}`;
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Баланс FLAMEXBOT",
        description: `${stars} Telegram Stars = ${stars * 2} монет FLAMEXBOT.`,
        payload,
        currency: "XTR",
        prices: [{ label: `${stars * 2} монет`, amount: stars }],
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || typeof data.result !== "string") return reply({ error: data.description || "Telegram не смог создать счёт." }, 502);
    return reply({ ok: true, invoice_url: data.result, stars, coins: stars * 2 });
  } catch (error) {
    console.error("create-wallet-invoice:", error?.message ?? error);
    return reply({ error: "Не удалось создать счёт пополнения." }, 500);
  }
});
