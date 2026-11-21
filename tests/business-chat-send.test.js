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
