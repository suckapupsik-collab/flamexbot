import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async path => readFile(new URL(path, import.meta.url), "utf8");
const [accessSource, authSource, appSource, animationSource] = await Promise.all([
  read("../supabase/functions/flamexbot-access-check/index.ts"),
  read("../supabase/functions/telegram-auth/index.ts"),
  read("../src/main.js"),
  read("../src/enhance.css"),
]);

test("authenticated Mini App checks subscription from its Supabase session", () => {
  const bearerBranch = accessSource.indexOf("if (bearer) {");
  const initDataBranch = accessSource.indexOf("} else {", bearerBranch);
  assert.ok(bearerBranch >= 0, "access check must detect an authenticated session");
  assert.ok(initDataBranch > bearerBranch, "initData fallback must be separate from session validation");
  assert.match(accessSource, /admin\.auth\.getUser\(bearer\)/);
  assert.match(accessSource, /select\("id,telegram_id,is_banned"\)\.eq\("id", authData\.user\.id\)/);
  assert.match(accessSource, /telegramUserId = String\(data\.telegram_id\)/);
  assert.match(accessSource, /getTelegramUser\(typeof body\?\.initData/);
});

test("Mini App session checks are not tied to the five-minute initData window", () => {
  assert.match(accessSource, /INIT_DATA_MAX_AGE_SECONDS = 24 \* 60 \* 60/);
  assert.doesNotMatch(accessSource, /now - authDate > 300/);
  assert.match(appSource, /session\?\.access_token/);
  assert.match(appSource, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(appSource, /body: \{\}, headers:/);
});

test("Telegram login checks subscription before creating or linking a profile", () => {
  const verifyAt = authSource.indexOf("const user = await verifyTelegramInitData");
  const subscriptionAt = authSource.indexOf("checkRequiredChannel(botToken, String(user.id))");
  const createAt = authSource.indexOf("admin.auth.admin.createUser");
  assert.ok(subscriptionAt > verifyAt, "signed Telegram identity must be checked first");
  assert.ok(createAt > subscriptionAt, "new account creation must happen after subscription confirmation");
  assert.match(authSource, /now - authDate > 24 \* 60 \* 60/);
  assert.match(authSource, /getChatMember/);
  assert.match(authSource, /reason: "subscription_required"/);
});

test("Telegram login preserves a valid username and falls back on collisions", () => {
  assert.match(authSource, /select\("id"\)\.eq\("username", telegramUsername\)/);
  assert.match(authSource, /profileUsername = `tg_\$\{telegramId\}`/);
  assert.match(authSource, /username: profileUsername/);
  assert.match(authSource, /auth\.admin\.generateLink/);
});

test("Telegram login reports stale and replayed credentials clearly", () => {
  assert.match(appSource, /Закрой Mini App и открой его заново из Telegram/);
  assert.match(appSource, /Данные Telegram устарели/);
  assert.match(appSource, /не вернул активную сессию/);
});

test("Subscription and registration gates remain visible and actionable", () => {
  assert.match(appSource, /renderSubscriptionGate/);
  assert.match(appSource, /Я подписался — проверить/);
  assert.match(appSource, /Регистрация в FLAMEXBOT/);
  assert.match(appSource, /access\.session_matches !== true/);
});

test("Entry animations include reduced-motion accessibility support", () => {
  assert.match(animationSource, /@keyframes fx-auth-card/);
  assert.match(animationSource, /@keyframes fx-flame-float/);
  assert.match(animationSource, /@keyframes fx-gate-aura/);
  assert.match(animationSource, /prefers-reduced-motion:reduce/);
});
