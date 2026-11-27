import test from "node:test";
import assert from "node:assert/strict";
import { explainTelegramSendError, hasBusinessRight, afkEnabledForCommand } from "../supabase/functions/business-chat-send/logic.js";

test("maps Telegram user-not-found to an actionable Business chat error", () => {
  assert.match(explainTelegramSendError("Bad Request: user not found"), /не нашёл пользователя/);
});
test("keeps blocked and rate-limit errors distinct", () => {
  assert.match(explainTelegramSendError("Forbidden: bot was blocked by the user"), /не может обходить блокировки/);
  assert.match(explainTelegramSendError("Too Many Requests: retry after 5"), /временно ограничил отправку/);
});
test("checks the exact Telegram Business permission", () => {
  assert.equal(hasBusinessRight({ can_delete_sent_messages: true }, "can_delete_sent_messages"), true);
  assert.equal(hasBusinessRight({ can_delete_all_messages: true }, "can_delete_sent_messages"), false);
  assert.equal(hasBusinessRight(null, "can_delete_sent_messages"), false);
});
test("AFK and unAFK commands set explicit states", () => {
  assert.equal(afkEnabledForCommand("afk"), true);
  assert.equal(afkEnabledForCommand("unafk"), false);
  assert.equal(afkEnabledForCommand("profile"), null);
});

test("maps bot initiation restrictions to a clear next step", () => {
  assert.match(explainTelegramSendError("Forbidden: bot can't initiate conversation with a user"), /нажать Start/);
});

import { readFile } from "node:fs/promises";
const miniAppSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("Mini App exposes the backend unAFK command", () => {
  assert.match(miniAppSource, /\.unafk/);
  assert.match(miniAppSource, /'afk','unafk'/);
  assert.match(miniAppSource, /name==='unafk'/);
});

const botWebhookSource = await readFile(new URL("../supabase/functions/flamexbot-bot/index.ts", import.meta.url), "utf8");

test("Business commands are dispatched early and the owner's command message is removed after it runs", () => {
  const captureAt = botWebhookSource.indexOf("business command captured at webhook ingress");
  const normalProcessingAt = botWebhookSource.indexOf("const directTelegramUserId");
  assert.ok(captureAt >= 0, "early Business command capture must exist");
  assert.ok(normalProcessingAt >= 0, "normal webhook processing marker must exist");
  assert.ok(captureAt < normalProcessingAt, "commands must be handled before unrelated webhook work");
  assert.match(botWebhookSource, /earlyBusinessMessage\.message_id/);
  assert.match(botWebhookSource, /can_delete_sent_messages === true/);
  assert.match(botWebhookSource, /message_ids: \[earlyBusinessMessage\.message_id\]/);
  assert.match(botWebhookSource, /const ALLOW_BUSINESS_MESSAGE_DELETION = true/);
  assert.match(botWebhookSource, /const ALLOW_PANIC_DELETION = false/);
});

test("ordinary Business messages are archived before slower webhook processing", () => {
  const archiveAt = botWebhookSource.indexOf("Business message archived at webhook ingress");
  const normalProcessingAt = botWebhookSource.indexOf("const directTelegramUserId");
  assert.ok(archiveAt >= 0, "early Business message archive must exist");
  assert.ok(archiveAt < normalProcessingAt, "message must be archived before unrelated webhook work");
  assert.match(botWebhookSource, /saveBusinessMessage\(earlyArchiveMessage, archiveConnection, true\)/);
  assert.match(botWebhookSource, /if \(captureOnly\) return chat\.id;/);
});

test("Antimut restores owner messages only after Telegram reports deletion", () => {
  const handlerAt = botWebhookSource.indexOf("async function deleteBusinessMessages");
  const restoreAt = botWebhookSource.indexOf("await sendAntimutRestore({", handlerAt);
  const oldImmediateAt = botWebhookSource.indexOf("Antimut resend started");
  assert.ok(handlerAt >= 0, "Business deletion handler must exist");
  assert.ok(restoreAt > handlerAt, "restore must run from the deletion handler");
  assert.equal(oldImmediateAt, -1, "messages must not be resent immediately on send");
  assert.match(botWebhookSource, /item\.direction\s*!==\s*"outbound"\s*\|\|\s*item\.deleted_at/);
  assert.match(botWebhookSource, /prefs\?\.antimut_enabled\s*===\s*true/);
  assert.match(botWebhookSource, /Antimut ignored deletion of its own restored message/);
  assert.match(botWebhookSource, /_flamexbot_antimut_resent\s*===\s*true/);
});

const telegramAuthSource = await readFile(new URL("../supabase/functions/telegram-auth/index.ts", import.meta.url), "utf8");
test("Telegram registration is blocked until required channel subscription is confirmed", () => {
  const verifyAt = telegramAuthSource.indexOf("const user = await verifyTelegramInitData");
  const subscriptionAt = telegramAuthSource.indexOf("checkRequiredChannel(botToken, String(user.id))");
  const createAt = telegramAuthSource.indexOf("admin.auth.admin.createUser");
  assert.ok(subscriptionAt > verifyAt, "subscription must be checked after Telegram initData verification");
  assert.ok(createAt > subscriptionAt, "profile creation must happen after subscription check");
  assert.match(telegramAuthSource, /reason: "subscription_required"/);
});
test("Bot commands require the channel and Mini App registration", () => {
  assert.match(botWebhookSource, /isRequiredChannelMember\(accessTelegramUserId\)/);
  assert.match(botWebhookSource, /hasRegisteredMiniAppProfile\(accessTelegramUserId\)/);
  assert.match(botWebhookSource, /fx:check_subscription/);
  assert.match(botWebhookSource, /sendMiniAppRegistrationPrompt/);
  assert.match(botWebhookSource, /!update\.message\?\.successful_payment/);
});
test("Mini App validates subscription and account registration on boot and navigation", () => {
  assert.match(miniAppSource, /flamexbot-access-check/);
  assert.match(miniAppSource, /access\.session_matches !== true/);
  assert.match(miniAppSource, /renderSubscriptionGate/);
  assert.match(miniAppSource, /registration: access\.registered !== true/);
});
test("Home and profile status use live Telegram Business verification", () => {
  assert.match(miniAppSource, /checkLiveBusiness\(supabase,profile\.id\)/);
  assert.match(miniAppSource, /homeBusinessUnknown/);
});

test(".time scheduled updates verify a separate Vault secret through a service-role RPC", () => {
  assert.match(botWebhookSource, /if \(req\.headers\.get\("x-flamexbot-job"\) === "time-tick"\) \{/);
  assert.match(botWebhookSource, /admin\.rpc\(\s*"verify_flamexbot_time_tick_secret"/);
  assert.match(botWebhookSource, /p_candidate:\s*tickSecret/);
  assert.match(botWebhookSource, /if \(tickAuthorized !== true\) return new Response\("Unauthorized", \{ status: 401 \}\)/);
  assert.ok(!botWebhookSource.includes('Deno.env.get("FLAMEXBOT_TIME_TICK_SECRET")'));
  assert.ok(!botWebhookSource.includes('req.headers.get("x-flamexbot-job-secret") === WEBHOOK_SECRET'));
  const tickRouteAt = botWebhookSource.indexOf('if (req.headers.get("x-flamexbot-job") === "time-tick")');
  const telegramAuthAt = botWebhookSource.indexOf('const webhookHeader = req.headers.get("x-telegram-bot-api-secret-token")');
  assert.ok(tickRouteAt >= 0 && telegramAuthAt > tickRouteAt, "invalid scheduler calls must be rejected before webhook processing");
});
