import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { explainTelegramSendError, hasBusinessRight, afkEnabledForCommand } from "./logic.js";

const FOUNDER_TELEGRAM_ID = "7781170049";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function mimeTypeFromName(fileName: string) {
 const extension=(fileName.split(".").pop()||"").toLowerCase();
 const types: Record<string,string>={
  jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",
  mp4:"video/mp4",mp3:"audio/mpeg",m4a:"audio/mp4",ogg:"audio/ogg",opus:"audio/ogg",wav:"audio/wav",
  pdf:"application/pdf",txt:"text/plain",csv:"text/csv",zip:"application/zip",
  doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt:"application/vnd.ms-powerpoint",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rtf:"application/rtf"
 };
 return types[extension] || "application/octet-stream";
}
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20000,
  service = "Внешний сервис",
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || (error as any)?.name === "AbortError") {
      throw new Error(`${service} не ответил за ${Math.round(timeoutMs / 1000)} сек. Повтори действие.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const supabaseTimedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetchWithTimeout(input, init, 25000, "Supabase");

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return reply({ error: "Требуется авторизация FLAMEXBOT." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey || !botToken) return reply({ error: "Сервис Business-чата не настроен." }, 503);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: supabaseTimedFetch },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return reply({ error: "Сессия недействительна." }, 401);
    const profileId = authData.user.id;

    const body = await req.json();
    const action = typeof body?.action === "string" ? body.action : "send";
    const chatId = typeof body?.chat_id === "string" ? body.chat_id : "";
    const text = typeof body?.text === "string" ? body.text.replace(/\\n/g, "\n").replace(/(^|\s)\/n(?=\s|$)/g, "$1\n").trim() : "";
    const storagePath = typeof body?.storage_path === "string" ? body.storage_path : "";
    const mediaType = typeof body?.media_type === "string" ? body.media_type : "";
    const replyTo = Number.isSafeInteger(Number(body?.reply_to_message_id)) && Number(body?.reply_to_message_id) > 0
      ? Number(body.reply_to_message_id) : null;
    const hasMedia = Boolean(storagePath);
    const antimutMode = body?.antimut_mode === true;
    const settingAction = action === "set_mute" || action === "set_antimute" || action === "set_preference";
    const commandMatch = text.trim().match(/^[./]([a-z][a-z0-9_]*)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
    const commandName = String(body?.command_name || commandMatch?.[1] || (action === "set_mute" ? (body.enabled ? "mute" : "unmute") : action === "set_antimute" ? "antimute" : "")).toLowerCase();
    const commandArgs = String(commandMatch?.[2] || "").trim().toLowerCase();
    const commandMode = body?.command_mode === true || settingAction || Boolean(commandMatch);
    let outgoingText = text;
    let outgoingParseMode = "";
    if (!["send","refresh_avatar","set_mute","set_antimute","set_preference","set_business_time","list_chats","list_messages"].includes(action)) return reply({ error: "Неизвестное действие Business-чата." }, 400);
    if (antimutMode && action !== "send") return reply({ error: "Антимут применяется только к отправке сообщения." }, 400);
    if (settingAction && typeof body?.enabled !== "boolean") return reply({ error: "Для настройки укажи enabled: true или false." }, 400);
    const preferenceKeys: Record<string,string> = {
      autoread: "autoread_enabled", autotyping: "autotyping_enabled", autovoice: "autovoice_enabled",
      mutestick: "mutestick_enabled", antimat: "antimat_enabled",
    };
    const preferenceKey = action === "set_preference" ? preferenceKeys[String(body?.preference ?? "")] : null;
    if (action === "set_preference" && !preferenceKey) return reply({ error: "Неизвестная настройка." }, 400);
    if (!["refresh_avatar","set_business_time","list_chats","list_messages"].includes(action) && !settingAction && (!chatId || (!text && !hasMedia) || text.length > 4096)) return reply({ error: "Укажи чат и текст или вложение." }, 400);
    if (settingAction && !chatId) return reply({ error: "Не указан диалог." }, 400);
    if (["refresh_avatar","list_messages"].includes(action) && !chatId) return reply({ error: "Не указан диалог." }, 400);
    if (hasMedia && !["photo", "video", "audio", "voice", "animation", "document"].includes(mediaType)) {
      return reply({ error: "Неподдерживаемый тип вложения." }, 400);
    }
    if (hasMedia && !storagePath.startsWith(`${profileId}/${chatId}/`)) {
      return reply({ error: "Неверный путь вложения." }, 403);
    }
    if (hasMedia && text.length > 1024) return reply({ error: "Подпись к файлу должна быть не длиннее 1024 символов." }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      global: { fetch: supabaseTimedFetch },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: moderation, error: moderationError } = await admin.from("profiles")
      .select("is_banned,ban_reason,telegram_id").eq("id", profileId).maybeSingle();
    if (moderationError) throw moderationError;
    if (moderation?.is_banned) {
      return reply({ error: moderation.ban_reason || "Этот аккаунт заблокирован администрацией FLAMEXBOT." }, 403);
    }

    if (action === "list_chats") {
      const { data: chats, error: chatsError } = await admin.from("flamexbot_business_chats")
        .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name,photo_url,last_message_at,business_connection_id")
        .eq("profile_id", profileId).order("last_message_at", { ascending: false }).limit(100);
      if (chatsError) throw chatsError;
      const ids = (chats ?? []).map((item: any) => item.id);
      if (!ids.length) return reply({ chats: [] });
      const [{ data: prefs, error: prefsError }, { data: messages, error: messagesError }, { data: connection, error: connectionError }] = await Promise.all([
        admin.from("flamexbot_business_chat_settings")
          .select("business_chat_id,is_favorite,is_pinned,is_muted,antimut_enabled,last_read_at").in("business_chat_id", ids),
        admin.from("flamexbot_business_messages")
          .select("business_chat_id,direction,created_at").in("business_chat_id", ids).eq("direction", "inbound")
          .order("created_at", { ascending: false }).limit(5000),
        admin.from("flamexbot_business_connections").select("is_enabled,rights").eq("profile_id", profileId).maybeSingle(),
      ]);
      if (prefsError) throw prefsError;
      if (messagesError) throw messagesError;
      if (connectionError) throw connectionError;
      const prefMap = new Map((prefs ?? []).map((item: any) => [item.business_chat_id, item]));
      const unread = new Map<string, number>();
      for (const message of messages ?? []) {
        const pref: any = prefMap.get(message.business_chat_id);
        if (!pref?.last_read_at || new Date(message.created_at).getTime() > new Date(pref.last_read_at).getTime()) {
          unread.set(message.business_chat_id, (unread.get(message.business_chat_id) ?? 0) + 1);
        }
      }
      return reply({ connection: connection ?? null, chats: (chats ?? []).map((item: any) => ({
        ...item, ...(prefMap.get(item.id) ?? {}), unread_count: unread.get(item.id) ?? 0,
      })) });
    }
    if (action === "list_messages") {
      const { data: ownedChat, error: ownedChatError } = await admin.from("flamexbot_business_chats")
        .select("id").eq("id", chatId).eq("profile_id", profileId).maybeSingle();
      if (ownedChatError) throw ownedChatError;
      if (!ownedChat) return reply({ error: "Чат не найден или у тебя нет доступа." }, 404);
      const { data: messages, error: messagesError } = await admin.from("flamexbot_business_messages")
        .select("id,telegram_message_id,direction,content,message_type,media_file_id,media_url,reply_to_message_id,created_at,deleted_at,raw")
        .eq("business_chat_id", chatId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
      if (messagesError) throw messagesError;
      return reply({ messages: (messages ?? []).reverse(), has_more: (messages ?? []).length === 100 });
    }

    const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats")
      .select("id,telegram_chat_id,telegram_user_id,business_connection_id")
      .eq("id", chatId).eq("profile_id", profileId).maybeSingle();
    if (chatError) throw chatError;
    if (!chat) return reply({ error: "Чат не найден или у тебя нет доступа." }, 404);


    if (action === "set_business_time") {
      if (String(moderation?.telegram_id || "") !== FOUNDER_TELEGRAM_ID) {
        const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
          .select("plan,expires_at").eq("user_id", profileId).maybeSingle();
        if (subscriptionError) throw subscriptionError;
        const premium = ["premium","founder"].includes(subscription?.plan) &&
          (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
        if (!premium) return reply({ error: "Команда .time доступна только с активным Premium." }, 403);
      }
      const { data: business, error: businessError } = await admin.from("flamexbot_business_connections")
        .select("connection_id,rights,is_enabled,original_first_name,original_last_name,time_name_enabled")
        .eq("profile_id", profileId).eq("connection_id", chat.business_connection_id).maybeSingle();
      if (businessError) throw businessError;
      if (!business?.is_enabled) return reply({ error: "Telegram Business не подключён или отключён." }, 409);
      if (business.rights?.can_edit_name !== true) {
        return reply({ error: "Выдай FLAMEXBOT право Telegram Business «Изменять имя профиля»." }, 403);
      }
      const telegramCall = async (method: string, payload: Record<string, unknown>) => {
        const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/${method}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
        }, 10000, `Telegram ${method}`);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
        return result.result;
      };
      let originalFirstName = business.original_first_name;
      let originalLastName = business.original_last_name ?? "";
      if (!originalFirstName) {
        const currentConnection = await telegramCall("getBusinessConnection", { business_connection_id: business.connection_id });
        originalFirstName = String(currentConnection?.user?.first_name || "").trim();
        originalLastName = String(currentConnection?.user?.last_name || "");
        if (!originalFirstName) return reply({ error: "Telegram не вернул исходное имя. Переподключи Telegram Business." }, 502);
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
      await telegramCall("setBusinessAccountName", {
        business_connection_id: business.connection_id,
        first_name: firstName,
        last_name: originalLastName,
      });
      const { error: saveError } = await admin.from("flamexbot_business_connections").update({
        original_first_name: originalFirstName,
        original_last_name: originalLastName,
        time_name_enabled: enabled,
        updated_at: new Date().toISOString(),
      }).eq("profile_id", profileId).eq("connection_id", business.connection_id);
      if (saveError) throw saveError;
      return reply({ success: true, enabled, message: enabled
        ? "🕒 Время добавлено в имя Telegram Business-профиля (МСК). Повтори команду, чтобы вернуть исходное имя."
        : "Исходное имя Telegram-профиля восстановлено." });
    }

    if (action === "refresh_avatar") {
      const telegramUserId = String(chat.telegram_user_id || chat.telegram_chat_id || "");
      if (!telegramUserId || !/^\d+$/.test(telegramUserId)) return reply({ error: "Не удалось определить Telegram ID собеседника." }, 400);
      const telegramCall = async (method: string, payload: Record<string, unknown>) => {
        const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/${method}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
        }, 12000, `Telegram ${method}`);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
        return result.result;
      };
      const photos = await telegramCall("getUserProfilePhotos", { user_id: Number(telegramUserId), limit: 1 });
      const sizes = photos?.photos?.[0] || [];
      if (!sizes.length) return reply({ ok: true, photo_url: chat.photo_url || null, message: "У пользователя нет доступной фотографии профиля." });
      const best = [...sizes].sort((a: any,b: any) => (b.width*b.height)-(a.width*a.height))[0];
      const file = await telegramCall("getFile", { file_id: best.file_id });
      if (!file?.file_path || (file.file_size && file.file_size > 5*1024*1024)) return reply({ ok: true, photo_url: chat.photo_url || null });
      const imageResponse = await fetchWithTimeout(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`, {}, 20000, "Telegram file download");
      if (!imageResponse.ok) throw new Error("Не удалось получить фотографию Telegram.");
      const imageBlob = await imageResponse.blob();
      if (imageBlob.size > 5*1024*1024) return reply({ ok: true, photo_url: chat.photo_url || null });
      const bucket = "flamexbot-avatars";
      const pathHint = file.file_path.toLowerCase();
      const responseMime = (imageResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const mimeType = ["image/jpeg","image/png","image/webp"].includes(responseMime)
        ? responseMime
        : pathHint.endsWith(".png") ? "image/png" : pathHint.endsWith(".webp") ? "image/webp" : "image/jpeg";
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const normalizedImage = imageBlob.type === mimeType ? imageBlob : new Blob([imageBlob], { type: mimeType });
      const path = `${profileId}/${chat.id}.${extension}`;
      const { error: uploadError } = await admin.storage.from(bucket).upload(path,normalizedImage,{
        contentType: mimeType,upsert:true,
      });
      if (uploadError) throw uploadError;
      const { data: publicUrl } = admin.storage.from(bucket).getPublicUrl(path);
      const photoUrl = publicUrl.publicUrl;
      const { error: updateError } = await admin.from("flamexbot_business_chats").update({
        photo_url: photoUrl,updated_at:new Date().toISOString(),
      }).eq("id",chat.id).eq("profile_id",profileId);
      if (updateError) throw updateError;
      return reply({ ok:true,photo_url:photoUrl });
    }

    const { data: connection, error: connectionError } = await admin.from("flamexbot_business_connections")
      .select("connection_id,is_enabled,rights")
      .eq("profile_id", profileId).eq("connection_id", chat.business_connection_id).maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.is_enabled) return reply({ error: "Telegram Business отключён. Подключи его заново в Telegram." }, 409);
    if (connection.rights?.can_reply === false && !settingAction && !antimutMode) return reply({ error: "У бота нет разрешения отвечать на бизнес-сообщения." }, 403);

    const ownerIsFounder = String(moderation?.telegram_id ?? "") === FOUNDER_TELEGRAM_ID;
    const targetTelegramId = String(chat.telegram_user_id || chat.telegram_chat_id || "");
    const targetIsFounder = String(chat.telegram_chat_id) === FOUNDER_TELEGRAM_ID || targetTelegramId === FOUNDER_TELEGRAM_ID;
    if (commandMode && !ownerIsFounder) {
      if (targetIsFounder) return reply({ error: "Этот диалог защищён. Команды управления здесь отключены." }, 403);
      if (targetTelegramId) {
        const { data: protection, error: protectionError } = await admin.from("profiles")
          .select("command_protection_expires_at,command_protection_disabled").eq("telegram_id", targetTelegramId).maybeSingle();
        if (protectionError) throw protectionError;
        const expiresAt = protection?.command_protection_expires_at
          ? new Date(protection.command_protection_expires_at).getTime() : 0;
        if (expiresAt > Date.now() && protection?.command_protection_disabled !== true) {
          return reply({ error: "Этот пользователь включил защиту от команд FLAMEXBOT. Использовать команды на защищённом аккаунте может только Основатель проекта." }, 403);
        }
      }
    }

    if (settingAction) {
      let enabled = body.enabled === true;
      if (action === "set_antimute" && body.toggle === true) {
        const { data: currentAnti, error: currentAntiError } = await admin.from("flamexbot_business_chat_settings")
          .select("antimut_enabled").eq("profile_id", profileId).eq("business_chat_id", chat.id).maybeSingle();
        if (currentAntiError) throw currentAntiError;
        enabled = !Boolean(currentAnti?.antimut_enabled);
      }
      const requiresPremium = enabled;
      if (requiresPremium) {
        const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
          .select("plan,expires_at").eq("user_id", profileId).maybeSingle();
        if (subscriptionError) throw subscriptionError;
        const premium = ["premium","founder"].includes(subscription?.plan) && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
        if (!premium) return reply({ error: "Включение этой функции доступно только в Premium. Отключение остаётся бесплатным." }, 403);
      }
      if (action === "set_mute" && enabled && connection.rights?.can_delete_all_messages !== true) {
        return reply({ error: "Telegram Business не выдал право «Удалять все сообщения»." }, 403);
      }      if (action === "set_antimute" && enabled && !hasBusinessRight(connection.rights, "can_delete_sent_messages")) {
        return reply({ error: "Telegram Business не выдал право «Удалять отправленные сообщения»." }, 403);
      }
      if (action === "set_preference" && enabled && ["mutestick","antimat"].includes(String(body?.preference)) &&
          connection.rights?.can_delete_all_messages !== true) {
        return reply({ error: "Для фильтрации сообщений Telegram Business должен выдать право «Удалять все сообщения»." }, 403);
      }
      if (action === "set_preference") {
        const { error: settingError } = await admin.from("flamexbot_business_chat_settings")
          .upsert({ profile_id: profileId, business_chat_id: chat.id, [preferenceKey!]: enabled, updated_at: new Date().toISOString() }, { onConflict: "profile_id,business_chat_id" });
        if (settingError) throw settingError;
        return reply({ ok: true, preference: body.preference, enabled });
      }
      const values = action === "set_mute" ? { is_muted: enabled, auto_flood_muted: false } : { antimut_enabled: enabled };
      const { error: settingError } = await admin.from("flamexbot_business_chat_settings")
        .upsert({ profile_id: profileId, business_chat_id: chat.id, ...values }, { onConflict: "profile_id,business_chat_id" });
      if (settingError) throw settingError;
      return reply({ ok: true, ...(action === "set_mute" ? { is_muted: enabled } : { antimut_enabled: enabled }) });
    }

    const commandNeedsPremium =
      ["mute","spam","afk","timeprofile","bold","dumb","link","time","copyp"].includes(commandName)
      || (["antimute","antimut","autoread","autotyping","autovoice","mutestick","antimat"].includes(commandName) && !settingAction);
    if (!settingAction && !antimutMode && commandNeedsPremium) {
      const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
        .select("plan,expires_at").eq("user_id", profileId).maybeSingle();
      if (subscriptionError) throw subscriptionError;
      const premium = ["premium","founder"].includes(subscription?.plan) && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
      if (!premium) return reply({ error: "Эта команда доступна только в Premium." }, 403);
    }

    if (commandName === "afk" || commandName === "unafk") {
      if (hasMedia) return reply({ error: "Команды AFK не принимают вложения." }, 400);
      const rawArgs = commandMatch?.[2]?.trim() ?? "";
      const { data: currentAfk, error: currentAfkError } = await admin.from("flamexbot_business_chat_settings").select("afk_enabled").eq("profile_id", profileId).eq("business_chat_id", chat.id).maybeSingle();
      if (currentAfkError) throw currentAfkError;
      const enabled = afkEnabledForCommand(commandName);
      const afkMessage = enabled ? (rawArgs || "Сейчас отошёл, отвечу позже.").slice(0, 300) : null;
      const { error: afkError } = await admin.from("flamexbot_business_chat_settings").upsert({
        profile_id: profileId,
        business_chat_id: chat.id,
        afk_enabled: enabled,
        ...(enabled ? { afk_message: afkMessage, last_afk_reply_at: null } : {}),
        updated_at: new Date().toISOString(),
      }, { onConflict: "profile_id,business_chat_id" });
      if (afkError) throw afkError;
      return reply({
        ok: true,
        command: commandName,
        afk_enabled: enabled,
        message: enabled ? "AFK включён только в этом диалоге." : "AFK выключен в этом диалоге.",
      });
    }

    if (commandMode && commandName === "advertising") {
      const { data: existingCode, error: codeError } = await admin.from("flamexbot_referral_codes")
        .select("code").eq("user_id", profileId).maybeSingle();
      if (codeError) throw codeError;
      let referralCode = existingCode?.code;
      if (!referralCode) {
        const generated = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
        const { error: insertError } = await admin.from("flamexbot_referral_codes")
          .upsert({ user_id: profileId, code: generated }, { onConflict: "user_id", ignoreDuplicates: true });
        if (insertError) throw insertError;
        const { data: created, error: createdError } = await admin.from("flamexbot_referral_codes")
          .select("code").eq("user_id", profileId).single();
        if (createdError) throw createdError;
        referralCode = created.code;
      }
      outgoingText = "Я использую FLAMEXBOT! Открой бота по моей ссылке и получи Premium на 3 дня бесплатно: https://t.me/Flamexgame?start=ref_" + referralCode;
    }

    if (antimutMode) {
      if (String(chat.telegram_chat_id) === "7781170049" || String(chat.telegram_user_id ?? "") === "7781170049") {
        return reply({ error: "Этот диалог защищён. Антимут и другие команды управления здесь отключены." }, 403);
      }
      const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions").select("plan,expires_at").eq("user_id", profileId).maybeSingle();
      if (subscriptionError) throw subscriptionError;
      const premium = ["premium","founder"].includes(subscription?.plan) && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
      if (!premium) return reply({ error: "Антимут доступен только в Premium." }, 403);
      const { data: settings, error: settingsError } = await admin.from("flamexbot_business_chat_settings").select("antimut_enabled").eq("profile_id", profileId).eq("business_chat_id", chat.id).maybeSingle();
      if (settingsError) throw settingsError;
      if (!settings?.antimut_enabled) return reply({ error: "Сначала включи антимут в настройках этого чата." }, 409);
      /* Antimut is still a Telegram Business reply: send through the connected account, never the bot private chat. */
    }

    if (commandMode && !hasMedia && ["bold","dumb","link","copyp","profile","id","chatid","date","calc","upper","lower","reverse","count","wordcount","choose","roll","qr"].includes(commandName)) {
      const rawArgs = String(commandMatch?.[2] ?? "").trim();
      const htmlEscape = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      if (commandName === "bold") {
        if (!rawArgs) return reply({error:"Формат: .bold текст"},400);
        outgoingText = "<b>"+htmlEscape(rawArgs)+"</b>"; outgoingParseMode = "HTML";
      } else if (commandName === "dumb") {
        if (!rawArgs) return reply({error:"Формат: .dumb текст"},400);
        outgoingText = rawArgs.replace(/привет/gi,"превед").replace(/что/gi,"што").replace(/ч/gi,"4");
      } else if (commandName === "link") {
        if (!rawArgs) return reply({error:"Формат: .link текст"},400);
        outgoingText = chat.username ? "https://t.me/"+chat.username+"?text="+encodeURIComponent(rawArgs) : "tg://user?id="+chat.telegram_chat_id;
      } else if (commandName === "copyp" || commandName === "profile" || commandName === "id" || commandName === "chatid") {
        const name = [chat.first_name,chat.last_name].filter(Boolean).join(" ") || "Telegram-пользователь";
        const userId = String(chat.telegram_user_id || chat.telegram_chat_id);
        const username = chat.username ? "@"+chat.username : "не указан";
        outgoingText = commandName === "chatid"
          ? "ID чата: "+String(chat.telegram_chat_id)
          : commandName === "id"
            ? "Данные собеседника\nИмя: "+name+"\nTelegram ID: "+userId+"\nЧат ID: "+String(chat.telegram_chat_id)+"\nЮзернейм: "+username
            : "FLAMEXBOT · карточка собеседника\nИмя: "+name+"\nЮзернейм: "+username+"\nTelegram ID: "+userId+"\n"+(chat.username?"https://t.me/"+chat.username:"Публичная ссылка недоступна");
      } else if (commandName === "date") {
        outgoingText = "Сейчас по Москве: "+new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",dateStyle:"full",timeStyle:"short"}).format(new Date());
      } else if (commandName === "calc") {
        const tokens = rawArgs.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) || [];
        if (!rawArgs || tokens.join("").replace(/\s/g,"") !== rawArgs.replace(/\s/g,"")) return reply({error:"Формат: .calc (12 + 8) * 2"},400);
        let pos=0;
        let expression:()=>number;
        const factor=():number=>{const t=tokens[pos++];if(t==="+")return factor();if(t==="-")return -factor();if(t==="("){const v=expression();if(tokens[pos++]!==")")throw new Error("paren");return v;}const n=Number(t);if(!Number.isFinite(n))throw new Error("number");return n;};
        const term=():number=>{let v=factor();while(["*","/","%"].includes(tokens[pos])){const op=tokens[pos++],r=factor();v=op==="*"?v*r:op==="/"?v/r:v%r;}return v;};
        expression=():number=>{let v=term();while(tokens[pos]==="+"||tokens[pos]==="-"){const op=tokens[pos++],r=term();v=op==="+"?v+r:v-r;}return v;};
        try{const value=expression();if(pos!==tokens.length||!Number.isFinite(value))throw new Error("expression");outgoingText="Результат: "+String(Number(value.toPrecision(12)));}catch{return reply({error:"Не удалось вычислить. Проверь скобки и операторы."},400);}
      } else if (["upper","lower","reverse","count","wordcount"].includes(commandName)) {
        if (!rawArgs || rawArgs.length>3000) return reply({error:"Добавь текст (до 3000 символов)."},400);
        outgoingText = commandName==="upper" ? rawArgs.toLocaleUpperCase("ru-RU")
          : commandName==="lower" ? rawArgs.toLocaleLowerCase("ru-RU")
          : commandName==="reverse" ? Array.from(rawArgs).reverse().join("")
          : commandName==="count" ? "Символов: "+rawArgs.length
          : "Слов: "+(rawArgs.match(/[^\s]+/g)||[]).length;
      } else if (commandName === "choose") {
        const choices=rawArgs.split("|").map(x=>x.trim()).filter(Boolean).slice(0,30);
        if(choices.length<2)return reply({error:"Формат: .choose вариант 1 | вариант 2"},400);
        outgoingText="Выбор FLAMEXBOT: "+choices[Math.floor(Math.random()*choices.length)];
      } else if (commandName === "roll") {
        const max=rawArgs?Number(rawArgs):6;
        if(!Number.isInteger(max)||max<2||max>100000)return reply({error:"Формат: .roll [максимум от 2 до 100000]"},400);
        outgoingText="Выпало: "+(Math.floor(Math.random()*max)+1)+" (1–"+max+")";
      } else if (commandName === "qr") {
        if(!rawArgs||rawArgs.length>512)return reply({error:"Формат: .qr ссылка или текст (до 512 символов)."},400);
        const qrUrl=new URL("https://api.qrserver.com/v1/create-qr-code/");
        qrUrl.searchParams.set("size","512x512");qrUrl.searchParams.set("data",rawArgs);
        const photoPayload=new FormData();
        photoPayload.append("business_connection_id",connection.connection_id);
        photoPayload.append("chat_id",String(chat.telegram_chat_id));
        photoPayload.append("photo",qrUrl.toString());
        photoPayload.append("caption","QR-код создан в FLAMEXBOT");
        const photoResponse=await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendPhoto`,{method:"POST",body:photoPayload},15000,"Telegram sendPhoto");
        const photoData=await photoResponse.json();
        if(!photoResponse.ok||!photoData.ok)return reply({error:explainTelegramSendError(photoData.description||"Не удалось отправить QR-код.")},502);
        return reply({ok:true,command:commandName,message_id:photoData.result?.message_id});
      }
    }

    const { data: sendLimit, error: sendLimitError } = await admin.rpc(
      "flamexbot_consume_business_send_limit",
      { p_profile_id: profileId, p_business_chat_id: chat.id },
    );
    if (sendLimitError) throw sendLimitError;
    if (sendLimit?.allowed !== true) {
      const retryAfter = Math.max(1, Number(sendLimit?.retry_after) || 1);
      return reply({
        error: `Слишком частая отправка. Подожди ${retryAfter} сек. и попробуй снова.`,
        retry_after: retryAfter,
      }, 429);
    }

    const telegramPayload = new FormData();
    telegramPayload.append("business_connection_id", connection.connection_id);
    telegramPayload.append("chat_id", String(chat.telegram_chat_id));
    if (replyTo) telegramPayload.append("reply_parameters", JSON.stringify({ message_id: replyTo }));
    let method = "sendMessage";
    if (hasMedia) {
      const { data: file, error: fileError } = await admin.storage.from("flamex-business-media").download(storagePath);
      if (fileError || !file) return reply({ error: "Не удалось прочитать загруженное вложение." }, 400);
      const fileName = storagePath.split("/").pop() || "attachment";
      const fileField = mediaType === "photo" ? "photo"
        : mediaType === "video" ? "video"
        : mediaType === "audio" ? "audio"
        : mediaType === "voice" ? "voice"
        : mediaType === "animation" ? "animation" : "document";
      method = mediaType === "photo" ? "sendPhoto"
        : mediaType === "video" ? "sendVideo"
        : mediaType === "audio" ? "sendAudio"
        : mediaType === "voice" ? "sendVoice"
        : mediaType === "animation" ? "sendAnimation" : "sendDocument";
      const inferredMime = mimeTypeFromName(fileName);
      const safeMime = file.type && file.type !== "application/octet-stream" ? file.type : inferredMime;
      const uploadFile = file.type === safeMime ? file : new Blob([file], { type: safeMime });
      telegramPayload.append(fileField, uploadFile, fileName);
      if (mediaType === "document") telegramPayload.append("disable_content_type_detection", "true");
      if (text) telegramPayload.append("caption", text);
    } else {
      method = "sendMessage";
      telegramPayload.append("text", outgoingText);
      if (outgoingParseMode) telegramPayload.append("parse_mode", outgoingParseMode);
    }
    const tgResponse = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      body: telegramPayload,
    }, 15000, `Telegram ${method}`);
    const tgData = await tgResponse.json();
    if (!tgResponse.ok || !tgData.ok) {
      console.error(`Business ${method} failed:`, tgData.description ?? "unknown error");
      return reply({ error: explainTelegramSendError(tgData.description ?? "Telegram не смог отправить сообщение.") }, tgResponse.status === 403 ? 403 : 502);
    }
    const sent = tgData.result;
    const sentMedia = sent.photo?.at(-1) ?? sent.video ?? sent.audio ?? sent.voice ?? sent.animation ?? sent.document ?? null;
    const { error: saveError } = await admin.from("flamexbot_business_messages").upsert({
      business_chat_id: chat.id,
      telegram_message_id: sent.message_id,
      direction: "outbound",
      sender_profile_id: profileId,
      content: sent.text ?? sent.caption ?? outgoingText ?? "",
      message_type: hasMedia ? mediaType : "text",
      media_file_id: sentMedia?.file_id ?? null,
      media_url: hasMedia ? storagePath : null,
      reply_to_message_id: replyTo,
      created_at: new Date((sent.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      raw: sent,
    }, { onConflict: "business_chat_id,telegram_message_id" });
    if (saveError) throw saveError;
    await admin.from("flamexbot_business_chats")
      .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", chat.id);
    return reply({ ok: true, message_id: sent.message_id, message: sent });
  } catch (error) {
    const message = String(error?.message ?? error ?? "Не удалось отправить сообщение.");
    console.error("business-chat-send:", message);
    if (/mime type .*not supported/i.test(message)) {
      return reply({ error: "Telegram не распознал тип файла. Попробуй отправить его как обычный документ." }, 400);
    }
    return reply({ error: message }, 500);
  }
});