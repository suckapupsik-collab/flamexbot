import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const APP_URL = "https://flamexbot.pages.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char] ?? char));
}
function formatExpiry(value: string | null) {
  if (!value) return "бессрочно";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
}
async function sendBotMessage(chatId: string, messageText: string) {
  const baseButton: Record<string, unknown> = {
    text: "✦ Открыть FLAMEXBOT",
    web_app: { url: APP_URL },
  };
  let customEmojiId: string | null = null;
  try {
    const emojiId = "5877318502947229960";
    const checkResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/getCustomEmojiStickers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ custom_emoji_ids: [emojiId] }),
      signal: AbortSignal.timeout(8000),
    });
    const checkData = await checkResponse.json();
    if (checkResponse.ok && checkData.ok && Array.isArray(checkData.result)
        && checkData.result.some((item: any) => String(item?.custom_emoji_id) === emojiId)) {
      customEmojiId = emojiId;
    }
  } catch (error) {
    console.warn("Notification button emoji check skipped:", (error as any)?.message ?? error);
  }
  if (customEmojiId) baseButton.icon_custom_emoji_id = customEmojiId;

  const send = async (button: Record<string, unknown>) => {
    const telegramResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text: messageText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[button]] },
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await telegramResponse.json();
    if (!telegramResponse.ok || !data.ok) throw new Error(data.description ?? "Telegram sendMessage failed");
    return data.result;
  };

  try {
    return await send(baseButton);
  } catch (error) {
    if (!customEmojiId) throw error;
    delete baseButton.icon_custom_emoji_id;
    return await send(baseButton);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return response({ error: "Unauthorized" }, 401);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY || !BOT_TOKEN) {
    return response({ error: "Notification service is not configured" }, 503);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.target_user_id ?? "");
    const action = String(body?.action ?? "");
    const badgeCode = String(body?.badge_code ?? "");
    const auditId = String(body?.audit_id ?? "");
    const allowed = new Set([
      "ban", "unban", "verify", "unverify",
      "premium_grant", "premium_revoke", "pro_grant", "pro_revoke",
      "badge_grant", "badge_revoke",
    ]);
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId) || !/^[0-9a-f-]{36}$/i.test(auditId) || !allowed.has(action)) {
      return response({ error: "Invalid notification request" }, 400);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Unauthorized" }, 401);
    const { data: isAdmin, error: adminCheckError } = await userClient.rpc("is_flamexbot_admin");
    if (adminCheckError || isAdmin !== true) return response({ error: "Administrator access required" }, 403);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: audit, error: auditError } = await admin.from("flamexbot_admin_audit")
      .select("id,target_user_id,action").eq("id", auditId).maybeSingle();
    if (auditError) throw auditError;
    if (!audit || audit.target_user_id !== targetUserId || audit.action !== action) {
      return response({ error: "Admin action audit record does not match notification request" }, 403);
    }
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,username,display_name,is_banned,ban_reason")
      .eq("id", targetUserId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return response({ error: "Target account not found" }, 404);
    if (!profile.telegram_id || !/^\d+$/.test(String(profile.telegram_id))) {
      return response({ ok: true, delivered: false, reason: "telegram_not_linked" });
    }

    const displayName = escapeHtml(profile.display_name || profile.username || "пользователь");
    let message = "";
    if (action === "premium_grant" || action === "pro_grant" || action === "premium_revoke" || action === "pro_revoke") {
      const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
        .select("plan,expires_at").eq("user_id", targetUserId).maybeSingle();
      if (subscriptionError) throw subscriptionError;
      const active = Boolean(subscription && ["premium", "pro"].includes(subscription.plan)
        && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now()));
      if (active) {
        const planName = subscription.plan === "pro" ? "🔥 <b>FLAMEX PRO</b>" : "⭐ <b>FLAMEX Premium</b>";
        const perks = subscription.plan === "pro"
          ? "\n• 2 бесплатные прокрутки колеса каждую неделю\n• +10% к относительному шансу редких наград"
          : "\n• 1 бесплатная прокрутка колеса каждую неделю";
        message = "🎉 <b>Тариф твоего аккаунта обновлён!</b>\n\nПривет, " + displayName +
          "!\nТвой текущий тариф: " + planName + "\nСрок действия: <b>" +
          formatExpiry(subscription.expires_at) + "</b>" + perks;
      } else {
        message = "ℹ️ <b>Изменение подписки FLAMEXBOT</b>\n\nПривет, " + displayName +
          "!\nТариф Premium/PRO был снят администрацией. Сейчас у тебя Free.";
      }
    } else if (action === "ban") {
      message = "⛔ <b>Аккаунт FLAMEXBOT заблокирован</b>\n\nПричина: " +
        escapeHtml(profile.ban_reason || "не указана");
    } else if (action === "unban") {
      message = "✅ <b>Доступ к FLAMEXBOT восстановлен</b>\n\nОграничение аккаунта снято администрацией.";
    } else if (action === "verify") {
      message = "🔵 <b>Аккаунт подтверждён</b>\n\nТебе выдана синяя галочка FLAMEXBOT.";
    } else if (action === "unverify") {
      message = "ℹ️ <b>Статус подтверждения изменён</b>\n\nСиняя галочка снята с аккаунта.";
    } else if (action === "badge_grant") {
      const labels: Record<string, string> = {
        founder: "Основатель", developer: "Разработчик", administrator: "Администратор",
        moderator: "Модератор", designer: "Дизайнер", creator: "Создатель",
        supporter: "Поддержка", beta_tester: "Бета-тестер", community_manager: "Комьюнити",
        partner: "Партнёр", verified: "Подтверждён",
      };
      message = "🏷️ <b>Тебе выдан новый значок</b>\n\nЗначок: <b>" +
        escapeHtml(labels[badgeCode] || badgeCode || "роль") + "</b>";
    } else if (action === "badge_revoke") {
      message = "ℹ️ <b>Значок аккаунта изменён</b>\n\nАдминистрация обновила список твоих значков.";
    }

    const claimToken = crypto.randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc("claim_flamexbot_telegram_admin_notification", {
      p_user_id: targetUserId,
      p_audit_id: auditId,
      p_claim_token: claimToken,
    });
    if (claimError) throw claimError;
    const notification = claimed?.[0];
    if (!notification) {
      const { data: existingNotice, error: existingNoticeError } = await admin.from("notifications")
        .select("telegram_delivered_at,telegram_delivery_claimed_at")
        .eq("user_id", targetUserId).contains("data", { audit_id: auditId }).maybeSingle();
      if (existingNoticeError) throw existingNoticeError;
      if (existingNotice?.telegram_delivered_at) return response({ ok: true, delivered: true, already_delivered: true });
      if (existingNotice) return response({ ok: true, delivered: false, reason: "notification_queued" });
      return response({ error: "Admin notification record was not created" }, 409);
    }

    try {
      await sendBotMessage(String(profile.telegram_id), message);
    } catch (error) {
      const reason = String((error as any)?.message ?? error);
      const outcomeUnknown = error instanceof TypeError || /timeout|timed out|network|connection reset|aborted/i.test(reason);
      if (!outcomeUnknown) {
        const { error: releaseError } = await admin.rpc("release_flamexbot_telegram_notification_claims", {
          p_claim_token: claimToken,
        });
        if (releaseError) console.warn("Could not release admin notification claim:", releaseError.message);
      }
      console.warn("FLAMEXBOT notification delivery skipped:", reason);
      return response({
        ok: true,
        delivered: false,
        reason: /blocked|chat not found|can't initiate|not enough rights/i.test(reason)
          ? "bot_not_started_or_blocked" : "telegram_unavailable",
      });
    }

    const { data: marked, error: markError } = await admin.rpc("mark_flamexbot_telegram_notification_delivered", {
      p_notification_id: notification.notification_id,
      p_claim_token: claimToken,
    });
    if (markError || marked !== true) {
      console.warn("Could not confirm admin notification delivery:", markError?.message ?? "claim token no longer owns notification");
    }
    return response({ ok: true, delivered: true, delivery_marked: marked === true });
  } catch (error) {
    console.error("flamexbot-user-notify:", (error as any)?.message ?? error);
    return response({ error: (error as any)?.message ?? "Could not send bot notification" }, 500);
  }
});