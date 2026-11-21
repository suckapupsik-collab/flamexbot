import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY || !BOT_TOKEN) {
    return response({ error: "Unauthorized or service unavailable" }, 401);
  }
  try {
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Unauthorized" }, 401);
    const { data: allowed, error: accessError } = await caller.rpc("is_flamexbot_admin");
    if (accessError || allowed !== true) return response({ error: "Forbidden" }, 403);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "list");

    if (action === "inbox_start") {
      const targetUserId = String(body?.target_user_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return response({ error: "Invalid target_user_id" }, 400);
      const { data: target, error: targetError } = await admin.from("profiles")
        .select("id,telegram_id,telegram_username,username,display_name")
        .eq("id", targetUserId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return response({ error: "Пользователь не найден." }, 404);
      if (!target.telegram_id || !/^\d+$/.test(String(target.telegram_id))) {
        return response({ error: "У пользователя не привязан Telegram." }, 409);
      }
      const now = new Date().toISOString();
      const { data: chat, error: chatError } = await admin.from("flamexbot_bot_inbox_chats").upsert({
        telegram_chat_id: String(target.telegram_id), telegram_user_id: String(target.telegram_id),
        username: target.telegram_username || target.username || null,
        first_name: target.display_name || target.username || "Пользователь",
        last_message_preview: "Диалог открыт администрацией", last_message_at: now, updated_at: now,
      }, { onConflict: "telegram_chat_id" })
        .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name,last_message_preview,last_message_at,unread_count").single();
      if (chatError) throw chatError;
      return response({ ok: true, chat });
    }
    if (action === "inbox_list") {
      const { data, error } = await admin.from("flamexbot_bot_inbox_chats")
        .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name,last_message_preview,last_message_at,unread_count")
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) throw error;
      return response({ chats: data ?? [] });
    }
    if (action === "inbox_messages" || action === "inbox_send") {
      const inboxChatId = String(body?.chat_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(inboxChatId)) return response({ error: "Invalid chat_id" }, 400);
      const { data: inboxChat, error: inboxChatError } = await admin.from("flamexbot_bot_inbox_chats")
        .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name")
        .eq("id", inboxChatId).maybeSingle();
      if (inboxChatError) throw inboxChatError;
      if (!inboxChat) return response({ error: "Chat not found" }, 404);
      if (action === "inbox_messages") {
        const { data, error } = await admin.from("flamexbot_bot_inbox_messages")
          .select("id,telegram_message_id,direction,content,message_type,created_at")
          .eq("inbox_chat_id", inboxChatId).order("created_at", { ascending: true }).limit(300);
        if (error) throw error;
        const { error: readError } = await admin.from("flamexbot_bot_inbox_chats").update({ unread_count: 0 }).eq("id", inboxChatId);
        if (readError) throw readError;
        return response({ chat: inboxChat, messages: data ?? [] });
      }
      const content = String(body?.content ?? "").trim();
      if (!content || content.length > 4096) return response({ error: "Сообщение должно содержать от 1 до 4096 символов." }, 400);
      const telegramResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: Number(inboxChat.telegram_chat_id), text: content, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(12000),
      });
      const telegramData = await telegramResponse.json();
      if (!telegramResponse.ok || !telegramData.ok) return response({ error: telegramData.description ?? "Telegram не принял сообщение." }, 502);
      const sent = telegramData.result;
      const createdAt = new Date((sent.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
      const { error: saveError } = await admin.from("flamexbot_bot_inbox_messages").upsert({
        inbox_chat_id: inboxChatId, telegram_message_id: sent.message_id, direction: "outgoing",
        content, message_type: "text", created_at: createdAt,
      }, { onConflict: "inbox_chat_id,telegram_message_id" });
      if (saveError) throw saveError;
      const { error: updateError } = await admin.from("flamexbot_bot_inbox_chats").update({
        last_message_preview: content.slice(0, 240), last_message_at: createdAt, updated_at: new Date().toISOString(),
      }).eq("id", inboxChatId);
      if (updateError) throw updateError;
      return response({ ok: true, message: { telegram_message_id: sent.message_id, direction: "outgoing", content, message_type: "text", created_at: createdAt } });
    }

    if (action === "list") {
      const { data, error } = await admin.from("flamexbot_support_chats")
        .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name,last_message_preview,last_message_at,unread_count,status")
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) throw error;
      return response({ chats: data ?? [] });
    }

    const chatId = String(body?.chat_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(chatId)) return response({ error: "Invalid chat_id" }, 400);
    const { data: chat, error: chatError } = await admin.from("flamexbot_support_chats")
      .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name,status")
      .eq("id", chatId).maybeSingle();
    if (chatError) throw chatError;
    if (!chat) return response({ error: "Chat not found" }, 404);

    if (action === "close") {
      const closedAt = new Date().toISOString();
      const { error } = await admin.from("flamexbot_support_chats").update({ status: "closed", closed_at: closedAt }).eq("id", chatId);
      if (error) throw error;
      try {
        const telegramResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: Number(chat.telegram_chat_id), text: "✅ Твоё обращение в техподдержку FLAMEXBOT закрыто. Если появится новая проблема, отправь /support." }),
          signal: AbortSignal.timeout(12000),
        });
        const telegramData = await telegramResponse.json();
        if (telegramResponse.ok && telegramData.ok) {
          const sent = telegramData.result;
          await admin.from("flamexbot_support_messages").upsert({
            support_chat_id: chatId, telegram_message_id: sent.message_id, direction: "outgoing",
            content: "Твоё обращение в техподдержку FLAMEXBOT закрыто. Если появится новая проблема, отправь /support.",
            message_type: "text", created_at: new Date((sent.date ?? Math.floor(Date.now()/1000))*1000).toISOString(),
          }, { onConflict: "support_chat_id,telegram_message_id" });
        }
      } catch (notifyError) {
        console.warn("Support close notification could not be sent:", notifyError);
      }
      return response({ ok: true });
    }

    if (action === "messages") {
      const { data, error } = await admin.from("flamexbot_support_messages")
        .select("id,telegram_message_id,direction,content,message_type,created_at")
        .eq("support_chat_id", chatId).order("created_at", { ascending: true }).limit(300);
      if (error) throw error;
      const { error: readError } = await admin.from("flamexbot_support_chats")
        .update({ unread_count: 0 }).eq("id", chatId);
      if (readError) throw readError;
      return response({ chat, messages: data ?? [] });
    }

    if (action === "media") {
      const messageId = Number(body?.message_id);
      if (!Number.isSafeInteger(messageId) || messageId <= 0) return response({ error: "Invalid message_id" }, 400);
      const { data: stored, error: storedError } = await admin.from("flamexbot_support_messages")
        .select("content,message_type").eq("support_chat_id", chatId).eq("telegram_message_id", messageId).maybeSingle();
      if (storedError) throw storedError;
      if (!stored) return response({ error: "Файл не найден." }, 404);
      let media: any = null;
      try { media = JSON.parse(stored.content); } catch { media = null; }
      if (!media || media._fx_media !== 1 || !media.file_id) return response({ error: "У сообщения нет вложения." }, 404);
      const infoResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/getFile", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id: media.file_id }), signal: AbortSignal.timeout(12000),
      });
      const info = await infoResponse.json();
      if (!infoResponse.ok || !info.ok || !info.result?.file_path) return response({ error: "Telegram не смог получить файл." }, 502);
      if (Number(info.result.file_size || 0) > 20 * 1024 * 1024) return response({ error: "Файл превышает лимит 20 МБ." }, 413);
      const fileResponse = await fetch("https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + info.result.file_path, { signal: AbortSignal.timeout(20000) });
      if (!fileResponse.ok) return response({ error: "Не удалось загрузить файл из Telegram." }, 502);
      const headers = new Headers(corsHeaders);
      headers.set("Content-Type", fileResponse.headers.get("Content-Type") || media.mime_type || "application/octet-stream");
      headers.set("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(media.file_name || ("telegram-" + messageId)));
      headers.set("Cache-Control", "private, max-age=60");
      return new Response(fileResponse.body, { status: 200, headers });
    }

    if (action === "send_media") {
      const fileName = String(body?.file_name ?? "attachment").slice(0, 180);
      const mimeType = String(body?.mime_type ?? "application/octet-stream").slice(0, 120);
      const base64 = String(body?.file_base64 ?? "");
      const caption = String(body?.caption ?? "").trim().slice(0, 1024);
      if (!base64 || base64.length > 28 * 1024 * 1024) return response({ error: "Файл пустой или превышает лимит 20 МБ." }, 413);
      const binary = atob(base64);
      if (binary.length > 20 * 1024 * 1024) return response({ error: "Максимальный размер файла — 20 МБ." }, 413);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const extension = fileName.split(".").pop()?.toLowerCase() || "";
      const method = mimeType.startsWith("image/") && !["gif"].includes(extension) ? "sendPhoto"
        : mimeType.startsWith("video/") ? "sendVideo"
        : mimeType.startsWith("audio/") ? "sendAudio"
        : extension === "gif" ? "sendAnimation" : "sendDocument";
      const field = method === "sendPhoto" ? "photo" : method === "sendVideo" ? "video"
        : method === "sendAudio" ? "audio" : method === "sendAnimation" ? "animation" : "document";
      const form = new FormData();
      form.set("chat_id", chat.telegram_chat_id);
      form.set(field, new Blob([bytes], { type: mimeType }), fileName);
      if (caption) form.set("caption", caption);
      const telegramResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/" + method, {
        method: "POST", body: form, signal: AbortSignal.timeout(30000),
      });
      const telegramData = await telegramResponse.json();
      if (!telegramResponse.ok || !telegramData.ok) return response({ error: telegramData.description ?? "Telegram не принял вложение." }, 502);
      const sent = telegramData.result;
      const sentMedia = sent.photo?.[sent.photo.length - 1] ?? sent.video ?? sent.audio ?? sent.animation ?? sent.document;
      const fileId = sentMedia?.file_id;
      if (!fileId) throw new Error("Telegram did not return a media file_id");
      const sentAt = new Date((sent.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
      const storedContent = JSON.stringify({ _fx_media: 1, caption, file_id: fileId, file_name: fileName, mime_type: mimeType });
      const { error: saveError } = await admin.from("flamexbot_support_messages").upsert({
        support_chat_id: chatId, telegram_message_id: sent.message_id, direction: "outgoing",
        content: storedContent, message_type: method === "sendPhoto" ? "photo" : method === "sendVideo" ? "video" : method === "sendAudio" ? "audio" : method === "sendAnimation" ? "animation" : "document",
        sender_profile_id: authData.user.id, created_at: sentAt,
      }, { onConflict: "support_chat_id,telegram_message_id" });
      if (saveError) throw saveError;
      await admin.from("flamexbot_support_chats").update({
        last_message_preview: (caption || "📎 " + fileName).slice(0, 240),
        last_message_at: sentAt, updated_at: new Date().toISOString(),
      }).eq("id", chatId);
      return response({ ok: true, message_id: sent.message_id });
    }

    if (action === "send") {
      const content = String(body?.content ?? "").trim();
      if (!content || content.length > 4096) return response({ error: "Сообщение должно содержать от 1 до 4096 символов." }, 400);
      const telegramResponse = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: Number(chat.telegram_chat_id), text: content, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(12000),
      });
      const telegramData = await telegramResponse.json();
      if (!telegramResponse.ok || !telegramData.ok) {
        return response({ error: telegramData.description ?? "Telegram не принял сообщение." }, 502);
      }
      const sent = telegramData.result;
      const createdAt = new Date((sent.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
      const { error: saveError } = await admin.from("flamexbot_support_messages").upsert({
        support_chat_id: chatId,
        telegram_message_id: sent.message_id,
        direction: "outgoing",
        content,
        message_type: "text",
        sender_profile_id: authData.user.id,
        created_at: createdAt,
      }, { onConflict: "support_chat_id,telegram_message_id" });
      if (saveError) throw saveError;
      const { error: updateError } = await admin.from("flamexbot_support_chats").update({
        last_message_preview: content.slice(0, 240),
        last_message_at: createdAt,
        updated_at: new Date().toISOString(),
      }).eq("id", chatId);
      if (updateError) throw updateError;
      return response({ ok: true, message: { telegram_message_id: sent.message_id, direction: "outgoing", content, message_type: "text", created_at: createdAt } });
    }
    return response({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("support inbox error:", error?.message ?? error);
    return response({ error: "Не удалось обработать запрос входящих сообщений." }, 500);
  }
});
