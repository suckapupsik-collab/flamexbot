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

test("Business commands are dispatched before slower webhook processing", () => {
  const captureAt = botWebhookSource.indexOf("business command captured at webhook ingress");
  const normalProcessingAt = botWebhookSource.indexOf("const directTelegramUserId");
  assert.ok(captureAt >= 0, "early Business command capture must exist");
  assert.ok(normalProcessingAt >= 0, "normal webhook processing marker must exist");
  assert.ok(captureAt < normalProcessingAt, "commands must be handled before unrelated webhook work");
  assert.match(botWebhookSource, /earlyBusinessMessage\.message_id/);
  assert.match(botWebhookSource, /Another bot may already have deleted the command/);
});
