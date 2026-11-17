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

    if (action === "list") {
      const { data, error } = await admin.from("flamexbot_support_chats")
        .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name,last_message_preview,last_message_at,unread_count")
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) throw error;
      return response({ chats: data ?? [] });
    }

    const chatId = String(body?.chat_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(chatId)) return response({ error: "Invalid chat_id" }, 400);
    const { data: chat, error: chatError } = await admin.from("flamexbot_support_chats")
      .select("id,telegram_chat_id,telegram_user_id,username,first_name,last_name")
      .eq("id", chatId).maybeSingle();
    if (chatError) throw chatError;
    if (!chat) return response({ error: "Chat not found" }, 404);

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
