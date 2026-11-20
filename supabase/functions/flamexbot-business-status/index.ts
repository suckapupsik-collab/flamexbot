import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json({ error: "Требуется авторизация FLAMEXBOT." }, 401);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
    return json({ error: "Сервис проверки Telegram Business не настроен." }, 503);
  }

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Сессия FLAMEXBOT недействительна." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,telegram_id,is_banned")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.is_banned) return json({ error: "Аккаунт недоступен." }, 403);
    if (!profile.telegram_id) {
      return json({ ok: true, live: true, connected: false, rights: {}, reason: "telegram_not_linked" });
    }

    const telegramId = String(profile.telegram_id);
    const { data: connection, error: connectionError } = await admin
      .from("flamexbot_business_connections")
      .select("connection_id,telegram_user_id,profile_id,is_enabled,rights,connected_at,updated_at")
      .eq("telegram_user_id", telegramId)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.connection_id) {
      return json({ ok: true, live: true, connected: false, rights: {}, reason: "not_connected" });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getBusinessConnection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_connection_id: connection.connection_id }),
        signal: AbortSignal.timeout(9000),
      },
    );
    const telegramData = await telegramResponse.json().catch(() => ({}));
    if (!telegramResponse.ok || telegramData?.ok !== true) {
      const description = String(telegramData?.description ?? "");
      if (Number(telegramData?.error_code) === 400 && /business connection|connection/i.test(description)) {
        const { error: updateError } = await admin
          .from("flamexbot_business_connections")
          .update({ is_enabled: false, rights: {}, profile_id: authData.user.id, updated_at: new Date().toISOString() })
          .eq("telegram_user_id", telegramId);
        if (updateError) throw updateError;
        return json({ ok: true, live: true, connected: false, rights: {}, reason: "connection_invalid" });
      }
      console.warn("Telegram Business live status failed:", description || telegramResponse.status);
      return json({ error: "Telegram временно не смог подтвердить подключение. Попробуй ещё раз." }, 502);
    }

    const live = telegramData.result ?? {};
    if (String(live.user?.id ?? "") !== telegramId) {
      return json({ error: "Telegram вернул подключение для другого аккаунта." }, 409);
    }

    const connected = live.is_enabled === true;
    const rights = live.rights && typeof live.rights === "object" ? live.rights : {};
    const connectedAt = live.date ? new Date(Number(live.date) * 1000).toISOString() : connection.connected_at;
    const { error: updateError } = await admin
      .from("flamexbot_business_connections")
      .update({
        profile_id: authData.user.id,
        is_enabled: connected,
        rights,
        connected_at: connectedAt,
        updated_at: new Date().toISOString(),
        ...(live.user_chat_id != null ? { user_chat_id: String(live.user_chat_id) } : {}),
      })
      .eq("telegram_user_id", telegramId);
    if (updateError) throw updateError;

    return json({
      ok: true,
      live: true,
      connected,
      rights,
      connected_at: connectedAt ?? null,
      reason: connected ? "connected" : "disabled",
    });
  } catch (error) {
    console.error("flamexbot-business-status:", (error as Error)?.message ?? error);
    return json({ error: "Не удалось проверить Telegram Business. Попробуй ещё раз." }, 500);
  }
});
