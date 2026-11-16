import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function explainTelegramSendError(description: unknown) {
 const raw=String(description??"ошибка Telegram API"), lower=raw.toLowerCase();
 if(/blocked by the user|bot was blocked|user is deactivated|chat not found|peer_id_invalid/.test(lower))return "Telegram отклонил отправку: чат недоступен или получатель ограничил сообщения. FLAMEXBOT не может обходить блокировки.";
 if(/bot can\x27t initiate conversation|bot cannot initiate|bot can\x27t send messages to bots/.test(lower))return "Чтобы отправить сообщение через FLAMEXBOT, собеседник должен сначала открыть бота и нажать Start. Антимут не обходит блокировки Telegram.";
 if(/business_connection_invalid|business connection.*(invalid|not found|disabled)/.test(lower))return "Telegram Business-подключение недействительно или отключено.";
 if(/not enough rights|can't write|can_reply|chat_write_forbidden|have no rights/.test(lower))return "Telegram не разрешил отправку: у Business-подключения нет нужного права или чат недоступен для ответа.";
 if(/too many requests|retry after/.test(lower))return "Telegram временно ограничил отправку. Подожди и попробуй позже вручную.";
 return `Telegram отклонил отправку: ${raw.slice(0,220)}`;
}
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
    const text = typeof body?.text === "string" ? body.text.trim() : "";
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
    if (!["send","refresh_avatar","set_mute","set_antimute","set_preference"].includes(action)) return reply({ error: "Неизвестное действие Business-чата." }, 400);
    if (antimutMode && action !== "send") return reply({ error: "Антимут применяется только к отправке сообщения." }, 400);
    if (settingAction && typeof body?.enabled !== "boolean") return reply({ error: "Для настройки укажи enabled: true или false." }, 400);
    const preferenceKeys: Record<string,string> = {
      autoread: "autoread_enabled", autotyping: "autotyping_enabled", autovoice: "autovoice_enabled",
      mutestick: "mutestick_enabled", antimat: "antimat_enabled",
    };
    const preferenceKey = action === "set_preference" ? preferenceKeys[String(body?.preference ?? "")] : null;
    if (action === "set_preference" && !preferenceKey) return reply({ error: "Неизвестная настройка." }, 400);
    if (action !== "refresh_avatar" && !settingAction && (!chatId || (!text && !hasMedia) || text.length > 4096)) return reply({ error: "Укажи чат и текст или вложение." }, 400);
    if (settingAction && !chatId) return reply({ error: "Не указан диалог." }, 400);
    if (action === "refresh_avatar" && !chatId) return reply({ error: "Не указан диалог." }, 400);
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
    const { data: chat, error: chatError } = await admin.from("flamexbot_business_chats")
      .select("id,telegram_chat_id,telegram_user_id,business_connection_id")
      .eq("id", chatId).eq("profile_id", profileId).maybeSingle();
    if (chatError) throw chatError;
    if (!chat) return reply({ error: "Чат не найден или у тебя нет доступа." }, 404);


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
          .select("command_protection_expires_at").eq("telegram_id", targetTelegramId).maybeSingle();
        if (protectionError) throw protectionError;
        const expiresAt = protection?.command_protection_expires_at
          ? new Date(protection.command_protection_expires_at).getTime() : 0;
        if (expiresAt > Date.now()) {
          return reply({ error: "Этот пользователь включил защиту от команд FLAMEXBOT. Использовать команды на защищённом аккаунте может только Основатель проекта." }, 403);
        }
      }
    }

    if (settingAction) {
      const enabled = body.enabled === true;
      const requiresPremium = enabled;
      if (requiresPremium) {
        const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions")
          .select("plan,expires_at").eq("user_id", profileId).maybeSingle();
        if (subscriptionError) throw subscriptionError;
        const premium = ["premium","pro","founder"].includes(subscription?.plan) && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
        if (!premium) return reply({ error: "Включение этой функции доступно только в Premium. Отключение остаётся бесплатным." }, 403);
      }
      if (action === "set_mute" && enabled && connection.rights?.can_delete_all_messages !== true) {
        return reply({ error: "Telegram Business не выдал право «Удалять все сообщения»." }, 403);
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
      const values = action === "set_mute" ? { is_muted: enabled } : { antimut_enabled: enabled };
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
      const premium = ["premium","pro","founder"].includes(subscription?.plan) && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
      if (!premium) return reply({ error: "Эта команда доступна только в Premium." }, 403);
    }

    if (commandName === "afk" || commandName === "unafk") {
      if (hasMedia) return reply({ error: "Команды AFK не принимают вложения." }, 400);
      const rawArgs = commandMatch?.[2]?.trim() ?? "";
      const enabled = commandName === "afk";
      const afkMessage = enabled
        ? (rawArgs || "Сейчас отошёл, отвечу позже.").slice(0, 300)
        : null;
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

    if (antimutMode) {
      if (String(chat.telegram_chat_id) === "7781170049" || String(chat.telegram_user_id ?? "") === "7781170049") {
        return reply({ error: "Этот диалог защищён. Антимут и другие команды управления здесь отключены." }, 403);
      }
      const { data: subscription, error: subscriptionError } = await admin.from("user_subscriptions").select("plan,expires_at").eq("user_id", profileId).maybeSingle();
      if (subscriptionError) throw subscriptionError;
      const premium = ["premium","pro","founder"].includes(subscription?.plan) && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now());
      if (!premium) return reply({ error: "Антимут доступен только в Premium." }, 403);
      const { data: settings, error: settingsError } = await admin.from("flamexbot_business_chat_settings").select("antimut_enabled").eq("profile_id", profileId).eq("business_chat_id", chat.id).maybeSingle();
      if (settingsError) throw settingsError;
      if (!settings?.antimut_enabled) return reply({ error: "Сначала включи антимут в настройках этого чата." }, 409);
      /* Antimut sends from the bot account itself; Telegram still enforces blocks and bot-start requirements. */
    }

    const telegramPayload = new FormData();
    if (!antimutMode) telegramPayload.append("business_connection_id", connection.connection_id);
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
      telegramPayload.append("text", text);
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
      content: sent.text ?? sent.caption ?? text ?? "",
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