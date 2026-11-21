import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = "https://flamexbot.pages.dev";
const FOUNDER_TELEGRAM_ID = "7781170049";
const WEBHOOK_URL = "https://yxmfhnbqzudoiwjlrpui.supabase.co/functions/v1/flamexbot-bot";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "fxbot_whsec_6c2d9a7e4f1b8c3d5a0e7f9b2c4d6a8e";
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
// Safety lock: FLAMEXBOT must never delete messages in connected Business chats.
const ALLOW_BUSINESS_MESSAGE_DELETION = false;
const admin = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

function isFounderTarget(chatId: unknown, userId?: unknown) {
  return String(chatId ?? "") === FOUNDER_TELEGRAM_ID || String(userId ?? "") === FOUNDER_TELEGRAM_ID;
}

async function getTelegramBan(telegramUserId: unknown) {
  if (!admin || telegramUserId == null) return null;
  const { data, error } = await admin.from("profiles")
    .select("is_banned,ban_reason")
    .eq("telegram_id", String(telegramUserId))
    .maybeSingle();
  if (error) throw error;
  return data?.is_banned ? {
    reason: data.ban_reason || "Этот аккаунт заблокирован администрацией FLAMEXBOT.",
  } : null;
}

const answeredCallbackQueries = new Set<string>();
const callbackFeedbackContexts = new Map<string, { chatId: number | string; businessConnectionId?: string }>();
async function telegram(method: string, body: Record<string, unknown>) {
  if (!ALLOW_BUSINESS_MESSAGE_DELETION && ["deleteBusinessMessages", "deleteMessage", "deleteMessages"].includes(method)) {
    console.error("FLAMEXBOT_SAFETY_BLOCKED_MESSAGE_DELETION", JSON.stringify({
      method,
      chat_id: body.chat_id ?? null,
      message_ids: Array.isArray(body.message_ids) ? body.message_ids : (body.message_id != null ? [body.message_id] : []),
      stack: new Error().stack?.split("\n").slice(1, 5),
    }));
    throw new Error("Message deletion is disabled by FLAMEXBOT safety lock");
  }
  if (method === "answerCallbackQuery" && body.callback_query_id != null) {
    const callbackId = String(body.callback_query_id);
    if (answeredCallbackQueries.has(callbackId)) {
      const feedback = String(body.text ?? "").trim();
      if (feedback && !/^(Запрос принят|Функция включена\\.|Функция выключена\\.|Переписка очищена\\.|Удаление отменено\\.)$/i.test(feedback)) {
        const context = callbackFeedbackContexts.get(callbackId);
        if (context) {
          const safeFeedback = feedback.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const notice = tgEmoji("warning") + " <b>" + safeFeedback + "</b>";
          try {
            if (context.businessConnectionId) await sendBusinessReply(context.businessConnectionId, context.chatId, notice, "HTML");
            else await sendRichTelegramMessage(context.chatId, notice, "HTML");
          } catch (feedbackError) { console.warn("Callback feedback delivery failed:", (feedbackError as any)?.message ?? feedbackError); }
        }
      }
      return true;
    }
    answeredCallbackQueries.add(callbackId);
    if (answeredCallbackQueries.size > 500) answeredCallbackQueries.clear();
  }
  let payload: Record<string, unknown> = { ...body };
  const preservePlainEmoji = body.preserve_plain_emoji === true;
  delete payload.preserve_plain_emoji;
  if (!preservePlainEmoji) {
    if (typeof body.text === "string") payload.text = stripStandardEmojiOutsidePremiumTags(body.text);
    if (typeof body.caption === "string") payload.caption = stripStandardEmojiOutsidePremiumTags(body.caption);
  }
  if ((typeof payload.text === "string" && /<tg-emoji/.test(payload.text)) ||
      (typeof payload.caption === "string" && /<tg-emoji/.test(payload.caption))) {
    const availableEmojiIds = await getAvailablePremiumEmojiIds();
    const cleanPremiumMarkup = (value: string) => value.replace(
      /<tg-emoji emoji-id="([0-9]+)">([^<]*)<\/tg-emoji>/g,
      (_match, id, _fallback) => availableEmojiIds.has(String(id)) ? _match : "",
    );
    if (typeof payload.text === "string") payload.text = cleanPremiumMarkup(payload.text);
    if (typeof payload.caption === "string") payload.caption = cleanPremiumMarkup(payload.caption);
  }
  if (body.reply_markup && typeof body.reply_markup === "object") {
    try {
      const available = await getAvailablePremiumEmojiIds();
      const icons: Record<string, keyof typeof PREMIUM_EMOJI> = {
        open: "sparkles", settings: "settings", back: "back", home: "home",
        refresh: "refresh", success: "success", confirm: "success", unlock: "success",
        cancel: "cancel", help: "help", download: "download", export: "download",
        security: "lock", premium: "diamond", star: "star", upload: "upload",
        search: "search", folder: "folder", profile: "user",
      };
      const stripButtonEmoji = (value: string) => value
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
        .replace(/\s{2,}/g, " ").trim();
      const enrich = (rows: unknown) => Array.isArray(rows) ? rows.map((row: any) =>
        Array.isArray(row) ? row.map((button: any) => {
          if (!button || typeof button !== "object") return button;
          const cleanText = typeof button.text === "string" ? stripButtonEmoji(button.text) : button.text;
          const normalizedButton = cleanText !== button.text ? { ...button, text: cleanText || "Открыть" } : { ...button };
          const label = (String(normalizedButton.text ?? "") + " " + String(normalizedButton.callback_data ?? "")).toLowerCase();
          if (!normalizedButton.style) normalizedButton.style =
            /отмен|удалить|заблок|сбросить|ban|delete|cancel|panic_no/i.test(label) ? "danger" :
            /подтверд|да,|сохран|готово|включить|оплат|купить|success|confirm/i.test(label) ? "success" : "primary";
          if (normalizedButton.icon_custom_emoji_id) return normalizedButton;
          const key = /отмен|cancel|закрыть/.test(label) ? "cancel"
            : /назад|back/.test(label) ? "back"
            : /обнов|refresh|повтор/.test(label) ? "refresh"
            : /инструкц|помощ|help|команд|guide/.test(label) ? "help"
            : /экспорт|скач|download/.test(label) ? "download"
            : /настрой|settings/.test(label) ? "settings"
            : /домой|главн|home/.test(label) ? "home"
            : /подтверд|готово|продолж|сохран/.test(label) ? "success"
            : /профил|аккаунт/.test(label) ? "profile"
            : /оплат|stars|звезд/.test(label) ? "star"
            : /premium|тариф/.test(label) ? "diamond"
            : /выключить антимут|выключить мут|размут|unmute/.test(label) ? "unlock"
             : /включить мут|мут|mute/.test(label) ? "lock"
             : /защит|безопас|lock/.test(label) ? "security"
            : /загруз|отправ|upload/.test(label) ? "upload"
            : /поиск|найти|search/.test(label) ? "search"
            : /папк|архив/.test(label) ? "folder"
            : /открыть|запустить|старт|подключ|войти|прилож/.test(label) ? "open"
            : null;
          if (!key) return normalizedButton;
          const emoji = PREMIUM_EMOJI[icons[key] ?? key as keyof typeof PREMIUM_EMOJI];
          return emoji && available.has(emoji.id) ? { ...normalizedButton, icon_custom_emoji_id: emoji.id } : normalizedButton;
        }) : row
      ) : rows;
      const markup = body.reply_markup as Record<string, unknown>;
      const enhanced = { ...markup };
      if (markup.inline_keyboard) enhanced.inline_keyboard = enrich(markup.inline_keyboard);
      if (markup.keyboard) enhanced.keyboard = enrich(markup.keyboard);
      payload = { ...payload, reply_markup: enhanced };
    } catch (error) {
      console.warn("Telegram button emoji enrichment skipped:", (error as any)?.message ?? error);
    }
  }
  payload = sanitizeTelegramPayload(payload);
  const telegramStartedAt = Date.now();
  const response = await fetch(`${API}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(method === "getFile" ? 8000 : 15000),
  });
  const data = await response.json();
  const telegramDurationMs = Date.now() - telegramStartedAt;
  if (telegramDurationMs >= 250) {
    console.log("flamexbot telegram api slow", JSON.stringify({
      method, duration_ms: telegramDurationMs, ok: Boolean(response.ok && data.ok),
      status: response.status,
    }));
  }
  if (!response.ok || !data.ok) {
    const message = String(data.description ?? `Telegram API ${method} failed`);
    if (JSON.stringify(payload) !== JSON.stringify(body)
        && /icon_custom_emoji_id|custom emoji|BUTTON_TYPE_INVALID|BUTTON_DATA_INVALID|keyboard button|button.*invalid/i.test(message)) {
      const fallbackPayload = JSON.parse(JSON.stringify(payload)) as Record<string, any>;
      const fallbackMarkup = fallbackPayload.reply_markup;
      for (const key of ["inline_keyboard", "keyboard"]) {
        if (Array.isArray(fallbackMarkup?.[key])) {
          fallbackMarkup[key] = fallbackMarkup[key].map((row: any) => Array.isArray(row)
            ? row.map((button: any) => {
                if (!button || typeof button !== "object") return button;
                const clean = { ...button };
                delete clean.icon_custom_emoji_id;
                return clean;
              })
            : row);
        }
      }
      const fallbackResponse = await fetch(`${API}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fallbackPayload),
      });
      const fallbackData = await fallbackResponse.json();
      if (!fallbackResponse.ok || !fallbackData.ok) {
        throw new Error(fallbackData.description ?? `Telegram API ${method} failed`);
      }
      return fallbackData.result;
    }
    throw new Error(message);
  }
  return data.result;
}
function explainTelegramSendError(error: unknown) {
  const raw = String((error as any)?.message ?? error ?? "ошибка Telegram API");
  const lower = raw.toLowerCase();
  if (/blocked by the user|bot was blocked|user is deactivated|chat not found|peer_id_invalid/.test(lower)) return "Telegram отклонил отправку: чат недоступен или получатель ограничил сообщения. FLAMEXBOT не может обходить блокировки.";
  if (/business_connection_invalid|business connection.*(invalid|not found|disabled)/.test(lower)) return "Telegram Business-подключение недействительно или отключено. Переподключи его в настройках Telegram.";
  if (/not enough rights|can't write|can_reply|chat_write_forbidden|have no rights/.test(lower)) return "Telegram не разрешил отправку: у Business-подключения нет нужного права или чат недоступен для ответа.";
  if (/too many requests|retry after/.test(lower)) return "Telegram временно ограничил отправку. Подожди и попробуй позже вручную.";
  return `Telegram отклонил отправку: ${raw.slice(0, 220)}`;
}
const PREMIUM_EMOJI: Record<string, { id: string; fallback: string }> = {
  back: { id: "5877536313623711363", fallback: "⬅️" },
  home: { id: "5807868868886009920", fallback: "🏠" },
  success: { id: "5920052658743283381", fallback: "✅" },
  cancel: { id: "5258226313285607065", fallback: "❌" },
  settings: { id: "5258420634785947640", fallback: "⚙️" },
  refresh: { id: "5260687119092817530", fallback: "🔄" },
  trash: { id: "5258130763148172425", fallback: "🗑" },
  diamond: { id: "5807465992363710697", fallback: "💎" },
  star: { id: "5874948844935974490", fallback: "⭐️" },
  lightning: { id: "5843553939672274145", fallback: "⚡️" },
  crown: { id: "5807868868886009920", fallback: "👑" },
  folder: { id: "5875206779196935950", fallback: "📁" },
  document: { id: "5258477770735885832", fallback: "📄" },
  download: { id: "5258336354642697821", fallback: "⬇️" },
  upload: { id: "5260652420052032852", fallback: "⬆️" },
  book: { id: "5258328383183396223", fallback: "📖" },
  search: { id: "5260341314095947411", fallback: "🔍" },
  help: { id: "5258503720928288433", fallback: "❓" },
  warning: { id: "5258474669769497337", fallback: "⚠️" },
  edit: { id: "5839380464116175529", fallback: "✏️" },
  attach: { id: "5260730055880876557", fallback: "📎" },
  lock: { id: "5258476306152038031", fallback: "🔒" },
  unlock: { id: "5258514780469075716", fallback: "🔓" },
  user: { id: "5258362837411045098", fallback: "👤" },
  users: { id: "5258513401784573443", fallback: "👥" },
  card: { id: "5258260149037965799", fallback: "💳" },
  coin: { id: "5258368777350816286", fallback: "🪙" },
  sparkles: { id: "5877318502947229960", fallback: "✨" },
  robot: { id: "5258093637450866522", fallback: "🤖" },
  calendar: { id: "5258105663359294787", fallback: "🗓" },
};
let premiumEmojiCheck: Promise<Set<string>> | null = null;
async function getAvailablePremiumEmojiIds(): Promise<Set<string>> {
  if (!premiumEmojiCheck) {
    premiumEmojiCheck = (async () => {
      try {
        const stickers = await telegram("getCustomEmojiStickers", {
          custom_emoji_ids: Object.values(PREMIUM_EMOJI).map(item => item.id),
        });
        return new Set((Array.isArray(stickers) ? stickers : [])
          .map((sticker: any) => String(sticker?.custom_emoji_id ?? ""))
          .filter(Boolean));
      } catch (error) {
        console.warn("Premium emoji validation unavailable; using standard emoji:", (error as any)?.message ?? error);
        return new Set<string>();
      }
    })();
  }
  return premiumEmojiCheck;
}
function tgEmoji(name: keyof typeof PREMIUM_EMOJI, fallback?: string) {
  const item = PREMIUM_EMOJI[name] ?? PREMIUM_EMOJI.sparkles;
  return `<tg-emoji emoji-id="${item.id}">${fallback ?? item.fallback}</tg-emoji>`;
}
function normalizeTelegramText(value: string) {
  return value.replace(/\\n/g, "\n").replace(/(^|\s)\/n(?=\s|$)/g, "$1\n");
}
function stripStandardEmojiOutsidePremiumTags(value: string) {
  const normalized = normalizeTelegramText(value);
  return normalized.split(/(<tg-emoji[^>]*>[^<]*<\/tg-emoji>)/g).map(part =>
    part.startsWith("<tg-emoji ") ? part : part.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
  ).join("");
}
function sanitizeTelegramUtf8(value: string): string {
  return Array.from(value).map(char => {
    const point = char.codePointAt(0) ?? 0;
    return point >= 0xD800 && point <= 0xDFFF ? "\uFFFD" : char;
  }).join("");
}
function sanitizeTelegramPayload(value: any): any {
  if (typeof value === "string") return sanitizeTelegramUtf8(value);
  if (Array.isArray(value)) return value.map(sanitizeTelegramPayload);
  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) clean[key] = sanitizeTelegramPayload(item);
    return clean;
  }
  return value;
}
function truncateTelegramText(value: unknown, max: number): string {
  return Array.from(sanitizeTelegramUtf8(String(value ?? "")).normalize("NFC")).slice(0, max).join("");
}
async function sendRichTelegramMessage(
  chatId: number | string,
  body: string,
  parseMode?: string,
  replyMarkup?: Record<string, unknown>,
  connectionId?: string,
  archiveInbox = true,
) {
  const available = await getAvailablePremiumEmojiIds();
  const emojiPattern = new RegExp('<tg-emoji emoji-id="([0-9]+)">([^<]*)</tg-emoji>', 'g');
  const effectiveParseMode = parseMode || "HTML";
  const emojiCleanBody = stripStandardEmojiOutsidePremiumTags(body);
  const sourceBody = parseMode ? emojiCleanBody : emojiCleanBody.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const richBody = effectiveParseMode === "HTML"
    ? sourceBody.split(/(<tg-emoji[^>]*>[^<]*<\/tg-emoji>)/g).map(part => {
        if (part.startsWith("<tg-emoji ")) return part;
        let output = part;
        const known = Object.values(PREMIUM_EMOJI).filter(item => available.has(item.id))
          .sort((a, b) => b.fallback.length - a.fallback.length);
        for (const item of known) {
          output = output.split(item.fallback).join('<tg-emoji emoji-id="' + item.id + '">' + item.fallback + '</tg-emoji>');
        }
        return output;
      }).join("")
    : sourceBody;
  const prepared = richBody.replace(emojiPattern, (_match, id, fallback) =>
    available.has(String(id)) ? '<tg-emoji emoji-id="' + id + '">' + fallback + '</tg-emoji>' : "");
  const payload: Record<string, unknown> = {
    ...(connectionId ? { business_connection_id: connectionId } : {}),
    chat_id: chatId,
    text: prepared,
    ...(effectiveParseMode ? { parse_mode: effectiveParseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };
  try {
    const sent = await telegram("sendMessage", payload);
    if (archiveInbox && !connectionId && admin && /^\d+$/.test(String(chatId)) && sent?.message_id) {
      try {
        const { data: supportChat } = await admin.from("flamexbot_bot_inbox_chats")
          .select("id").eq("telegram_chat_id", String(chatId)).maybeSingle();
        if (supportChat?.id) {
          const readable = String(body).replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, "$1")
            .replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
          const createdAt = new Date((sent.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
          const [archiveResult, chatUpdateResult] = await Promise.all([
            admin.from("flamexbot_bot_inbox_messages").upsert({
              inbox_chat_id: supportChat.id, telegram_message_id: sent.message_id,
              direction: "outgoing", content: readable, message_type: "text", created_at: createdAt,
            }, { onConflict: "inbox_chat_id,telegram_message_id" }),
            admin.from("flamexbot_bot_inbox_chats").update({
              last_message_preview: readable.slice(0, 240), last_message_at: createdAt, updated_at: new Date().toISOString(),
            }).eq("id", supportChat.id),
          ]);
          if (archiveResult.error) throw archiveResult.error;
          if (chatUpdateResult.error) throw chatUpdateResult.error;
        }
      } catch (logError) {
        console.warn("Bot inbox outgoing message archive skipped:", (logError as any)?.message ?? logError);
      }
    }
    return sent;
  } catch (error) {
    const reason = String((error as any)?.message ?? error).toLowerCase();
    if (/<tg-emoji/.test(prepared) && /custom emoji|can't parse entities|unsupported start tag/.test(reason)) {
      const fallbackPattern = new RegExp('<tg-emoji emoji-id="[0-9]+">([^<]*)</tg-emoji>', 'g');
      return await telegram("sendMessage", { ...payload, text: prepared.replace(fallbackPattern, "$1") });
    }
    throw error;
  }
}
async function sendBusinessReply(
  connectionId: string,
  chatId: number | string,
  body: string,
  parseMode?: string,
  replyMarkup?: Record<string, unknown>,
) {
  return sendRichTelegramMessage(chatId, body, parseMode, replyMarkup, connectionId);
}
async function enableBusinessUpdates() {
  await telegram("setWebhook", {
    url: WEBHOOK_URL, secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query", "pre_checkout_query", "business_connection", "business_message", "edited_business_message", "deleted_business_messages"],
    drop_pending_updates: false,
  });
}
let telegramGlobalSetupPromise: Promise<void> | null = null;
const telegramChatMenuSetup = new Map<string, Promise<void>>();

async function ensureTelegramGlobalSetup() {
  if (!telegramGlobalSetupPromise) {
    telegramGlobalSetupPromise = (async () => {
      await Promise.all([
        enableBusinessUpdates(),
        telegram("setMyCommands", {
          scope: { type: "all_private_chats" },
          language_code: "ru",
          commands: [
            { command: "start", description: "Запустить FLAMEXBOT" },
            { command: "app", description: "Открыть Mini App" },
            { command: "ping", description: "Проверить связь с ботом" },
            { command: "status", description: "Статус Telegram Business" },
            { command: "help", description: "Справка и команды" },
            { command: "commands", description: "Список доступных команд" },
            { command: "premium", description: "Купить или продлить Premium" },
            { command: "support", description: "Написать в техподдержку" },
            { command: "cancel_support", description: "Закрыть обращение в поддержку" },
          ],
        }),
      ]);
    })().catch((error) => {
      telegramGlobalSetupPromise = null;
      throw error;
    });
  }
  return telegramGlobalSetupPromise;
}

async function ensureTelegramChatMenuButton(chatId: number | string) {
  const key = String(chatId);
  let pending = telegramChatMenuSetup.get(key);
  if (!pending) {
    pending = telegram("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "web_app", text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } },
    }).then(() => undefined).catch((error) => {
      telegramChatMenuSetup.delete(key);
      throw error;
    });
    telegramChatMenuSetup.set(key, pending);
  }
  return pending;
}

async function saveBusinessConnection(connection: any) {
  if (!admin || !connection?.user?.id || !connection?.id) throw new Error("Business connection payload is incomplete or Supabase service is unavailable");
  const telegramUserId = String(connection.user.id);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id").eq("telegram_id", telegramUserId).maybeSingle();
  if (profileError) throw profileError;
  const { data: previous, error: previousError } = await admin.from("flamexbot_business_connections")
    .select("connection_id,is_enabled,original_first_name,original_last_name,time_name_enabled,reconnected_welcome_pending")
    .eq("telegram_user_id", telegramUserId).maybeSingle();
  if (previousError) throw previousError;
  const enabled = Boolean(connection.is_enabled);
  const shouldNotify = !previous || previous.connection_id !== connection.id || previous.is_enabled !== enabled;
  const { error } = await admin.from("flamexbot_business_connections").upsert({
    telegram_user_id: telegramUserId, profile_id: profile?.id ?? null,
    connection_id: connection.id,
    user_chat_id: connection.user_chat_id != null ? String(connection.user_chat_id) : null,
    is_enabled: enabled, rights: connection.rights ?? {},
    original_first_name: previous?.connection_id === connection.id && previous?.original_first_name
      ? previous.original_first_name : (connection.user.first_name ?? null),
    original_last_name: previous?.connection_id === connection.id && previous?.original_last_name != null
      ? previous.original_last_name : (connection.user.last_name ?? null),
    time_name_enabled: previous?.connection_id === connection.id ? (previous?.time_name_enabled ?? false) : false,
    reconnected_welcome_pending: previous && previous.is_enabled === false && enabled
      ? true : (enabled ? Boolean(previous?.reconnected_welcome_pending) : false),
    connected_at: connection.date ? new Date(connection.date * 1000).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id" });
  if (error) throw error;
  if (profile?.id && shouldNotify) {
    const type = enabled ? "business_connected" : "business_disconnected";
    const title = enabled ? "Telegram Business подключён" : "Telegram Business отключён";
    const body = enabled
      ? "Бизнес-аккаунт Telegram подключён к FLAMEXBOT. Теперь входящие бизнес-переписки могут отображаться в приложении."
      : "Подключение Telegram Business отключено. Получение новых бизнес-сообщений приостановлено.";
    const { error: noticeError } = await admin.from("notifications").insert({
      user_id: profile.id, type, title, body,
      data: { connection_id: connection.id, telegram_user_id: telegramUserId, rights: connection.rights ?? {} },
    });
    if (noticeError) throw noticeError;
    try {
      await sendRichTelegramMessage(Number(telegramUserId),
        `${tgEmoji(enabled ? "success" : "warning")} <b>${title}</b>\n\n${body}`,
        "HTML",
        { inline_keyboard: [[{ text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } }]] },
      );
    } catch (deliveryError) {
      // Telegram does not allow bot DMs before the user starts the bot; keep the in-app notice either way.
      console.warn("Business connection notice could not be sent to bot DM:", (deliveryError as any)?.message ?? deliveryError);
    }
  }
}
function messageContent(message: any) {
  return String(message?.text ?? message?.caption ?? "");
}
function messageMedia(message: any) {
  if (message?.photo?.length) return { type: "photo", fileId: message.photo[message.photo.length - 1].file_id };
  for (const key of ["video", "document", "audio", "voice", "video_note", "animation", "sticker"]) {
    if (message?.[key]?.file_id) return { type: key, fileId: message[key].file_id };
  }
  return { type: "text", fileId: null };
}
function isOwnerAuthoredBusinessMessage(message: any, connection: any) {
  return Boolean(
    message?.from?.id != null &&
    String(message.from.id) === String(connection?.telegram_user_id ?? "") &&
    !message?.sender_business_bot?.id
  );
}
const ANTIMUT_MAX_RESTORES = 1;
async function getActiveAntimutActivation(connection: any, chatId: string | number, messageDateMs: number, expectedActivationAt?: string | null) {
  if (!admin || !connection?.is_enabled || connection?.rights?.can_reply !== true) return null;
  const { data: prefs, error } = await admin.from("flamexbot_business_chat_settings")
    .select("antimut_enabled,antimut_enabled_at")
    .eq("profile_id", connection.profile_id)
    .eq("business_chat_id", chatId)
    .maybeSingle();
  if (error) throw error;
  if (prefs?.antimut_enabled !== true || !prefs.antimut_enabled_at) return null;
  const activationAt = String(prefs.antimut_enabled_at);
  if (expectedActivationAt && activationAt !== expectedActivationAt) return null;
  const activationMs = new Date(activationAt).getTime();
  if (!Number.isFinite(activationMs)) return null;
  // Telegram message.date has one-second precision. Compare at the same precision.
  if (!Number.isFinite(messageDateMs) || messageDateMs < Math.floor(activationMs / 1000) * 1000) return null;
  return activationAt;
}
function buildAntimutRestorePayload(original: any, connectionId: string, chatId: number | string) {
  const media = messageMedia(original);
  const body = String(original?.text ?? original?.caption ?? "").trim();
  const payload: Record<string, unknown> = {
    business_connection_id: connectionId,
    chat_id: chatId,
    preserve_plain_emoji: true,
  };
  let method = "sendMessage";
  if (media.fileId) {
    const map: Record<string, { method: string; field: string }> = {
      photo: { method: "sendPhoto", field: "photo" },
      video: { method: "sendVideo", field: "video" },
      animation: { method: "sendAnimation", field: "animation" },
      document: { method: "sendDocument", field: "document" },
      audio: { method: "sendAudio", field: "audio" },
      voice: { method: "sendVoice", field: "voice" },
      sticker: { method: "sendSticker", field: "sticker" },
      video_note: { method: "sendVideoNote", field: "video_note" },
    };
    const selected = map[media.type];
    if (!selected) return null;
    method = selected.method;
    payload[selected.field] = media.fileId;
    if (body && selected.field !== "sticker" && selected.field !== "video_note") payload.caption = body;
    if (original.caption_entities?.length) payload.caption_entities = original.caption_entities;
  } else if (original?.contact) {
    method = "sendContact";
    Object.assign(payload, {
      phone_number: original.contact.phone_number,
      first_name: original.contact.first_name,
      last_name: original.contact.last_name,
      vcard: original.contact.vcard,
    });
  } else if (original?.location) {
    method = "sendLocation";
    Object.assign(payload, {
      latitude: original.location.latitude,
      longitude: original.location.longitude,
    });
  } else if (body) {
    payload.text = body;
    if (original.entities?.length) payload.entities = original.entities;
  } else {
    return null;
  }
  return { method, payload, media, body };
}
async function sendAntimutRestore(args: {
  original: any;
  originalMessageId: number;
  previousAttempt: number;
  activationAt: string;
  connection: any;
  chatId: string | number;
  businessChatId: string;
  sourceMessageId: number;
}) {
  const { original, originalMessageId, previousAttempt, activationAt, connection, chatId, businessChatId, sourceMessageId } = args;
  if (!admin) throw new Error("Supabase client unavailable during antimut restore");
  const messageDateMs = Number(original?.date) * 1000;
  // Re-read the setting immediately before sending. Disabling or re-enabling antimut
  // invalidates work claimed by an older handler.
  const stillActive = await getActiveAntimutActivation(connection, businessChatId, messageDateMs, activationAt);
  if (!stillActive) {
    console.log("Antimut restore cancelled because the setting is now off or has changed", JSON.stringify({
      chat_id: String(chatId), original_message_id: originalMessageId,
    }));
    return null;
  }
  const nextAttempt = previousAttempt + 1;
  if (nextAttempt > ANTIMUT_MAX_RESTORES) return null;
  const prepared = buildAntimutRestorePayload(original, connection.connection_id, chatId);
  if (!prepared) {
    console.warn("Antimut restore skipped: unsupported or empty message", JSON.stringify({
      chat_id: String(chatId), original_message_id: originalMessageId,
    }));
    return null;
  }
  console.log("Antimut restore sending", JSON.stringify({
    chat_id: String(chatId), original_message_id: originalMessageId, attempt: nextAttempt,
  }));
  let resent: any;
  try {
    resent = await telegram(prepared.method, prepared.payload);
    if (!resent?.message_id) throw new Error("Antimut restore failed: Telegram returned no message id");
  } catch (sendError) {
    const { error: releaseClaimError } = await admin.from("flamexbot_business_messages")
      .update({ antimut_restore_claimed_at: null })
      .eq("business_chat_id", businessChatId).eq("telegram_message_id", sourceMessageId);
    if (releaseClaimError) console.error("Could not release failed antimut restore claim:", releaseClaimError.message);
    throw sendError;
  }
  const sentMedia = resent.photo?.at(-1) ?? resent.video ?? resent.animation ?? resent.document ?? resent.audio ?? resent.voice ?? resent.sticker ?? null;
  const sentAt = new Date((resent.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const { error: saveError } = await admin.from("flamexbot_business_messages").upsert({
    business_chat_id: businessChatId,
    telegram_message_id: resent.message_id,
    direction: "outbound",
    sender_profile_id: connection.profile_id,
    content: resent.text ?? resent.caption ?? prepared.body,
    message_type: prepared.media.type,
    media_file_id: sentMedia?.file_id ?? prepared.media.fileId ?? null,
    media_url: null,
    reply_to_message_id: original.reply_to_message?.message_id ?? null,
    created_at: sentAt,
    raw: {
      ...resent,
      _flamexbot_antimut_resent: true,
      _flamexbot_antimut_attempt: nextAttempt,
      _flamexbot_antimut_activation_at: activationAt,
      _flamexbot_restored_from: originalMessageId,
      _flamexbot_antimut_original_message: original,
    },
  }, { onConflict: "business_chat_id,telegram_message_id" });
  if (saveError) throw saveError;
  console.log("Antimut restore succeeded", JSON.stringify({
    chat_id: String(chatId), original_message_id: originalMessageId,
    restored_message_id: resent.message_id, attempt: nextAttempt,
  }));
  return resent.message_id;
}
const telegramFileInfoCache = new Map<string, { value: any; expiresAt: number }>();
async function getTelegramFileInfo(fileId: string) {
  const cached = telegramFileInfoCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await telegram("getFile", { file_id: fileId });
  telegramFileInfoCache.set(fileId, { value, expiresAt: Date.now() + 15 * 60 * 1000 });
  if (telegramFileInfoCache.size > 300) {
    const first = telegramFileInfoCache.keys().next().value;
    if (first) telegramFileInfoCache.delete(first);
  }
  return value;
}
async function downloadTelegramProfilePhoto(fileId: string) {
  const info = await getTelegramFileInfo(fileId);
  if (!info?.file_path || Number(info.file_size || 0) > 10 * 1024 * 1024) throw new Error("Аватарка отсутствует или превышает лимит 10 МБ.");
  const response = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Не удалось скачать аватарку из Telegram.");
  const blob = await response.blob();
  if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("Размер аватарки недопустим.");
  return blob;
}
async function setBusinessProfilePhotoFromBlob(connectionId: string, blob: Blob, fileName = "profile.jpg") {
  const form = new FormData();
  form.set("business_connection_id", connectionId);
  form.set("photo", JSON.stringify({ type: "static", photo: "attach://profile_photo" }));
  form.set("profile_photo", new File([blob], fileName, { type: "image/jpeg" }));
  const response = await fetch(`${API}/setBusinessAccountProfilePhoto`, { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(String(result.description || "Telegram не принял новую аватарку."));
  return result.result;
}
async function removeBusinessProfilePhoto(connectionId: string) {
  return await telegram("removeBusinessAccountProfilePhoto", { business_connection_id: connectionId });
}

async function archiveBusinessMedia(fileId: string, profileId: string, chatId: string, messageId: number, originalName?: string) {
  try {
    const fileInfo = await telegram("getFile", { file_id: fileId });
    if (!fileInfo?.file_path || (fileInfo.file_size && fileInfo.file_size > 20 * 1024 * 1024)) return null;
    const response = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 20 * 1024 * 1024) return null;
    const fallbackName = fileInfo.file_path.split("/").pop() || `${messageId}.bin`;
    const safeName = (originalName || fallbackName).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
    const storagePath = `${profileId}/${chatId}/in-${messageId}-${safeName}`;
    const { error } = await admin!.storage.from("flamex-business-media").upload(storagePath, blob, {
      contentType: blob.type || "application/octet-stream",
      upsert: true,
    });
    if (error) throw error;
    return storagePath;
  } catch (error) {
    console.warn("Business media archive skipped:", error?.message ?? error);
    return null;
  }
}

async function ensureBusinessConnection(connectionId: string) {
  if (!admin || !connectionId) throw new Error("Business connection id is missing");
  const selectConnection = () => admin.from("flamexbot_business_connections")
    .select("profile_id,telegram_user_id,connection_id,is_enabled,rights")
    .eq("connection_id", connectionId).maybeSingle();
  const { data: existing, error } = await selectConnection();
  if (error) throw error;
  if (existing) return existing;
  // Telegram may deliver business_message without a preceding business_connection update.
  // Resolve and persist it only for this first-message fallback.
  const connection = await telegram("getBusinessConnection", { business_connection_id: connectionId });
  await saveBusinessConnection(connection);
  const { data: saved, error: savedError } = await selectConnection();
  if (savedError) throw savedError;
  return saved;
}
function containsBusinessProfanity(value: string) {
  return /(^|[^а-яёa-z0-9_])(?:бля[а-яё]*|хуй[а-яё]*|хуе[а-яё]*|пизд[а-яё]*|еб[а-яё]*|муд[а-яё]*|сука[а-яё]*|пидор[а-яё]*|fuck[a-z]*|shit[a-z]*|bitch[a-z]*|asshole[a-z]*)(?=$|[^а-яёa-z0-9_])/i.test(value);
}
function calculateBusinessExpression(input: string): number | null {
  const source = String(input ?? "").replace(/\s+/g, "");
  if (!source || source.length > 120 || !/^[0-9.+*\/%()\-]+$/.test(source)) return null;
  let index = 0;
  const parsePrimary = (): number => {
    if (source[index] === "+") { index++; return parsePrimary(); }
    if (source[index] === "-") { index++; return -parsePrimary(); }
    if (source[index] === "(") {
      index++;
      const value = parseExpression();
      if (source[index] !== ")") throw new Error("parenthesis");
      index++;
      return value;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(index));
    if (!match) throw new Error("number");
    index += match[0].length;
    return Number(match[0]);
  };
  const parseTerm = (): number => {
    let value = parsePrimary();
    while (["*", "/", "%"].includes(source[index] ?? "")) {
      const operator = source[index++];
      const right = parsePrimary();
      if ((operator === "/" || operator === "%") && right === 0) throw new Error("zero");
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  };
  const parseExpression = (): number => {
    let value = parseTerm();
    while (source[index] === "+" || source[index] === "-") {
      const operator = source[index++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const result = parseExpression();
    return index === source.length && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}
async function saveBusinessMessage(message: any, connectionOverride?: any, captureOnly = false): Promise<string | null> {
  if (!admin || !message?.business_connection_id || !message?.chat?.id || !message?.message_id) {
    throw new Error("Business message payload is incomplete");
  }
  let connection = connectionOverride;
  if (!connection) {
    const { data, error } = await admin.from("flamexbot_business_connections")
      .select("profile_id,telegram_user_id,connection_id,is_enabled,rights")
      .eq("connection_id", message.business_connection_id).maybeSingle();
    if (error) throw error;
    connection = data;
  }
  if (!connection?.profile_id || !connection.is_enabled) return null;
  const senderId = message.from?.id != null ? String(message.from.id) : null;
  // Telegram explicitly marks messages sent by the connected Business bot.
  // Treat them as outbound even if Message.from is absent or does not match the account owner.
  const sentByBusinessBot = Boolean(message.sender_business_bot?.id);
  const direction = sentByBusinessBot || (senderId && senderId === String(connection.telegram_user_id)) ? "outbound" : "inbound";
  const chatId = String(message.chat.id);
  const sender = direction === "inbound" ? message.from : message.chat;
  const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats").upsert({
    profile_id: connection.profile_id,
    telegram_chat_id: chatId,
    ...(direction === "inbound" && senderId ? { telegram_user_id: senderId } : {}),
    username: sender?.username ?? null,
    first_name: sender?.first_name ?? null,
    last_name: sender?.last_name ?? null,
    business_connection_id: connection.connection_id,
    last_message_at: new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "profile_id,telegram_chat_id" }).select("id").single();
  if (chatError) throw chatError;
  const media = messageMedia(message);
  const content = messageContent(message) || (media.type === "text" ? "" : `[${media.type}]`);
  const originalName = message.document?.file_name ?? message.audio?.file_name ?? message.video?.file_name ?? undefined;
  let mediaUrl: string | null = null; // Archive media only after mute/filter checks.
  const { error: messageError } = await admin.from("flamexbot_business_messages").upsert({
    business_chat_id: chat.id,
    telegram_message_id: message.message_id,
    direction,
    sender_profile_id: direction === "outbound" ? connection.profile_id : null,
    content,
    message_type: media.type,
    media_file_id: media.fileId,
    media_url: mediaUrl,
    reply_to_message_id: message.reply_to_message?.message_id ?? null,
    created_at: new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    raw: message,
  }, { onConflict: "business_chat_id,telegram_message_id" });
  if (messageError) throw messageError;
  if (direction === "outbound") {
    const {error:warnResetError}=await admin.from("flamexbot_business_chat_settings")
      .update({warn_count:0,updated_at:new Date().toISOString()})
      .eq("profile_id",connection.profile_id).eq("business_chat_id",chat.id).eq("warn_enabled",true);
    if(warnResetError)throw warnResetError;
  }
  if (direction === "outbound") {
    // Telegram may deliver deleted_business_messages before business_message.
    // Reconcile the placeholder and restore the owner's message here, otherwise
    // the deletion handler cannot find the message in the archive.
    const placeholder = "[Текст не был сохранён до получения события об удалении]";
    const { data: pendingDeletion, error: pendingDeletionError } = await admin.from("flamexbot_business_message_events")
      .select("id,occurred_at").eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id)
      .eq("event_type", "deleted").eq("original_content", placeholder)
      .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
    if (pendingDeletionError) throw pendingDeletionError;
    if (pendingDeletion) {
      const archivedUrl = media.fileId
        ? await archiveBusinessMedia(media.fileId, connection.profile_id, chat.id, message.message_id, originalName)
        : null;
      const { error: reconcileError } = await admin.from("flamexbot_business_message_events")
        .update({
          original_content: content, message_type: media.type, media_file_id: media.fileId,
          media_url: archivedUrl, original_raw: message,
        }).eq("id", pendingDeletion.id);
      if (reconcileError) throw reconcileError;
      const { error: markLateDeleteError } = await admin.from("flamexbot_business_messages")
        .update({ deleted_at: pendingDeletion.occurred_at })
        .eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id);
      if (markLateDeleteError) throw markLateDeleteError;

      const originalCreatedAt = new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).getTime();
      if (isOwnerAuthoredBusinessMessage(message, connection)) {
        const activationAt = await getActiveAntimutActivation(connection, chat.id, originalCreatedAt);
        if (activationAt) {
          const { data: lateRestoreClaim, error: lateRestoreClaimError } = await admin.from("flamexbot_business_messages")
            .update({ antimut_restore_claimed_at: new Date().toISOString() })
            .eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id)
            .is("antimut_restore_claimed_at", null).select("telegram_message_id").maybeSingle();
          if (lateRestoreClaimError) throw lateRestoreClaimError;
          if (lateRestoreClaim) {
            console.log("Antimut late archive race detected", JSON.stringify({
              chat_id: String(message.chat.id), original_message_id: message.message_id,
            }));
            await sendAntimutRestore({
              original: message,
              originalMessageId: Number(message.message_id),
              previousAttempt: 0,
              activationAt,
              connection,
              chatId: message.chat.id,
              businessChatId: chat.id,
              sourceMessageId: Number(message.message_id),
            });
          }
        }
      }
    }
  }
  if (direction === "inbound") {
    const placeholder = "[Текст не был сохранён до получения события об удалении]";
    const { data: pendingDeletion, error: pendingDeletionError } = await admin.from("flamexbot_business_message_events")
      .select("id,occurred_at").eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id)
      .eq("event_type", "deleted").eq("original_content", placeholder)
      .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
    if (pendingDeletionError) throw pendingDeletionError;
    if (pendingDeletion) {
      const archivedUrl = media.fileId
        ? await archiveBusinessMedia(media.fileId, connection.profile_id, chat.id, message.message_id, originalName)
        : null;
      const { error: reconcileError } = await admin.from("flamexbot_business_message_events")
        .update({
          original_content: content, message_type: media.type, media_file_id: media.fileId,
          media_url: archivedUrl, original_raw: message,
        }).eq("id", pendingDeletion.id);
      if (reconcileError) throw reconcileError;
      const { error: markLateDeleteError } = await admin.from("flamexbot_business_messages")
        .update({ deleted_at: pendingDeletion.occurred_at })
        .eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id);
      if (markLateDeleteError) throw markLateDeleteError;
    }
    if (captureOnly) return chat.id;
    const { data: currentPrefs, error: currentPrefsError } = await admin.from("flamexbot_business_chat_settings")
      .select("is_muted,auto_flood_muted,warn_enabled,warn_threshold,warn_count").eq("profile_id", connection.profile_id).eq("business_chat_id", chat.id).maybeSingle();
    if (currentPrefsError) throw currentPrefsError;
    if(currentPrefs?.warn_enabled&&!currentPrefs?.is_muted&&!currentPrefs?.auto_flood_muted&&!isFounderTarget(chatId)){
      const nextCount=Number(currentPrefs.warn_count||0)+1;
      const threshold=Math.max(2,Number(currentPrefs.warn_threshold||0));
      const reached=nextCount>=threshold;
      const {error:warnUpdateError}=await admin.from("flamexbot_business_chat_settings").update({
        warn_count:reached?0:nextCount,
        ...(reached?{is_muted:true,auto_flood_muted:false,warn_enabled:false}:{}),
        updated_at:new Date().toISOString()
      }).eq("profile_id",connection.profile_id).eq("business_chat_id",chat.id);
      if(warnUpdateError)throw warnUpdateError;
      if(reached){
        try{await sendRichTelegramMessage(connection.telegram_user_id,
          `${tgEmoji("warning")} <b>Автомут по .warn сработал</b>\nСобеседник отправил ${threshold} сообщений подряд. Мут включён в этом диалоге.`,"HTML");}
        catch(notifyError){console.warn("Could not notify owner about .warn automute:",notifyError?.message??notifyError);}
      }
    }
    if (!currentPrefs?.is_muted && !currentPrefs?.auto_flood_muted && senderId && !isFounderTarget(chatId)) {
      const { data: floodData, error: floodError } = await admin.rpc("record_flamexbot_business_flood", {
        p_profile_id: connection.profile_id,
        p_business_chat_id: chat.id,
        p_sender_telegram_id: senderId,
      });
      if (floodError) throw floodError;
      const flood = Array.isArray(floodData) ? floodData[0] : floodData;
      if (flood?.triggered) {
        const { error: autoMuteError } = await admin.from("flamexbot_business_chat_settings").upsert({
          profile_id: connection.profile_id, business_chat_id: chat.id, is_muted: true, auto_flood_muted: true,
        }, { onConflict: "profile_id,business_chat_id" });
        if (autoMuteError) throw autoMuteError;
        const canDeleteIncoming = connection.rights?.can_delete_all_messages === true;
        const notice = `${tgEmoji("warning")} <b>FLAMEXBOT · защита от флуда сработала</b>\nВ этом диалоге получено 10 или более сообщений за 2 секунды.\n${canDeleteIncoming
          ? "Автоматический мут включён, но удаление сообщений отключено защитой FLAMEXBOT."
          : "Диалог помечен мутом; автоматическое удаление сообщений отключено защитой FLAMEXBOT."}\nОткрой FLAMEXBOT и нажми «Размут», когда будешь готов продолжить общение.`;
        try {
          await sendRichTelegramMessage(connection.telegram_user_id, notice, "HTML");
        } catch (notifyError) {
          console.warn("Could not notify business owner about incoming flood:", (notifyError as any)?.message ?? notifyError);
        }
      }
    }
    if (isFounderTarget(chatId)) return;
    const { data: chatPrefs, error: chatSettingsError } = await admin.from("flamexbot_business_chat_settings")
      .select("is_muted,auto_flood_muted,antimut_enabled,afk_enabled,afk_message,autoread_enabled,autotyping_enabled,autovoice_enabled,mutestick_enabled,antimat_enabled")
      .eq("profile_id", connection.profile_id).eq("business_chat_id", chat.id).maybeSingle();
    if (chatSettingsError) throw chatSettingsError;
    const isFounderChat = chatId === FOUNDER_TELEGRAM_ID;
    const hasCommandAutomations = Boolean(
      chatPrefs?.is_muted || chatPrefs?.auto_flood_muted || chatPrefs?.antimut_enabled || chatPrefs?.afk_enabled ||
      chatPrefs?.autoread_enabled || chatPrefs?.autotyping_enabled || chatPrefs?.autovoice_enabled ||
      chatPrefs?.mutestick_enabled || chatPrefs?.antimat_enabled
    );
    if (hasCommandAutomations && !chatPrefs?.auto_flood_muted && connection.telegram_user_id !== FOUNDER_TELEGRAM_ID) {
      const { data: targetProtection, error: targetProtectionError } = await admin.from("profiles")
        .select("command_protection_expires_at,command_protection_disabled").eq("telegram_id", chatId).maybeSingle();
      if (targetProtectionError) throw targetProtectionError;
      const protectedUntil = targetProtection?.command_protection_expires_at
        ? new Date(targetProtection.command_protection_expires_at).getTime() : 0;
      if (protectedUntil > Date.now() && targetProtection?.command_protection_disabled !== true) return;
    }
    const shouldHardMute = !isFounderChat && Boolean(chatPrefs?.is_muted || chatPrefs?.auto_flood_muted);
    const shouldDeleteSticker = media.type === "sticker" && Boolean(chatPrefs?.mutestick_enabled);
    const shouldDeleteProfanity = Boolean(chatPrefs?.antimat_enabled) && containsBusinessProfanity(content);
    const shouldFilter = shouldDeleteSticker || shouldDeleteProfanity;
    // HARD SAFETY: moderation may delete incoming messages only; never delete messages authored by the connected Business account owner.
    // Never delete outgoing messages: Telegram's sender_business_bot marks messages sent by this Business bot.
    if (ALLOW_BUSINESS_MESSAGE_DELETION && direction === "inbound" && !message.sender_business_bot?.id && senderId !== String(connection.telegram_user_id) && (shouldHardMute || shouldFilter)) {
      if (connection.rights?.can_delete_all_messages) {
        try {
          await telegram("deleteBusinessMessages", {
            business_connection_id: connection.connection_id,
            chat_id: String(message.chat.id),
            message_ids: [message.message_id],
          });
          const deletedAt = new Date().toISOString();
          const [eventResult,markDeletedResult] = await Promise.all([
            admin.from("flamexbot_business_message_events").upsert({
              profile_id: connection.profile_id, business_chat_id: chat.id, telegram_message_id: message.message_id,
              event_type: "deleted", original_content: content, message_type: media.type,
              media_file_id: media.fileId, media_url: null, original_raw: message, occurred_at: deletedAt,
            }, { onConflict: "business_chat_id,telegram_message_id,event_type,occurred_at", ignoreDuplicates: true }),
            admin.from("flamexbot_business_messages").update({ deleted_at: deletedAt })
              .eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id)
          ]);
          if (eventResult.error) throw eventResult.error;
          if (markDeletedResult.error) throw markDeletedResult.error;
          // Delete first so Telegram removal is not delayed by file downloads.
          // Preserve media in the archive afterwards for the deleted-message page.
          if (media.fileId) {
            try {
              const archivedUrl = await archiveBusinessMedia(media.fileId, connection.profile_id, chat.id, message.message_id, originalName);
              if (archivedUrl) {
                const { error: mediaEventError } = await admin.from("flamexbot_business_message_events")
                  .update({ media_url: archivedUrl })
                  .eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id).eq("event_type", "deleted").eq("occurred_at", deletedAt);
                if (mediaEventError) throw mediaEventError;
              }
            } catch (mediaError) {
              console.warn("Deleted Business media archive skipped:", mediaError?.message ?? mediaError);
            }
          }
          return;
        } catch (deleteError) {
          console.warn("Business incoming message deletion failed:", deleteError?.message ?? deleteError);
        }
      } else {
        console.warn("Mute/filter is enabled but can_delete_all_messages permission is missing");
      }
      if (shouldHardMute) return;
    }
    if (media.fileId) {
      mediaUrl = await archiveBusinessMedia(media.fileId, connection.profile_id, chat.id, message.message_id, originalName);
      if (mediaUrl) {
        const { error: mediaUpdateError } = await admin.from("flamexbot_business_messages")
          .update({ media_url: mediaUrl }).eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id);
        if (mediaUpdateError) throw mediaUpdateError;
      }
    }
    if (!shouldHardMute && !(shouldFilter && connection.rights?.can_delete_all_messages)) {
      const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || "Новый контакт";
      const preview = content ? content.slice(0, 180) : `Получено сообщение: ${media.type}`;
      const { error: noticeError } = await admin.from("notifications").insert({
        user_id: connection.profile_id,
        type: "business_message",
        title: `Сообщение от ${senderName}`,
        body: preview,
        data: { business_chat_id: chat.id, telegram_chat_id: chatId, telegram_message_id: message.message_id },
      });
      if (noticeError) throw noticeError;
    }
    if (chatPrefs?.autoread_enabled) {
      try { await telegram("readBusinessMessage", { business_connection_id: connection.connection_id, chat_id: Number(chatId), message_id: message.message_id }); }
      catch (error) { console.warn("Business auto-read skipped:", error?.message ?? error); }
    }
    if (chatPrefs?.autovoice_enabled || chatPrefs?.autotyping_enabled) {
      try { await telegram("sendChatAction", { business_connection_id: connection.connection_id, chat_id: Number(chatId), action: chatPrefs.autovoice_enabled ? "record_voice" : "typing" }); }
      catch (error) { console.warn("Business chat action skipped:", error?.message ?? error); }
    }
    if (chatPrefs?.afk_enabled) {
      const { data: lastReply, error: lastReplyError } = await admin.from("flamexbot_business_chat_settings")
        .select("last_afk_reply_at").eq("profile_id", connection.profile_id).eq("business_chat_id", chat.id).maybeSingle();
      if (lastReplyError) throw lastReplyError;
      const lastAt = lastReply?.last_afk_reply_at ? new Date(lastReply.last_afk_reply_at).getTime() : 0;
      if (Date.now() - lastAt > 60 * 60 * 1000) {
        await telegram("sendMessage", { business_connection_id: connection.connection_id, chat_id: Number(chatId), text: `🌙 Автоответ: ${chatPrefs.afk_message || "Сейчас отошёл, отвечу позже."}` });
        const { error: markError } = await admin.from("flamexbot_business_chat_settings").upsert({
          profile_id: connection.profile_id, business_chat_id: chat.id, last_afk_reply_at: new Date().toISOString(),
        }, { onConflict: "profile_id,business_chat_id" });
        if (markError) throw markError;
      }
    }
  }
}
async function updateBusinessMessage(message: any) {
  if (!admin || !message?.business_connection_id || !message?.chat?.id || !message?.message_id) return;
  const { data: connection, error } = await admin.from("flamexbot_business_connections").select("profile_id,telegram_user_id").eq("connection_id", message.business_connection_id).maybeSingle();
  if (error) throw error; if (!connection?.profile_id) return;
  const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats").select("id").eq("profile_id", connection.profile_id).eq("telegram_chat_id", String(message.chat.id)).maybeSingle();
  if (chatError) throw chatError; if (!chat) return;
  const { data: existing, error: existingError } = await admin.from("flamexbot_business_messages").select("direction,content,message_type,media_file_id,media_url,raw").eq("business_chat_id", chat.id).eq("telegram_message_id", message.message_id).maybeSingle();
  if (existingError) throw existingError;
  const editAt = message.edit_date ? new Date(Number(message.edit_date) * 1000).toISOString() : new Date().toISOString();
  {
    const originalRaw=existing?.raw??{};
    const originalName=originalRaw.document?.file_name??originalRaw.audio?.file_name??originalRaw.video?.file_name??undefined;
    const originalMediaUrl=existing?.media_url||(existing?.media_file_id
      ? await archiveBusinessMedia(existing.media_file_id,connection.profile_id,chat.id,message.message_id,originalName)
      : null);
    const { error: eventError } = await admin.from("flamexbot_business_message_events").upsert({
      profile_id: connection.profile_id, business_chat_id: chat.id, telegram_message_id: message.message_id, event_type: "edited",
      original_content: existing?.content ?? "[Предыдущая версия не была сохранена до включения архива]", message_type: existing?.message_type ?? "text", media_file_id: existing?.media_file_id ?? null, media_url: originalMediaUrl, original_raw: originalRaw, occurred_at: editAt,
    }, { onConflict: "business_chat_id,telegram_message_id,event_type,occurred_at", ignoreDuplicates: true });
    if (eventError) throw eventError;
  }
  const media = messageMedia(message);
  const originalName = message.document?.file_name ?? message.audio?.file_name ?? message.video?.file_name ?? undefined;
  const mediaUrl = media.fileId ? await archiveBusinessMedia(media.fileId, connection.profile_id, chat.id, message.message_id, originalName) : null;
  const direction = String(message.from?.id ?? "") === String(connection.telegram_user_id ?? "") ? "outbound" : "inbound";
  const { error: updateError } = await admin.from("flamexbot_business_messages").upsert({
    business_chat_id: chat.id, telegram_message_id: message.message_id, direction,
    sender_profile_id: direction === "outbound" ? connection.profile_id : null,
    content: messageContent(message), message_type: media.type, media_file_id: media.fileId,
    media_url: mediaUrl, edited_at: editAt, raw: message,
  }, { onConflict: "business_chat_id,telegram_message_id" });
  if (updateError) throw updateError;
}
async function deleteBusinessMessages(update: any) {
  if (!admin || !update?.business_connection_id || !update?.chat?.id || !Array.isArray(update.message_ids)) return;
  const { data: connection, error } = await admin.from("flamexbot_business_connections")
    .select("profile_id,telegram_user_id,connection_id,is_enabled,rights")
    .eq("connection_id", update.business_connection_id).maybeSingle();
  if (error) throw error;
  if (!connection?.profile_id) return;
  const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats")
    .select("id").eq("profile_id", connection.profile_id)
    .eq("telegram_chat_id", String(update.chat.id)).maybeSingle();
  if (chatError) throw chatError;
  if (!chat) return;

  const { data: messages, error: messagesError } = await admin.from("flamexbot_business_messages")
    .select("telegram_message_id,direction,content,message_type,media_file_id,media_url,raw,deleted_at,created_at,antimut_restore_claimed_at")
    .eq("business_chat_id", chat.id).in("telegram_message_id", update.message_ids);
  if (messagesError) throw messagesError;
  const deletedAt = new Date().toISOString();
  console.warn("Telegram reported deleted Business messages; the update does not identify the deleting actor",
    JSON.stringify({ chat_id: String(update.chat.id), message_ids: update.message_ids }));

  const { data: prefs, error: prefsError } = await admin.from("flamexbot_business_chat_settings")
    .select("antimut_enabled,antimut_enabled_at")
    .eq("profile_id", connection.profile_id).eq("business_chat_id", chat.id).maybeSingle();
  if (prefsError) throw prefsError;
  const currentActivationAt = prefs?.antimut_enabled_at ? String(prefs.antimut_enabled_at) : null;
  const currentActivationMs = currentActivationAt ? new Date(currentActivationAt).getTime() : Number.POSITIVE_INFINITY;

  const restoreCandidates = (connection.is_enabled && connection.rights?.can_reply === true &&
    prefs?.antimut_enabled === true && currentActivationAt && Number.isFinite(currentActivationMs))
    ? (messages || []).flatMap((item: any) => {
        const raw = item.raw ?? {};
        const isOurPreviousRestore = raw._flamexbot_antimut_resent === true;
        // A restored copy is never eligible for another restore. This prevents
        // antimut from chasing an external bot that deletes every replacement.
        if (isOurPreviousRestore) {
          console.warn("Antimut ignored deletion of its own restored message", JSON.stringify({
            chat_id: String(update.chat.id),
            message_id: item.telegram_message_id,
            original_message_id: raw._flamexbot_restored_from ?? item.telegram_message_id,
          }));
          return [];
        }
        const original = raw;
        const previousAttempt = 0;
        const activationForChain = isOurPreviousRestore
          ? String(raw._flamexbot_antimut_activation_at ?? "")
          : currentActivationAt;
        const ownerAuthored = original && String(original.from?.id ?? "") === String(connection.telegram_user_id);
        const externalBusinessBotMessage = !isOurPreviousRestore && Boolean(raw.sender_business_bot?.id);
        const originalDateMs = Number(original?.date) * 1000;
        const sameActivation = activationForChain === currentActivationAt;
        const insideActivationWindow = Number.isFinite(originalDateMs) &&
          originalDateMs >= Math.floor(currentActivationMs / 1000) * 1000;
        if (item.direction !== "outbound" || item.deleted_at || item.antimut_restore_claimed_at ||
            !ownerAuthored || externalBusinessBotMessage || !sameActivation || !insideActivationWindow) return [];
        if (previousAttempt >= ANTIMUT_MAX_RESTORES) {
          console.warn("Antimut retry limit reached; another actor keeps deleting restored messages", JSON.stringify({
            chat_id: String(update.chat.id),
            original_message_id: raw._flamexbot_restored_from ?? item.telegram_message_id,
            last_message_id: item.telegram_message_id,
            attempts: previousAttempt,
          }));
          return [];
        }
        return [{
          ...item,
          antimutOriginalMessage: original,
          antimutOriginalMessageId: Number(raw._flamexbot_restored_from ?? item.telegram_message_id),
          antimutPreviousAttempt: previousAttempt,
          antimutActivationAt: activationForChain,
        }];
      })
    : [];

  const restoreClaimedIds = new Set<number>();
  if (restoreCandidates.length) {
    const { data: claimed, error: claimError } = await admin.from("flamexbot_business_messages")
      .update({ antimut_restore_claimed_at: deletedAt })
      .eq("business_chat_id", chat.id)
      .in("telegram_message_id", restoreCandidates.map((item: any) => item.telegram_message_id))
      .is("antimut_restore_claimed_at", null).is("deleted_at", null)
      .select("telegram_message_id");
    if (claimError) throw claimError;
    for (const row of claimed || []) restoreClaimedIds.add(Number(row.telegram_message_id));
  }

  const events = await Promise.all((messages || []).filter((item: any) => !item.deleted_at).map(async (item: any) => {
    const raw = item.raw ?? {};
    const originalName = raw.document?.file_name ?? raw.audio?.file_name ?? raw.video?.file_name ?? raw.animation?.file_name;
    const archivedUrl = item.media_url || (item.media_file_id
      ? await archiveBusinessMedia(item.media_file_id, connection.profile_id, chat.id, item.telegram_message_id, originalName)
      : null);
    return {
      profile_id: connection.profile_id, business_chat_id: chat.id,
      telegram_message_id: item.telegram_message_id, event_type: "deleted",
      original_content: item.content ?? "", message_type: item.message_type ?? "text",
      media_file_id: item.media_file_id ?? null, media_url: archivedUrl,
      original_raw: raw, occurred_at: deletedAt,
    };
  }));
  const known = new Set((messages || []).map((item: any) => Number(item.telegram_message_id)));
  const missing = update.message_ids
    .filter((id: number) => !known.has(Number(id)))
    .map((id: number) => ({
      profile_id: connection.profile_id, business_chat_id: chat.id,
      telegram_message_id: id, event_type: "deleted",
      original_content: "[Текст не был сохранён до получения события об удалении]",
      message_type: "unknown", media_file_id: null, media_url: null,
      original_raw: {}, occurred_at: deletedAt,
    }));
  if (events.length || missing.length) {
    const { error: eventError } = await admin.from("flamexbot_business_message_events")
      .upsert([...events, ...missing], {
        onConflict: "business_chat_id,telegram_message_id,event_type,occurred_at",
        ignoreDuplicates: true,
      });
    if (eventError) throw eventError;
  }
  const { error: markError } = await admin.from("flamexbot_business_messages")
    .update({ deleted_at: deletedAt })
    .eq("business_chat_id", chat.id).in("telegram_message_id", update.message_ids).is("deleted_at", null);
  if (markError) throw markError;

  if (restoreClaimedIds.size) {
    for (const item of restoreCandidates) {
      if (!restoreClaimedIds.has(Number(item.telegram_message_id))) continue;
      await sendAntimutRestore({
        original: item.antimutOriginalMessage,
        originalMessageId: item.antimutOriginalMessageId,
        previousAttempt: item.antimutPreviousAttempt,
        activationAt: item.antimutActivationAt,
        connection,
        chatId: update.chat.id,
        businessChatId: chat.id,
        sourceMessageId: Number(item.telegram_message_id),
      });
    }
  }
  return chat.id;
}

async function postBusinessStoryFromReply(message: any, businessConnectionId: string, connectionOverride: any) {
  if (connectionOverride?.rights?.can_manage_stories !== true) {
    throw new Error("Для публикации историй включи право «Управлять историями» в настройках подключения Telegram Business.");
  }
  const source = message.reply_to_message;
  if (!source) throw new Error("Ответь командой .history на сообщение с фото или видео.");
  const media = messageMedia(source);
  let fileId = "";
  let content: Record<string, unknown>;
  let fileName = "story-media.bin";
  if (media.type === "photo") {
    fileId = media.fileId;
    fileName = "story-photo.jpg";
    content = { type: "photo", photo: "attach://story_media" };
  } else if (media.type === "video") {
    const video = source.video;
    if (!video || video.width !== 720 || video.height !== 1280 || Number(video.duration || 0) > 60) {
      throw new Error("Для истории нужно видео 720×1280 длительностью до 60 секунд.");
    }
    if (video.supports_streaming !== true) {
      throw new Error("Видео должно поддерживать потоковое воспроизведение. Подготовь вертикальный MP4 для историй и повтори команду.");
    }
    fileId = media.fileId;
    fileName = "story-video.mp4";
    content = { type: "video", video: "attach://story_media", duration: Number(video.duration || 0) };
  } else {
    throw new Error("Поддерживаются только фото и видео. Ответь .history на нужное медиа.");
  }
  const info = await getTelegramFileInfo(fileId);
  if (!info?.file_path || Number(info.file_size || 0) > 30 * 1024 * 1024) {
    throw new Error("Файл не найден или превышает лимит 30 МБ.");
  }
  const download = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`, { signal: AbortSignal.timeout(12000) });
  if (!download.ok) throw new Error("Не удалось скачать исходный файл из Telegram.");
  const blob = await download.blob();
  if (blob.size > 30 * 1024 * 1024) throw new Error("Файл превышает лимит 30 МБ.");
  let storyBlob = blob;
  if (media.type === "photo") {
    try {
      const { Image } = await import("npm:imagescript@3.20.3");
      const image = await Image.decode(new Uint8Array(await blob.arrayBuffer()));
      image.cover(1080, 1920);
      let resizedBytes = await image.encodeJPEG(88);
      if (resizedBytes.byteLength > 10 * 1024 * 1024) resizedBytes = await image.encodeJPEG(72);
      if (resizedBytes.byteLength > 10 * 1024 * 1024) throw new Error("После изменения размера фото всё ещё превышает лимит 10 МБ.");
      storyBlob = new Blob([resizedBytes], { type: "image/jpeg" });
    } catch (resizeError) {
      throw new Error("Не удалось подготовить фото для Telegram Stories: " + String((resizeError as any)?.message ?? resizeError));
    }
  }
  const form = new FormData();
  form.set("business_connection_id", businessConnectionId);
  form.set("content", JSON.stringify(content));
  form.set("active_period", "86400");
  const caption = String(source.caption || "").trim();
  if (caption) form.set("caption", caption.slice(0, 2048));
  form.set("story_media", storyBlob, fileName);
  const response = await fetch(`${API}/postStory`, { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(String(result.description || "Telegram не принял историю."));
  return result.result;
}

async function handleBusinessChatCommand(message: any, businessConnectionId: string, connectionOverride?: any) {
  if (!admin || !businessConnectionId || message?.chat?.type !== "private" || !message?.from?.id || typeof message.text !== "string") return false;
  const text = message.text.trim();
  if (!/^[./][a-zа-яё0-9]/i.test(text)) return false;
  const [rawCommand, ...parts] = text.slice(1).split(/\s+/);
  const command = String(rawCommand ?? "").replace(/@\w+$/,"").toLowerCase();
  const args = parts;
  const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const reply = async (body: string, parseMode?: string, replyMarkup?: Record<string, unknown>) => {
    const formatted = parseMode === "HTML" || body.includes("<tg-emoji")
      ? body
      : `${tgEmoji("sparkles")} ${escapeHtml(body)}`;
    return sendBusinessReply(businessConnectionId, message.chat.id, formatted, "HTML", replyMarkup);
  };
  if (isFounderTarget(message.chat.id)) {
    await reply(`${tgEmoji("lock")} <b>Этот диалог защищён</b>\nКоманды FLAMEXBOT не применяются к владельцу проекта.`, "HTML");
    return true;
  }
  if (String(message.from.id) !== FOUNDER_TELEGRAM_ID) {
    const targetTelegramId = String(message.chat.id);
    const { data: protection, error: protectionError } = await admin.from("profiles")
      .select("command_protection_expires_at,command_protection_disabled")
      .eq("telegram_id", targetTelegramId).maybeSingle();
    if (protectionError) throw protectionError;
    const protectionExpiresAt = protection?.command_protection_expires_at
      ? new Date(protection.command_protection_expires_at).getTime() : 0;
    if (protectionExpiresAt > Date.now() && protection?.command_protection_disabled !== true) {
      await reply(`${tgEmoji("lock")} <b>Защита от команд включена</b>\nВладелец этого аккаунта запретил применение команд FLAMEXBOT. Использовать команды на защищённом аккаунте может только Основатель проекта.`, "HTML");
      return true;
    }
  }

  if (["crop","resize","rotate","compress","round","wanted","stories","sticker"].includes(command)) {
    const source = message.reply_to_message;
    const sourceMedia = messageMedia(source);
    if (!source || sourceMedia.type !== "photo") {
      await reply("Ответь командой на фотографию. Доступны .crop, .round, .wanted, .stories, .sticker, .resize ШИРИНА ВЫСОТА, .rotate УГОЛ и .compress.");
      return true;
    }
    try {
      const info = await getTelegramFileInfo(sourceMedia.fileId);
      if (!info?.file_path || Number(info.file_size || 0) > 20 * 1024 * 1024) throw new Error("Фото отсутствует или превышает 20 МБ.");
      const download = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`, { signal: AbortSignal.timeout(12000) });
      if (!download.ok) throw new Error("Не удалось скачать фото.");
      const bytes = new Uint8Array(await download.arrayBuffer());
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Размер фото превышает лимит 20 МБ.");
      const { Image } = await import("npm:imagescript@3.20.3");
      const image = await Image.decode(bytes);
      if (command === "crop" || command === "round") {
        const side = Math.min(image.width, image.height);
        image.crop(Math.floor((image.width-side)/2), Math.floor((image.height-side)/2), side, side);
        if (command === "round") image.cropCircle();
      } else if (command === "resize") {
        const width = Number(args[0]), height = Number(args[1]);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 2048 || height > 2048) {
          await reply("Формат: .resize 1080 1080 (каждая сторона от 64 до 2048 px).");
          return true;
        }
        image.resize(width, height);
      } else if (command === "rotate") {
        const angle = Number(args[0] ?? 90);
        if (![90,180,270,-90,-180,-270].includes(angle)) {
          await reply("Укажи угол: .rotate 90, .rotate 180 или .rotate 270.");
          return true;
        }
        image.rotate(angle);
      }
      if (command === "sticker") {
        const ownerId = Number(message.from?.id);
        if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error("Не удалось определить владельца набора.");
        const botInfo = await telegram("getMe", {});
        const botUsername = String(botInfo?.username || "").replace(/[^a-zA-Z0-9_]/g, "");
        if (!botUsername) throw new Error("Не удалось определить username бота.");
        const setName = "flamex_" + ownerId + "_by_" + botUsername.toLowerCase();
        const side = Math.min(image.width, image.height);
        image.crop(Math.floor((image.width-side)/2), Math.floor((image.height-side)/2), side, side).resize(512, 512);
        const stickerBytes = await image.encodePNG();
        if (stickerBytes.byteLength > 512 * 1024) throw new Error("PNG превышает лимит стикера 512 КБ.");
        const stickerUpload = async (method: string) => {
          const form = new FormData();
          form.set("user_id", String(ownerId));
          form.set("name", setName);
          form.set("sticker_file", new File([stickerBytes], "flamex-sticker.png", { type: "image/png" }));
          if (method === "createNewStickerSet") {
            form.set("title", "FLAMEXBOT · " + ownerId);
            form.set("stickers", JSON.stringify([{ sticker: "attach://sticker_file", format: "static", emoji_list: ["✨"] }]));
          } else {
            form.set("sticker", JSON.stringify({ sticker: "attach://sticker_file", format: "static", emoji_list: ["✨"] }));
          }
          const response = await fetch(`${API}/${method}`, { method: "POST", body: form, signal: AbortSignal.timeout(20000) });
          return await response.json();
        };
        let stickerResult = await stickerUpload("createNewStickerSet");
        if (!stickerResult.ok && /STICKERSET_INVALID|already exists|name is already occupied/i.test(String(stickerResult.description || ""))) {
          stickerResult = await stickerUpload("addStickerToSet");
        }
        if (!stickerResult.ok) throw new Error(String(stickerResult.description || "Telegram не создал стикер."));
        await reply("Стикер создан и добавлен в набор: https://t.me/addstickers/" + setName);
        return true;
      }
      if (command === "stories") {
        if (image.width < 3 || image.height < 3) throw new Error("Фото слишком маленькое для нарезки.");
        const tileW = Math.floor(image.width / 3), tileH = Math.floor(image.height / 3);
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const tile = image.clone().crop(col * tileW, row * tileH, tileW, tileH).resize(720, 1280);
            const bytes = await tile.encodeJPEG(88);
            const form = new FormData();
            form.set("business_connection_id", businessConnectionId);
            form.set("active_period", "86400");
            form.set("content", JSON.stringify({ type: "photo", photo: "attach://story_photo" }));
            form.set("story_photo", new File([bytes], "flamex-story-" + (row * 3 + col + 1) + ".jpg", { type: "image/jpeg" }));
            const response = await fetch(`${API}/postStory`, { method: "POST", body: form, signal: AbortSignal.timeout(25000) });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(String(data.description || "Telegram не принял фрагмент " + (row * 3 + col + 1) + ". Уже опубликовано: " + (row * 3 + col)));
          }
        }
        await reply("Опубликовано 9 фрагментов истории. Они складываются в одну картинку 3×3 в профиле.");
        return true;
      }
      const isRound = command === "round";
      const output = isRound ? await image.encodePNG() : await image.encodeJPEG(command === "compress" ? 65 : 88);
      if (output.byteLength > 9 * 1024 * 1024) throw new Error("Готовое изображение превышает лимит Telegram.");
      const form = new FormData();
      form.set("business_connection_id", businessConnectionId);
      form.set("chat_id", String(message.chat.id));
      if (command === "wanted") {
        const who = source.from?.username ? "@" + source.from.username : String([source.from?.first_name, source.from?.last_name].filter(Boolean).join(" ") || "НЕИЗВЕСТНЫЙ");
        form.set("caption", "<b>🚨 РАЗЫСКИВАЕТСЯ 🚨</b>\n" + who + "\n<b>Награда:</b> 1 000 000 печенек");
        form.set("parse_mode", "HTML");
      }
      form.set("photo", new File([output], isRound ? "flamexbot-round.png" : "flamexbot-edit.jpg", { type: isRound ? "image/png" : "image/jpeg" }));
      const sent = await fetch(`${API}/sendPhoto`, { method: "POST", body: form, signal: AbortSignal.timeout(20000) });
      const sentData = await sent.json();
      if (!sent.ok || !sentData.ok) throw new Error(String(sentData.description || "Telegram не принял обработанное фото."));
      await reply(command === "compress" ? "Фото сжато и отправлено." : command === "crop" ? "Фото обрезано по центру в квадрат." : command === "round" ? "Готово: круглое фото с прозрачным фоном." : command === "wanted" ? "Постер «Разыскивается» готов." : command === "rotate" ? "Фото повёрнуто." : "Размер фото изменён.");
    } catch (error) {
      await reply("Не удалось обработать фото: " + String((error as any)?.message ?? error).slice(0, 220));
    }
    return true;
  }

  if (command === "music") {
    const query = args.join(" ").trim();
    if (!query) {
      await reply("Формат: .music название песни или исполнитель. Например: .music Eminem Mockingbird");
      return true;
    }
    try {
      const endpoint = "https://api.deezer.com/search/track?q=" + encodeURIComponent(query) + "&limit=5";
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Музыкальный каталог временно недоступен (HTTP " + response.status + ").");
      const payload = await response.json();
      const tracks = Array.isArray(payload?.data) ? payload.data : [];
      if (!tracks.length) {
        await reply("Ничего не найдено. Попробуй указать название песни и исполнителя.");
        return true;
      }
      const lines = tracks.slice(0, 5).map((track: any, index: number) => {
        const title = String(track?.title ?? "Без названия").slice(0, 120);
        const artist = String(track?.artist?.name ?? "Неизвестный исполнитель").slice(0, 100);
        const album = String(track?.album?.title ?? "").slice(0, 100);
        const page = String(track?.link ?? "");
        const preview = String(track?.preview ?? "");
        return (index + 1) + ". <b>" + escapeHtml(title) + "</b> — " + escapeHtml(artist) +
          (album ? "\\n   Альбом: " + escapeHtml(album) : "") +
          (preview ? "\\n   <a href=\"" + escapeHtml(preview) + "\">▶ 30-секундный фрагмент</a>" : "\\n   Фрагмент недоступен") +
          (page ? " · <a href=\"" + escapeHtml(page) + "\">Открыть в Deezer</a>" : "");
      });
      await reply("<b>FLAMEXBOT · поиск музыки</b>\\n\\n" + lines.join("\\n\\n") +
        "\\n\\n<i>Доступны официальные ссылки на каталог и короткие предпрослушивания, если они предоставлены Deezer.</i>", "HTML");
    } catch (error) {
      await reply("Не удалось выполнить поиск музыки: " + String((error as any)?.message ?? error).slice(0, 180));
    }
    return true;
  }

  if (command === "audio" || command === "voice") {
    const source = message.reply_to_message;
    if (!source) { await reply("Ответь на аудио или голосовое сообщение командой ." + command + "."); return true; }
    const media = messageMedia(source);
    if (!["audio","voice","document","video"].includes(media.type) || !media.fileId) {
      await reply("Нужно ответить на аудио, голосовое или видеофайл.");
      return true;
    }
    const method = command === "audio" ? "sendAudio" : "sendVoice";
    const field = command === "audio" ? "audio" : "voice";
    try {
      await telegram(method, {
        business_connection_id: businessConnectionId,
        chat_id: message.chat.id,
        [field]: media.fileId,
        ...(source.caption ? { caption: String(source.caption).slice(0, 900) } : {}),
      });
      await reply(command === "audio" ? "Отправлено как аудиотрек." : "Отправлено как голосовое сообщение.");
    } catch (error) {
      await reply("Не удалось отправить медиа в этом формате: " + String((error as any)?.message || error).slice(0,180));
    }
    return true;
  }

  if (command === "font") {
    const input = text.slice(text.indexOf(rawCommand) + rawCommand.length).trim();
    if (!input) { await reply("Напиши текст после команды: .font Привет, мир!"); return true; }
    const styles: Record<string, string> = {
      "A":"𝔸","B":"𝔹","C":"ℂ","D":"𝔻","E":"𝔼","F":"𝔽","G":"𝔾","H":"ℍ","I":"𝕀","J":"𝕁","K":"𝕂","L":"𝕃","M":"𝕄","N":"ℕ","O":"𝕆","P":"ℙ","Q":"ℚ","R":"ℝ","S":"𝕊","T":"𝕋","U":"𝕌","V":"𝕍","W":"𝕎","X":"𝕏","Y":"𝕐","Z":"ℤ",
      "a":"𝕒","b":"𝕓","c":"𝕔","d":"𝕕","e":"𝕖","f":"𝕗","g":"𝕘","h":"𝕙","i":"𝕚","j":"𝕛","k":"𝕜","l":"𝕝","m":"𝕞","n":"𝕟","o":"𝕠","p":"𝕡","q":"𝕢","r":"𝕣","s":"𝕤","t":"𝕥","u":"𝕦","v":"𝕧","w":"𝕨","x":"𝕩","y":"𝕪","z":"𝕫"
    };
    const converted = Array.from(input).map((char) => styles[char] || char).join("");
    await reply(converted);
    return true;
  }

  if (command === "ping") {
    await reply(`${tgEmoji("success")} <b>PONG!</b>\nBusiness-команды получены. Текущий диалог определён, обработчик отвечает.`, "HTML");
    return true;
  }

  if (command === "help" || command === "inf" || command === "commands") {
    await reply(`${tgEmoji("sparkles")} <b>FLAMEXBOT · все команды</b>

${tgEmoji("settings")} <b>Автоматизация текущего диалога</b>
<code>.afk причина</code> / <code>.afk</code> повторно — автоответ только в этом диалоге
<code>.autoread</code> — переключатель автопрочтения (повтори для выключения)
<code>.autotyping</code> — переключатель статуса набора (повтори для выключения)
<code>.autovoice</code> — переключатель статуса записи (повтори для выключения)
<code>.mutestick</code> — переключатель фильтра стикеров (повтори для выключения)\n<code>.antimat</code> — переключатель фильтра мата (повтори для выключения)

${tgEmoji("lock")} <b>Текущий диалог</b>
<code>.ping</code> / <code>/ping</code> — проверить ответы Business-команд\n<code>.help</code> / <code>/help</code> / <code>.commands</code> — полный список команд\n<code>.streak 1-3650</code> — мгновенно установить серию (только администрация)\n<code>.music название</code> — найти трек и открыть 30-секундный фрагмент\n<code>.mute</code> / <code>/mute</code> — включить или выключить мут (повтори команду)
<code>.antimute</code> / <code>.antimute</code> — переключатель повторной отправки от имени подключённого Telegram Business-аккаунта
<code>.warn N</code> — включить автомут; повтори ту же команду или отправь .warn без числа, чтобы выключить
<code>.panic</code> — удаление истории у обоих после подтверждения (доступны последние 48 часов)
<code>.history</code> — опубликовать фото/видео из ответа в историю (нужны права Business)\n<code>.clone</code> — копировать сообщение собеседника с пометкой об источнике
<code>.advertising</code> — персональная реферальная ссылка с бонусом Premium на 3 дня
<code>.profile</code> — расширенная анимированная карточка собеседника

${tgEmoji("edit")} <b>Дополнительно</b>
<code>.timeprofile +N</code> — установить часовой пояс FLAMEXBOT (например, +3 или -5)
<code>.time</code> — добавить или убрать московское время в имени подключённого Telegram Business-профиля (повтори команду)
<code>.bold текст</code> / <code>.dumb текст</code> — изменить оформление текста
<code>.link текст</code> — создать ссылку на этот диалог\n<code>.copyp</code> — скопировать имя, описание и доступную аватарку Business-профиля собеседника\n<code>.uncopyp</code> — восстановить исходные имя, описание и аватарку\n<code>.qr текст</code> — создать QR-код для текста или ссылки\n<code>.id</code> / <code>.chatid</code> — ID собеседника и чата\n<code>.date</code> — дата и время по Москве\n<code>.calc выражение</code> — калькулятор со скобками\n<code>.upper</code> / <code>.lower</code> / <code>.reverse</code> / <code>.title</code> / <code>.leet</code> / <code>.zalgo</code> / <code>.binary</code> / <code>.morse</code> / <code>.anagram</code> / <code>.fixlayout</code> — изменяют исходное сообщение\n<code>.base64</code> / <code>.hash</code> / <code>.random</code> / <code>.password</code> / <code>.nickname</code> — инструменты текста\n<code>.count</code> / <code>.wordcount</code> — подсчёт символов и слов\n<code>.choose A | B</code> — случайный выбор\n<code>.roll 100</code> — случайное число от 1 до 100\n<code>.coin</code> — подбросить монетку\n<code>.8ball вопрос</code> — ответ магического шара\n<code>.ship</code> — шуточная совместимость с собеседником\n<code>.dice</code> / <code>.кубик</code> — бросить кубик с анимацией\n<code>.кнб камень</code> — камень, ножницы, бумага\n<code>.rate</code> — случайная оценка собеседника\n<code>.aura</code> / <code>.fortune</code> / <code>.mood</code> — Premium-развлечения
<code>/premium</code> — счёт на FLAMEXBOT Premium на 30 дней

${tgEmoji("sparkles")} <b>RP-команды с анимацией</b>\n<code>.обнять</code> <code>.поцеловать</code> <code>.расцеловать</code> <code>.прижать</code> <code>.погладить</code> <code>.положитьнаколени</code> <code>.укрыть</code> <code>.успокоить</code>\n<code>.подкормить</code> <code>.покормить</code> <code>.напоить</code> <code>.поздравить</code> <code>.поприветствовать</code> <code>.пожать</code> <code>.попрощаться</code>\n<code>.укусить</code> <code>.лизнуть</code> <code>.шлепнуть</code> <code>.испугать</code> <code>.ударить</code> <code>.врезать</code> <code>.пнуть</code> <code>.удушить</code> <code>.задушить</code>\n<code>.пырнуть</code> <code>.выстрелить</code> <code>.убить</code> <code>.закопать</code> <code>.отшлепать</code> <code>.связать</code> <code>.плюнуть</code> <code>.сжечь</code> <code>.послать</code> <code>.украсть</code> <code>.похоронить</code>\n<code>.love</code> <code>.dox</code> <code>.snos</code> <code>.hack</code> <code>.ddos</code> <code>.ban</code> <code>.burger</code>\nАнимации с Premium Emoji; сцены насилия — только мультяшные и постановочные.\n\n${tgEmoji("star")} <b>Подписка и тарифы · личный чат с ботом</b>
Подписки оплачиваются разово через Telegram Stars и не продлеваются автоматически. Текущий тариф и срок действия смотри в Mini App → «Тарифы». Продление выполняется вручную командой <code>/premium</code>. 

${tgEmoji("lock")} <b>Административные команды · только персонал</b>\n<code>.adminhelp</code> — подробная справка для администрации\n<code>.stats</code> / <code>.botstats</code> — статистика бота\n<code>.user ID</code> / <code>.userinfo ID</code> — информация об аккаунте\n<code>.grantpremium ID ДНИ</code> / <code>.givepremium ID ДНИ</code> — выдать Premium\n<code>.revokepremium ID</code> / <code>.delpremium ID</code> — снять Premium\n<code>.banuser ID причина</code> / <code>.unbanuser ID</code> — блокировка аккаунта\n<code>.addadmin ID роль</code> / <code>.deladmin ID</code> — управление персоналом\n<code>.admins</code> — список персонала\n<code>.audit</code> — журнал действий администрации\n<code>.broadcast текст</code> — рассылка от Основателя\n<code>.setperm ID право on|off</code> — настройка прав сотрудника\n<code>.myrights</code> — мои права\n\n${tgEmoji("help")} <b>Как пользоваться</b>
Отправляй команду прямо в переписке с нужным человеком. FLAMEXBOT сам определит текущий диалог — <b>@username и ID указывать не нужно</b>. Для команд включения Premium-функций нужна активная подписка; команды отключения доступны бесплатно.
В Business-переписке можно использовать префикс <code>.</code> или <code>/</code>. В личном чате с ботом работают /ping, /status и /help.`, "HTML");
    return true;
  }
  let profile = connectionOverride?.profile_id
    ? { id: connectionOverride.profile_id, telegram_id: String(connectionOverride.telegram_user_id ?? message.from.id) }
    : null;
  if (!profile) {
    const { data, error } = await admin.from("profiles")
      .select("id,telegram_id").eq("telegram_id", String(message.from.id)).maybeSingle();
    if (error) throw error;
    profile = data;
  }
  if (!profile) { await reply("Сначала открой FLAMEXBOT и войди через Telegram."); return true; }

  // Lazily resolve the current Business chat once and reuse it across chat-scoped commands.
  let currentBusinessChatPromise: Promise<any> | null = null;
  const getCurrentBusinessChat = async () => {
    if (!currentBusinessChatPromise) {
      currentBusinessChatPromise = (async () => {
        const { data, error } = await admin.from("flamexbot_business_chats")
          .select("id,telegram_chat_id,telegram_user_id,business_connection_id,username,first_name,last_name,photo_url")
          .eq("profile_id", profile.id)
          .eq("telegram_chat_id", String(message.chat.id))
          .eq("business_connection_id", businessConnectionId)
          .maybeSingle();
        if (error) throw error;
        return data;
      })();
    }
    return currentBusinessChatPromise;
  };

  const adminCommands = new Set(["adminhelp","admhelp","stats","botstats","user","userinfo","grantpremium","givepremium","revokepremium","delpremium","banuser","unbanuser","addadmin","deladmin","admins","audit","broadcast","setperm","myrights"]);
  if (adminCommands.has(command)) {
    const actorTelegramId = String(message.from.id);
    const isFounder = actorTelegramId === FOUNDER_TELEGRAM_ID;
    let staffRole: string | null = null;
    let staffPermissions: Record<string, boolean> = {};
    if (!isFounder) {
      const { data: staff, error: staffError } = await admin.from("flamexbot_admin_roles").select("role,permissions").eq("telegram_id", actorTelegramId).maybeSingle();
      if (staffError) throw staffError;
      staffRole = staff?.role || null;
      staffPermissions = (staff?.permissions && typeof staff.permissions === "object" ? staff.permissions : {}) as Record<string, boolean>;
    }
    if (!isFounder && !staffRole) {
      await reply(tgEmoji("lock")+" <b>Доступ запрещён</b>\nКоманды доступны только персоналу FLAMEXBOT.", "HTML");
      return true;
    }
    const founderOnly = ["grantpremium","givepremium","revokepremium","delpremium","addadmin","deladmin","broadcast","setperm"];
    if (!isFounder && founderOnly.includes(command)) {
      await reply(tgEmoji("lock")+" Эта команда доступна только Основателю.");
      return true;
    }
    const roleDefaults: Record<string,string[]> = {
      moderator: ["user_lookup"],
      admin: ["user_lookup","view_stats","manage_bans","view_audit"],
      senior_admin: ["user_lookup","view_stats","manage_bans","view_audit","manage_staff"]
    };
    const hasPermission = (permission: string) => isFounder || (staffPermissions[permission] !== undefined ? staffPermissions[permission] === true : (roleDefaults[staffRole||""]||[]).includes(permission));
    const permissionByCommand: Record<string,string> = {stats:"view_stats",botstats:"view_stats",user:"user_lookup",userinfo:"user_lookup",banuser:"manage_bans",unbanuser:"manage_bans",audit:"view_audit",admins:"manage_staff"};
    if (command === "myrights") {
      const all = ["user_lookup","view_stats","manage_bans","view_audit","manage_staff"];
      await reply(tgEmoji("lock")+" <b>Твои права</b>\nРоль: <b>"+(isFounder?"founder":escapeHtml(staffRole||"staff"))+"</b>\n"+
        all.map(p=>(hasPermission(p)?"✅ ":"❌ ")+escapeHtml(p)).join("\n"),"HTML");
      return true;
    }
    const neededPermission = permissionByCommand[command];
    if (neededPermission && !hasPermission(neededPermission)) {
      await reply(tgEmoji("lock")+" Недостаточно прав. Требуется разрешение: <code>"+neededPermission+"</code>","HTML");
      return true;
    }
    const writeAdminAudit = async (action: string, targetTelegramId: string | null = null, details: Record<string, unknown> = {}) => {
      const { error } = await admin.from("flamexbot_admin_audit").insert({ actor_telegram_id: actorTelegramId, action, target_telegram_id: targetTelegramId, details });
      if (error) console.error("admin audit insert failed", error);
    };
    if (command === "adminhelp" || command === "admhelp") {
      await reply(tgEmoji("lock")+" <b>FLAMEXBOT · команды Основателя</b>\n\n"+
        "<code>.stats</code> — статистика пользователей и Premium\n"+
        "<code>.user TELEGRAM_ID</code> — информация об аккаунте\n"+
        "<code>.grantpremium TELEGRAM_ID ДНИ</code> — выдать Premium на указанное число дней\n"+
        "<code>.revokepremium TELEGRAM_ID</code> — снять Premium\n"+
        "<code>.banuser TELEGRAM_ID причина</code> — заблокировать аккаунт FLAMEXBOT\n"+
        "<code>.unbanuser TELEGRAM_ID</code> — снять блокировку\n"+
        "<code>.addadmin ID admin|moderator</code> — назначить персонал\n"+
        "<code>.deladmin ID</code> — снять роль персонала\n"+
        "<code>.admins</code> — список персонала\n"+
        "<code>.audit</code> — последние действия администрации\n"+
        "<code>.broadcast текст</code> — рассылка пользователям (только Основатель)\n"+
        "<code>.setperm ID permission on|off</code> — настроить право сотрудника\n"+
        "<code>.myrights</code> — посмотреть свои права\n\n"+
        "Основатель управляет ролями и рассылкой; администраторы и модераторы имеют ограниченные права.", "HTML");
      return true;
    }
    if (command === "stats" || command === "botstats") {
      const [users,banned,subs] = await Promise.all([
        admin.from("profiles").select("id",{count:"exact",head:true}),
        admin.from("profiles").select("id",{count:"exact",head:true}).eq("is_banned",true),
        admin.from("user_subscriptions").select("user_id",{count:"exact",head:true}).in("plan",["premium","founder"])
      ]);
      if(users.error||banned.error||subs.error) throw users.error||banned.error||subs.error;
      await writeAdminAudit("view_stats");
      await reply(tgEmoji("diamond")+" <b>Статистика FLAMEXBOT</b>\n\n"+
        "Всего аккаунтов: <b>"+(users.count??0)+"</b>\n"+
        "Заблокировано: <b>"+(banned.count??0)+"</b>\n"+
        "Подписок Premium/Founder: <b>"+(subs.count??0)+"</b>", "HTML");
      return true;
    }

    if (command === "setperm") {
      const id=String(args[0]||"");
      const permission=String(args[1]||"");
      const value=String(args[2]||"").toLowerCase();
      const allowed=["user_lookup","view_stats","manage_bans","view_audit","manage_staff"];
      if(!/^\d{5,20}$/.test(id)||id===FOUNDER_TELEGRAM_ID||!allowed.includes(permission)||!["on","off"].includes(value)){
        await reply("Формат: <code>.setperm ID user_lookup|view_stats|manage_bans|view_audit|manage_staff on|off</code>","HTML");return true;
      }
      const {data:staff,error}=await admin.from("flamexbot_admin_roles").select("permissions").eq("telegram_id",id).maybeSingle();
      if(error)throw error;
      if(!staff){await reply("Сотрудник не найден. Сначала назначь его через .addadmin.");return true;}
      const updated={...(staff.permissions||{}),[permission]:value==="on"};
      const {error:updateError}=await admin.from("flamexbot_admin_roles").update({permissions:updated}).eq("telegram_id",id);
      if(updateError)throw updateError;
      await writeAdminAudit("set_staff_permission",id,{permission,enabled:value==="on"});
      await reply(tgEmoji("success")+" Право <code>"+permission+"</code> для <code>"+id+"</code>: <b>"+(value==="on"?"включено":"выключено")+"</b>.","HTML");
      return true;
    }
    if (command === "admins") {
      const { data: staffList, error } = await admin.from("flamexbot_admin_roles").select("telegram_id,role,created_at").order("created_at",{ascending:false}).limit(100);
      if (error) throw error;
      const lines = (staffList||[]).map((x:any)=>"<code>"+escapeHtml(x.telegram_id)+"</code> — <b>"+escapeHtml(x.role)+"</b>");
      await reply(tgEmoji("user")+" <b>Персонал FLAMEXBOT</b>\n"+(lines.length?lines.join("\n"):"Список пока пуст."), "HTML");
      await writeAdminAudit("list_staff");
      return true;
    }
    if (command === "addadmin") {
      const id=String(args[0]||"");
      const role=String(args[1]||"moderator").toLowerCase();
      if (!/^\\d{5,20}$/.test(id) || !["admin","moderator","senior_admin"].includes(role)) {
        await reply("Формат: <code>.addadmin TELEGRAM_ID admin|moderator|senior_admin</code>","HTML"); return true;
      }
      if (id===FOUNDER_TELEGRAM_ID) { await reply("Основатель уже имеет максимальные права."); return true; }
      const {error}=await admin.from("flamexbot_admin_roles").upsert({telegram_id:id,role,granted_by:actorTelegramId},{onConflict:"telegram_id"});
      if(error)throw error;
      await writeAdminAudit("grant_staff_role",id,{role});
      await reply(tgEmoji("success")+" Пользователю <code>"+escapeHtml(id)+"</code> назначена роль <b>"+role+"</b>.","HTML");
      return true;
    }
    if (command === "deladmin") {
      const id=String(args[0]||"");
      if (!/^\\d{5,20}$/.test(id) || id===FOUNDER_TELEGRAM_ID) { await reply("Укажи корректный Telegram ID персонала."); return true; }
      const {data:removed,error}=await admin.from("flamexbot_admin_roles").delete().eq("telegram_id",id).select("telegram_id");
      if(error)throw error;
      await writeAdminAudit("revoke_staff_role",id);
      await reply(removed?.length?"Роль персонала снята с <code>"+escapeHtml(id)+"</code>.":"Этот пользователь не был в персонале.","HTML");
      return true;
    }
    if (command === "audit") {
      const {data:logs,error}=await admin.from("flamexbot_admin_audit").select("actor_telegram_id,action,target_telegram_id,created_at").order("created_at",{ascending:false}).limit(12);
      if(error)throw error;
      const lines=(logs||[]).map((x:any)=>"<code>"+escapeHtml(x.actor_telegram_id)+"</code> · <b>"+escapeHtml(x.action)+"</b>"+(x.target_telegram_id?" → <code>"+escapeHtml(x.target_telegram_id)+"</code>":"")+"\n<small>"+escapeHtml(new Date(x.created_at).toLocaleString("ru-RU"))+"</small>");
      await reply(tgEmoji("diamond")+" <b>Журнал администрации</b>\n"+(lines.length?lines.join("\n\n"):"Записей пока нет."),"HTML");
      await writeAdminAudit("view_audit");
      return true;
    }
    if (command === "broadcast") {
      const body=args.join(" ").trim();
      if(!body){await reply("Формат: <code>.broadcast Текст рассылки</code>","HTML");return true;}
      if(body.length>3500){await reply("Сообщение слишком длинное (максимум 3500 символов).");return true;}
      const {data:recipients,error}=await admin.from("profiles").select("telegram_id").not("telegram_id","is",null).limit(5000);
      if(error)throw error;
      let sent=0,failed=0;
      for(const recipient of recipients||[]){
        const id=String(recipient.telegram_id||"");
        if(!/^\\d{5,20}$/.test(id))continue;
        try{await telegram("sendMessage",{chat_id:id,text:tgEmoji("users")+" <b>FLAMEXBOT · Объявление</b>\n\n"+escapeHtml(body),parse_mode:"HTML",disable_web_page_preview:true});sent++;}
        catch(e){failed++;console.error("broadcast delivery failed",id,e);}
      }
      await writeAdminAudit("broadcast",null,{sent,failed,requested:(recipients||[]).length});
      await reply(tgEmoji("success")+" Рассылка завершена.\nДоставлено: <b>"+sent+"</b>\nОшибок: <b>"+failed+"</b>","HTML");
      return true;
    }
    const targetId=String(args[0]||"").replace(/^@/,"");
    if (!/^\d{5,20}$/.test(targetId)) {
      await reply("Укажи Telegram ID числом. Пример: <code>.user 123456789</code>", "HTML");
      return true;
    }
    const {data:target,error:targetError}=await admin.from("profiles")
      .select("id,telegram_id,telegram_username,display_name,is_banned,ban_reason,created_at")
      .eq("telegram_id",targetId).maybeSingle();
    if(targetError)throw targetError;
    if(!target){await reply("Аккаунт с таким Telegram ID не найден.");return true;}
    if(targetId===FOUNDER_TELEGRAM_ID && ["grantpremium","givepremium","revokepremium","delpremium","banuser","unbanuser"].includes(command)){
      await reply("Защищённый аккаунт Основателя нельзя изменять этими командами.");
      return true;
    }
    if(command==="user"||command==="userinfo"){
      const {data:sub,error:subError}=await admin.from("user_subscriptions").select("plan,expires_at")
        .eq("user_id",target.id).maybeSingle();
      if(subError)throw subError;
      const active=!sub?.expires_at||new Date(sub.expires_at).getTime()>Date.now();
      await reply(tgEmoji("user")+" <b>Информация об аккаунте</b>\n"+
        "ID: <code>"+escapeHtml(target.telegram_id)+"</code>\n"+
        "Username: "+(target.telegram_username?"@"+escapeHtml(target.telegram_username):"не указан")+"\n"+
        "Имя: "+escapeHtml(target.display_name||"не указано")+"\n"+
        "Тариф: <b>"+escapeHtml(sub?.plan||"free")+"</b>"+(sub?.expires_at?" до "+escapeHtml(new Date(sub.expires_at).toLocaleString("ru-RU")):"")+"\n"+
        "Статус: <b>"+(target.is_banned?"заблокирован":"активен")+"</b>"+(target.ban_reason?"\nПричина: "+escapeHtml(target.ban_reason):""), "HTML");
      return true;
    }
    if(command==="grantpremium"||command==="givepremium"){
      const days=Number(args[1]);
      if(!Number.isInteger(days)||days<1||days>3650){await reply("Формат: <code>.grantpremium TELEGRAM_ID ДНИ</code> (1–3650)", "HTML");return true;}
      const expiresAt=new Date(Date.now()+days*86400000).toISOString();
      const {error:grantError}=await admin.from("user_subscriptions").upsert({
        user_id:target.id,plan:"premium",starts_at:new Date().toISOString(),expires_at:expiresAt,granted_by:profile.id,updated_at:new Date().toISOString()
      },{onConflict:"user_id"});
      if(grantError)throw grantError;
      await writeAdminAudit("grant_premium",targetId,{days});
      await reply(tgEmoji("success")+" Premium выдан пользователю <code>"+escapeHtml(targetId)+"</code> на <b>"+days+" дн.</b>\nДо: <code>"+escapeHtml(expiresAt)+"</code>", "HTML");
      return true;
    }
    if(command==="revokepremium"||command==="delpremium"){
      const {error:revokeError}=await admin.from("user_subscriptions").delete().eq("user_id",target.id);
      if(revokeError)throw revokeError;
      await writeAdminAudit("revoke_premium",targetId);
      await reply(tgEmoji("success")+" Подписка пользователя <code>"+escapeHtml(targetId)+"</code> снята. Теперь тариф FREE.", "HTML");
      return true;
    }
    if(command==="banuser"){
      const reason=args.slice(1).join(" ").trim().slice(0,500)||"Нарушение правил FLAMEXBOT";
      if(targetId===FOUNDER_TELEGRAM_ID){await reply("Основателя нельзя заблокировать этой командой.");return true;}
      const {error:banError}=await admin.from("profiles").update({is_banned:true,ban_reason:reason,banned_at:new Date().toISOString(),banned_by:profile.id}).eq("id",target.id);
      if(banError)throw banError;
      await writeAdminAudit("ban_user",targetId,{reason});
      await reply(tgEmoji("success")+" Аккаунт <code>"+escapeHtml(targetId)+"</code> заблокирован.\nПричина: "+escapeHtml(reason), "HTML");
      return true;
    }
    if(command==="unbanuser"){
      const {error:unbanError}=await admin.from("profiles").update({is_banned:false,ban_reason:null,banned_at:null,banned_by:null}).eq("id",target.id);
      if(unbanError)throw unbanError;
      await writeAdminAudit("unban_user",targetId);
      await reply(tgEmoji("success")+" Блокировка аккаунта <code>"+escapeHtml(targetId)+"</code> снята.", "HTML");
      return true;
    }
  }

  let warnChatId: string | null = null;
  if(command==="warn"){
    const {data:warnChat,error:warnChatError}=await admin.from("flamexbot_business_chats")
      .select("id").eq("profile_id",profile.id).eq("telegram_chat_id",String(message.chat.id))
      .eq("business_connection_id",businessConnectionId).maybeSingle();
    if(warnChatError)throw warnChatError;
    if(!warnChat){await reply("Не удалось определить текущий Business-диалог.");return true;}
    warnChatId=warnChat.id;
  }
  if (command === "advertising") {
    const {data:existingCode,error:codeError}=await admin.from("flamexbot_referral_codes").select("code").eq("user_id",profile.id).maybeSingle();
    if(codeError)throw codeError;
    let referralCode=existingCode?.code;
    if(!referralCode){
      const generated=crypto.randomUUID().replace(/-/g,"").slice(0,10).toUpperCase();
      const {error:insertError}=await admin.from("flamexbot_referral_codes").upsert({user_id:profile.id,code:generated},{onConflict:"user_id",ignoreDuplicates:true});
      if(insertError)throw insertError;
      const {data:created,error:createdError}=await admin.from("flamexbot_referral_codes").select("code").eq("user_id",profile.id).single();
      if(createdError)throw createdError;
      referralCode=created.code;
    }
    const referralLink=`https://t.me/Flamexgame?start=ref_${referralCode}`;
    await reply(`Я использую @Flamexgame, и я очень рад его использовать. Используй мою реферальную ссылку и получи premium на 3 дня бесплатно!\n\n${referralLink}`);
    return true;
  }
  if (command === "history") {
    const progress = await sendBusinessReply(businessConnectionId, message.chat.id,
      tgEmoji("upload") + " <b>FLAMEXBOT · публикация истории</b>\n\nПроверяю медиа и подготавливаю вертикальный формат…", "HTML");
    try {
      const story = await postBusinessStoryFromReply(message, businessConnectionId, connectionOverride);
      await telegram("editMessageText", {
        business_connection_id: businessConnectionId, chat_id: message.chat.id, message_id: progress.message_id,
        text: tgEmoji("success") + " <b>История опубликована</b>\n\nID: <code>" + escapeHtml(String(story?.id ?? "—")) + "</code>",
        parse_mode: "HTML",
      });
    } catch (error) {
      const reason = String((error as any)?.message ?? error);
      await telegram("editMessageText", {
        business_connection_id: businessConnectionId, chat_id: message.chat.id, message_id: progress.message_id,
        text: tgEmoji("warning") + " <b>Не удалось опубликовать историю</b>\n\n" + escapeHtml(reason),
        parse_mode: "HTML",
      });
    }
    return true;
  }
  if(command==="clone"){
    const source=message.reply_to_message;
    if(!source||String(source.from?.id??"")===String(message.from.id)){
      await reply("Ответь командой .clone на сообщение собеседника, которое нужно скопировать.");
      return true;
    }
    const sourceMedia=messageMedia(source);
    const sourceText=String(source.text??source.caption??"").trim();
    const attribution="📋 Копия сообщения собеседника:\n";
    if(sourceMedia.fileId){
      const methods:Record<string,{method:string;field:string}>={photo:{method:"sendPhoto",field:"photo"},video:{method:"sendVideo",field:"video"},animation:{method:"sendAnimation",field:"animation"},document:{method:"sendDocument",field:"document"},audio:{method:"sendAudio",field:"audio"},voice:{method:"sendVoice",field:"voice"}};
      const selected=methods[sourceMedia.type];
      if(!selected){await reply("Этот тип медиа пока нельзя скопировать.");return true;}
      const payload:Record<string,unknown>={business_connection_id:businessConnectionId,chat_id:message.chat.id,[selected.field]:sourceMedia.fileId};
      if(sourceText)payload.caption=(attribution+sourceText).slice(0,1024);
      await telegram(selected.method,payload);
      if(!sourceText)await reply("📋 Копия медиа собеседника.");
    }else if(sourceText){
      await telegram("sendMessage",{business_connection_id:businessConnectionId,chat_id:message.chat.id,text:attribution+sourceText});
    }else{
      await reply("В сообщении нет текста или поддерживаемого медиа для копирования.");
    }
    return true;
  }
  if(command==="panic"){
    const {data:panicChat,error:panicChatError}=await admin.from("flamexbot_business_chats").select("id").eq("profile_id",profile.id).eq("telegram_chat_id",String(message.chat.id)).eq("business_connection_id",businessConnectionId).maybeSingle();
    if(panicChatError)throw panicChatError;
    if(!panicChat){await reply("Не удалось определить текущий диалог.");return true;}
    if(connectionOverride?.rights?.can_delete_all_messages!==true){
      await reply("Для удаления переписки у обоих Telegram Business должен выдать право «Удалять все сообщения».");
      return true;
    }
    await reply("⚠️ <b>Удалить переписку у обоих?</b>\nБудут удалены доступные Telegram сообщения за последние 48 часов. Это действие нельзя отменить.", "HTML", {
      inline_keyboard:[[{text:"🗑 Да, удалить переписку",callback_data:`fb:panic_yes:${panicChat.id}`}],[{text:"Отмена",callback_data:`fb:panic_no:${panicChat.id}`}]]
    });
    return true;
  }
  if(command==="warn"){
    const {data:currentWarn,error:currentWarnError}=await admin.from("flamexbot_business_chat_settings")
      .select("warn_enabled,warn_threshold").eq("profile_id",profile.id).eq("business_chat_id",warnChatId).maybeSingle();
    if(currentWarnError)throw currentWarnError;
    const hasArg=args[0]!=null&&String(args[0]).trim()!=="";
    const threshold=hasArg?Number(args[0]):Number(currentWarn?.warn_threshold||0);
    if(!hasArg&&!currentWarn?.warn_enabled){
      await reply("Формат: .warn N — включить автомут после 2–100 сообщений. Повтори .warn с тем же числом или отправь .warn ещё раз без числа, чтобы выключить.");
      return true;
    }
    if(hasArg&&(!Number.isInteger(threshold)||threshold<2||threshold>100)){
      await reply("Формат: .warn N — допустимо от 2 до 100. Например: .warn 5");
      return true;
    }
    const enabled=!(Boolean(currentWarn?.warn_enabled)&&(!hasArg||Number(currentWarn?.warn_threshold)===threshold));
    if(enabled&&connectionOverride?.rights?.can_delete_all_messages!==true){
      await reply("Для автомутa Telegram Business должен выдать право «Удалять все сообщения».");
      return true;
    }
    const {error:warnError}=await admin.from("flamexbot_business_chat_settings").upsert({
      profile_id:profile.id,business_chat_id:warnChatId,warn_enabled:enabled,
      warn_threshold:enabled?threshold:0,warn_count:0,updated_at:new Date().toISOString()
    },{onConflict:"profile_id,business_chat_id"});
    if(warnError)throw warnError;
    await reply(enabled
      ? `Автомут включён: после ${threshold} сообщений собеседника подряд FLAMEXBOT включит мут. Повтори .warn ${threshold}, чтобы выключить.`
      : "Автомут выключен повторной командой .warn.");
    return true;
  }
  if (command === "streak") {
    const { data: adminBadge, error: adminBadgeError } = await admin.from("profile_badges")
      .select("badge_code").eq("user_id",profile.id).eq("badge_code","administrator").limit(1).maybeSingle();
    if (adminBadgeError) throw adminBadgeError;
    const canManage = String(message.from.id) === FOUNDER_TELEGRAM_ID || Boolean(adminBadge);
    if (!canManage) {
      await reply("⛔ Команда .streak доступна только владельцу и администраторам FLAMEXBOT.");
      return true;
    }
    const days = Number(args[0] ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      await reply("Формат: .streak 1-3650. Например, .streak 7 — установить серию на 7 дней.");
      return true;
    }
    const { error: streakError } = await admin.rpc("admin_set_flamexbot_streak", {
      p_admin_telegram_id: String(message.from.id),
      p_target_telegram_id: String(message.chat.id),
      p_days: days,
    });
    if (streakError) {
      await reply(`Не удалось установить огонёк: ${escapeHtml(streakError.message)}`, "HTML");
      return true;
    }
    await reply(`${tgEmoji("sparkles")} <b>Огонёк установлен мгновенно!</b>\nСерия: <b>${days} дн.</b>\nПользователь добавлен в друзья, если вы ещё не были друзьями. Дальше огонёк будет продлеваться обычной взаимной перепиской.`, "HTML");
    return true;
  }
  const commandNeedsPremium = ["afk","timeprofile","bold","dumb","link","time","autoread","autotyping","autovoice","mutestick","antimat","uncopyp","dox","snos","hack","ddos","ban","burger","stab","shoot","kill","bury","burn","choke","tie","slapbutt","пырнуть","выстрелить","убить","закопать","сжечь","удушить","задушить","отшлепать","связать","aura","fortune","mood"].includes(command);
  let premium = false;
  if (commandNeedsPremium) {
    const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
      .select("plan,expires_at").eq("user_id", profile.id).maybeSingle();
    if (subscriptionError) throw subscriptionError;
    const active = !subscription?.expires_at || new Date(subscription.expires_at).getTime() > Date.now();
    premium = ["premium","founder"].includes(subscription?.plan) && active;
  }
  if (!premium && commandNeedsPremium) {
    await reply(`${tgEmoji("star")} Для этой команды нужна активная подписка <b>Premium</b>. Команды отключения и размут доступны и без неё.`, "HTML");
    return true;
  }

  const rpAliases: Record<string, string> = {
    обнять: "hug", поцеловать: "kiss", расцеловать: "kiss", засосать: "kiss",
    прижать: "squeeze", погладить: "pat", положитьнаколени: "lap", укрыть: "cover",
    успокоить: "calm", подкормить: "feed", покормить: "food", напоить: "drink",
    поздравить: "congrats", поприветствовать: "greet", пожать: "handshake", попрощаться: "bye",
    укусить: "bite", лизнуть: "lick", шлепнуть: "slap", испугать: "scare",
    ударить: "hit", врезать: "punch", пнуть: "kick", удушить: "choke", задушить: "choke",
    пырнуть: "stab", выстрелить: "shoot", убить: "kill", закопать: "bury",
    отшлепать: "slapbutt", связать: "tie", плюнуть: "spit", сжечь: "burn",
    послать: "dismiss", украсть: "steal", похоронить: "funeral",
  };
  // RP animations are deliberately fictional, playful and non-graphic.
  const rpActions: Record<string, { title: string; frames: string[] }> = {
    hug: { title: "обнимает", frames: ["Подходит поближе…", "Крепко и дружески обнимает 🤗"] },
    kiss: { title: "целует", frames: ["Смущённо улыбается…", "Оставляет нежный поцелуй 💗"] },
    cuddle: { title: "прижимается", frames: ["Устраивается рядом…", "Уютно прижимается 🧸"] },
    squeeze: { title: "прижимает", frames: ["Осторожно подходит…", "Мягко обнимает покрепче 🤗"] },
    pat: { title: "гладит", frames: ["Поднимает руку…", "Ласково гладит по голове ✨"] },
    lap: { title: "усаживает рядом", frames: ["Освобождает место…", "Предлагает уютно устроиться рядом 🪑"] },
    cover: { title: "укрывает", frames: ["Берёт тёплый плед…", "Заботливо укрывает 🌙"] },
    calm: { title: "успокаивает", frames: ["Замечает тревогу…", "Говорит: «Всё будет хорошо» 💙"] },
    feed: { title: "угощает", frames: ["Достаёт вкусняшку…", "Угощает 🍪"] },
    food: { title: "кормит", frames: ["Готовит угощение…", "Подаёт вкусную еду 🍓"] },
    drink: { title: "угощает напитком", frames: ["Наливает напиток…", "Протягивает стакан 🥤"] },
    congrats: { title: "поздравляет", frames: ["Готовит сюрприз…", "Поздравляет и желает удачи 🎉"] },
    greet: { title: "приветствует", frames: ["Машет рукой…", "Радостно говорит: «Привет!» 👋"] },
    handshake: { title: "жмёт руку", frames: ["Протягивает руку…", "Крепкое рукопожатие 🤝"] },
    bye: { title: "прощается", frames: ["Улыбается напоследок…", "Машет рукой: «До встречи!» 👋"] },
    bite: { title: "слегка кусает", frames: ["Делает смешной вид…", "Оставляет шуточный укус 🐾"] },
    lick: { title: "лизнул", frames: ["Подкрадывается…", "Быстро лизнул и убежал 😛"] },
    slap: { title: "шлёпает в шуточной сценке", frames: ["Замахивается подушкой…", "Пух! Подушечная битва ☁️"] },
    scare: { title: "пугает", frames: ["Прячется за углом…", "Внезапно кричит: «Бу!» 👻"] },
    hit: { title: "попадает по игровой мишени", frames: ["Прицеливается в тренировочную мишень…", "Попадание! 🎯"] },
    punch: { title: "устраивает шуточный спарринг", frames: ["Надевает боксёрские перчатки…", "Лёгкий игровой удар по груше 🥊"] },
    kick: { title: "бьёт по мячу", frames: ["Разбегается…", "Отправляет мяч в ворота ⚽"] },
    choke: { title: "разыгрывает сценку", frames: ["Делает драматичное лицо…", "Сценка заканчивается смехом 🎭"] },
    stab: { title: "разыгрывает сценку с игрушечным мечом", frames: ["Достаёт мягкий реквизит…", "Игрушечный меч эффектно звенит ⚔️"] },
    shoot: { title: "стреляет по мишени в тире", frames: ["Поднимает игрушечный бластер…", "Попадает в мишень: +10 очков 🎯"] },
    kill: { title: "побеждает в игровой дуэли", frames: ["Начинается игровая дуэль…", "Победа! Персонаж возвращается на респавн 🎮"] },
    bury: { title: "закапывает клад", frames: ["Находит лопатку…", "Прячет клад в песочнице 🪣"] },
    slapbutt: { title: "разыгрывает комедийную сценку", frames: ["Поднимает подушку…", "Пух! Все смеются 😂"] },
    tie: { title: "завязывает ленточку", frames: ["Берёт мягкую ленту…", "Аккуратно завязывает бантик 🎀"] },
    spit: { title: "плюётся водой в игре", frames: ["Набирает немного воды…", "Комичный фонтанчик 💦"] },
    burn: { title: "сжигает бумажную мишень", frames: ["Зажигает виртуальный фитиль…", "Бумажная мишень превращается в конфетти 🎊"] },
    dismiss: { title: "отправляет отдыхать", frames: ["Указывает на выход…", "Шуточно говорит: «Свободен!» 🚪"] },
    steal: { title: "крадёт печеньку", frames: ["Оглядывается по сторонам…", "Печенька исчезает 🍪"] },
    funeral: { title: "устраивает церемонию для игрового персонажа", frames: ["Звучит торжественная музыка…", "Персонаж отправляется в виртуальный зал славы 🕊️"] },
    love: { title: "признаётся в симпатии", frames: ["Немного волнуется…", "Дарит сердечко ❤️"] },
    dox: { title: "запускает фейковое OSINT-досье", frames: ["[OSINT] Инициализация локального симулятора…", "Поиск по тестовому профилю: 192.0.2.42 · demo@example.invalid…", "ОТЧЁТ ГОТОВ: объект найден у холодильника рядом с пиццей. Все данные тестовые."] },
    snos: { title: "запускает симуляцию массовых жалоб", frames: ["[REPORT CENTER] Создание тестовой заявки #DEMO-2048…", "Проверка статусов: 3/3 · очередь модерации…", "РЕЗУЛЬТАТ: тестовая заявка закрыта. Реальные жалобы не отправлялись."] },
    hack: { title: "запускает фейковую консоль взлома", frames: ["[SECURITY CONSOLE] Establishing demo session…", "Enumerating sandbox nodes… 3 hosts · 0 real targets…", "ACCESS GRANTED · DEMO MODE. Никакие аккаунты или устройства не затронуты."] },
    ddos: { title: "запускает конфетти-атаку", frames: ["Заряжает виртуальную пушку…", "Пакеты конфетти отправлены…", "Сервер выдержал. Чат украшен конфетти"] },
    ban: { title: "выдаёт шуточный игровой бан", frames: ["Открывает игровую панель…", "Таймер бана: 00:01…", "Бан завершён. Персонаж вернулся на респавн"] },
  };
  const rpPremiumCommands = new Set(["dox","snos","hack","ddos","ban","burger","stab","shoot","kill","bury","burn","choke","tie","slapbutt"]);
  const isRpCommand = ["hug","kiss","cuddle","squeeze","pat","lap","cover","calm","feed","food","drink","congrats","greet","handshake","bye","bite","lick","slap","scare","hit","punch","kick","choke","stab","shoot","kill","bury","slapbutt","tie","spit","burn","dismiss","steal","funeral","love","dox","snos","hack","ddos","ban","burger","обнять","поцеловать","расцеловать","засосать","прижать","погладить","положитьнаколени","укрыть","успокоить","подкормить","покормить","напоить","поздравить","поприветствовать","пожать","попрощаться","укусить","лизнуть","шлепнуть","испугать","ударить","врезать","пнуть","удушить","задушить","пырнуть","выстрелить","убить","закопать","отшлепать","связать","плюнуть","сжечь","послать","украсть","похоронить"].includes(command);
  if (isRpCommand) {
    const { data: rpChat, error: rpChatError } = await admin.from("flamexbot_business_chats")
      .select("id,telegram_chat_id,telegram_user_id,first_name,last_name")
      .eq("profile_id", profile.id).eq("telegram_chat_id", String(message.chat.id))
      .eq("business_connection_id", businessConnectionId).maybeSingle();
    if (rpChatError) throw rpChatError;
    if (!rpChat) { await reply("Не удалось определить текущий Business-диалог."); return true; }
    const rpKey = rpAliases[command] || command;
    const rpAction = rpActions[rpKey];
    if (rpKey === "burger") {
      let burgerPack: any;
      try { burgerPack = await telegram("getStickerSet", { name: "stickers4_burger" }); }
      catch (error) { await reply("Не удалось загрузить стикеры бургера: " + String((error as any)?.message || error)); return true; }
      const burgerStickers = Array.isArray(burgerPack?.stickers) ? burgerPack.stickers : [];
      if (burgerStickers.length < 2) { await reply("В наборе не нашлось двух кадров для ловушки."); return true; }
      const openSticker = burgerStickers[0]?.file_id, closeSticker = burgerStickers[1]?.file_id;
      if (!openSticker || !closeSticker) { await reply("Не удалось получить файлы стикеров."); return true; }
      const { error: trapError } = await admin.from("flamexbot_business_chat_settings").upsert({
        profile_id: profile.id, business_chat_id: rpChat.id, burger_trap_armed: true,
        burger_open_sticker_id: openSticker, burger_close_sticker_id: closeSticker,
      }, { onConflict: "profile_id,business_chat_id" });
      if (trapError) throw trapError;
      await telegram("sendSticker", { business_connection_id: businessConnectionId, chat_id: message.chat.id, sticker: openSticker });
      await reply("Бургер открыт! Ловушка сработает один раз на следующем сообщении собеседника.");
      return true;
    }
    if (rpAction) {
      const simulationLabel = ["dox","snos","hack","ddos","ban"].includes(rpKey) ? "FLAMEXBOT · СИМУЛЯЦИЯ" : "FLAMEXBOT · RP-сценка";
      const targetName = [rpChat.first_name, rpChat.last_name].filter(Boolean).join(" ") || "собеседника";
      const mention = rpChat.telegram_user_id ? '<a href="tg://user?id=' + escapeHtml(String(rpChat.telegram_user_id)) + '">' + escapeHtml(targetName) + '</a>' : '<b>' + escapeHtml(targetName) + '</b>';
      const progress = await sendBusinessReply(businessConnectionId, message.chat.id,
        tgEmoji("sparkles") + " <b>" + simulationLabel + "</b>\\n\\n" + mention + " · " + escapeHtml(rpAction.title) + "\\n<code>▰▱▱▱▱▱▱▱▱▱ 10%</code>", "HTML");
      const sequence = [
        { icon: "search", text: "Подготовка реквизита и декораций…", percent: 25 },
        { icon: "lightning", text: rpAction.frames[0], percent: 60 },
        { icon: "sparkles", text: rpAction.frames.length > 2 ? rpAction.frames[1] : rpAction.frames[rpAction.frames.length - 1], percent: 85 },
        { icon: "success", text: rpAction.frames[rpAction.frames.length - 1], percent: 100 },
      ];
      for (let i=0;i<sequence.length;i++) {
        await new Promise(resolve => setTimeout(resolve, 220));
        const frame = sequence[i];
        const filled = Math.round(frame.percent / 10);
        await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
          text:tgEmoji(frame.icon as keyof typeof PREMIUM_EMOJI)+" <b>" + simulationLabel + "</b>\\n\\n"+mention+" · "+escapeHtml(rpAction.title)+"\\n<b>"+escapeHtml(frame.text)+"</b>\\n<code>"+ "▰".repeat(filled) + "▱".repeat(10-filled) + " " + frame.percent + "%</code>",parse_mode:"HTML"});
      }
      return true;
    }
  }

  if (command === "dice" || command === "кубик") {
    const frames = ["⚀","⚁","⚂","⚃","⚄","⚅"];
    const result = Math.floor(Math.random()*6)+1;
    const progress = await sendBusinessReply(businessConnectionId,message.chat.id,tgEmoji("sparkles")+" <b>FLAMEXBOT · бросок кубика</b>\\n\\nПодбрасываю… <code>0%</code>","HTML");
    for (let i=0;i<3;i++) {
      await new Promise(resolve=>setTimeout(resolve,160));
      await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
        text:tgEmoji(i===2?"success":"lightning")+" <b>FLAMEXBOT · бросок кубика</b>\\n\\n"+(i===2?"Выпало: <b>"+frames[result-1]+" · "+result+"</b>":"Кубик вращается… <code>"+(35+i*30)+"%</code>"),parse_mode:"HTML"});
    }
    return true;
  }
  if (command === "rps" || command === "кнб") {
    const choice = String(args[0]||"").toLowerCase();
    const valid = ["камень","ножницы","бумага","rock","paper","scissors"];
    if (!valid.includes(choice)) { await reply("Формат: .кнб камень / ножницы / бумага"); return true; }
    const map:Record<string,string>={rock:"камень",paper:"бумага",scissors:"ножницы"};
    const userChoice=map[choice]||choice;
    const botChoice=["камень","ножницы","бумага"][Math.floor(Math.random()*3)];
    const win=userChoice===botChoice?"Ничья!":((userChoice==="камень"&&botChoice==="ножницы")||(userChoice==="ножницы"&&botChoice==="бумага")||(userChoice==="бумага"&&botChoice==="камень"))?"Ты победил!":"Победил FLAMEXBOT!";
    const progress=await sendBusinessReply(businessConnectionId,message.chat.id,tgEmoji("sparkles")+" <b>FLAMEXBOT · КНБ</b>\n\nВыбираю ход… <code>30%</code>","HTML");
    await new Promise(resolve=>setTimeout(resolve,260));
    await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
      text:tgEmoji("success")+" <b>Камень · Ножницы · Бумага</b>\nТвой выбор: <b>"+userChoice+"</b>\nFLAMEXBOT: <b>"+botChoice+"</b>\n\n<b>"+win+"</b>","parse_mode":"HTML"});
    return true;
  }
  if (command === "rate" || command === "оценить") {
    const value=Math.floor(Math.random()*101);
    const progress=await sendBusinessReply(businessConnectionId,message.chat.id,tgEmoji("search")+" <b>FLAMEXBOT · анализ настроения</b>\n\nСчитаю шуточную оценку… <code>0%</code>","HTML");
    for(let i=1;i<=3;i++){
      await new Promise(resolve=>setTimeout(resolve,130));
      const shown=i===3?value:Math.min(99,Math.floor(Math.random()*100));
      const filled=Math.round(shown/10);
      await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
        text:tgEmoji(i===3?"success":"lightning")+" <b>Оценка собеседника</b>\n<code>"+"▰".repeat(filled)+"▱".repeat(10-filled)+"</code>\n<b>"+(i===3?value:shown)+"/100</b>"+(i===3?"\n<i>Результат шуточный, не серьёзный рейтинг.</i>":"\n<i>Подсчитываю…</i>"),parse_mode:"HTML"});
    }
    return true;
  }
  if (command === "aura" || command === "fortune" || command === "mood") {
    const pools:Record<string,string[]>={aura:["Легендарная аура","Спокойная аура","Энергия лидера","Загадочная аура"],fortune:["Сегодня тебя ждёт приятный сюрприз","Не торопись с решениями","Удача на твоей стороне","Впереди интересное знакомство"],mood:["Отличное настроение","Немного грустное","На максимальной энергии","Спокойное и тёплое"]};
    const pool=pools[command]; const value=pool[Math.floor(Math.random()*pool.length)];
    const label=command==="aura"?"Сканирую ауру":command==="fortune"?"Читаю предсказание":"Определяю настроение";
    const progress=await sendBusinessReply(businessConnectionId,message.chat.id,tgEmoji("diamond")+" <b>FLAMEXBOT · "+command.toUpperCase()+"</b>\n\n"+label+"…","HTML");
    await new Promise(resolve=>setTimeout(resolve,300));
    await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
      text:tgEmoji("success")+" <b>FLAMEXBOT · "+command.toUpperCase()+"</b>\n\n"+escapeHtml(value)+"\n\n<i>Шуточный результат для настроения.</i>",parse_mode:"HTML"});
    return true;
  }
  if (command === "coin" || command === "монетка") {
    const side = Math.random() < 0.5 ? "Орёл" : "Решка";
    const progress=await sendBusinessReply(businessConnectionId,message.chat.id,tgEmoji("sparkles")+" <b>FLAMEXBOT · монетка</b>\n\nПодбрасываю… <code>0%</code>","HTML");
    for(let i=1;i<=3;i++){
      await new Promise(resolve=>setTimeout(resolve,150));
      await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
        text:tgEmoji(i===3?"success":"lightning")+" <b>FLAMEXBOT · монетка</b>\n\n"+(i===3?"Выпало: <b>"+side+"</b>":"Монетка вращается… <code>"+(i*30)+"%</code>"),parse_mode:"HTML"});
    }
    return true;
  }
  if (command === "8ball" || command === "шар") {
    const question = args.join(" ").trim();
    if (!question) { await reply("Формат: .8ball твой вопрос"); return true; }
    const answers = ["Определённо да","Похоже, да","Скорее всего","Пока неясно","Спроси позже","Скорее нет","Определённо нет"];
    const answer = answers[Math.floor(Math.random()*answers.length)];
    const progress=await sendBusinessReply(businessConnectionId,message.chat.id,tgEmoji("search")+" <b>Магический шар</b>\n\nВопрос: "+escapeHtml(question)+"\n\nИщу ответ…","HTML");
    await new Promise(resolve=>setTimeout(resolve,320));
    await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
      text:tgEmoji("diamond")+" <b>Магический шар отвечает</b>\n\n"+escapeHtml(question)+"\n\n<b>"+answer+"</b>","parse_mode":"HTML"});
    return true;
  }
  if (command === "ship" || command === "совместимость") {
    const percent = Math.floor(Math.random()*101);
    const filled=Math.round(percent/10);
    const progress=await sendBusinessReply(businessConnectionId,message.chat.id,tgEmoji("sparkles")+" <b>FLAMEXBOT · совместимость</b>\n\nСверяю две воображаемые звезды… <code>0%</code>","HTML");
    for(let i=1;i<=3;i++){
      await new Promise(resolve=>setTimeout(resolve,150));
      const shown=i===3?percent:Math.min(99,Math.floor(Math.random()*100));
      const count=Math.round(shown/10);
      await telegram("editMessageText",{business_connection_id:businessConnectionId,chat_id:message.chat.id,message_id:progress.message_id,
        text:tgEmoji(i===3?"success":"sparkles")+" <b>Совместимость</b>\n<code>"+"▰".repeat(count)+"▱".repeat(10-count)+"</code>\n<b>"+(i===3?percent:shown)+"%</b>"+(i===3?"\n<i>Результат исключительно шуточный.</i>":""),parse_mode:"HTML"});
    }
    return true;
  }

  if (command === "afk") {
    const currentBusinessChat = await getCurrentBusinessChat();
    if (!currentBusinessChat) { await reply("Не удалось определить текущий Business-диалог."); return true; }
    const { data: currentAfk, error: currentAfkError } = await admin.from("flamexbot_business_chat_settings")
      .select("afk_enabled").eq("profile_id", profile.id).eq("business_chat_id", currentBusinessChat.id).maybeSingle();
    if (currentAfkError) throw currentAfkError;
    const enabled = !Boolean(currentAfk?.afk_enabled);
    const reason = args.join(" ").trim().slice(0, 300) || "Сейчас отошёл, отвечу позже.";
    const { error: afkError } = await admin.from("flamexbot_business_chat_settings").upsert({
      profile_id: profile.id, business_chat_id: currentBusinessChat.id, afk_enabled: enabled,
      ...(enabled ? { afk_message: reason, last_afk_reply_at: null } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id,business_chat_id" });
    if (afkError) throw afkError;
    await reply(enabled ? "🌙 AFK включён только в этом диалоге." : "AFK выключен в этом диалоге.");
    return true;
  }
  const preferenceCommands: Record<string, { key: string; label: string }> = {
    autoread: { key: "autoread_enabled", label: "Автопрочтение" },
    autotyping: { key: "autotyping_enabled", label: "Статус «печатает…»" },
    autovoice: { key: "autovoice_enabled", label: "Статус записи голосового" },
    mutestick: { key: "mutestick_enabled", label: "Фильтр стикеров" },
    antimat: { key: "antimat_enabled", label: "Антимат" },
  };
  const preferenceCommand = preferenceCommands[command];
  if (preferenceCommand) {
    const currentBusinessChat = await getCurrentBusinessChat();
    if (!currentBusinessChat) { await reply("Не удалось определить текущий Business-диалог."); return true; }
    const { data: currentPreference, error: currentPreferenceError } = await admin.from("flamexbot_business_chat_settings")
      .select(preferenceCommand.key).eq("profile_id", profile.id).eq("business_chat_id", currentBusinessChat.id).maybeSingle();
    if (currentPreferenceError) throw currentPreferenceError;
    const enabled = !Boolean(currentPreference?.[preferenceCommand.key]);
    if (enabled && ["mutestick_enabled","antimat_enabled"].includes(preferenceCommand.key) &&
        connectionOverride?.rights?.can_delete_all_messages !== true) {
      await reply("⛔ Для включения фильтра Telegram Business должен выдать право «Удалять все сообщения».");
      return true;
    }
    const { error: chatPreferenceError } = await admin.from("flamexbot_business_chat_settings").upsert({
      profile_id: profile.id, business_chat_id: currentBusinessChat.id,
      [preferenceCommand.key]: enabled, updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id,business_chat_id" });
    if (chatPreferenceError) throw chatPreferenceError;
    await reply((enabled ? tgEmoji("success") + " <b>" : tgEmoji("lock") + " <b>") +
      escapeHtml(preferenceCommand.label) + (enabled ? " включён.</b>" : " выключен.</b>"), "HTML");
    return true;
  }
  if (command === "antimute" || command === "antimut") {
    if (!businessConnectionId) { await reply("Команда работает только внутри подключённого Business-чата."); return true; }
    const currentBusinessChat = await getCurrentBusinessChat();
    if (!currentBusinessChat) { await reply("Не удалось определить этот Business-чат."); return true; }
    if (isFounderTarget(currentBusinessChat.telegram_chat_id, currentBusinessChat.telegram_user_id)) {
      await reply(tgEmoji("lock") + " <b>Владелец FLAMEXBOT защищён.</b> Режимы управления для этого диалога отключены.", "HTML");
      return true;
    }
    const { data: currentAnti, error: currentAntiError } = await admin.from("flamexbot_business_chat_settings")
      .select("antimut_enabled,antimut_enabled_at").eq("profile_id", profile.id).eq("business_chat_id", currentBusinessChat.id).maybeSingle();
    if (currentAntiError) throw currentAntiError;
    const enabled = !Boolean(currentAnti?.antimut_enabled);
    if (enabled) {
      const { data: antiSubscription, error: antiSubscriptionError } = await admin.from("user_subscriptions").select("plan,expires_at").eq("user_id", profile.id).maybeSingle();
      if (antiSubscriptionError) throw antiSubscriptionError;
      const antiPremium = ["premium","founder"].includes(antiSubscription?.plan) && (!antiSubscription.expires_at || new Date(antiSubscription.expires_at).getTime() > Date.now());
      if (!antiPremium) { await reply(tgEmoji("star") + " <b>Для включения антимута нужна активная подписка Premium.</b> Выключение бесплатно.", "HTML"); return true; }
    }
    if (enabled && connectionOverride?.rights?.can_reply !== true) {
      await reply(tgEmoji("warning") + " <b>Для антимута нужно право «Отправлять сообщения» в настройках Telegram Business.</b>", "HTML");
      return true;
    }
    const { error: settingError } = await admin.from("flamexbot_business_chat_settings").upsert({ profile_id: profile.id, business_chat_id: currentBusinessChat.id, antimut_enabled: enabled, antimut_enabled_at: enabled ? new Date(Math.floor(Date.now() / 1000) * 1000).toISOString() : null, updated_at: new Date().toISOString() }, { onConflict: "profile_id,business_chat_id" });
    if (settingError) throw settingError;
    const antimutMarkup = { inline_keyboard: [[{
      text: enabled ? "Выключить антимут" : "Включить антимут",
      callback_data: `fb:antimut_${enabled ? "off" : "on"}:${currentBusinessChat.id}`,
    }]] };
    await reply(
      enabled
        ? `${tgEmoji("diamond")} <b>Антимут включён</b>\n\nЕсли другой бот удалит ваше сообщение, FLAMEXBOT восстановит его до 3 раз, пока антимут включён.\n\nРежим можно отключить кнопкой ниже или повторной командой <code>.antimute</code>.`
        : `${tgEmoji("lock")} <b>Антимут выключен</b>\nПовторная отправка ваших сообщений остановлена. Включить режим снова можно кнопкой ниже или командой <code>.antimute</code>.`,
      "HTML",
      antimutMarkup,
    );
    return true;
  }
  if (command === "timeprofile") {
    const rawOffset = args[0] == null || args[0] === "" ? "3" : String(args[0]).trim();
    if (!/^(?:\+?(?:0|[1-9]|1[0-4])|-(?:[1-9]|1[0-2]))$/.test(rawOffset)) {
      await reply("Формат: .timeprofile +3 или .timeprofile -5. Допустимый диапазон: UTC−12…UTC+14.");
      return true;
    }
    const offset = Number(rawOffset);
    await savePreference({ timezone_offset: offset });
    await reply("Часовой пояс FLAMEXBOT установлен: UTC" + (offset >= 0 ? "+" : "") + offset + ". Повтори команду с другим смещением, чтобы изменить его.");
    return true;
  }
  if (command === "bold" || command === "dumb") {
    const value = args.join(" ").trim();
    if (!value) { await reply(`Формат: .${command} текст`); return true; }
    if (command === "bold") {
      const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await reply(`<b>${escaped}</b>`, "HTML");
    } else {
      const silly = value.replace(/привет/gi, "превед").replace(/что/gi, "што").replace(/ч/gi, "4");
      await reply(silly);
    }
    return true;
  }
  if (command === "link") {
    const linkText = args.join(" ").trim();
    const username = message.chat.username;
    const url = username
      ? `https://t.me/${username}${linkText ? `?text=${encodeURIComponent(linkText)}` : ""}`
      : `tg://user?id=${message.chat.id}`;
    await reply(url);
    return true;
  }
  if (command === "time") {
    if (!businessConnectionId) {
      await reply("Команду .time отправь в личной переписке Telegram Business. Она изменяет имя подключённого аккаунта Telegram.");
      return true;
    }
    const { data: business, error: businessError } = await admin.from("flamexbot_business_connections")
      .select("connection_id,rights,is_enabled,original_first_name,original_last_name,time_name_enabled")
      .eq("profile_id", profile.id).eq("connection_id", businessConnectionId).maybeSingle();
    if (businessError) throw businessError;
    if (!business?.is_enabled) {
      await reply("Telegram Business не подключён или соединение отключено.");
      return true;
    }
    if (business.rights?.can_edit_name !== true) {
      await reply("⛔ Для .time выдай FLAMEXBOT право Telegram Business «Изменять имя профиля» и повтори команду.");
      return true;
    }
    let originalFirstName = business.original_first_name;
    let originalLastName = business.original_last_name ?? "";
    if (!originalFirstName) {
      const currentConnection = await telegram("getBusinessConnection", { business_connection_id: businessConnectionId });
      originalFirstName = String(currentConnection?.user?.first_name || "").trim();
      originalLastName = String(currentConnection?.user?.last_name || "");
      if (!originalFirstName) {
        await reply("Telegram не вернул исходное имя аккаунта. Переподключи Telegram Business и попробуй снова.");
        return true;
      }
    }
    const enabled = !Boolean(business.time_name_enabled);
    let firstName = originalFirstName;
    if (enabled) {
      const clock = new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(new Date());
      const suffix = " · " + clock;
      firstName = originalFirstName.slice(0, Math.max(1, 64 - suffix.length)) + suffix;
    }
    await telegram("setBusinessAccountName", {
      business_connection_id: businessConnectionId,
      first_name: firstName,
      last_name: originalLastName,
    });
    const { error: saveTimeError } = await admin.from("flamexbot_business_connections").update({
      original_first_name: originalFirstName,
      original_last_name: originalLastName,
      time_name_enabled: enabled,
      updated_at: new Date().toISOString(),
    }).eq("profile_id", profile.id).eq("connection_id", businessConnectionId);
    if (saveTimeError) throw saveTimeError;
    await reply(enabled
      ? "🕒 Время добавлено в имя твоего Telegram Business-профиля (МСК). Повтори .time, чтобы вернуть исходное имя."
      : "Исходное имя Telegram-профиля восстановлено.");
    return true;
  }
  if (["mute","copyp","uncopyp","profile","qr","id","chatid","date","calc","upper","lower","reverse","count","wordcount","choose","roll"].includes(command)) {
    if (!businessConnectionId) { await reply("Эту команду нужно писать в личной переписке с собеседником."); return true; }
    const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats")
      .select("id,telegram_chat_id,telegram_user_id,business_connection_id,username,first_name,last_name,photo_url")
      .eq("profile_id", profile.id).eq("telegram_chat_id", String(message.chat.id)).eq("business_connection_id", businessConnectionId).maybeSingle();
    if (chatError) throw chatError;
    if (!chat) { await reply("Не удалось определить текущий Business-чат. Проверь подключение Telegram Business."); return true; }
    if (command === "monitor") {
      const { error: monitorError } = await admin.from("flamexbot_business_monitors").upsert({
        profile_id: profile.id, business_chat_id: chat.id, enabled: true,
        started_at: new Date().toISOString(), stopped_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: "profile_id,business_chat_id" });
      if (monitorError) throw monitorError;
      await reply("📡 <b>Мониторинг включён</b>\\nОтслеживаю активность только в этом вашем Telegram Business-диалоге. Используй <code>.monitorlog</code> для журнала или <code>.stopmonitor</code> для остановки.", "HTML");
      return true;
    }
    if (command === "stopmonitor") {
      const { error: stopError } = await admin.from("flamexbot_business_monitors").upsert({
        profile_id: profile.id, business_chat_id: chat.id, enabled: false,
        stopped_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "profile_id,business_chat_id" });
      if (stopError) throw stopError;
      await reply("Мониторинг этого диалога остановлен. История сообщений в архиве не удалена.");
      return true;
    }
    if (command === "monitorlog") {
      const { data: monitor, error: monitorLookupError } = await admin.from("flamexbot_business_monitors")
        .select("enabled,started_at,stopped_at").eq("profile_id", profile.id).eq("business_chat_id", chat.id).maybeSingle();
      if (monitorLookupError) throw monitorLookupError;
      if (!monitor) { await reply("Мониторинг ещё не включался. Напиши <code>.monitor</code> для запуска.", "HTML"); return true; }
      const { data: logRows, error: logError } = await admin.from("flamexbot_business_messages")
        .select("direction,content,message_type,created_at").eq("business_chat_id", chat.id)
        .gte("created_at", monitor.started_at).order("created_at", { ascending: false }).limit(15);
      if (logError) throw logError;
      const rows = (logRows || []).reverse().map((row: any) => {
        const when = new Date(row.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
        const who = row.direction === "outbound" ? "Вы" : "Собеседник";
        const preview = String(row.content || "").replace(/\\s+/g, " ").slice(0, 110) || "[" + String(row.message_type || "media") + "]";
        return "<code>" + when + "</code> · <b>" + who + "</b>: " + escapeHtml(preview);
      });
      await reply("<b>Журнал активности · последние 15 событий</b>\\nСтатус: " + (monitor.enabled ? "включён" : "остановлен") + "\\n\\n" + (rows.length ? rows.join("\\n") : "Пока нет сохранённых сообщений."), "HTML");
      return true;
    }
    if (command === "mute") {
      const { data: currentMute, error: currentMuteError } = await admin.from("flamexbot_business_chat_settings")
        .select("is_muted").eq("profile_id", profile.id).eq("business_chat_id", chat.id).maybeSingle();
      if (currentMuteError) throw currentMuteError;
      const enabled = !Boolean(currentMute?.is_muted);
      if (enabled) {
        let business = connectionOverride;
        if (!business) {
          const { data, error } = await admin.from("flamexbot_business_connections")
            .select("rights,is_enabled").eq("profile_id", profile.id)
            .eq("connection_id", businessConnectionId).maybeSingle();
          if (error) throw error;
          business = data;
        }
        if (!business?.is_enabled || !business.rights?.can_delete_all_messages) {
          await reply("⛔ Для включения .mute нужно право Telegram Business «Удалять все сообщения».");
          return true;
        }
      }
      const { error } = await admin.from("flamexbot_business_chat_settings").upsert({
        profile_id: profile.id, business_chat_id: chat.id, is_muted: enabled, auto_flood_muted: false,
      }, { onConflict: "profile_id,business_chat_id" });
      if (error) throw error;
      const markup = { inline_keyboard: [[{
        text: enabled ? "🔊 Выключить мут" : "🔇 Включить мут",
        callback_data: `fb:mute_${enabled ? "off" : "on"}:${chat.id}`,
      }]] };
      await reply(enabled
        ? `${tgEmoji("lock")} <b>Мут включён</b>\nНовые входящие сообщения в этом диалоге будут удаляться. Уже сохранённая переписка не затрагивается.`
        : `${tgEmoji("success")} <b>Размут выполнен</b>\nНовые сообщения больше не удаляются.`,
        "HTML", markup);
      return true;
    }
    if (command === "copyp") {
      const targetId = String(chat.telegram_user_id || chat.telegram_chat_id);
      const targetFirstName = truncateTelegramText(chat.first_name || "", 64).trim();
      const targetLastName = truncateTelegramText(chat.last_name || "", 64);
      if (!targetFirstName) { await reply("Не удалось получить имя собеседника для копирования."); return true; }
      const { data: business, error: businessError } = await admin.from("flamexbot_business_connections")
        .select("connection_id,is_enabled,rights").eq("profile_id", profile.id).eq("connection_id", businessConnectionId).maybeSingle();
      if (businessError) throw businessError;
      if (!business?.is_enabled || business.rights?.can_edit_name !== true) {
        await reply("⛔ Для .copyp нужно включить право Telegram Business «Изменять имя профиля»."); return true;
      }
      const { data: activeCopy, error: activeCopyError } = await admin.from("flamexbot_business_profile_copies")
        .select("id").eq("profile_id", profile.id).eq("business_connection_id", businessConnectionId).is("restored_at", null).maybeSingle();
      if (activeCopyError) throw activeCopyError;
      if (activeCopy) { await reply("Профиль уже скопирован. Сначала используй .uncopyp."); return true; }

      const current = await telegram("getBusinessConnection", { business_connection_id: businessConnectionId });
      const originalFirstName = truncateTelegramText(current?.user?.first_name || "", 64).trim();
      const originalLastName = truncateTelegramText(current?.user?.last_name || "", 64);
      const { data: connectionRow, error: connectionRowError } = await admin.from("flamexbot_business_connections")
        .select("user_chat_id,rights").eq("profile_id", profile.id).eq("connection_id", businessConnectionId).maybeSingle();
      if (connectionRowError) throw connectionRowError;
      if (!originalFirstName || !connectionRow?.user_chat_id) {
        await reply("Не удалось безопасно получить исходные данные Business-аккаунта. Ничего не изменено."); return true;
      }

      const canEditBio = connectionRow.rights?.can_edit_bio === true;
      const canEditPhoto = connectionRow.rights?.can_edit_profile_photo === true;
      const [originalInfo, targetInfo] = (canEditBio || canEditPhoto)
        ? await Promise.all([
            telegram("getChat", { chat_id: String(connectionRow.user_chat_id) }),
            telegram("getChat", { chat_id: String(chat.telegram_chat_id) }),
          ])
        : [null, null];
      const originalBio = canEditBio ? truncateTelegramText(originalInfo?.bio || "", 140) : null;
      const targetBio = canEditBio ? truncateTelegramText(targetInfo?.bio || "", 140) : null;
      const originalPhotoId = canEditPhoto ? String(originalInfo?.photo?.big_file_id || "") : "";
      const targetPhotoId = canEditPhoto ? String(targetInfo?.photo?.big_file_id || "") : "";
      const [targetPhotoBlob, originalPhotoBlob] = await Promise.all([
        targetPhotoId ? downloadTelegramProfilePhoto(targetPhotoId) : Promise.resolve(null),
        originalPhotoId ? downloadTelegramProfilePhoto(originalPhotoId) : Promise.resolve(null),
      ]);

      const { data: snapshot, error: snapshotError } = await admin.from("flamexbot_business_profile_copies")
        .insert({
          profile_id: profile.id, business_connection_id: businessConnectionId, target_telegram_user_id: targetId,
          target_first_name: targetFirstName, target_last_name: targetLastName,
          original_first_name: originalFirstName, original_last_name: originalLastName,
          original_bio: originalBio, target_bio: targetBio,
          original_photo_present: Boolean(originalPhotoBlob), original_photo_storage_path: null,
          target_photo_copied: false,
        }).select("id").single();
      if (snapshotError) {
        if (snapshotError.code === "23505") { await reply("Копирование уже выполняется. Используй .uncopyp для восстановления."); return true; }
        throw snapshotError;
      }

      let originalPhotoPath: string | null = null;
      if (originalPhotoBlob) {
        originalPhotoPath = `${profile.id}/profile-copies/${snapshot.id}/original.jpg`;
        const { error: storageError } = await admin.storage.from("flamex-business-media").upload(originalPhotoPath, originalPhotoBlob, {
          contentType: "image/jpeg", upsert: false,
        });
        if (storageError) {
          await admin.from("flamexbot_business_profile_copies").delete().eq("id", snapshot.id);
          throw new Error("Не удалось сохранить исходную аватарку; профиль не изменён: " + storageError.message);
        }
        const { error: pathError } = await admin.from("flamexbot_business_profile_copies")
          .update({ original_photo_storage_path: originalPhotoPath }).eq("id", snapshot.id);
        if (pathError) {
          await admin.storage.from("flamex-business-media").remove([originalPhotoPath]);
          await admin.from("flamexbot_business_profile_copies").delete().eq("id", snapshot.id);
          throw pathError;
        }
      }
      try {
        await telegram("setBusinessAccountName", { business_connection_id: businessConnectionId,
          first_name: targetFirstName, last_name: targetLastName });
        if (canEditBio) await telegram("setBusinessAccountBio", { business_connection_id: businessConnectionId, bio: targetBio || "" });
        if (targetPhotoBlob) {
          const { error: photoFlagError } = await admin.from("flamexbot_business_profile_copies")
            .update({ target_photo_copied: true }).eq("id", snapshot.id);
          if (photoFlagError) throw photoFlagError;
          await setBusinessProfilePhotoFromBlob(businessConnectionId, targetPhotoBlob);
        }
      } catch (error) {
        let rollbackSucceeded = true;
        try {
          await telegram("setBusinessAccountName", { business_connection_id: businessConnectionId,
            first_name: originalFirstName, last_name: originalLastName });
          if (canEditBio) await telegram("setBusinessAccountBio", { business_connection_id: businessConnectionId, bio: originalBio || "" });
          if (targetPhotoBlob) {
            if (originalPhotoBlob) await setBusinessProfilePhotoFromBlob(businessConnectionId, originalPhotoBlob);
            else await removeBusinessProfilePhoto(businessConnectionId);
          }
        } catch (rollbackError) {
          rollbackSucceeded = false;
          console.error("Business profile copy rollback failed; snapshot retained for .uncopyp:", rollbackError);
        }
        if (rollbackSucceeded) {
          if (originalPhotoPath) await admin.storage.from("flamex-business-media").remove([originalPhotoPath]);
          await admin.from("flamexbot_business_profile_copies").delete().eq("id", snapshot.id);
        }
        throw error;
      }
      const copiedParts = ["имя"];
      if (canEditBio) copiedParts.push("описание");
      if (targetPhotoBlob) copiedParts.push("аватарка");
      await reply(`✅ Скопировано: ${copiedParts.join(", ")}. Исходный профиль сохранён для .uncopyp.`);
      return true;
    }
    if (command === "uncopyp") {
      const { data: snapshot, error: snapshotError } = await admin.from("flamexbot_business_profile_copies")
        .select("id,original_first_name,original_last_name,original_bio,original_photo_present,original_photo_storage_path,target_photo_copied")
        .eq("profile_id", profile.id).eq("business_connection_id", businessConnectionId).is("restored_at", null)
        .order("copied_at", { ascending: false }).limit(1).maybeSingle();
      if (snapshotError) throw snapshotError;
      if (!snapshot) { await reply("Нет активного копирования профиля. Сначала используй .copyp."); return true; }
      const { data: business, error: businessError } = await admin.from("flamexbot_business_connections")
        .select("is_enabled,rights").eq("profile_id", profile.id).eq("connection_id", businessConnectionId).maybeSingle();
      if (businessError) throw businessError;
      if (!business?.is_enabled || business.rights?.can_edit_name !== true) {
        await reply("⛔ Для .uncopyp нужно включить право Telegram Business «Изменять имя профиля»."); return true;
      }
      if (snapshot.target_photo_copied && business.rights?.can_edit_profile_photo !== true) {
        await reply("⛔ Для восстановления аватарки включи право Telegram Business «Изменять фото профиля». Остальные данные пока не менялись."); return true;
      }
      if (snapshot.original_bio !== null && business.rights?.can_edit_bio !== true) {
        await reply("⛔ Для восстановления описания включи право Telegram Business «Изменять описание профиля». Данные пока не менялись."); return true;
      }
      let originalPhotoBlob: Blob | null = null;
      if (snapshot.target_photo_copied && snapshot.original_photo_present) {
        if (!snapshot.original_photo_storage_path) throw new Error("Не найден файл исходной аватарки. Восстановление остановлено, чтобы не потерять фото.");
        const { data: storedPhoto, error: photoDownloadError } = await admin.storage.from("flamex-business-media")
          .download(snapshot.original_photo_storage_path);
        if (photoDownloadError || !storedPhoto) throw new Error("Не удалось получить сохранённую исходную аватарку: " + (photoDownloadError?.message || "файл отсутствует"));
        originalPhotoBlob = storedPhoto;
      }
      await telegram("setBusinessAccountName", { business_connection_id: businessConnectionId,
        first_name: snapshot.original_first_name, last_name: snapshot.original_last_name || "" });
      if (business.rights?.can_edit_bio === true && snapshot.original_bio !== null) {
        await telegram("setBusinessAccountBio", { business_connection_id: businessConnectionId, bio: snapshot.original_bio || "" });
      }
      if (snapshot.target_photo_copied) {
        if (originalPhotoBlob) await setBusinessProfilePhotoFromBlob(businessConnectionId, originalPhotoBlob, "original-profile.jpg");
        else await removeBusinessProfilePhoto(businessConnectionId);
      }
      const { error: restoreError } = await admin.from("flamexbot_business_profile_copies")
        .update({ restored_at: new Date().toISOString() }).eq("id", snapshot.id);
      if (restoreError) throw restoreError;
      if (snapshot.original_photo_storage_path) await admin.storage.from("flamex-business-media").remove([snapshot.original_photo_storage_path]);
      const restoredParts = ["имя"];
      if (snapshot.original_bio !== null) restoredParts.push("описание");
      if (snapshot.target_photo_copied) restoredParts.push("аватарка");
      await reply(`✅ Восстановлено: ${restoredParts.join(", ")}.`);
      return true;
    }
    if (command === "profile") {
      const username = String(chat.username || "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
      const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "Telegram-пользователь";
      const telegramId = String(chat.telegram_user_id || chat.telegram_chat_id);
      const profileLink = username ? `<a href="https://t.me/${username}">Открыть публичный профиль</a>` : "Публичная ссылка недоступна";
      let publicInfo:any = null;
      try { publicInfo = await telegram("getChat", { chat_id: String(chat.telegram_chat_id) }); }
      catch (profileLookupError) { console.warn("Business .profile public details lookup unavailable:", (profileLookupError as any)?.message ?? profileLookupError); }
      const bio = String(publicInfo?.bio || "").trim();
      const birthday = publicInfo?.birthdate;
      const birthdayText = birthday?.year ? String(birthday.year)
        : (birthday?.day && birthday?.month ? String(birthday.day).padStart(2,"0") + "." + String(birthday.month).padStart(2,"0") + " (год скрыт)" : "не указана/недоступна");
      const phoneText = publicInfo?.phone_number ? String(publicInfo.phone_number) : "Нету доступа";
      const report = [
        `${tgEmoji("users")} <b>Публичная карточка собеседника</b>`,
        "Имя: <b>" + escapeHtml([publicInfo?.first_name || chat.first_name, publicInfo?.last_name || chat.last_name].filter(Boolean).join(" ") || fullName) + "</b>",
        "Юзернейм: " + (username ? "@" + escapeHtml(username) : "не указан"),
        "Telegram ID: <code>" + escapeHtml(String(publicInfo?.id || telegramId)) + "</code>",
        "О себе: " + (bio ? escapeHtml(bio) : "не заполнено или недоступно"),
        "Год рождения: " + escapeHtml(birthdayText),
        "Телефон: " + escapeHtml(phoneText),
        profileLink,
        "",
      ].join("\n");
      if (command === "profile") {
        const progress = await sendBusinessReply(businessConnectionId, message.chat.id,
          `${tgEmoji("search")} <b>FLAMEXBOT · поиск профиля</b>\n\n① Определяю собеседника…`, "HTML");
        const frames = [
          `${tgEmoji("search")} <b>FLAMEXBOT · поиск профиля</b>\n\n✓ Собеседник определён\n② Проверяю публичные данные…`,
          `${tgEmoji("search")} <b>FLAMEXBOT · поиск профиля</b>\n\n✓ Собеседник определён\n✓ Публичные данные проверены\n③ Формирую карточку…`,
        ];
        for (const frame of frames) {
          await new Promise(resolve => setTimeout(resolve, 120));
          await telegram("editMessageText", { business_connection_id: businessConnectionId, chat_id: message.chat.id,
            message_id: progress.message_id, text: frame, parse_mode: "HTML" });
        }
        await telegram("editMessageText", { business_connection_id: businessConnectionId, chat_id: message.chat.id,
          message_id: progress.message_id, text: report, parse_mode: "HTML",
          link_preview_options: { is_disabled: true } });
      }
      return true;
    }
    if (command === "qr") {
      const value = args.join(" ").trim();
      if (!value || value.length > 512) {
        await reply("Формат: .qr ссылка или текст (до 512 символов).");
        return true;
      }
      const qrUrl = new URL("https://api.qrserver.com/v1/create-qr-code/");
      qrUrl.searchParams.set("size", "512x512");
      qrUrl.searchParams.set("data", value);
      await telegram("sendPhoto", {
        business_connection_id: businessConnectionId,
        chat_id: message.chat.id,
        photo: qrUrl.toString(),
        caption: `${tgEmoji("sparkles")} <b>QR-код создан в FLAMEXBOT</b>`,
        parse_mode: "HTML",
      });
      return true;
    }
    if (command === "id" || command === "chatid") {
      await reply(`${tgEmoji("user")} <b>Данные собеседника</b>\nTelegram ID: <code>${escapeHtml(String(chat.telegram_user_id || chat.telegram_chat_id))}</code>\nЧат ID: <code>${escapeHtml(String(chat.telegram_chat_id))}</code>\nЮзернейм: ${chat.username ? "@" + escapeHtml(chat.username) : "не указан"}`, "HTML");
      return true;
    }
    if (command === "date") {
      const now = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "full", timeStyle: "short" }).format(new Date());
      await reply(`${tgEmoji("calendar")} <b>Сейчас по Москве</b>\n${escapeHtml(now)}`, "HTML");
      return true;
    }
    if (command === "calc") {
      const expression = args.join(" ").trim();
      const value = calculateBusinessExpression(expression);
      if (value === null || !Number.isFinite(value)) {
        await reply("Формат: .calc (12 + 8) * 2. Поддерживаются числа, скобки и + − × ÷ %.");
      } else {
        await reply(`${tgEmoji("success")} <b>Результат:</b> <code>${escapeHtml(String(Number(value.toPrecision(12))))}</code>`, "HTML");
      }
      return true;
    }
    if (["upper", "lower", "reverse", "count", "wordcount"].includes(command)) {
      const value = args.join(" ").trim();
      if (!value || value.length > 3000) {
        await reply(`Формат: .${command} текст (до 3000 символов).`);
        return true;
      }
      if (command === "count") await reply(`Символов: <b>${value.length}</b>`, "HTML");
      else if (command === "wordcount") await reply(`Слов: <b>${(value.match(/[^\s]+/g) || []).length}</b>`, "HTML");
      else {
        const transformed = command === "upper" ? value.toLocaleUpperCase("ru-RU")
          : command === "lower" ? value.toLocaleLowerCase("ru-RU")
          : Array.from(value).reverse().join("");
        await reply(escapeHtml(transformed), "HTML");
      }
      return true;
    }
    if (command === "choose") {
      const choices = args.join(" ").split("|").map(value => value.trim()).filter(Boolean).slice(0, 30);
      if (choices.length < 2) {
        await reply("Формат: .choose вариант 1 | вариант 2 | вариант 3");
        return true;
      }
      const selected = choices[Math.floor(Math.random() * choices.length)];
      await reply(`${tgEmoji("sparkles")} Выбор FLAMEXBOT: <b>${escapeHtml(selected)}</b>`, "HTML");
      return true;
    }
    if (command === "roll") {
      const max = args[0] ? Number(args[0]) : 6;
      if (!Number.isInteger(max) || max < 2 || max > 100000) {
        await reply("Формат: .roll [максимум]. По умолчанию — от 1 до 6, максимум — 100000.");
        return true;
      }
      const result = Math.floor(Math.random() * max) + 1;
      await reply(`${tgEmoji("star")} Выпало: <b>${result}</b> (1–${max})`, "HTML");
      return true;
    }
  await reply(tgEmoji("warning") + " <b>Команда введена неправильно</b>\nКоманда <code>." + escapeHtml(command) + "</code> не найдена. Проверь написание или отправь <code>.help</code> для списка доступных команд.", "HTML");
  return true;
  }
}


async function handleBusinessActionCallback(query: any) {
  const panicMatch=/^fb:panic_(yes|no):([0-9a-f-]{36})$/i.exec(String(query?.data??""));
  if(panicMatch&&admin&&query?.from?.id){
    const [,decision,panicChatId]=panicMatch;
    const {data:panicChat,error:panicChatError}=await admin.from("flamexbot_business_chats")
      .select("id,profile_id,telegram_chat_id,telegram_user_id,business_connection_id")
      .eq("id",panicChatId).maybeSingle();
    if(panicChatError)throw panicChatError;
    if(!panicChat||isFounderTarget(panicChat.telegram_chat_id,panicChat.telegram_user_id)){
      await telegram("answerCallbackQuery",{callback_query_id:query.id,text:"Этот диалог недоступен для очистки.",show_alert:true});return;
    }
    const {data:panicConnection,error:panicConnectionError}=await admin.from("flamexbot_business_connections")
      .select("connection_id,telegram_user_id,is_enabled,rights")
      .eq("profile_id",panicChat.profile_id).eq("connection_id",panicChat.business_connection_id).maybeSingle();
    if(panicConnectionError)throw panicConnectionError;
    if(!panicConnection||String(query.from.id)!==String(panicConnection.telegram_user_id)){
      await telegram("answerCallbackQuery",{callback_query_id:query.id,text:"Подтвердить действие может только владелец подключения.",show_alert:true});return;
    }
    if(decision==="no"){
      await telegram("answerCallbackQuery",{callback_query_id:query.id,text:"Удаление отменено."});
      if(query.message?.chat?.id&&query.message?.message_id){
        await telegram("editMessageText",{business_connection_id:panicChat.business_connection_id,chat_id:query.message.chat.id,message_id:query.message.message_id,text:"Удаление переписки отменено."});
      }
      return;
    }
    if(decision==="yes"&&!ALLOW_BUSINESS_MESSAGE_DELETION){
      await telegram("answerCallbackQuery",{callback_query_id:query.id,text:"Удаление переписки отключено защитой FLAMEXBOT.",show_alert:true});
      if(query.message?.chat?.id&&query.message?.message_id){
        await telegram("editMessageText",{business_connection_id:panicChat.business_connection_id,chat_id:query.message.chat.id,message_id:query.message.message_id,text:"Удаление переписки отключено защитой FLAMEXBOT. Сообщения сохранены."});
      }
      return;
    }
    if(!panicConnection.is_enabled||panicConnection.rights?.can_delete_all_messages!==true){
      await telegram("answerCallbackQuery",{callback_query_id:query.id,text:"Нет активного Business-подключения или права удалять все сообщения.",show_alert:true});return;
    }
    if(String(panicConnection.telegram_user_id)!==FOUNDER_TELEGRAM_ID){
      const targetId=String(panicChat.telegram_user_id||panicChat.telegram_chat_id||"");
      const {data:protection,error:protectionError}=await admin.from("profiles")
        .select("command_protection_expires_at,command_protection_disabled").eq("telegram_id",targetId).maybeSingle();
      if(protectionError)throw protectionError;
      if(protection?.command_protection_expires_at&&new Date(protection.command_protection_expires_at).getTime()>Date.now()&&protection.command_protection_disabled!==true){
        await telegram("answerCallbackQuery",{callback_query_id:query.id,text:"На аккаунте включена защита от команд.",show_alert:true});return;
      }
    }
    const cutoff=new Date(Date.now()-48*60*60*1000).toISOString();
    const {data:rows,error:rowsError}=await admin.from("flamexbot_business_messages")
      .select("telegram_message_id,content,message_type,media_file_id,media_url,raw,created_at")
      .eq("business_chat_id",panicChat.id).is("deleted_at",null).gte("created_at",cutoff)
      .order("created_at",{ascending:true}).limit(5000);
    if(rowsError)throw rowsError;
    const deletedRows:any[]=[];
    for(let i=0;i<(rows||[]).length;i+=100){
      const batch=(rows||[]).slice(i,i+100);
      const ids=batch.map((row:any)=>Number(row.telegram_message_id)).filter((id:number)=>Number.isInteger(id)&&id>0);
      if(!ids.length)continue;
      try{
        await telegram("deleteBusinessMessages",{business_connection_id:panicChat.business_connection_id,chat_id:String(panicChat.telegram_chat_id),message_ids:ids});
        deletedRows.push(...batch);
      }catch(deleteError){
        console.warn("Panic delete batch failed",deleteError?.message??deleteError);
      }
    }
    const deletedAt=new Date().toISOString();
    const deletedIds=deletedRows.map((row:any)=>Number(row.telegram_message_id));
    if(deletedRows.length){
      const events=deletedRows.map((row:any)=>({
        profile_id:panicChat.profile_id,business_chat_id:panicChat.id,
        telegram_message_id:Number(row.telegram_message_id),event_type:"deleted",
        original_content:row.content??"",message_type:row.message_type??"text",
        media_file_id:row.media_file_id??null,media_url:row.media_url??null,
        original_raw:row.raw??{},occurred_at:deletedAt
      }));
      const {error:eventError}=await admin.from("flamexbot_business_message_events")
        .upsert(events,{onConflict:"business_chat_id,telegram_message_id,event_type,occurred_at",ignoreDuplicates:true});
      if(eventError)throw eventError;
      const {error:updateError}=await admin.from("flamexbot_business_messages").update({deleted_at:deletedAt})
        .eq("business_chat_id",panicChat.id).in("telegram_message_id",deletedIds);
      if(updateError)throw updateError;
    }
    const summary=deletedRows.length
      ? `Удалено сообщений у обоих: ${deletedRows.length}. Telegram позволяет удалять только сообщения за последние 48 часов.`
      : "За последние 48 часов не найдено доступных для удаления сообщений.";
    if(query.message?.chat?.id&&query.message?.message_id){
      await telegram("editMessageText",{business_connection_id:panicChat.business_connection_id,chat_id:query.message.chat.id,message_id:query.message.message_id,text:summary});
    }
    await telegram("answerCallbackQuery",{callback_query_id:query.id,text:deletedRows.length?"Переписка очищена.":"Нет сообщений для удаления."});
    return;
  }
  const match = /^fb:(mute|antimut)_(on|off):([0-9a-f-]{36})$/i.exec(String(query?.data ?? ""));
  if (!match || !admin || !query?.from?.id) return;
  const [, action, mode, chatId] = match;
  const enabled = mode === "on";
  const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats")
    .select("id,profile_id,telegram_chat_id,telegram_user_id,business_connection_id")
    .eq("id", chatId).maybeSingle();
  if (chatError) throw chatError;
  if (!chat) {
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Этот диалог больше не найден." });
    return;
  }
  if (isFounderTarget(chat.telegram_chat_id, chat.telegram_user_id)) {
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Этот диалог защищён. Команды управления отключены." });
    return;
  }
  const targetTelegramId = String(chat.telegram_user_id || chat.telegram_chat_id || "");
  const [connectionResult, protectionResult, subscriptionResult] = await Promise.all([
    admin.from("flamexbot_business_connections").select("connection_id,telegram_user_id,is_enabled,rights")
      .eq("profile_id", chat.profile_id).eq("connection_id", chat.business_connection_id).maybeSingle(),
    String(query.from.id) !== FOUNDER_TELEGRAM_ID && targetTelegramId
      ? admin.from("profiles").select("command_protection_expires_at,command_protection_disabled").eq("telegram_id", targetTelegramId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    enabled
      ? admin.from("user_subscriptions").select("plan,expires_at").eq("user_id", chat.profile_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (connectionResult.error) throw connectionResult.error;
  if (protectionResult.error) throw protectionResult.error;
  if (subscriptionResult.error) throw subscriptionResult.error;
  const connection = connectionResult.data;
  const protection = protectionResult.data;
  const subscription = subscriptionResult.data;
  if (!connection || String(query.from.id) !== String(connection.telegram_user_id)) {
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Эта кнопка доступна только владельцу подключения." });
    return;
  }
  if (String(connection.telegram_user_id) !== FOUNDER_TELEGRAM_ID && protection?.command_protection_expires_at
      && new Date(protection.command_protection_expires_at).getTime() > Date.now()
      && protection.command_protection_disabled !== true) {
    await telegram("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Пользователь включил защиту от команд. Использовать команды на нём может только Основатель.",
      show_alert: true,
    });
    return;
  }
  if (enabled) {
    const premium = ["premium","founder"].includes(subscription?.plan) &&
      (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
    if (!premium) {
      await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Для включения этой функции нужна активная Premium-подписка." });
      return;
    }
    if (!connection.is_enabled) {
      await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Telegram Business сейчас отключён." });
      return;
    }
    if (action === "mute" && connection.rights?.can_delete_all_messages !== true) {
      await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Не выдано право «Удалять все сообщения»." });
      return;
    }
    if (action === "antimut" && connection.rights?.can_reply !== true) {
      await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Не выдано право «Отправлять сообщения»." });
      return;
    }
  }
  const field = action === "mute" ? "is_muted" : "antimut_enabled";
  const { error: updateError } = await admin.from("flamexbot_business_chat_settings").upsert({
    profile_id: chat.profile_id, business_chat_id: chat.id, [field]: enabled,
    ...(action === "antimut" ? { antimut_enabled_at: enabled ? new Date(Math.floor(Date.now() / 1000) * 1000).toISOString() : null } : {}),
    updated_at: new Date().toISOString(),
    ...(action === "mute" ? { auto_flood_muted: false } : {}),
  }, { onConflict: "profile_id,business_chat_id" });
  if (updateError) throw updateError;
  await telegram("answerCallbackQuery", { callback_query_id: query.id, text: enabled ? "Функция включена." : "Функция выключена." });
  if (!connection.is_enabled) return;
  const markup = { inline_keyboard: [[{
    text: action === "mute"
      ? (enabled ? "🔊 Выключить мут" : "🔇 Включить мут")
      : (enabled ? "Выключить антимут" : "Включить антимут"),
    callback_data: `fb:${action}_${enabled ? "off" : "on"}:${chat.id}`,
  }]] };
  const body = action === "mute"
    ? (enabled
      ? `${tgEmoji("lock")} <b>Мут включён</b>\nАвтоматическое удаление сообщений отключено защитой FLAMEXBOT. Переписка остаётся на месте.`
      : `${tgEmoji("success")} <b>Размут выполнен</b>\nОграничение обработки сообщений снято.`)
    : (enabled
      ? `${tgEmoji("success")} <b>Антимут включён</b>\nЕсли Telegram сообщит об удалении сообщения владельца, FLAMEXBOT повторно отправит его. Сам FLAMEXBOT не удаляет сообщения.`
      : `${tgEmoji("lock")} <b>Антимут выключен</b>\nПовторная отправка сообщений остановлена.`);
  if (query.message?.chat?.id && query.message?.message_id) {
    try {
      await telegram("editMessageText", { business_connection_id: chat.business_connection_id, chat_id: query.message.chat.id, message_id: query.message.message_id, text: body, parse_mode: "HTML", reply_markup: markup });
    } catch (editError) {
      const editReason = String((editError as any)?.message ?? editError);
      if (!/message is not modified/i.test(editReason)) { console.warn("Antimute control message refresh failed:", editReason); await sendBusinessReply(connection.connection_id, chat.telegram_chat_id, body, "HTML", markup); }
    }
  } else { await sendBusinessReply(connection.connection_id, chat.telegram_chat_id, body, "HTML", markup); }
}

const PREMIUM_PRICE_STARS = 100;
const PREMIUM_PERIOD_DAYS = 30;
function parsePremiumPayload(payload: string) {
  const match = /^flamexbot_premium:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(payload);
  return match?.[1] ?? null;
}
function parseCommandProtectionPayload(payload: string) {
  const match = /^flamexbot_addon:command_protection:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(payload);
  return match?.[1] ?? null;
}
function parseWheelPayload(payload: string) {
  const match = /^flamexbot_wheel:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(payload);
  return match?.[1] ?? null;
}
async function sendTierInvoice(chatId: number, telegramUserId: number) {
  if (!admin) throw new Error("Database is unavailable");
  const { data: profile, error } = await admin.from("profiles").select("id,telegram_id,is_banned").eq("telegram_id", String(telegramUserId)).maybeSingle();
  if (error) throw error;
  if (!profile?.id) { await sendRichTelegramMessage(chatId, `${tgEmoji("warning")} <b>Сначала привяжи Telegram.</b> Открой профиль FLAMEXBOT и заверши привязку этого аккаунта.`, "HTML"); return; }
  if (profile.is_banned) { await sendRichTelegramMessage(chatId, "⛔ Аккаунт заблокирован. Покупка тарифа недоступна.", "HTML"); return; }
  const { data: current, error: currentError } = await admin.from("user_subscriptions").select("plan,expires_at").eq("user_id", profile.id).maybeSingle();
  if (currentError) throw currentError;
  const active = Boolean(current && (!current.expires_at || new Date(current.expires_at).getTime() > Date.now()));
  if (active && !current.expires_at) {
    await sendRichTelegramMessage(chatId, `${tgEmoji("success")} <b>У тебя уже бессрочный тариф.</b> Покупка не требуется.`, "HTML");
    return;
  }
  const payload = `flamexbot_premium:${profile.id}:${crypto.randomUUID()}`;
  await telegram("sendInvoice", {
    chat_id: chatId, title: "FLAMEXBOT Premium",
    description: "FLAMEXBOT Premium на 30 дней: Premium-инструменты и 2 бесплатные прокрутки колеса каждую неделю.",
    payload, currency: "XTR", prices: [{ label: "Premium · 30 дней", amount: PREMIUM_PRICE_STARS }],
  });
}
async function handlePreCheckout(query: any) {
  let ok = false;
  let rejectionMessage = "Счёт недействителен или устарел. Создай новый счёт в FLAMEXBOT.";
  try {
    if (admin && query.currency === "XTR") {
      const payload = String(query.invoice_payload ?? "");
      const premiumUserId = parsePremiumPayload(payload);
      const tierUserId = premiumUserId;
      const expectedTierAmount = PREMIUM_PRICE_STARS;
      if (tierUserId && query.total_amount === expectedTierAmount) {
        const { data: profile, error } = await admin.from("profiles")
          .select("id,telegram_id,is_banned").eq("id", tierUserId).maybeSingle();
        if (error) throw error;
        const { data: current, error: currentError } = await admin.from("user_subscriptions")
          .select("plan,expires_at").eq("user_id", tierUserId).maybeSingle();
        if (currentError) throw currentError;
        const currentActive = Boolean(current && (!current.expires_at || new Date(current.expires_at).getTime() > Date.now()));
        const isLifetime = Boolean(current && !current.expires_at && current.plan === "premium");
        if (isLifetime) rejectionMessage = "У тебя уже бессрочная подписка. Повторная покупка не требуется.";
        ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id) && !isLifetime);
      } else if (parseCommandProtectionPayload(payload) && query.total_amount === 15) {
        const { data: order, error: orderError } = await admin.from("flamexbot_addon_star_payments")
          .select("user_id,telegram_user_id,addon_code,currency,total_amount,period_days,status,valid_until")
          .eq("invoice_payload", payload).maybeSingle();
        if (orderError) throw orderError;
        if (order && order.addon_code === "command_protection" && order.currency === "XTR"
            && order.total_amount === 15 && order.period_days === 5 && order.status === "pending"
            && new Date(order.valid_until).getTime() > Date.now()
            && order.telegram_user_id === String(query.from?.id)) {
          const { data: profile, error: profileError } = await admin.from("profiles")
            .select("id,telegram_id,is_banned").eq("id", order.user_id).maybeSingle();
          if (profileError) throw profileError;
          ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id));
        }
      } else {
        const walletMatch = /^flamexbot_wallet:([0-9a-f-]{36}):(\d+):([0-9a-f-]{36})$/i.exec(payload);
        if (walletMatch) {
          const userId = walletMatch[1];
          const stars = Number(walletMatch[2]);
          const { data: profile, error: profileError } = await admin.from("profiles")
            .select("id,telegram_id,is_banned").eq("id", userId).maybeSingle();
          if (profileError) throw profileError;
          ok = Boolean(stars >= 5 && stars <= 5000 && query.total_amount === stars
            && profile && !profile.is_banned && profile.telegram_id === String(query.from?.id));
        }
      }
      if (!ok && parseWheelPayload(payload)) {
        const { data: order, error: orderError } = await admin.from("flamexbot_wheel_orders")
          .select("user_id,telegram_user_id,status,price_stars").eq("invoice_payload",payload).maybeSingle();
        if (orderError) throw orderError;
        if (order && order.status === "pending" && order.price_stars === query.total_amount && order.telegram_user_id === String(query.from?.id)) {
          const { data: profile, error: profileError } = await admin.from("profiles")
            .select("telegram_id,is_banned").eq("id",order.user_id).maybeSingle();
          if (profileError) throw profileError;
          ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id));
        }
      }
    }
  } catch (error) { console.error("pre-checkout validation:", error?.message ?? error); }
  await telegram("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok, ...(!ok ? { error_message: rejectionMessage } : {}) });
}
async function refundTelegramStarsPayment(telegramUserId: number, chargeId: string) {
  try {
    await telegram("refundStarPayment", { user_id: telegramUserId, telegram_payment_charge_id: chargeId });
  } catch (error) {
    const message = String(error?.message ?? error ?? "");
    if (!/ALREADY_REFUNDED|already refunded/i.test(message)) throw error;
  }
}

async function refundAndRecordStarsPayment(args: {
  userId: string;
  telegramUserId: string;
  invoicePayload: string;
  paymentKind: "premium" | "wheel" | "command_protection";
  currency: string;
  totalAmount: number;
  chargeId: string;
  providerChargeId?: string | null;
  reason: string;
}) {
  if (!admin) throw new Error("Database is unavailable while recording Stars refund");
  const { error: prepareError } = await admin.rpc("prepare_flamexbot_star_refund", {
    p_telegram_payment_charge_id: args.chargeId,
    p_user_id: args.userId,
    p_telegram_user_id: args.telegramUserId,
    p_invoice_payload: args.invoicePayload,
    p_payment_kind: args.paymentKind,
    p_currency: args.currency,
    p_total_amount: args.totalAmount,
    p_provider_payment_charge_id: args.providerChargeId ?? null,
    p_reason: args.reason,
  });
  if (prepareError) throw prepareError;

  // Persist refund intent before contacting Telegram. A retry can safely resume it.
  await refundTelegramStarsPayment(Number(args.telegramUserId), args.chargeId);
  const { data: completed, error: completeError } = await admin.rpc("complete_flamexbot_star_refund", {
    p_telegram_payment_charge_id: args.chargeId,
  });
  if (completeError || completed !== true) {
    throw completeError ?? new Error("Could not finalize Stars refund record");
  }
}

async function sendPaymentNotificationOnce(
  userId: string,
  notificationType: string,
  dataFilter: Record<string, unknown>,
  chatId: number | string,
  body: string,
  replyMarkup?: Record<string, unknown>,
) {
  if (!admin) return;
  const { data: notice, error: noticeError } = await admin.from("notifications")
    .select("id").eq("user_id", userId).eq("type", notificationType)
    .contains("data", dataFilter)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (noticeError) {
    console.warn("Could not locate payment notification; queued delivery will handle it:", noticeError.message);
    return;
  }
  if (!notice?.id) {
    // The payment RPC may not have produced a notification; there is no queue row to race with.
    try { await sendRichTelegramMessage(chatId, body, "HTML", replyMarkup); }
    catch (error) { console.warn("Payment confirmation send failed:", (error as any)?.message ?? error); }
    return;
  }

  const claimToken = crypto.randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc("claim_flamexbot_telegram_notification_by_id", {
    p_notification_id: notice.id,
    p_user_id: userId,
    p_claim_token: claimToken,
  });
  const ownsClaim = Array.isArray(claimed)
    && claimed.some((item: any) => item?.notification_id === notice.id);
  if (claimError || !ownsClaim) {
    if (claimError) console.warn("Could not claim payment notification:", claimError.message);
    return;
  }

  try {
    await sendRichTelegramMessage(chatId, body, "HTML", replyMarkup);
  } catch (error) {
    const reason = String((error as any)?.message ?? error);
    const outcomeUnknown = error instanceof TypeError || /timeout|timed out|network|connection reset|aborted/i.test(reason);
    if (!outcomeUnknown) {
      const { error: releaseError } = await admin.rpc("release_flamexbot_telegram_notification_claims", {
        p_claim_token: claimToken,
      });
      if (releaseError) console.warn("Could not release failed payment notification claim:", releaseError.message);
    }
    console.warn("Payment confirmation send failed:", reason);
    return;
  }

  const { data: marked, error: markError } = await admin.rpc("mark_flamexbot_telegram_notification_delivered", {
    p_notification_id: notice.id,
    p_claim_token: claimToken,
  });
  if (markError || marked !== true) {
    console.warn("Could not confirm payment notification delivery:", markError?.message ?? "claim token no longer owns notification");
  }
}

async function handleSuccessfulPayment(message: any) {
  if (!admin || !message?.from?.id || !message?.successful_payment) return;
  const payment = message.successful_payment;
  const invoicePayload = String(payment.invoice_payload ?? "");
  const chargeId = String(payment.telegram_payment_charge_id ?? "");
  if (chargeId) {
    const { data: refundRows, error: refundLookupError } = await admin.rpc("get_flamexbot_star_refund_status", {
      p_telegram_payment_charge_id: chargeId,
    });
    if (refundLookupError) throw refundLookupError;
    const recordedRefund = Array.isArray(refundRows) ? refundRows[0] : null;
    if (recordedRefund) {
      if (recordedRefund.invoice_payload !== invoicePayload
          || recordedRefund.telegram_user_id !== String(message.from.id)) {
        throw new Error("Refunded Telegram charge does not match the repeated payment update");
      }
      await refundTelegramStarsPayment(Number(message.from.id), chargeId);
      const { error: completeError } = await admin.rpc("complete_flamexbot_star_refund", {
        p_telegram_payment_charge_id: chargeId,
      });
      if (completeError) throw completeError;
      console.log("Resumed previously recorded Stars refund", chargeId);
      return;
    }
  }
  const walletMatch = /^flamexbot_wallet:([0-9a-f-]{36}):(\d+):([0-9a-f-]{36})$/i.exec(invoicePayload);
  if (walletMatch) {
    const userId = walletMatch[1];
    const stars = Number(walletMatch[2]);
    if (payment.currency !== "XTR" || payment.total_amount !== stars || !chargeId || stars < 5 || stars > 5000) {
      throw new Error("Wallet Stars payment mismatch");
    }
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned").eq("id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.telegram_id !== String(message.from.id) || profile.is_banned) {
      throw new Error("Wallet payer does not match an active profile");
    }
    const { data: balance, error: creditError } = await admin.rpc("credit_flamexbot_wallet_service", {
      p_user_id: userId, p_amount: stars * 2, p_reason: `Пополнение через Telegram Stars (${stars} ⭐)`,
      p_source: "telegram_stars", p_reference: chargeId,
      p_metadata: { stars, telegram_payment_charge_id: chargeId, invoice_payload: invoicePayload },
    });
    if (creditError) throw creditError;
    await sendRichTelegramMessage(message.chat.id,
      `💰 <b>Баланс пополнен!</b>\nНачислено: <b>${stars * 2} монет</b> (${stars} ⭐).\nБаланс: <b>${balance} монет</b>.`,
      "HTML", { inline_keyboard: [[{ text: "Открыть баланс", web_app: { url: APP_URL } }]] });
    return;
  }
  const wheelUserId = parseWheelPayload(invoicePayload);
  if (wheelUserId) {
    if (payment.currency !== "XTR" || payment.total_amount !== 5 || !payment.telegram_payment_charge_id) throw new Error("Wheel payment mismatch");
    const { data: order, error: orderError } = await admin.from("flamexbot_wheel_orders")
      .select("id,user_id,telegram_user_id,status").eq("invoice_payload",invoicePayload).maybeSingle();
    if (orderError) throw orderError;
    if (!order || order.user_id !== wheelUserId || order.telegram_user_id !== String(message.from.id)) throw new Error("Wheel order does not match payer");
    if (order.status === "paid") return;
    if (order.status === "refunded") {
      await refundAndRecordStarsPayment({
        userId: wheelUserId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: "wheel",
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: "wheel_order_already_refunded",
      });
      return;
    }
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned").eq("id",wheelUserId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.telegram_id !== String(message.from.id)) throw new Error("Wheel payer does not match profile");
    if (profile.is_banned) {
      const { error: refundOrderError } = await admin.from("flamexbot_wheel_orders")
        .update({
          status: "refunded",
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
          paid_at: new Date().toISOString(),
        }).eq("id", order.id).eq("status", "pending");
      if (refundOrderError) throw refundOrderError;
      await refundAndRecordStarsPayment({
        userId: wheelUserId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: "wheel",
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: "account_banned",
      });
      try { await sendRichTelegramMessage(message.chat.id,"Оплата возвращена: аккаунт заблокирован.","HTML"); }
      catch (notifyError) { console.warn("Could not send wheel refund notice:", (notifyError as any)?.message ?? notifyError); }
      return;
    }
    const {data:prize,error:prizeError}=await admin.rpc("apply_flamexbot_wheel_payment",{
      p_invoice_payload:invoicePayload,p_telegram_user_id:String(message.from.id),
      p_telegram_payment_charge_id:payment.telegram_payment_charge_id,
      p_provider_payment_charge_id:payment.provider_payment_charge_id??null,
      p_currency:payment.currency,p_total_amount:payment.total_amount
    });
    if(prizeError)throw prizeError;
    if(prize?.applied !== true) return;
    await sendPaymentNotificationOnce(
      wheelUserId,
      "wheel_prize",
      { wheel_order_id: order.id },
      message.chat.id,
      `${tgEmoji("sparkles")} <b>Колесо фортуны!</b>\nТвоя награда: <b>${String(prize?.prize_label??"Награда начислена")}</b>.\nОткрой FLAMEXBOT, чтобы посмотреть результат.`,
      {inline_keyboard:[[{text:"Открыть FLAMEXBOT",web_app:{url:APP_URL}}]]},
    );
    return;
  }
  const addonUserId = parseCommandProtectionPayload(invoicePayload);
  if (addonUserId) {
    if (payment.currency !== "XTR" || payment.total_amount !== 15 || !payment.telegram_payment_charge_id) {
      throw new Error("Successful Telegram Stars payment did not match a command protection invoice");
    }
    const { data: order, error: orderError } = await admin.from("flamexbot_addon_star_payments")
      .select("user_id,telegram_user_id,addon_code,total_amount,period_days,status")
      .eq("invoice_payload", invoicePayload).maybeSingle();
    if (orderError) throw orderError;
    if (!order || order.user_id !== addonUserId || order.addon_code !== "command_protection"
        || order.telegram_user_id !== String(message.from.id) || order.total_amount !== 15 || order.period_days !== 5) {
      throw new Error("Command protection payment does not match its invoice");
    }
    const { data: addonProfile, error: addonProfileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned,ban_reason").eq("id", addonUserId).maybeSingle();
    if (addonProfileError) throw addonProfileError;
    if (!addonProfile || addonProfile.telegram_id !== String(message.from.id)) {
      throw new Error("Telegram payment sender does not match the command protection account");
    }
    if (order.status === "paid") return;
    if (order.status === "refunded" || addonProfile.is_banned || order.status !== "pending") {
      if (order.status !== "refunded") {
        const { error: refundRecordError } = await admin.from("flamexbot_addon_star_payments")
          .update({
            status: "refunded",
            telegram_payment_charge_id: payment.telegram_payment_charge_id,
            provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
            paid_at: new Date().toISOString(),
          }).eq("invoice_payload", invoicePayload).in("status", ["pending","failed"]);
        if (refundRecordError) throw refundRecordError;
      }
      await refundAndRecordStarsPayment({
        userId: addonUserId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: "command_protection",
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: addonProfile.is_banned ? "account_banned" : "invoice_not_payable",
      });
      try { await sendRichTelegramMessage(message.chat.id, "⛔ Оплата дополнения возвращена: аккаунт заблокирован или счёт недействителен.", "HTML"); }
      catch (notifyError) { console.warn("Could not send add-on refund notice:", (notifyError as any)?.message ?? notifyError); }
      return;
    }
    const { data: applied, error: applyError } = await admin.rpc("apply_flamexbot_command_protection_payment", {
      p_invoice_payload: invoicePayload,
      p_telegram_user_id: String(message.from.id),
      p_telegram_payment_charge_id: payment.telegram_payment_charge_id,
      p_provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
      p_currency: payment.currency,
      p_total_amount: payment.total_amount,
    });
    if (applyError) {
      const reason = String(applyError.message ?? applyError);
      if (/Command protection account is unavailable|Command protection invoice is not payable/i.test(reason)) {
        const { error: refundRecordError } = await admin.from("flamexbot_addon_star_payments")
          .update({
            status: "refunded",
            telegram_payment_charge_id: payment.telegram_payment_charge_id,
            provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
            paid_at: new Date().toISOString(),
          }).eq("invoice_payload", invoicePayload).eq("status", "pending");
        if (refundRecordError) throw refundRecordError;
        await refundAndRecordStarsPayment({
          userId: addonUserId,
          telegramUserId: String(message.from.id),
          invoicePayload,
          paymentKind: "command_protection",
          currency: payment.currency,
          totalAmount: payment.total_amount,
          chargeId: payment.telegram_payment_charge_id,
          providerChargeId: payment.provider_payment_charge_id ?? null,
          reason: "account_or_invoice_unavailable",
        });
        try { await sendRichTelegramMessage(message.chat.id, "⛔ Счёт больше недействителен. Оплата возвращена.", "HTML"); }
        catch (notifyError) { console.warn("Could not send add-on refund notice:", (notifyError as any)?.message ?? notifyError); }
        return;
      }
      throw applyError;
    }
    if (applied === true) {
      await sendRichTelegramMessage(message.chat.id,
        `${tgEmoji("success")} <b>Защита от команд активирована!</b>\nНа ваш аккаунт нельзя применять команды FLAMEXBOT в течение 5 дней. Основатель проекта сохраняет доступ к командам на всех аккаунтах.`,
        "HTML");
    }
    return;
  }

  const premiumUserId = parsePremiumPayload(invoicePayload);
  const userId = premiumUserId;
  const plan = "premium";
  const expectedAmount = PREMIUM_PRICE_STARS;
  if (!userId || payment.currency !== "XTR" || payment.total_amount !== expectedAmount || !payment.telegram_payment_charge_id) {
    throw new Error("Successful Telegram Stars payment did not match a Premium invoice");
  }
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,telegram_id,is_banned,ban_reason").eq("id", userId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.telegram_id !== String(message.from.id)) throw new Error("Telegram payment sender does not match the FLAMEXBOT account");
  if (profile.is_banned) {
    await refundAndRecordStarsPayment({
      userId,
      telegramUserId: String(message.from.id),
      invoicePayload,
      paymentKind: plan,
      currency: payment.currency,
      totalAmount: payment.total_amount,
      chargeId: payment.telegram_payment_charge_id,
      providerChargeId: payment.provider_payment_charge_id ?? null,
      reason: "account_banned",
    });
    try { await sendRichTelegramMessage(message.chat.id, "⛔ Аккаунт заблокирован. Оплата тарифа автоматически возвращена.", "HTML"); }
    catch (notifyError) { console.warn("Could not send subscription refund notice:", (notifyError as any)?.message ?? notifyError); }
    return;
  }
  const { data: applied, error: applyError } = await admin.rpc("apply_flamexbot_tier_payment", {
    p_user_id: userId,
    p_telegram_user_id: String(message.from.id),
    p_invoice_payload: payment.invoice_payload,
    p_telegram_payment_charge_id: payment.telegram_payment_charge_id,
    p_provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
    p_currency: payment.currency,
    p_total_amount: payment.total_amount,
    p_period_days: PREMIUM_PERIOD_DAYS,
    p_plan: plan,
  });
  if (applyError) {
    const reason = String(applyError.message ?? applyError);
    if (/Lifetime subscription is already active/i.test(reason)) {
      await refundAndRecordStarsPayment({
        userId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: plan,
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: "subscription_state_changed_after_precheckout",
      });
      try { await sendRichTelegramMessage(message.chat.id, "⛔ Состояние тарифа изменилось до завершения оплаты. Деньги автоматически возвращены.", "HTML"); }
      catch (notifyError) { console.warn("Could not send subscription refund notice:", (notifyError as any)?.message ?? notifyError); }
      return;
    }
    throw applyError;
  }
  if (applied === true) {
    await sendPaymentNotificationOnce(
      userId,
      "subscription_activated",
      { payment_charge_id: payment.telegram_payment_charge_id },
      message.chat.id,
      `${tgEmoji("star")} <b>Оплата прошла успешно!</b> FLAMEXBOT Premium активирован на 30 дней. Тебе доступны 2 бесплатные прокрутки каждую неделю.`,
    );
  }
}

const TELEGRAM_DELIVERABLE_NOTIFICATION_TYPES = [
  "weekly_wheel_spins",
  "subscription_activated",
  "wheel_prize",
  "referral_reward",
  "trial_activated",
  "account_banned",
  "account_unbanned",
  "verified",
  "unverified",
  "premium_granted",
  "premium_revoked",
  "badge_granted",
  "badge_revoked",
  "business_connected",
  "business_disconnected",
];

async function deliverPendingTelegramNotifications(telegramUserId: number | string, privateChatId: number | string) {
  if (!admin) return;
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id").eq("telegram_id", String(telegramUserId)).maybeSingle();
  if (profileError) {
    console.warn("Could not load notification recipient:", profileError.message);
    return;
  }
  if (!profile?.id) return;

  // Atomically reserve pending notifications so concurrent Telegram updates cannot send the same rows.
  const claimToken = crypto.randomUUID();
  const { data: pending, error: pendingError } = await admin.rpc("claim_flamexbot_telegram_notifications", {
    p_user_id: profile.id,
    p_claim_token: claimToken,
    p_limit: 8,
  });
  if (pendingError) {
    console.warn("Could not claim pending bot notifications:", pendingError.message);
    return;
  }

  for (const item of pending ?? []) {
    try {
      const title = String(item.title ?? "Уведомление FLAMEXBOT");
      const body = String(item.body ?? "");
      await sendRichTelegramMessage(privateChatId, "📬 " + title + (body ? "\n\n" + body : ""));
    } catch (error) {
      // A network timeout can happen after Telegram accepted the message, so keep the lease in that ambiguous case.
      const reason = String((error as any)?.message ?? error);
      const outcomeUnknown = error instanceof TypeError || /timeout|timed out|network|connection reset|aborted/i.test(reason);
      if (!outcomeUnknown) {
        const { error: releaseError } = await admin.rpc("release_flamexbot_telegram_notification_claims", {
          p_claim_token: claimToken,
        });
        if (releaseError) console.warn("Could not release failed notification claims:", releaseError.message);
      }
      console.warn("Bot notification delivery stopped:", reason);
      break;
    }

    const { data: marked, error: markError } = await admin.rpc("mark_flamexbot_telegram_notification_delivered", {
      p_notification_id: item.notification_id,
      p_claim_token: claimToken,
    });
    if (markError || marked !== true) {
      // Do not release the claim after a successful send: that could cause an immediate duplicate.
      console.warn("Could not confirm bot notification delivery:", markError?.message ?? "claim token no longer owns notification");
      break;
    }
  }
}

async function saveBotInboxMessage(message: any) {
  if (!admin || message?.chat?.type !== "private" || !message?.chat?.id || !message?.message_id || !message?.from?.id || message.from.is_bot) return;
  const media=messageMedia(message),caption=messageContent(message);
  const content=media.type==="text"?caption:JSON.stringify({_fx_media:1,caption,file_id:media.fileId,file_name:message.document?.file_name??message.audio?.file_name??message.video?.file_name??null,mime_type:message.document?.mime_type??message.audio?.mime_type??message.video?.mime_type??null});
  const now=new Date((message.date??Math.floor(Date.now()/1000))*1000).toISOString();
  const {data:chat,error:chatError}=await admin.from("flamexbot_bot_inbox_chats").upsert({
    telegram_chat_id:String(message.chat.id),telegram_user_id:String(message.from.id),username:message.from.username??null,
    first_name:message.from.first_name??null,last_name:message.from.last_name??null,last_message_preview:content.slice(0,240),
    last_message_at:now,updated_at:new Date().toISOString()
  },{onConflict:"telegram_chat_id"}).select("id,unread_count").single();
  if(chatError)throw chatError;
  const {data:inserted,error:messageError}=await admin.from("flamexbot_bot_inbox_messages").upsert({
    inbox_chat_id:chat.id,telegram_message_id:message.message_id,direction:"incoming",content,message_type:media.type,created_at:now
  },{onConflict:"inbox_chat_id,telegram_message_id",ignoreDuplicates:true}).select("id");
  if(messageError)throw messageError;
  if(inserted?.length){
    const {error:unreadError}=await admin.from("flamexbot_bot_inbox_chats").update({
      unread_count:Number(chat.unread_count||0)+1,updated_at:new Date().toISOString()
    }).eq("id",chat.id);
    if(unreadError)throw unreadError;
  }
}

async function saveSupportRequestMessage(message: any,content: string) {
  if(!admin||!message?.chat?.id||!message?.message_id||!message?.from?.id)return;
  const now=new Date((message.date??Math.floor(Date.now()/1000))*1000).toISOString();
  const {data:chat,error:chatError}=await admin.from("flamexbot_support_chats").upsert({
    telegram_chat_id:String(message.chat.id),telegram_user_id:String(message.from.id),username:message.from.username??null,
    first_name:message.from.first_name??null,last_name:message.from.last_name??null,last_message_preview:content.slice(0,240),
    last_message_at:now,status:"open",closed_at:null,updated_at:new Date().toISOString()
  },{onConflict:"telegram_chat_id"}).select("id,unread_count").single();
  if(chatError)throw chatError;
  const {data:inserted,error:messageError}=await admin.from("flamexbot_support_messages").upsert({
    support_chat_id:chat.id,telegram_message_id:message.message_id,direction:"incoming",content,message_type:"text",created_at:now
  },{onConflict:"support_chat_id,telegram_message_id",ignoreDuplicates:true}).select("id");
  if(messageError)throw messageError;
  if(inserted?.length){
    const {error:unreadError}=await admin.from("flamexbot_support_chats").update({
      unread_count:Number(chat.unread_count||0)+1,updated_at:new Date().toISOString()
    }).eq("id",chat.id);
    if(unreadError)throw unreadError;
    const {data:admins,error:adminsError}=await admin.from("profile_badges").select("user_id").in("badge_code",["founder","administrator"]);
    if(adminsError)throw adminsError;
    const recipients=[...new Set([FOUNDER_PROFILE_ID,...(admins||[]).map((item:any)=>item.user_id)])];
    if(recipients.length){
      const {error:noticeError}=await admin.from("notifications").insert(recipients.map(user_id=>({
        user_id,type:"support_message",title:"Новое сообщение в техподдержку",
        body:(message.from.username?"@"+message.from.username:message.from.first_name||"Пользователь")+": "+content.slice(0,180),
        data:{support_chat_id:chat.id,telegram_message_id:message.message_id}
      })));
      if(noticeError)throw noticeError;
      const {data:adminProfiles,error:adminProfilesError}=await admin.from("profiles").select("telegram_id").in("id",recipients);
      if(adminProfilesError)throw adminProfilesError;
      for(const recipient of adminProfiles||[]){
        if(!recipient.telegram_id||String(recipient.telegram_id)===String(message.from.id))continue;
        try{await telegram("sendMessage",{chat_id:recipient.telegram_id,text:"🛟 Новое сообщение в техподдержку\n"+(message.from.username?"@"+message.from.username:message.from.first_name||"Пользователь")+": "+content.slice(0,900)+"\n\nОткрой FLAMEXBOT → Техподдержка."});}
        catch(notifyError){console.warn("Could not send support notification to admin:",notifyError?.message??notifyError);}
      }
    }
  }
}

async function processTelegramUpdate(update: any) {
  const startedAt=Date.now();
  try {
    console.log("telegram update received", JSON.stringify({
      update_id: update.update_id ?? null,
      update_types: Object.keys(update).filter((key) => key !== "update_id"),
      business_enabled: update.business_connection?.is_enabled ?? null,
      business_user_id: update.business_connection?.user?.id != null ? String(update.business_connection.user.id) : null,
    }));
    // Fast-path Business commands before unrelated inbox, notification, and moderation work.
    // An update already delivered to this webhook remains usable even if another bot deletes
    // the original message moments later. Dispatch from the captured update immediately.
    const earlyBusinessMessage = update.business_message;
    const earlyText = typeof earlyBusinessMessage?.text === "string" ? earlyBusinessMessage.text.trim() : "";
    const earlyCommand = /^[./][a-z]/i.test(earlyText);
    if (earlyBusinessMessage?.chat?.type === "private" && earlyCommand && earlyBusinessMessage.from?.id != null) {
      await ensureBusinessConnection(earlyBusinessMessage.business_connection_id);
      const { data: earlyConnection, error: earlyConnectionError } = await admin.from("flamexbot_business_connections")
        .select("profile_id,telegram_user_id,connection_id,is_enabled,rights")
        .eq("connection_id", earlyBusinessMessage.business_connection_id).maybeSingle();
      if (earlyConnectionError) throw earlyConnectionError;
      const earlySenderIsOwner = String(earlyBusinessMessage.from.id) === String(earlyConnection?.telegram_user_id ?? "");
      if (earlySenderIsOwner && earlyConnection?.is_enabled) {
        const earlyBan = await getTelegramBan(earlyConnection.telegram_user_id);
        if (earlyBan) {
          console.warn("Ignored Business command from banned FLAMEXBOT owner", earlyConnection.telegram_user_id);
          return new Response("OK", { status: 200 });
        }
        const earlyCommandName = earlyText.slice(1).split(/\s+/)[0].replace(/@\w+$/, "").toLowerCase();
        console.log("business command captured at webhook ingress", JSON.stringify({
          command: earlyCommandName, chat_id: String(earlyBusinessMessage.chat.id),
          message_id: earlyBusinessMessage.message_id, update_id: update.update_id ?? null,
        }));
        try {
          const earlyHandled = await handleBusinessChatCommand(
            earlyBusinessMessage, earlyBusinessMessage.business_connection_id, earlyConnection,
          );
          if (earlyHandled) {
            // Keep the owner's command in chat history. FLAMEXBOT must never auto-delete it.
            console.log("business command processed from early capture", JSON.stringify({
              command: earlyCommandName, handled: true, message_id: earlyBusinessMessage.message_id,
            }));
            return new Response("OK", { status: 200 });
          }
        } catch (commandError) {
          const reason = String((commandError as any)?.message ?? commandError ?? "Неизвестная ошибка").slice(0, 240);
          console.error("Early Business command failed", JSON.stringify({
            command: earlyCommandName, chat_id: String(earlyBusinessMessage.chat.id), error: reason,
          }));
          try {
            const safeReason = reason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            await sendBusinessReply(
              earlyBusinessMessage.business_connection_id, earlyBusinessMessage.chat.id,
              `${tgEmoji("warning")} <b>Команда .${earlyCommandName} не выполнена</b>\\nПричина: ${safeReason}\\nПопробуй ещё раз позже.`,
              "HTML",
            );
          } catch (replyError) {
            console.error("Could not report early Business command failure:", (replyError as any)?.message ?? replyError);
          }
          return new Response("OK", { status: 200 });
        }
      }
    }

    // Archive every ordinary Business message immediately on webhook ingress.
    // This preserves its payload if another bot deletes it before the slower processing path.
    const earlyArchiveMessage = update.business_message;
    const earlyArchiveText = typeof earlyArchiveMessage?.text === "string" ? earlyArchiveMessage.text.trim() : "";
    const earlyArchiveIsCommand = /^[./][a-z]/i.test(earlyArchiveText);
    if (earlyArchiveMessage?.chat?.type === "private" && earlyArchiveMessage?.from?.id != null
        && !earlyArchiveIsCommand && !earlyArchiveMessage.sender_business_bot?.id) {
      try {
        await ensureBusinessConnection(earlyArchiveMessage.business_connection_id);
        const { data: archiveConnection, error: archiveConnectionError } = await admin.from("flamexbot_business_connections")
          .select("profile_id,telegram_user_id,connection_id,is_enabled,rights")
          .eq("connection_id", earlyArchiveMessage.business_connection_id).maybeSingle();
        if (archiveConnectionError) throw archiveConnectionError;
        if (archiveConnection?.is_enabled) {
          await saveBusinessMessage(earlyArchiveMessage, archiveConnection, true);
          console.log("Business message archived at webhook ingress", JSON.stringify({
            chat_id: String(earlyArchiveMessage.chat.id),
            message_id: earlyArchiveMessage.message_id,
            direction: String(earlyArchiveMessage.from.id) === String(archiveConnection.telegram_user_id) ? "outbound" : "inbound",
            update_id: update.update_id ?? null,
          }));
        }
      } catch (archiveError) {
        console.error("Early Business message archive failed", JSON.stringify({
          chat_id: String(earlyArchiveMessage.chat.id),
          message_id: earlyArchiveMessage.message_id,
          error: String((archiveError as any)?.message ?? archiveError).slice(0, 240),
        }));
      }
    }

    const directTelegramUserId =
      update.message?.from?.id ??
      update.callback_query?.from?.id ??
      update.pre_checkout_query?.from?.id ??
      update.business_connection?.user?.id;
    if (directTelegramUserId != null && String(directTelegramUserId) !== FOUNDER_TELEGRAM_ID && !update.message?.successful_payment) {
      const banCheckStartedAt = Date.now();
      const ban = await getTelegramBan(directTelegramUserId);
      if (Date.now() - banCheckStartedAt >= 180) console.log("flamexbot stage slow", JSON.stringify({ stage: "ban_check", duration_ms: Date.now() - banCheckStartedAt }));
      if (ban) {
        if (update.message?.chat?.type === "private") {
          await sendRichTelegramMessage(update.message.chat.id, `⛔ FLAMEXBOT: доступ ограничен. ${ban.reason}`);
        }
        if (update.callback_query?.id) {
          await telegram("answerCallbackQuery", {
            callback_query_id: update.callback_query.id,
            text: "Аккаунт заблокирован администрацией FLAMEXBOT.",
            show_alert: true,
          });
        }
        console.warn("Blocked Telegram update from banned FLAMEXBOT user", String(directTelegramUserId));
        return new Response("OK", { status: 200 });
      }
    }
    if (update.message?.chat?.type === "private" && update.message.from?.id) {
      const notificationUserId = update.message.from.id;
      const notificationChatId = update.message.chat.id;
      // Notifications are independent of the incoming message response. Keep delivery
      // inside the Edge Function lifetime without making commands wait for Telegram sends.
      EdgeRuntime.waitUntil((async () => {
        const notificationsStartedAt = Date.now();
        try {
          await deliverPendingTelegramNotifications(notificationUserId, notificationChatId);
        } catch (notificationError) {
          console.warn("Background notification delivery failed:", (notificationError as any)?.message ?? notificationError);
        } finally {
          const duration = Date.now() - notificationsStartedAt;
          if (duration >= 180) console.log("flamexbot stage slow", JSON.stringify({ stage: "pending_notifications_background", duration_ms: duration }));
        }
      })());
    }
    if (update.message?.chat?.type === "private" && update.message.from?.id && !update.message.from.is_bot && !update.message.successful_payment) {
      const directText=String(update.message.text??"").trim();
      const supportMatch=directText.match(/^\/support(?:@\w+)?(?:\s+([\s\S]+))?$/i);
      const cancelSupport=/^\/cancel_support(?:@\w+)?(?:\s|$)/i.test(directText);
      if(cancelSupport){
        const {error:closeError}=await admin.from("flamexbot_support_chats").update({status:"closed",closed_at:new Date().toISOString()}).eq("telegram_chat_id",String(update.message.chat.id)).eq("status","open");
        if(closeError)throw closeError;
        await sendRichTelegramMessage(update.message.chat.id,"✅ Обращение закрыто. Чтобы создать новое, отправь /support.","HTML",undefined,undefined,false);
      }else if(supportMatch){
        const requestText=String(supportMatch[1]||"").trim()||"Обращение открыто. Ожидается описание проблемы.";
        await saveSupportRequestMessage(update.message,requestText);
        await sendRichTelegramMessage(update.message.chat.id,requestText.startsWith("Обращение открыто")?"🛟 <b>Чат техподдержки открыт.</b>\n\nОпиши проблему следующим сообщением. Для закрытия отправь /cancel_support.":"✅ Обращение отправлено в техподдержку. Можешь продолжать переписку здесь. Для закрытия отправь /cancel_support.","HTML",undefined,undefined,false);
      }else{
        const {data:activeTicket,error:ticketError}=await admin.from("flamexbot_support_chats").select("id").eq("telegram_chat_id",String(update.message.chat.id)).eq("status","open").maybeSingle();
        if(ticketError)throw ticketError;
        const isSlashCommand=/^\/[a-z_]+(?:@\w+)?(?:\s|$)/i.test(directText);
        if(activeTicket&&!isSlashCommand)await saveSupportRequestMessage(update.message,messageContent(update.message));
        else await saveBotInboxMessage(update.message);
      }
    }
    if (update.callback_query?.data === "fx:connect_guide") {
      await telegram("answerCallbackQuery",{callback_query_id:update.callback_query.id});
      const guideMarkup={inline_keyboard:[[{text:"Открыть FLAMEXBOT",web_app:{url:APP_URL}}]]};
      const {data:guideBanner,error:guideBannerError}=await admin.from("flamexbot_bot_banners")
        .select("image_url,caption,enabled").eq("banner_key","instruction").maybeSingle();
      if(guideBannerError)console.warn("Instruction banner settings unavailable:",guideBannerError.message);
      const guideText=guideBanner?.caption||`<b>Инструкция по подключению FLAMEXBOT</b>\n\n1. Открой Telegram → Настройки → Telegram Business.\n2. Выбери «Чат-боты» → «Добавить чат-бота».\n3. Найди FLAMEXBOT и подключи его.\n4. Разреши доступ к сообщениям и отправке ответов. Для автоматического удаления сообщений также включи право удаления.\n5. Вернись в Mini App → Профиль и проверь статус подключения.`;
      if(guideBanner?.enabled&&guideBanner.image_url)await telegram("sendPhoto",{chat_id:update.callback_query.message.chat.id,photo:guideBanner.image_url,caption:guideText.slice(0,1024),parse_mode:"HTML",reply_markup:guideMarkup});
      else await sendRichTelegramMessage(update.callback_query.message.chat.id,guideText,"HTML",guideMarkup);
    } else if (update.callback_query) {
      try { await handleBusinessActionCallback(update.callback_query); }
      catch (callbackError) {
        const callbackReason = String((callbackError as any)?.message ?? callbackError ?? "Ошибка действия").slice(0, 180);
        console.error("Business action callback failed after acknowledgement:", callbackReason);
        const callbackMessage = update.callback_query.message;
        if (callbackMessage?.chat?.id) {
          try {
            const notice = tgEmoji("warning") + " <b>Не удалось изменить настройку</b>\n" + callbackReason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            if (callbackMessage.business_connection_id) await sendBusinessReply(callbackMessage.business_connection_id, callbackMessage.chat.id, notice, "HTML");
            else await sendRichTelegramMessage(callbackMessage.chat.id, notice, "HTML");
          } catch (noticeError) { console.warn("Could not report callback failure:", (noticeError as any)?.message ?? noticeError); }
        }
      }
    }
    if (update.message?.successful_payment) await handleSuccessfulPayment(update.message);
    if (update.message?.chat?.type === "private" && update.message.from?.id
        && /^\/premium(?:@\w+)?(?:\s|$)/i.test((update.message.text ?? "").trim())) {
      await sendTierInvoice(update.message.chat.id, update.message.from.id);
    }
    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^\/ping(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        `${tgEmoji("success")} <b>PONG!</b> Бот запущен, webhook принимает обновления.`,
        "HTML",
      );
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^\/status(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      const telegramUserId=String(update.message.from?.id ?? "");
      const {data:profile,error:profileError}=await admin.from("profiles").select("id").eq("telegram_id",telegramUserId).maybeSingle();
      if(profileError)throw profileError;
      const {data:connection,error:connectionError}=profile
        ? await admin.from("flamexbot_business_connections").select("is_enabled,rights").eq("profile_id",profile.id).maybeSingle()
        : {data:null,error:null};
      if(connectionError)throw connectionError;
      const connected=Boolean(connection?.is_enabled);
      const canReply=connection?.rights?.can_reply===true;
      const canDelete=connection?.rights?.can_delete_all_messages===true;
      await sendRichTelegramMessage(
        update.message.chat.id,
        `<b>FLAMEXBOT · статус</b>\n\n${connected?"🟢 Telegram Business подключён":"🔴 Telegram Business не подключён"}\n${canReply?"✓":"✕"} Отправка ответов\n${canDelete?"✓":"✕"} Удаление сообщений\n\nПроверка команд: <code>.ping</code> или <code>/ping</code> прямо в Business-переписке.\nСправка: /help`,
        "HTML",
      );
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^[./](ping|help|inf|commands|mute|profile|afk|antimute|antimut|autoread|autotyping|autovoice|mutestick|antimat|time|timeprofile|bold|dumb|link|streak|copyp|qr|id|chatid|date|calc|upper|lower|reverse|count|wordcount|choose|roll|advertising|clone|panic|warn)(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        "Команда получена в личном чате с FLAMEXBOT, но здесь нет выбранного собеседника.\n\nЧтобы .bold, .dumb, .time, .mute и другие команды сработали, открой обычную личную переписку с нужным человеком и отправь команду прямо туда. FLAMEXBOT определит этот диалог автоматически.\n\nПроверка подключения здесь: /status. Справка: /help.",
        "HTML",
      );
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^\/(help|commands)(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        `<b>FLAMEXBOT · помощь</b>

Привет! Я управляю возможностями FLAMEXBOT и Telegram Business.

<b>Важно:</b> команды .mute, .antimute и остальные команды управления нужно отправлять <b>прямо в переписке с нужным человеком</b>, а не сюда в личные сообщения боту.

Открой FLAMEXBOT, подключи Telegram Business и выдай необходимые разрешения. Затем отправь <code>.help</code> или <code>/help</code> в нужном диалоге.

Команды без адреса собеседника и без @username — бот определит текущий чат автоматически. Статус подключения: /status. Тарифы: /premium.`,
        "HTML",
        { inline_keyboard: [[{ text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } }]] },
      );
    }

    if (update.business_connection) await saveBusinessConnection(update.business_connection);
    if (update.business_message?.chat?.type === "private") {
      const ownerConnection = await ensureBusinessConnection(update.business_message.business_connection_id);
      if (!ownerConnection) {
        console.warn("Business update ignored: connection could not be resolved", update.business_message.business_connection_id);
        return new Response("OK", { status: 200 });
      }
      const ownerBan = ownerConnection.telegram_user_id
        ? await getTelegramBan(ownerConnection.telegram_user_id)
        : null;
      if (ownerBan) {
        console.warn("Ignored Business update for banned FLAMEXBOT owner", ownerConnection.telegram_user_id);
        return new Response("OK", { status: 200 });
      }
      const hasCommandPrefix = typeof update.business_message.text === "string" &&
        /^[./][a-z]/i.test(update.business_message.text.trim()) &&
        update.business_message.from?.id != null;
      const isBusinessCommand = hasCommandPrefix &&
        String(update.business_message.from.id) === String(ownerConnection?.telegram_user_id ?? "");
      const businessMessage = update.business_message;
      const ownerAuthored = String(businessMessage.from?.id ?? "") === String(ownerConnection?.telegram_user_id ?? "");
      let isAntimutEcho = Boolean(businessMessage.sender_business_bot?.id);
      if (ownerAuthored && ownerConnection?.profile_id && !isBusinessCommand && !isAntimutEcho) {
        try {
          const { data: echoChat, error: echoChatError } = await admin.from("flamexbot_business_chats")
            .select("id").eq("profile_id",ownerConnection.profile_id)
            .eq("telegram_chat_id",String(businessMessage.chat.id))
            .eq("business_connection_id",businessMessage.business_connection_id).maybeSingle();
          if (echoChatError) throw echoChatError;
          if (echoChat) {
            const { data: echoMessage, error: echoMessageError } = await admin.from("flamexbot_business_messages")
              .select("raw").eq("business_chat_id",echoChat.id)
              .eq("telegram_message_id",businessMessage.message_id).maybeSingle();
            if (echoMessageError) throw echoMessageError;
            isAntimutEcho = echoMessage?.raw?._flamexbot_antimut_resent === true;
          }
        } catch (echoError) {
          // Never block command execution on the optional anti-mute echo lookup.
          // Fail closed for this ordinary message to avoid a resend loop.
          isAntimutEcho = true;
          console.warn("Antimut echo lookup skipped:", (echoError as any)?.message ?? echoError);
        }
      }
      // Only commands authored by the connected account owner are executable.
      // Messages from the other participant (including dot-prefixed text) stay in the archive.
      if (!isBusinessCommand && !isAntimutEcho) {
        const savedBusinessChatId = await saveBusinessMessage(businessMessage, ownerConnection);
        if (!ownerAuthored && ownerConnection?.profile_id && savedBusinessChatId) {
          const trapChat = { id: savedBusinessChatId };
          if (trapChat) {
            const { data: trapSettings, error: trapSettingsError } = await admin.from("flamexbot_business_chat_settings")
              .select("burger_trap_armed,burger_close_sticker_id").eq("profile_id", ownerConnection.profile_id)
              .eq("business_chat_id", trapChat.id).maybeSingle();
            if (trapSettingsError) throw trapSettingsError;
            if (trapSettings?.burger_trap_armed) {
              const { error: consumeTrapError } = await admin.from("flamexbot_business_chat_settings")
                .update({ burger_trap_armed: false }).eq("profile_id", ownerConnection.profile_id)
                .eq("business_chat_id", trapChat.id);
              if (consumeTrapError) throw consumeTrapError;
              let trapResult: any = null;
              if (trapSettings.burger_close_sticker_id) trapResult = await telegram("sendSticker", {
                business_connection_id: businessMessage.business_connection_id,
                chat_id: businessMessage.chat.id, sticker: trapSettings.burger_close_sticker_id,
              });
              console.log("burger one-shot trap triggered", JSON.stringify({chat_id:String(businessMessage.chat.id),message_id:trapResult?.message_id,sticker:Boolean(trapSettings.burger_close_sticker_id)}));
            }
          }
        }
        try {
          // Antimut restores a message only after Telegram reports its deletion.
        } catch (antimutProcessingError) {
          console.error("Antimut processing failed:", (antimutProcessingError as any)?.message ?? antimutProcessingError);
        }
      }
      if (isBusinessCommand) {
        const commandToken = update.business_message.text.trim().slice(1).split(/\s+/)[0].replace(/@\w+$/,"").toLowerCase();
        console.log("business command candidate", JSON.stringify({
          command: commandToken,
          chat_id: String(update.business_message.chat.id),
          sender_id: String(update.business_message.from.id),
          connection_found: Boolean(ownerConnection),
          connection_enabled: Boolean(ownerConnection?.is_enabled),
          sender_is_owner: String(update.business_message.from.id) === String(ownerConnection?.telegram_user_id ?? ""),
        }));
        if (ownerConnection?.is_enabled &&
            String(update.business_message.from.id) === String(ownerConnection.telegram_user_id)) {
          let handled = false;
          try {
            handled = await handleBusinessChatCommand(update.business_message, update.business_message.business_connection_id, ownerConnection);
            console.log("business command processed", JSON.stringify({ command: commandToken, handled: Boolean(handled) }));
          } catch (commandError) {
            const reason = String((commandError as any)?.message ?? commandError ?? "Неизвестная ошибка").slice(0, 240);
            console.error("Business command failed", JSON.stringify({
              command: commandToken, chat_id: String(update.business_message.chat.id),
              owner_id: String(ownerConnection.telegram_user_id), error: reason,
            }));
            try {
              const safeReason = reason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              await sendBusinessReply(
                update.business_message.business_connection_id,
                update.business_message.chat.id,
                `${tgEmoji("warning")} <b>Команда .${commandToken} не выполнена</b>\nПричина: ${safeReason}\nПопробуй ещё раз позже. Если ошибка повторяется, сообщи администратору FLAMEXBOT.`,
                "HTML",
              );
            } catch (replyError) {
              console.error("Could not report Business command failure:", (replyError as any)?.message ?? replyError);
            }
          }
          // Intentionally keep handled owner commands in the conversation; no automatic deletion.
        }
      }
    }
    if (update.edited_business_message?.chat?.type === "private") await updateBusinessMessage(update.edited_business_message);
    if (update.deleted_business_messages?.chat?.type === "private") await deleteBusinessMessages(update.deleted_business_messages);
    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^[/](start|app)(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$/i.test(update.message.text)) {
      const chatId = update.message.chat.id;
      const startMatch = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$/i.exec(update.message.text.trim());
      const referralCode = startMatch?.[1]?.startsWith("ref_") ? startMatch[1].slice(4) : null;
      if (referralCode && update.message.from?.id) {
        const {error:referralError}=await admin.rpc("record_flamexbot_referral",{
          p_telegram_user_id:String(update.message.from.id),p_code:referralCode
        });
        if(referralError)console.warn("Referral link processing skipped:",referralError.message);
      }
      await Promise.all([
        ensureTelegramGlobalSetup(),
        ensureTelegramChatMenuButton(chatId),
      ]);
      const telegramUserId = String(update.message.from?.id ?? chatId);
      const { data: startConnection, error: startConnectionError } = await admin.from("flamexbot_business_connections")
        .select("connection_id,is_enabled,reconnected_welcome_pending").eq("telegram_user_id", telegramUserId).maybeSingle();
      if (startConnectionError) console.warn("Start Business connection lookup failed:", startConnectionError.message);
      const businessConnected = startConnection?.is_enabled === true;
      const welcomeBack = businessConnected && startConnection?.reconnected_welcome_pending === true;
      const requestedGuide = startMatch?.[1] === "connect_guide";
      const startMarkup = { inline_keyboard: [
        [{ text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } }],
        ...(!businessConnected ? [[{ text: "Инструкция к подключению", callback_data: "fx:connect_guide" }]] : []),
      ] };
      const { data: startBanner, error: startBannerError } = await admin.from("flamexbot_bot_banners")
        .select("image_url,caption,enabled").eq("banner_key","start").maybeSingle();
      if (startBannerError) console.warn("Start banner settings unavailable:", startBannerError.message);
      const defaultStartCaption = `${tgEmoji("sparkles")} <b>${welcomeBack ? "С возвращением в FLAMEXBOT!" : "Добро пожаловать в FLAMEXBOT!"}</b>

${tgEmoji("users")} Общайся с друзьями, поддерживай ваши огоньки и возвращайся к важным диалогам каждый день.`;
      const connectionStatus = businessConnected
        ? (welcomeBack
          ? `${tgEmoji("success")} <b>С возвращением! Бот снова подключён к вашему аккаунту.</b>`
          : `${tgEmoji("success")} <b>Бот подключён к вашему аккаунту.</b>`)
        : `${tgEmoji("warning")} <b>Вы ещё не подключили бота к своему аккаунту.</b> Нажмите «Инструкция к подключению», чтобы посмотреть шаги.`;
      const guideText = `${tgEmoji("settings")} <b>Подключение FLAMEXBOT</b>

1. Открой Telegram → Настройки → Telegram Business.
2. Выбери «Чат-боты» → «Добавить чат-бота».
3. Найди FLAMEXBOT и подключи его.
4. Выдай необходимые разрешения, включая «Удалять все сообщения» для антимута.
5. Вернись в FLAMEXBOT и проверь статус подключения.`;
      const startCaption = requestedGuide ? guideText : `${startBanner?.caption || defaultStartCaption}

${connectionStatus}`;
      if (startBanner?.enabled && startBanner.image_url && !requestedGuide) {
        await telegram("sendPhoto", { chat_id: chatId, photo: startBanner.image_url, caption: startCaption.slice(0,1024), parse_mode:"HTML", reply_markup:startMarkup });
      } else {
        await sendRichTelegramMessage(chatId,startCaption,"HTML",startMarkup);
      }
      if (welcomeBack) {
        const { error: welcomeResetError } = await admin.from("flamexbot_business_connections")
          .update({ reconnected_welcome_pending: false }).eq("telegram_user_id", telegramUserId).eq("connection_id", startConnection.connection_id);
        if (welcomeResetError) console.warn("Reconnect welcome flag reset failed:", welcomeResetError.message);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("flamexbot-bot webhook processing error:", error?.message ?? error);
    throw error;
  } finally {
    if (update.callback_query?.id) callbackFeedbackContexts.delete(String(update.callback_query.id));
    console.log("telegram update processed", JSON.stringify({update_id:update.update_id??null,duration_ms:Date.now()-startedAt}));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    try {
      const [me, webhook] = await Promise.all([
        telegram("getMe", {}),
        telegram("getWebhookInfo", {}),
      ]);
      return new Response(JSON.stringify({
        ok: true,
        bot_username: me.username ?? null,
        can_connect_to_business: me.can_connect_to_business === true,
        webhook_url_set: Boolean(webhook.url),
        webhook_url_matches: webhook.url === WEBHOOK_URL,
        allowed_updates: webhook.allowed_updates ?? [],
        pending_update_count: webhook.pending_update_count ?? 0,
        last_error_message: webhook.last_error_message ?? null,
        last_error_date: webhook.last_error_date ?? null,
      }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    } catch (error) {
      console.error("flamexbot-bot diagnostics error:", error?.message ?? error);
      return new Response(JSON.stringify({ ok: false, error: "Telegram diagnostics failed" }), {
        status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
  }
  if (req.method !== "POST") return new Response("OK", { status: 200 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (update.callback_query?.id) {
    const callbackId = String(update.callback_query.id);
    const callbackMessage = update.callback_query.message;
    callbackFeedbackContexts.set(callbackId, {
      chatId: callbackMessage?.chat?.id ?? update.callback_query.from?.id,
      businessConnectionId: callbackMessage?.business_connection_id,
    });
    if (callbackFeedbackContexts.size > 500) callbackFeedbackContexts.delete(callbackFeedbackContexts.keys().next().value!);
    try { await telegram("answerCallbackQuery", { callback_query_id: update.callback_query.id, text: "Запрос принят" }); }
    catch (callbackAckError) { console.warn("Early callback acknowledgement skipped:", (callbackAckError as any)?.message ?? callbackAckError); }
  }
  const updateId = Number(update.update_id);
  const hasUpdateId = Number.isSafeInteger(updateId) && updateId >= 0;
  let claimed = false;
  if (hasUpdateId && admin) {
    const claimStartedAt = Date.now();
    const { data: claimResult, error: claimError } = await admin.rpc("claim_flamexbot_telegram_update_v2", {
      p_update_id: updateId,
    });
    if (Date.now() - claimStartedAt >= 180) console.log("flamexbot stage slow", JSON.stringify({ stage: "update_claim", duration_ms: Date.now() - claimStartedAt }));
    if (claimError) {
      console.error("Telegram update claim failed:", claimError.message);
      return new Response("Webhook temporarily unavailable", { status: 500 });
    }
    if (claimResult === "completed") {
      if (update.callback_query?.id) callbackFeedbackContexts.delete(String(update.callback_query.id));
      return new Response("OK", { status: 200 });
    }
    claimed = claimResult === "claimed";
    if (!claimed) {
      if (update.callback_query?.id) callbackFeedbackContexts.delete(String(update.callback_query.id));
      // Keep Telegram retrying an in-flight or uncertain update; only completed updates get 200.
      return new Response("Update is still processing; retry later", {
        status: 503,
        headers: { "Retry-After": "2" },
      });
    }
  }

  try {
    // Telegram requires an answer to pre-checkout within 10 seconds.
    if (update.pre_checkout_query) await handlePreCheckout(update.pre_checkout_query);
    await processTelegramUpdate(update);
    if (claimed && admin) {
      const completeStartedAt = Date.now();
      const { error: completeError } = await admin.rpc("complete_flamexbot_telegram_update", {
        p_update_id: updateId,
      });
      if (Date.now() - completeStartedAt >= 180) console.log("flamexbot stage slow", JSON.stringify({ stage: "update_complete", duration_ms: Date.now() - completeStartedAt }));
      if (completeError) throw completeError;
    }
    return new Response("OK", { status: 200, headers: { "Connection": "keep-alive" } });
  } catch (error) {
    console.error("Telegram webhook failed; update will be retried:", error?.message ?? error);
    if (claimed && admin) {
      const { error: failError } = await admin.rpc("fail_flamexbot_telegram_update", {
        p_update_id: updateId,
        p_error: String(error?.message ?? error ?? "Unknown webhook error"),
      });
      if (failError) console.error("Could not record failed Telegram update:", failError.message);
    }
    return new Response("Webhook processing failed", { status: 500 });
  }
});
