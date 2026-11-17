import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return respond({ error: "Требуется вход в FLAMEXBOT." }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!url || !anon || !service || !botToken) return respond({ error: "Реферальный сервис не настроен." }, 503);

  try {
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return respond({ error: "Сессия недействительна." }, 401);

    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned,ban_reason").eq("id", authData.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.telegram_id) return respond({ error: "Сначала привяжи Telegram." }, 400);
    if (profile.is_banned) return respond({ error: profile.ban_reason || "Аккаунт заблокирован." }, 403);

    let { data: existing, error: codeError } = await admin.from("flamexbot_referral_codes")
      .select("code").eq("user_id", profile.id).maybeSingle();
    if (codeError) throw codeError;
    if (!existing?.code) {
      let saved = false;
      for (let attempt = 0; attempt < 4 && !saved; attempt++) {
        const bytes = crypto.getRandomValues(new Uint8Array(5));
        const code = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
        const { error } = await admin.from("flamexbot_referral_codes").insert({ user_id: profile.id, code });
        if (!error) { existing = { code }; saved = true; }
        else if (!String(error.code || "").startsWith("23")) throw error;
      }
      if (!existing?.code) {
        const { data, error } = await admin.from("flamexbot_referral_codes").select("code").eq("user_id", profile.id).single();
        if (error) throw error;
        existing = data;
      }
    }

    const meResponse = await fetch("https://api.telegram.org/bot" + botToken + "/getMe");
    const me = await meResponse.json();
    if (!meResponse.ok || !me.ok || !me.result?.username) throw new Error(me.description || "Не удалось определить имя Telegram-бота.");
    const link = "https://t.me/" + me.result.username + "?start=ref_" + encodeURIComponent(existing.code);
    return respond({ ok: true, code: existing.code, bot_username: me.result.username, link });
  } catch (error) {
    console.error("flamexbot-referral-link:", error?.message ?? error);
    return respond({ error: error?.message || "Не удалось создать реферальную ссылку." }, 500);
  }
});