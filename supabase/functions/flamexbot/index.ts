import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = "https://flamexbot.pages.dev";
const FOUNDER_TELEGRAM_ID = "7781170049";
const WEBHOOK_URL = "https://yxmfhnbqzudoiwjlrpui.supabase.co/functions/v1/flamexbot-bot";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "fxbot_whsec_6c2d9a7e4f1b8c3d5a0e7f9b2c4d6a8e";
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
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

async function telegram(method: string, body: Record<string, unknown>) {
  let payload = body;
  if (body.reply_markup && typeof body.reply_markup === "object") {
    try {
      const available = await getAvailablePremiumEmojiIds();
      const icons: Record<string, keyof typeof PREMIUM_EMOJI> = {
        open: "sparkles", settings: "settings", back: "back", home: "home",
        refresh: "refresh", success: "success", confirm: "success",
        cancel: "cancel", help: "help", download: "download", export: "download",
        security: "lock", premium: "diamond", star: "star", upload: "upload",
        search: "search", folder: "folder", profile: "user",
      };
      const enrich = (rows: unknown) => Array.isArray(rows) ? rows.map((row: any) =>
        Array.isArray(row) ? row.map((button: any) => {
          if (!button || typeof button !== "object" || button.icon_custom_emoji_id) return button;
          const label = (String(button.text ?? "") + " " + String(button.callback_data ?? "")).toLowerCase();
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
            : /защит|безопас|lock/.test(label) ? "security"
            : /загруз|отправ|upload/.test(label) ? "upload"
            : /поиск|найти|search/.test(label) ? "search"
            : /папк|архив/.test(label) ? "folder"
            : /открыть|запустить|старт|подключ|войти|прилож/.test(label) ? "open"
            : null;
          if (!key) return button;
          const emoji = PREMIUM_EMOJI[icons[key] ?? key as keyof typeof PREMIUM_EMOJI];
          return emoji && available.has(emoji.id) ? { ...button, icon_custom_emoji_id: emoji.id } : button;
        }) : row
      ) : rows;
      const markup = body.reply_markup as Record<string, unknown>;
      const enhanced = { ...markup };
      if (markup.inline_keyboard) enhanced.inline_keyboard = enrich(markup.inline_keyboard);
      if (markup.keyboard) enhanced.keyboard = enrich(markup.keyboard);
      payload = { ...body, reply_markup: enhanced };
    } catch (error) {
      console.warn("Telegram button emoji enrichment skipped:", (error as any)?.message ?? error);
    }
  }
  const response = await fetch(`${API}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const message = String(data.description ?? `Telegram API ${method} failed`);
    if (JSON.stringify(payload) !== JSON.stringify(body)
        && /icon_custom_emoji_id|custom emoji|BUTTON_TYPE_INVALID|BUTTON_DATA_INVALID|keyboard button|button.*invalid/i.test(message)) {
      const fallbackResponse = await fetch(`${API}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
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
  const item = PREMIUM_EMOJI[name];
  return `<tg-emoji emoji-id="${item.id}">${fallback ?? item.fallback}</tg-emoji>`;
}
async function sendRichTelegramMessage(
  chatId: number | string,
  body: string,
  parseMode?: string,
  replyMarkup?: Record<string, unknown>,
  connectionId?: string,
) {
  const available = await getAvailablePremiumEmojiIds();
  const emojiPattern = new RegExp('<tg-emoji emoji-id="([0-9]+)">([^<]*)</tg-emoji>', 'g');
  const prepared = body.replace(emojiPattern, (_match, id, fallback) =>
    available.has(String(id)) ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback);
  const payload: Record<string, unknown> = {
    ...(connectionId ? { business_connection_id: connectionId } : {}),
    chat_id: chatId,
    text: prepared,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };
  try {
    return await telegram("sendMessage", payload);
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
async function saveBusinessConnection(connection: any) {
  if (!admin || !connection?.user?.id || !connection?.id) throw new Error("Business connection payload is incomplete or Supabase service is unavailable");
  const telegramUserId = String(connection.user.id);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id").eq("telegram_id", telegramUserId).maybeSingle();
  if (profileError) throw profileError;
  const { data: previous, error: previousError } = await admin.from("flamexbot_business_connections")
    .select("connection_id,is_enabled").eq("telegram_user_id", telegramUserId).maybeSingle();
  if (previousError) throw previousError;
  const enabled = Boolean(connection.is_enabled);
  const shouldNotify = !previous || previous.connection_id !== connection.id || previous.is_enabled !== enabled;
  const { error } = await admin.from("flamexbot_business_connections").upsert({
    telegram_user_id: telegramUserId, profile_id: profile?.id ?? null,
    connection_id: connection.id,
    user_chat_id: connection.user_chat_id != null ? String(connection.user_chat_id) : null,
    is_enabled: enabled, rights: connection.rights ?? {},
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
  const { data: existing, error } = await admin.from("flamexbot_business_connections")
    .select("connection_id").eq("connection_id", connectionId).maybeSingle();
  if (error) throw error;
  if (existing) return;
  // Telegram may deliver business_message without a preceding business_connection update.
  // Resolve the connection directly from Telegram so the first message can initialize it.
  const connection = await telegram("getBusinessConnection", { business_connection_id: connectionId });
  await saveBusinessConnection(connection);
}
function containsBusinessProfanity(value: string) {
  return /(^|[^а-яёa-z0-9_])(?:бля[а-яё]*|хуй[а-яё]*|хуе[а-яё]*|пизд[а-яё]*|еб[а-яё]*|муд[а-яё]*|сука[а-яё]*|пидор[а-яё]*|fuck[a-z]*|shit[a-z]*|bitch[a-z]*|asshole[a-z]*)(?=$|[^а-яёa-z0-9_])/i.test(value);
}
async function saveBusinessMessage(message: any, connectionOverride?: any) {
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
  if (!connection?.profile_id || !connection.is_enabled) return;
  const senderId = message.from?.id != null ? String(message.from.id) : null;
  const direction = senderId && senderId === connection.telegram_user_id ? "outbound" : "inbound";
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
  if (direction === "inbound") {
    if (isFounderTarget(chatId)) return;
    const { data: chatPrefs, error: chatSettingsError } = await admin.from("flamexbot_business_chat_settings")
      .select("is_muted,antimut_enabled,afk_enabled,afk_message,autoread_enabled,autotyping_enabled,autovoice_enabled,mutestick_enabled,antimat_enabled")
      .eq("profile_id", connection.profile_id).eq("business_chat_id", chat.id).maybeSingle();
    if (chatSettingsError) throw chatSettingsError;
    const isFounderChat = chatId === FOUNDER_TELEGRAM_ID;
    const hasCommandAutomations = Boolean(
      chatPrefs?.is_muted || chatPrefs?.antimut_enabled || chatPrefs?.afk_enabled ||
      chatPrefs?.autoread_enabled || chatPrefs?.autotyping_enabled || chatPrefs?.autovoice_enabled ||
      chatPrefs?.mutestick_enabled || chatPrefs?.antimat_enabled
    );
    if (hasCommandAutomations && connection.telegram_user_id !== FOUNDER_TELEGRAM_ID) {
      const { data: targetProtection, error: targetProtectionError } = await admin.from("profiles")
        .select("command_protection_expires_at,command_protection_disabled").eq("telegram_id", chatId).maybeSingle();
      if (targetProtectionError) throw targetProtectionError;
      const protectedUntil = targetProtection?.command_protection_expires_at
        ? new Date(targetProtection.command_protection_expires_at).getTime() : 0;
      if (protectedUntil > Date.now() && targetProtection?.command_protection_disabled !== true) return;
    }
    const shouldHardMute = !isFounderChat && Boolean(chatPrefs?.is_muted);
    const shouldDeleteSticker = media.type === "sticker" && Boolean(chatPrefs?.mutestick_enabled);
    const shouldDeleteProfanity = Boolean(chatPrefs?.antimat_enabled) && containsBusinessProfanity(content);
    const shouldFilter = shouldDeleteSticker || shouldDeleteProfanity;
    if (shouldHardMute || shouldFilter) {
      if (connection.rights?.can_delete_all_messages) {
        try {
          await telegram("deleteBusinessMessages", {
            business_connection_id: connection.connection_id,
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
  const { data: connection, error } = await admin.from("flamexbot_business_connections").select("profile_id").eq("connection_id", update.business_connection_id).maybeSingle();
  if (error) throw error; if (!connection?.profile_id) return;
  const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats").select("id").eq("profile_id", connection.profile_id).eq("telegram_chat_id", String(update.chat.id)).maybeSingle();
  if (chatError) throw chatError; if (!chat) return;
  const { data: messages, error: messagesError } = await admin.from("flamexbot_business_messages").select("telegram_message_id,direction,content,message_type,media_file_id,media_url,raw,deleted_at").eq("business_chat_id", chat.id).in("telegram_message_id", update.message_ids);
  if (messagesError) throw messagesError;
  const deletedAt = new Date().toISOString();
  const events = await Promise.all((messages || []).filter((item: any) => !item.deleted_at).map(async (item: any) => {
    const raw=item.raw??{};
    const originalName=raw.document?.file_name??raw.audio?.file_name??raw.video?.file_name??raw.animation?.file_name??undefined;
    const archivedUrl=item.media_url||(item.media_file_id
      ? await archiveBusinessMedia(item.media_file_id,connection.profile_id,chat.id,item.telegram_message_id,originalName)
      : null);
    return {
      profile_id: connection.profile_id, business_chat_id: chat.id, telegram_message_id: item.telegram_message_id, event_type: "deleted",
      original_content: item.content ?? "", message_type: item.message_type ?? "text", media_file_id: item.media_file_id ?? null, media_url: archivedUrl, original_raw: raw, occurred_at: deletedAt,
    };
  }));
  const knownIds = new Set((messages || []).map((item: any) => Number(item.telegram_message_id)));
  const missingEvents = update.message_ids.filter((messageId: number) => !knownIds.has(Number(messageId))).map((messageId: number) => ({
    profile_id: connection.profile_id, business_chat_id: chat.id, telegram_message_id: messageId,
    event_type: "deleted", original_content: "[Текст не был сохранён до получения события об удалении]",
    message_type: "unknown", media_file_id: null, media_url: null, original_raw: {}, occurred_at: deletedAt,
  }));
  const allEvents = [...events, ...missingEvents];
  if (allEvents.length) { const { error: eventError } = await admin.from("flamexbot_business_message_events").upsert(allEvents, { onConflict: "business_chat_id,telegram_message_id,event_type,occurred_at", ignoreDuplicates: true }); if (eventError) throw eventError; }
  const { error: deleteError } = await admin.from("flamexbot_business_messages").update({ deleted_at: deletedAt }).eq("business_chat_id", chat.id).in("telegram_message_id", update.message_ids);
  if (deleteError) throw deleteError;
}

async function handleBusinessChatCommand(message: any, businessConnectionId: string, connectionOverride?: any) {
  if (!admin || !businessConnectionId || message?.chat?.type !== "private" || !message?.from?.id || typeof message.text !== "string") return false;
  const text = message.text.trim();
  if (!/^[./][a-z]/i.test(text)) return false;
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
  if (command === "ping") {
    await reply(`${tgEmoji("success")} <b>PONG!</b>\nBusiness-команды получены. Текущий диалог определён, обработчик отвечает.`, "HTML");
    return true;
  }
  if (command === "help" || command === "inf" || command === "commands") {
    await reply(`${tgEmoji("sparkles")} <b>FLAMEXBOT · все команды</b>

${tgEmoji("settings")} <b>Автоматизация текущего диалога</b>
<code>.afk причина</code> / <code>.unafk</code> — автоответ только в этом диалоге
<code>.autoread</code> / <code>.unautoread</code> — автопрочтение только здесь
<code>.autotyping</code> / <code>.unautotyping</code> — статус набора только здесь
<code>.autovoice</code> / <code>.unautovoice</code> — статус записи только здесь
<code>.mutestick</code> / <code>.unmutestick</code> — фильтр стикеров только здесь\n<code>.antimat</code> / <code>.unantimat</code> — фильтр мата

${tgEmoji("lock")} <b>Текущий диалог</b>
<code>.ping</code> / <code>/ping</code> — проверить ответы Business-команд\n<code>.help</code> / <code>/help</code> / <code>.commands</code> — полный список команд\n<code>.streak 1-3650</code> — мгновенно установить серию (только администрация)\n<code>.mute</code> / <code>/mute</code> — удалять новые входящие сообщения
<code>.unmute</code> — остановить удаление сообщений
<code>.antimute</code> / <code>.unantimute</code> — отправлять новые сообщения от имени бота FLAMEXBOT (собеседник должен открыть бота и нажать Start)
<code>.spam 2-5 текст</code> — отправить от 2 до 5 копий сообщения

${tgEmoji("edit")} <b>Дополнительно</b>
<code>.timeprofile</code> — закрепить московское время (UTC+3)
<code>.time</code> / <code>.untime</code> — показать или скрыть время профиля
<code>.bold текст</code> / <code>.dumb текст</code> — изменить оформление текста
<code>.link текст</code> — создать ссылку на этот диалог\n<code>.copyp</code> — скопировать данные профиля собеседника\n<code>.qr текст</code> — создать QR-код для текста или ссылки

${tgEmoji("help")} <b>Как пользоваться</b>
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
  const commandNeedsPremium = ["mute","spam","afk","timeprofile","bold","dumb","link","time","copyp","antimute","antimut","autoread","autotyping","autovoice","mutestick","antimat"].includes(command);
  let premium = false;
  if (commandNeedsPremium) {
    const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
      .select("plan,expires_at").eq("user_id", profile.id).maybeSingle();
    if (subscriptionError) throw subscriptionError;
    premium = ["premium","founder"].includes(subscription?.plan) && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
  }
  if (!premium && commandNeedsPremium) {
    await reply(`${tgEmoji("star")} Для этой команды нужна активная подписка <b>Premium</b>. Команды отключения и размут доступны и без неё.`, "HTML");
    return true;
  }

  if (command === "afk") {
    const reason = args.join(" ").trim().slice(0, 300) || "Сейчас отошёл, отвечу позже.";
    const { error: afkError } = await admin.from("flamexbot_business_chat_settings").upsert({
      profile_id: profile.id, business_chat_id: chat.id, afk_enabled: true, afk_message: reason,
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id,business_chat_id" });
    if (afkError) throw afkError;
    await reply("🌙 AFK включён только в этом диалоге. Автоответ будет отправляться на входящие Business-сообщения.");
    return true;
  }
  if (command === "unafk") {
    const { error: afkError } = await admin.from("flamexbot_business_chat_settings").upsert({
      profile_id: profile.id, business_chat_id: chat.id, afk_enabled: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id,business_chat_id" });
    if (afkError) throw afkError;
    await reply("AFK выключен в этом диалоге.");
    return true;
  }
  const preferenceCommands: Record<string, { key: string; enabled: boolean; label: string }> = {
    autoread: { key: "autoread_enabled", enabled: true, label: "Автопрочтение" },
    unautoread: { key: "autoread_enabled", enabled: false, label: "Автопрочтение" },
    autotyping: { key: "autotyping_enabled", enabled: true, label: "Статус «печатает…»" },
    unautotyping: { key: "autotyping_enabled", enabled: false, label: "Статус «печатает…»" },
    autovoice: { key: "autovoice_enabled", enabled: true, label: "Статус записи голосового" },
    unautovoice: { key: "autovoice_enabled", enabled: false, label: "Статус записи голосового" },
    mutestick: { key: "mutestick_enabled", enabled: true, label: "Фильтр стикеров" },
    unmutestick: { key: "mutestick_enabled", enabled: false, label: "Фильтр стикеров" },
    antimat: { key: "antimat_enabled", enabled: true, label: "Антимат" },
    unantimat: { key: "antimat_enabled", enabled: false, label: "Антимат" },
  };
  const preferenceCommand = preferenceCommands[command];
  if (preferenceCommand) {
    if (preferenceCommand.enabled && ["mutestick_enabled","antimat_enabled"].includes(preferenceCommand.key) &&
        connectionOverride?.rights?.can_delete_all_messages !== true) {
      await reply("⛔ Для включения фильтра Telegram Business должен выдать право «Удалять все сообщения».");
      return true;
    }
    const { error: chatPreferenceError } = await admin.from("flamexbot_business_chat_settings").upsert({
      profile_id: profile.id, business_chat_id: chat.id,
      [preferenceCommand.key]: preferenceCommand.enabled, updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id,business_chat_id" });
    if (chatPreferenceError) throw chatPreferenceError;
    await reply((preferenceCommand.enabled ? tgEmoji("success") + " <b>" : tgEmoji("lock") + " <b>") +
      escapeHtml(preferenceCommand.label) + (preferenceCommand.enabled ? " включён.</b>" : " выключен.</b>"), "HTML");
    return true;
  }
  if (["antimute","antimut","unantimute","unantimut"].includes(command)) {
    if (!businessConnectionId) { await reply("Команда работает только внутри подключённого Business-чата."); return true; }
    const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats").select("id,telegram_chat_id,telegram_user_id,business_connection_id").eq("profile_id", profile.id).eq("telegram_chat_id", String(message.chat.id)).eq("business_connection_id", businessConnectionId).maybeSingle();
    if (chatError) throw chatError; if (!chat) { await reply("Не удалось определить этот Business-чат."); return true; }
    if (isFounderTarget(chat.telegram_chat_id, chat.telegram_user_id)) { await reply(tgEmoji("lock") + " <b>Владелец FLAMEXBOT защищён.</b> Режимы управления для этого диалога отключены.", "HTML"); return true; }
    const enabled = command === "antimute" || command === "antimut";
    const { error: settingError } = await admin.from("flamexbot_business_chat_settings").upsert({ profile_id: profile.id, business_chat_id: chat.id, antimut_enabled: enabled }, { onConflict: "profile_id,business_chat_id" });
    if (settingError) throw settingError;
    const markup = { inline_keyboard: [[{ text: enabled ? "🔒 Отключить антимут" : "🛡 Включить антимут", callback_data: "fb:antimut_" + (enabled ? "off" : "on") + ":" + chat.id }]] };
    await reply(enabled ? tgEmoji("success") + " <b>Антимут включён</b>\nНовые сообщения будут отправляться от имени бота FLAMEXBOT. Получатель должен открыть бота и нажать Start; блокировки Telegram не обходятся." : tgEmoji("lock") + " <b>Антимут выключен</b>\nДополнительное сохранение режима антимута отключено.", "HTML", markup);
    return true;
  }
  if (command === "timeprofile") {
    await savePreference({ timezone_offset: 3 });
    await reply("Часовой пояс FLAMEXBOT закреплён: Москва (UTC+3). Все даты и ежедневные задания используют МСК.");
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
  if (command === "time" || command === "untime") {
    const enabled = command === "time";
    const { error } = await admin.from("profiles").update({ show_profile_time: enabled }).eq("id", profile.id);
    if (error) throw error;
    await reply(enabled ? "🕒 Время в профиле включено." : "Время в профиле скрыто.");
    return true;
  }
  if (command === "mute" || command === "unmute" || command === "spam") {
    if (!businessConnectionId) { await reply("Эту команду нужно писать в личной переписке с собеседником."); return true; }
    const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats")
      .select("id,telegram_chat_id,telegram_user_id,business_connection_id,username,first_name,last_name,photo_url")
      .eq("profile_id", profile.id).eq("telegram_chat_id", String(message.chat.id)).eq("business_connection_id", businessConnectionId).maybeSingle();
    if (chatError) throw chatError;
    if (!chat) { await reply("Не удалось определить текущий Business-чат. Проверь подключение Telegram Business."); return true; }
    if (command === "mute" || command === "unmute") {
      if (command === "mute") {
        let business = connectionOverride;
        if (!business) {
          const { data, error } = await admin.from("flamexbot_business_connections")
            .select("rights,is_enabled").eq("profile_id", profile.id)
            .eq("connection_id", businessConnectionId).maybeSingle();
          if (error) throw error;
          business = data;
        }
        if (!business?.is_enabled || !business.rights?.can_delete_all_messages) {
          await reply("⛔ Для .mute нужно включить право Telegram Business «Удалять все сообщения». Сейчас режим не активирован.");
          return true;
        }
      }
      const { error } = await admin.from("flamexbot_business_chat_settings").upsert({
        profile_id: profile.id, business_chat_id: chat.id, is_muted: command === "mute",
      }, { onConflict: "profile_id,business_chat_id" });
      if (error) throw error;
      const enabled = command === "mute";
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
      const username = String(chat.username || "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
      const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "Telegram-пользователь";
      const telegramId = String(chat.telegram_user_id || chat.telegram_chat_id);
      const profileLink = username ? `<a href="https://t.me/${username}">Открыть профиль</a>` : "Публичная ссылка недоступна";
      await reply(`${tgEmoji("users")} <b>Профиль собеседника</b>\nИмя: <b>${escapeHtml(fullName)}</b>\nЮзернейм: ${username ? "@" + escapeHtml(username) : "не указан"}\nTelegram ID: <code>${escapeHtml(telegramId)}</code>\n${profileLink}`, "HTML");
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
    const count = Number(args[0]);
    const spamText = args.slice(1).join(" ").trim();
    if (!Number.isInteger(count) || count < 2 || count > 5 || !spamText) {
      await reply("Формат: .spam 2-5 текст сообщения");
      return true;
    }
    let connection = connectionOverride;
    if (!connection) {
      const { data, error } = await admin.from("flamexbot_business_connections")
        .select("is_enabled,connection_id").eq("profile_id", profile.id).eq("connection_id", businessConnectionId).maybeSingle();
      if (error) throw error;
      connection = data;
    }
    if (!connection?.is_enabled) { await reply("Подключение Telegram Business не активно."); return true; }
    let sent = 0;
    for (let i = 0; i < count; i++) {
      try {
        await telegram("sendMessage", {
          business_connection_id: connection.connection_id,
          chat_id: Number(message.chat.id),
          text: spamText,
        });
        sent++;
      } catch (error) {
        await reply(`${tgEmoji("warning")} Отправлено ${sent} из ${count}. ${escapeHtml(explainTelegramSendError(error))}`, "HTML");
        return true;
      }
      if (i < count - 1) await new Promise(resolve => setTimeout(resolve, 1200));
    }
    await reply(`${tgEmoji("success")} <b>Готово.</b> Отправлено ${sent} сообщений в этот диалог.`, "HTML");
    return true;
  }
  await reply("Неизвестная команда. Напиши .help");
  return true;
}


async function handleBusinessActionCallback(query: any) {
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
  const { data: connection, error: connectionError } = await admin.from("flamexbot_business_connections")
    .select("connection_id,telegram_user_id,is_enabled,rights")
    .eq("profile_id", chat.profile_id).eq("connection_id", chat.business_connection_id).maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || String(query.from.id) !== String(connection.telegram_user_id)) {
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Эта кнопка доступна только владельцу подключения." });
    return;
  }
  if (String(connection.telegram_user_id) !== FOUNDER_TELEGRAM_ID) {
    const targetTelegramId = String(chat.telegram_user_id || chat.telegram_chat_id || "");
    if (targetTelegramId) {
      const { data: protection, error: protectionError } = await admin.from("profiles")
        .select("command_protection_expires_at,command_protection_disabled").eq("telegram_id", targetTelegramId).maybeSingle();
      if (protectionError) throw protectionError;
      if (protection?.command_protection_expires_at
          && new Date(protection.command_protection_expires_at).getTime() > Date.now()
          && protection.command_protection_disabled !== true) {
        await telegram("answerCallbackQuery", {
          callback_query_id: query.id,
          text: "Пользователь включил защиту от команд. Использовать команды на нём может только Основатель.",
          show_alert: true,
        });
        return;
      }
    }
  }
  if (enabled) {
    const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
      .select("plan,expires_at").eq("user_id", chat.profile_id).maybeSingle();
    if (subscriptionError) throw subscriptionError;
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
  }
  const field = action === "mute" ? "is_muted" : "antimut_enabled";
  const { error: updateError } = await admin.from("flamexbot_business_chat_settings").upsert({
    profile_id: chat.profile_id, business_chat_id: chat.id, [field]: enabled,
  }, { onConflict: "profile_id,business_chat_id" });
  if (updateError) throw updateError;
  await telegram("answerCallbackQuery", { callback_query_id: query.id, text: enabled ? "Функция включена." : "Функция выключена." });
  if (!connection.is_enabled) return;
  const markup = { inline_keyboard: [[{
    text: action === "mute"
      ? (enabled ? "🔊 Выключить мут" : "🔇 Включить мут")
      : (enabled ? "🔒 Выключить антимут" : "🛡 Включить антимут"),
    callback_data: `fb:${action}_${enabled ? "off" : "on"}:${chat.id}`,
  }]] };
  const body = action === "mute"
    ? (enabled
      ? `${tgEmoji("lock")} <b>Мут включён</b>\nНовые входящие сообщения в этом диалоге будут удаляться. История чата остаётся без изменений.`
      : `${tgEmoji("success")} <b>Размут выполнен</b>\nУдаление новых сообщений остановлено.`)
    : (enabled
      ? `${tgEmoji("success")} <b>Антимут включён</b>\nСообщения владельца будут видны в истории FLAMEXBOT. Мут собеседника и ограничения Telegram не обходятся.`
      : `${tgEmoji("lock")} <b>Антимут выключен</b>\nДополнительное сохранение режима антимута отключено.`);
  await sendBusinessReply(connection.connection_id, chat.telegram_chat_id, body, "HTML", markup);
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
async function sendPremiumInvoice(chatId: number, telegramUserId: number) {
  if (!admin) throw new Error("Database is unavailable");
  const { data: profile, error } = await admin.from("profiles").select("id,telegram_id").eq("telegram_id", String(telegramUserId)).maybeSingle();
  if (error) throw error;
  if (!profile?.id) { await sendRichTelegramMessage(chatId, `${tgEmoji("warning")} <b>Сначала привяжи Telegram.</b> Открой профиль FLAMEXBOT и заверши привязку этого аккаунта.`, "HTML"); return; }
  const { data: current } = await admin.from("user_subscriptions").select("plan,expires_at").eq("user_id", profile.id).maybeSingle();
  if (["premium","founder"].includes(current?.plan) && (!current.expires_at || new Date(current.expires_at).getTime() > Date.now())) {
    await sendRichTelegramMessage(chatId, `${tgEmoji("success")} <b>Premium уже активен.</b> Все возможности тарифа доступны до окончания подписки.`, "HTML"); return;
  }
  const payload = `flamexbot_premium:${profile.id}:${crypto.randomUUID()}`;
  await telegram("sendInvoice", { chat_id: chatId, title: "FLAMEXBOT Premium", description: "Полный доступ к Premium-функциям на 30 дней.", payload, currency: "XTR", prices: [{ label: "Premium · 30 дней", amount: PREMIUM_PRICE_STARS }] });
}
async function handlePreCheckout(query: any) {
  let ok = false;
  try {
    if (admin && query.currency === "XTR") {
      const payload = String(query.invoice_payload ?? "");
      const premiumUserId = parsePremiumPayload(payload);
      if (premiumUserId && query.total_amount === PREMIUM_PRICE_STARS) {
        const { data: profile, error } = await admin.from("profiles")
          .select("id,telegram_id,is_banned").eq("id", premiumUserId).maybeSingle();
        if (error) throw error;
        ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id));
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
      } else if (parseWheelPayload(payload) && query.total_amount === 5) {
        const { data: order, error: orderError } = await admin.from("flamexbot_wheel_orders")
          .select("user_id,telegram_user_id,status,price_stars").eq("invoice_payload",payload).maybeSingle();
        if (orderError) throw orderError;
        if (order && order.status === "pending" && order.price_stars === 5 && order.telegram_user_id === String(query.from?.id)) {
          const { data: profile, error: profileError } = await admin.from("profiles")
            .select("telegram_id,is_banned").eq("id",order.user_id).maybeSingle();
          if (profileError) throw profileError;
          ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id));
        }
      }
    }
  } catch (error) { console.error("pre-checkout validation:", error?.message ?? error); }
  await telegram("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok, ...(!ok ? { error_message: "Счёт недействителен или устарел. Создай новый счёт в FLAMEXBOT." } : {}) });
}
async function refundTelegramStarsPayment(telegramUserId: number, chargeId: string) {
  try {
    await telegram("refundStarPayment", { user_id: telegramUserId, telegram_payment_charge_id: chargeId });
  } catch (error) {
    const message = String(error?.message ?? error ?? "");
    if (!/ALREADY_REFUNDED|already refunded/i.test(message)) throw error;
  }
}

async function handleSuccessfulPayment(message: any) {
  if (!admin || !message?.from?.id || !message?.successful_payment) return;
  const payment = message.successful_payment;
  const invoicePayload = String(payment.invoice_payload ?? "");
  const wheelUserId = parseWheelPayload(invoicePayload);
  if (wheelUserId) {
    if (payment.currency !== "XTR" || payment.total_amount !== 5 || !payment.telegram_payment_charge_id) throw new Error("Wheel payment mismatch");
    const { data: order, error: orderError } = await admin.from("flamexbot_wheel_orders")
      .select("id,user_id,telegram_user_id,status").eq("invoice_payload",invoicePayload).maybeSingle();
    if (orderError) throw orderError;
    if (!order || order.user_id !== wheelUserId || order.telegram_user_id !== String(message.from.id)) throw new Error("Wheel order does not match payer");
    if (order.status === "paid") return;
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned").eq("id",wheelUserId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.telegram_id !== String(message.from.id)) throw new Error("Wheel payer does not match profile");
    if (profile.is_banned) {
      await refundTelegramStarsPayment(Number(message.from.id),payment.telegram_payment_charge_id);
      await sendRichTelegramMessage(message.chat.id,"Оплата возвращена: аккаунт заблокирован.","HTML");
      return;
    }
    const {data:prize,error:prizeError}=await admin.rpc("apply_flamexbot_wheel_payment",{
      p_invoice_payload:invoicePayload,p_telegram_user_id:String(message.from.id),
      p_telegram_payment_charge_id:payment.telegram_payment_charge_id,
      p_provider_payment_charge_id:payment.provider_payment_charge_id??null,
      p_currency:payment.currency,p_total_amount:payment.total_amount
    });
    if(prizeError)throw prizeError;
    await sendRichTelegramMessage(message.chat.id,
      `${tgEmoji("sparkles")} <b>Колесо фортуны!</b>\nТвоя награда: <b>${String(prize?.prize_label??"Награда начислена")}</b>.\nОткрой FLAMEXBOT, чтобы посмотреть результат.`,
      "HTML",{inline_keyboard:[[{text:"✦ Открыть FLAMEXBOT",web_app:{url:APP_URL}}]]});
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
    if (order.status === "refunded") {
      await refundTelegramStarsPayment(Number(message.from.id), payment.telegram_payment_charge_id);
      return;
    }
    if (addonProfile.is_banned || order.status !== "pending") {
      await refundTelegramStarsPayment(Number(message.from.id), payment.telegram_payment_charge_id);
      const { error: refundRecordError } = await admin.from("flamexbot_addon_star_payments")
        .update({
          status: "refunded",
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
          paid_at: new Date().toISOString(),
        }).eq("invoice_payload", invoicePayload).in("status", ["pending","failed"]);
      if (refundRecordError) throw refundRecordError;
      await sendRichTelegramMessage(message.chat.id, "⛔ Оплата дополнения возвращена: аккаунт заблокирован или счёт недействителен.", "HTML");
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
    if (applyError) throw applyError;
    if (applied === true) {
      await sendRichTelegramMessage(message.chat.id,
        `${tgEmoji("success")} <b>Защита от команд активирована!</b>\nНа ваш аккаунт нельзя применять команды FLAMEXBOT в течение 5 дней. Основатель проекта сохраняет доступ к командам на всех аккаунтах.`,
        "HTML");
    }
    return;
  }

  const userId = parsePremiumPayload(invoicePayload);
  if (!userId || payment.currency !== "XTR" || payment.total_amount !== PREMIUM_PRICE_STARS || !payment.telegram_payment_charge_id) throw new Error("Successful Telegram Stars payment did not match a Premium invoice");
  const { data: profile, error: profileError } = await admin.from("profiles").select("id,telegram_id,is_banned,ban_reason").eq("id", userId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.telegram_id !== String(message.from.id)) throw new Error("Telegram payment sender does not match the FLAMEXBOT account");
  if (profile.is_banned) {
    await refundTelegramStarsPayment(Number(message.from.id), payment.telegram_payment_charge_id);
    await sendRichTelegramMessage(message.chat.id, "⛔ Аккаунт заблокирован. Оплата Premium автоматически возвращена.", "HTML");
    return;
  }
  const { data: applied, error: applyError } = await admin.rpc("apply_flamexbot_star_payment", {
    p_user_id: userId, p_telegram_user_id: String(message.from.id), p_invoice_payload: payment.invoice_payload,
    p_telegram_payment_charge_id: payment.telegram_payment_charge_id,
    p_provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
    p_currency: payment.currency, p_total_amount: payment.total_amount, p_period_days: PREMIUM_PERIOD_DAYS,
  });
  if (applyError) throw applyError;
  if (applied === true) await sendRichTelegramMessage(message.chat.id, `${tgEmoji("star")} <b>Оплата прошла успешно!</b> FLAMEXBOT Premium активирован на 30 дней. Перезапусти приложение, чтобы обновить статус подписки.`, "HTML");
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
    const directTelegramUserId =
      update.message?.from?.id ??
      update.callback_query?.from?.id ??
      update.pre_checkout_query?.from?.id ??
      update.business_connection?.user?.id;
    if (directTelegramUserId != null && String(directTelegramUserId) !== FOUNDER_TELEGRAM_ID && !update.message?.successful_payment) {
      const ban = await getTelegramBan(directTelegramUserId);
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
    if (update.callback_query?.data === "fx:connect_guide") {
      await telegram("answerCallbackQuery",{callback_query_id:update.callback_query.id});
      await sendRichTelegramMessage(update.callback_query.message.chat.id,
        `<b>Инструкция по подключению FLAMEXBOT</b>\n\n1. Открой Telegram → Настройки → Telegram Business.\n2. Выбери «Чат-боты» → «Добавить чат-бота».\n3. Найди FLAMEXBOT и подключи его.\n4. Разреши доступ к сообщениям и отправке ответов. Для автоматического удаления сообщений также включи право удаления.\n5. Вернись в Mini App → Профиль и проверь статус подключения.`,
        "HTML",{inline_keyboard:[[{text:"✦ Открыть FLAMEXBOT",web_app:{url:APP_URL}}]]});
    } else if (update.callback_query) await handleBusinessActionCallback(update.callback_query);
    if (update.message?.successful_payment) await handleSuccessfulPayment(update.message);
    if (update.message?.chat?.type === "private" && update.message.from?.id && /^\/premium(?:@\w+)?(?:\s|$)/i.test((update.message.text ?? "").trim())) {
      await sendPremiumInvoice(update.message.chat.id, update.message.from.id);
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
        /^[./](mute|unmute|spam|afk|unafk|antimute|antimut|unantimute|unantimut|autoread|unautoread|autotyping|unautotyping|autovoice|unautovoice|mutestick|unmutestick|antimat|unantimat|timeprofile|bold|dumb|link|time|untime|streak)(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        "Эта команда выполняется не в чате с ботом, а прямо в нужной личной переписке Telegram Business.\n\nОткрой диалог с человеком и отправь команду там. Для проверки бота используй /ping, для статуса подключения — /status.",
        "HTML",
      );
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^\/(help|commands)(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        `<b>FLAMEXBOT · помощь</b>

Привет! Я управляю возможностями FLAMEXBOT и Telegram Business.

<b>Важно:</b> команды .mute, .unmute, .antimute и остальные команды управления нужно отправлять <b>прямо в переписке с нужным человеком</b>, а не сюда в личные сообщения боту.

Открой FLAMEXBOT, подключи Telegram Business и выдай необходимые разрешения. Затем отправь <code>.help</code> или <code>/help</code> в нужном диалоге.

Команды без адреса собеседника и без @username — бот определит текущий чат автоматически. Статус подключения можно проверить командой /status.`,
        "HTML",
        { inline_keyboard: [[{ text: "✦ Открыть FLAMEXBOT", web_app: { url: APP_URL } }]] },
      );
    }

    if (update.business_connection) await saveBusinessConnection(update.business_connection);
    if (update.business_message?.chat?.type === "private") {
      await ensureBusinessConnection(update.business_message.business_connection_id);
      const { data: ownerConnection, error: ownerConnectionError } = await admin.from("flamexbot_business_connections")
        .select("profile_id,telegram_user_id,connection_id,is_enabled,rights")
        .eq("connection_id", update.business_message.business_connection_id).maybeSingle();
      if (ownerConnectionError) throw ownerConnectionError;
      const ownerBan = ownerConnection?.telegram_user_id
        ? await getTelegramBan(ownerConnection.telegram_user_id)
        : null;
      if (ownerBan) {
        console.warn("Ignored Business update for banned FLAMEXBOT owner", ownerConnection.telegram_user_id);
        return new Response("OK", { status: 200 });
      }
      const isBusinessCommand = typeof update.business_message.text === "string" &&
        /^[./][a-z]/i.test(update.business_message.text.trim()) &&
        update.business_message.from?.id != null;
      if (!isBusinessCommand) await saveBusinessMessage(update.business_message, ownerConnection);
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
          const handled = await handleBusinessChatCommand(update.business_message, update.business_message.business_connection_id, ownerConnection);
          console.log("business command processed", JSON.stringify({ command: commandToken, handled: Boolean(handled) }));
          if (ownerConnection.rights?.can_delete_sent_messages) {
            try {
              await telegram("deleteBusinessMessages", {
                business_connection_id: update.business_message.business_connection_id,
                message_ids: [update.business_message.message_id],
              });
            } catch (deleteError) {
              console.warn("Could not remove Business command message:", deleteError?.message ?? deleteError);
            }
          }
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
      await enableBusinessUpdates();
      await telegram("setChatMenuButton", {
        chat_id: chatId,
        menu_button: { type: "web_app", text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } },
      });
      await sendRichTelegramMessage(
        chatId,
        `${tgEmoji("sparkles")} <b>Добро пожаловать в FLAMEXBOT!</b>

${tgEmoji("users")} Общайся с друзьями, поддерживай ваши огоньки и возвращайся к важным диалогам каждый день.

${tgEmoji("settings")} Подключение Telegram Business и управление разрешениями доступны в профиле приложения.`,
        "HTML",
        { inline_keyboard: [
          [{ text: "✦ Открыть FLAMEXBOT", web_app: { url: APP_URL } }],
          [{ text: "📖 Инструкция к подключению", callback_data: "fx:connect_guide" }]
        ] },
      );
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("flamexbot-bot webhook processing error:", error?.message ?? error);
    throw error;
  } finally {
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
  if (!WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const updateId = Number(update.update_id);
  const hasUpdateId = Number.isSafeInteger(updateId) && updateId >= 0;
  let claimed = false;
  if (hasUpdateId && admin) {
    const { data: claimResult, error: claimError } = await admin.rpc("claim_flamexbot_telegram_update", {
      p_update_id: updateId,
    });
    if (claimError) {
      console.error("Telegram update claim failed:", claimError.message);
      return new Response("Webhook temporarily unavailable", { status: 500 });
    }
    claimed = claimResult === true;
    if (!claimed) return new Response("OK", { status: 200 });
  }

  try {
    // Telegram requires an answer to pre-checkout within 10 seconds.
    if (update.pre_checkout_query) await handlePreCheckout(update.pre_checkout_query);
    await processTelegramUpdate(update);
    if (claimed && admin) {
      const { error: completeError } = await admin.rpc("complete_flamexbot_telegram_update", {
        p_update_id: updateId,
      });
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
