import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REQUIRED_CHANNEL = "@flamexbot1";
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

async function hmac(keyBytes: Uint8Array, message: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function getTelegramUser(initData: string) {
  if (!BOT_TOKEN) throw new Error("Telegram-проверка не настроена.");
  if (!initData || initData.length > 16_384) throw new Error("Некорректные данные Telegram Mini App.");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) throw new Error("Подпись Telegram отсутствует.");
  const pairs: string[] = [];
  params.forEach((value, key) => { if (key !== "hash") pairs.push(key + "=" + value); });
  pairs.sort();
  const secretKey = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const expected = hex(await hmac(secretKey, pairs.join("\n")));
  if (!constantTimeEqual(expected, receivedHash.toLowerCase())) throw new Error("Подпись Telegram недействительна.");
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 300 || now - authDate > INIT_DATA_MAX_AGE_SECONDS) {
    throw new Error("Данные Telegram устарели. Закрой и заново открой Mini App.");
  }
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram не передал пользователя Mini App.");
  let user: { id?: number };
  try { user = JSON.parse(rawUser); } catch { throw new Error("Данные Telegram повреждены."); }
  if (!Number.isSafeInteger(user.id) || !user.id) throw new Error("Не удалось определить Telegram-пользователя.");
  return String(user.id);
}
async function checkSubscription(telegramUserId: string) {
  const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/getChatMember", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: REQUIRED_CHANNEL, user_id: Number(telegramUserId) }),
    signal: AbortSignal.timeout(9000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    const description = String(payload?.description ?? "");
    console.error("flamexbot-access-check Telegram error:", description || response.status);
    if (/chat not found|not enough rights|administrator/i.test(description)) {
      throw new Error("Бот не может проверить канал. Убедись, что FLAMEXBOT — администратор @flamexbot1.");
    }
    throw new Error("Telegram временно не смог проверить подписку. Попробуй ещё раз.");
  }
  const member = payload.result ?? {};
  return ["creator", "administrator", "member"].includes(String(member.status ?? "")) ||
    (member.status === "restricted" && member.is_member === true);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BOT_TOKEN) {
    return json({ ok: false, reason: "configuration_error", error: "Сервис обязательной подписки не настроен." }, 503);
  }
  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // An authenticated Mini App session is the stable identity for repeat checks.
    // Do not re-verify old initData on every route change: Telegram initData is issued at launch
    // and can be older than a few minutes while the user is still using the same app session.
    const authorization = req.headers.get("Authorization") ?? "";
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    let telegramUserId: string;
    let profile: { id: string; telegram_id: string | null; is_banned: boolean | null } | null = null;
    let sessionMatches: boolean | null = null;

    if (bearer) {
      const { data: authData, error: authError } = await admin.auth.getUser(bearer);
      if (authError || !authData.user) {
        return json({ ok: false, reason: "invalid_session", error: "Сессия FLAMEXBOT истекла. Войди через Telegram ещё раз." }, 401);
      }
      const { data, error } = await admin.from("profiles")
        .select("id,telegram_id,is_banned").eq("id", authData.user.id).maybeSingle();
      if (error) throw error;
      if (!data?.telegram_id) {
        return json({
          ok: true, subscribed: false, registered: Boolean(data), session_matches: false,
          reason: "telegram_link_required",
          error: "Привяжи Telegram к профилю, чтобы подтвердить подписку и пользоваться Mini App.",
        });
      }
      profile = data;
      telegramUserId = String(data.telegram_id);
      sessionMatches = true;
    } else {
      telegramUserId = await getTelegramUser(typeof body?.initData === "string" ? body.initData : "");
      const { data, error } = await admin.from("profiles")
        .select("id,telegram_id,is_banned").eq("telegram_id", telegramUserId).maybeSingle();
      if (error) throw error;
      profile = data ?? null;
    }

    if (profile?.is_banned) {
      return json({ ok: true, subscribed: true, registered: true, session_matches: sessionMatches, reason: "banned" }, 403);
    }

    const subscribed = await checkSubscription(telegramUserId);
    if (!subscribed) {
      return json({
        ok: true, subscribed: false, registered: Boolean(profile),
        session_matches: sessionMatches, reason: "subscription_required",
        channel: REQUIRED_CHANNEL, subscribe_url: "https://t.me/flamexbot1",
      });
    }
    if (!profile) {
      return json({
        ok: true, subscribed: true, registered: false, session_matches: sessionMatches,
        reason: "registration_required", channel: REQUIRED_CHANNEL,
      });
    }
    return json({
      ok: true, subscribed: true, registered: true, session_matches: sessionMatches,
      reason: "allowed", channel: REQUIRED_CHANNEL,
    });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const invalidInitData = /подпись|устарели|некорректные данные|не передал|определить Telegram/i.test(message);
    const status = invalidInitData ? 401 : 503;
    console.error("flamexbot-access-check:", JSON.stringify({ error: message, status }));
    return json({
      ok: false, reason: invalidInitData ? "invalid_telegram_data" : "membership_check_unavailable",
      error: message,
    }, status);
  }
});
