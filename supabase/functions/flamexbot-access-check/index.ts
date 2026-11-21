import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REQUIRED_CHANNEL = "@flamexbot1";

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
  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 300) {
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
      throw new Error("Добавьте бота FLAMEXBOT администратором канала @flamexbot1, чтобы он мог проверять подписку.");
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
    const telegramUserId = await getTelegramUser(typeof body?.initData === "string" ? body.initData : "");
    const subscribed = await checkSubscription(telegramUserId);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,is_banned").eq("telegram_id", telegramUserId).maybeSingle();
    if (profileError) throw profileError;

    let sessionMatches: boolean | null = null;
    const authorization = req.headers.get("Authorization") ?? "";
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (bearer) {
      const { data: authData, error: authError } = await admin.auth.getUser(bearer);
      if (authError || !authData.user) return json({ ok: false, reason: "invalid_session", error: "Сессия FLAMEXBOT недействительна." }, 401);
      sessionMatches = Boolean(profile && profile.id === authData.user.id);
    }

    if (!subscribed) {
      return json({
        ok: true, subscribed: false, registered: Boolean(profile),
        session_matches: sessionMatches, reason: "subscription_required",
        channel: REQUIRED_CHANNEL, subscribe_url: "https://t.me/flamexbot1",
      });
    }
    if (profile?.is_banned) {
      return json({ ok: true, subscribed: true, registered: true, session_matches: sessionMatches, reason: "banned" }, 403);
    }
    if (!profile) {
      return json({
        ok: true, subscribed: true, registered: false, session_matches: sessionMatches,
        reason: "registration_required", channel: REQUIRED_CHANNEL,
      });
    }
    if (sessionMatches === false) {
      return json({
        ok: true, subscribed: true, registered: true, session_matches: false,
        reason: "account_mismatch",
      });
    }
    return json({
      ok: true, subscribed: true, registered: true, session_matches: sessionMatches,
      reason: "allowed",
    });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const status = /подпись|устарели|некорректные данные|не передал|определить Telegram/i.test(message) ? 401 : 503;
    console.error("flamexbot-access-check:", message);
    return json({ ok: false, reason: "membership_check_unavailable", error: message }, status);
  }
});
