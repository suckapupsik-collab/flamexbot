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
    timeZone: "Europe/Helsinki",
  });
}
async function sendBotMessage(chatId: string, messageText: string) {
  const telegramResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(chatId),
      text: messageText,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "✦ Открыть FLAMEXBOT", web_app: { url: APP_URL } }]] },
    }),
    signal: AbortSignal.timeout(12000),
  });
  const data = await telegramResponse.json();
  if (!telegramResponse.ok || !data.ok) throw new Error(data.description ?? "Telegram sendMessage failed");
  return data.result;
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
    const allowed = new Set([
      "ban", "unban", "verify", "unverify",
      "premium_grant", "premium_revoke", "pro_grant", "pro_revoke",
      "badge_grant", "badge_revoke",
    ]);
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId) || !allowed.has(action)) {
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

    try {
      await sendBotMessage(String(profile.telegram_id), message);
      return response({ ok: true, delivered: true });
    } catch (error) {
      const reason = String((error as any)?.message ?? error);
      console.warn("FLAMEXBOT notification delivery skipped:", reason);
      return response({
        ok: true,
        delivered: false,
        reason: /blocked|chat not found|can't initiate|not enough rights/i.test(reason)
          ? "bot_not_started_or_blocked" : "telegram_unavailable",
      });
    }
  } catch (error) {
    console.error("flamexbot-user-notify:", (error as any)?.message ?? error);
    return response({ error: (error as any)?.message ?? "Could not send bot notification" }, 500);
  }
});