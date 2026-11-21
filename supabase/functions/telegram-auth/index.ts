import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmac(keyBytes: Uint8Array, message: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function checkRequiredChannel(botToken: string, telegramUserId: string) {
  const response = await fetch("https://api.telegram.org/bot" + botToken + "/getChatMember", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: "@flamexbot1", user_id: Number(telegramUserId) }),
    signal: AbortSignal.timeout(9000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    const description = String(payload?.description ?? "");
    console.error("telegram-auth membership check failed:", description || response.status);
    throw new Error(/chat not found|not enough rights|administrator/i.test(description)
      ? "Не удалось проверить подписку. Добавьте FLAMEXBOT администратором канала @flamexbot1."
      : "Telegram временно не смог проверить подписку. Попробуй ещё раз.");
  }
  const member = payload.result ?? {};
  return ["creator", "administrator", "member"].includes(String(member.status ?? "")) ||
    (member.status === "restricted" && member.is_member === true);
}
async function verifyTelegramInitData(initData: string, botToken: string) {
  if (!initData || initData.length > 16_384) throw new Error("Некорректные данные Telegram.");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) throw new Error("Подпись Telegram отсутствует.");
  const pairs: string[] = [];
  params.forEach((value, key) => { if (key !== "hash") pairs.push(`${key}=${value}`); });
  pairs.sort();
  const secretKey = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const expected = hex(await hmac(secretKey, pairs.join("\n")));
  if (!constantTimeEqual(expected, receivedHash.toLowerCase())) throw new Error("Подпись Telegram недействительна.");
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 300) {
    throw new Error("Данные Telegram устарели. Перезапусти мини-приложение.");
  }
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram не передал данные пользователя.");
  let user: { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string };
  try { user = JSON.parse(rawUser); } catch { throw new Error("Профиль Telegram повреждён."); }
  if (!Number.isSafeInteger(user.id) || !user.id || !user.first_name) throw new Error("Не удалось определить Telegram-пользователя.");
  return user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  // Keep replay protection state isolated per request; Edge isolates handle concurrent requests.
  let admin: any = null;
  let reservedInitHash: string | null = null;
  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) return response({ error: "Сервер Telegram-входа ещё не настроен." }, 503);

    const body = await req.json();
    const initData = typeof body?.initData === "string" ? body.initData : "";
    const user = await verifyTelegramInitData(initData, botToken);
    const subscribed = await checkRequiredChannel(botToken, String(user.id));
    if (!subscribed) {
      return response({
        error: "Для использования FLAMEXBOT подпишись на канал @flamexbot1 и повтори вход.",
        reason: "subscription_required",
      }, 403);
    }
    admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const initHash = await sha256(initData);
    await admin.from("telegram_init_data_uses").delete().lt("used_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const { error: replayError } = await admin.from("telegram_init_data_uses").insert({ init_data_hash: initHash });
    if (replayError) {
      if (replayError.code === "23505") return response({ error: "Эти данные Telegram уже используются. Повтори попытку через несколько секунд." }, 409);
      throw replayError;
    }
    reservedInitHash = initHash;

    const telegramId = String(user.id);
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 80);
    const telegramUsername = user.username || null;
    const photoUrl = user.photo_url || null;
    const profileUpdate = {
      telegram_id: telegramId,
      telegram_username: telegramUsername,
      telegram_photo_url: photoUrl,
      ...(telegramUsername ? { username: telegramUsername } : {}),
      display_name: displayName || "Пользователь Telegram",
      avatar_url: photoUrl,
      updated_at: new Date().toISOString(),
    };
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    let userId: string | null = null;
    let linkedExistingSession = false;

    if (bearer) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data.user) return response({ error: "Сессия FLAMEXBOT недействительна." }, 401);
      userId = data.user.id;
      linkedExistingSession = true;
    } else {
      const { data, error } = await admin.from("profiles").select("id").eq("telegram_id", telegramId).maybeSingle();
      if (error) throw error;
      userId = data?.id || null;
    }

    if (userId) {
      const { data: moderation, error: moderationError } = await admin.from("profiles")
        .select("is_banned,ban_reason").eq("id", userId).maybeSingle();
      if (moderationError) throw moderationError;
      if (moderation?.is_banned) {
        return response({ error: moderation.ban_reason || "Этот аккаунт заблокирован администрацией FLAMEXBOT." }, 403);
      }
      const { error } = await admin.from("profiles").update(profileUpdate).eq("id", userId);
      if (error) {
        if (error.code === "23505") return response({ error: "Этот Telegram уже привязан к другому аккаунту." }, 409);
        throw error;
      }
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: {
          telegram_id: telegramId,
          telegram_username: telegramUsername,
          full_name: displayName || "Пользователь Telegram",
          name: displayName || "Пользователь Telegram",
          avatar_url: photoUrl || "",
          photo_url: photoUrl || "",
        },
      });
    } else {
      const syntheticEmail = `tg-${telegramId}@telegram.flamexbot.invalid`;
      const { data, error } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        password: `${crypto.randomUUID()}-Aa9!`,
        email_confirm: true,
        user_metadata: {
          full_name: displayName || "Пользователь Telegram",
          name: displayName || "Пользователь Telegram",
          avatar_url: photoUrl || "",
          photo_url: photoUrl || "",
          telegram_id: telegramId,
          telegram_username: telegramUsername || "",
        },
      });
      if (error) throw error;
      userId = data.user.id;
      const { error: profileError } = await admin.from("profiles").update({
        ...profileUpdate,
        username: telegramUsername || `tg_${telegramId}`,
      }).eq("id", userId);
      if (profileError) {
        const { error: rollbackError } = await admin.auth.admin.deleteUser(userId);
        if (rollbackError) console.error("telegram-auth: could not roll back incomplete account:", rollbackError.message);
        throw profileError;
      }
    }

    const { data: pendingConnection, error: pendingError } = await admin
      .from("flamexbot_business_connections")
      .select("connection_id,is_enabled,connected_at")
      .eq("telegram_user_id", telegramId)
      .maybeSingle();
    if (pendingError) throw pendingError;
    const { error: businessLinkError } = await admin
      .from("flamexbot_business_connections")
      .update({ profile_id: userId, updated_at: new Date().toISOString() })
      .eq("telegram_user_id", telegramId);
    if (businessLinkError) throw businessLinkError;

    if (pendingConnection?.is_enabled) {
      const { data: existingNotice, error: noticeLookupError } = await admin
        .from("notifications").select("id").eq("user_id", userId).eq("type", "business_connected")
        .contains("data", { connection_id: pendingConnection.connection_id }).limit(1);
      if (noticeLookupError) throw noticeLookupError;
      if (!existingNotice?.length) {
        const { error: noticeError } = await admin.from("notifications").insert({
          user_id: userId, type: "business_connected", title: "Telegram Business подключён",
          body: "Бизнес-аккаунт Telegram успешно связан с FLAMEXBOT.",
          data: { connection_id: pendingConnection.connection_id, connected_at: pendingConnection.connected_at },
        });
        if (noticeError) throw noticeError;
      }
    }

    const telegram = {
      id: telegramId,
      username: telegramUsername,
      first_name: user.first_name,
      last_name: user.last_name || null,
      photo_url: photoUrl,
    };
    if (linkedExistingSession) return response({ linked_existing_session: true, telegram });
    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
    if (authUserError || !authUser.user?.email) throw authUserError || new Error("Не найден email входа аккаунта.");
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink", email: authUser.user.email,
    });
    if (linkError) throw linkError;
    const tokenHash = linkData?.properties?.hashed_token;
    if (!tokenHash) throw new Error("Supabase не вернул одноразовый токен входа.");
    return response({ token_hash: tokenHash, email: authUser.user.email, linked_existing_session: false, telegram });
  } catch (error) {
    if (admin && reservedInitHash) {
      const { error: releaseError } = await admin.from("telegram_init_data_uses")
        .delete().eq("init_data_hash", reservedInitHash);
      if (releaseError) console.error("telegram-auth: could not release failed initData reservation:", releaseError.message);
    }
    console.error("telegram-auth:", error?.message || "unknown error");
    return response({ error: error?.message || "Не удалось выполнить вход через Telegram." }, 400);
  }
});