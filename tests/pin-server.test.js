import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const guard = await readFile(new URL("../supabase/functions/pin-guard/index.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("PIN hash is computed and compared only on the server", () => {
  assert.match(guard, /PBKDF2/);
  assert.match(guard, /constantTimeEqual/);
  assert.doesNotMatch(main, /localStorage\.setItem\([^)]*pin/i);
  assert.doesNotMatch(main, /pinHash/);
});

test("PIN checks are gated by a server-side lockout", () => {
  assert.match(guard, /locked_until/);
  assert.match(guard, /lockSecondsAfter\(fails\)/);
  assert.match(guard, /MAX_LOCK_SECONDS = 300/);
});

test("changing or removing a PIN requires the current PIN", () => {
  assert.match(guard, /Changing or replacing an existing PIN needs the current one/);
  assert.match(guard, /action === "remove"/);
});

test("PIN verification fails closed when recording an attempt fails", () => {
  assert.match(guard, /attemptUpdateError/);
  assert.match(guard, /Could not record PIN attempt/);
  assert.match(guard, /profile not found/);
});

test("Mini App shows a recoverable error when the PIN service is unavailable", () => {
  assert.match(main, /Проверка PIN временно недоступна/);
  assert.match(main, /retry-pin-service/);
  assert.match(main, /logout-pin-service/);
});

test("profile PIN settings use server-backed state, never the removed local pin key", () => {
  assert.match(main, /pinEnabledCache===true/);
  assert.doesNotMatch(main, /pinKey\(state\.session\.user\.id\)/);
});
