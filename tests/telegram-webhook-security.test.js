import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const botSource = await readFile(new URL('../supabase/functions/flamexbot-bot/index.ts', import.meta.url), 'utf8');
const setupSource = await readFile(new URL('../supabase/functions/setup-flamexbot-webhook/index.ts', import.meta.url), 'utf8');
const miniAppSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Telegram webhook uses Vault-backed verification and has no hard-coded fallback secret', () => {
  assert.match(botSource, /get_flamexbot_telegram_webhook_secret/);
  assert.match(botSource, /verify_flamexbot_telegram_webhook_secret/);
  assert.match(botSource, /verify_flamexbot_time_tick_secret/);
  assert.doesNotMatch(botSource, /fxbot_whsec_[a-f0-9]{32}/);
});

test('founder webhook setup reads its credential from Vault', () => {
  assert.match(setupSource, /get_flamexbot_telegram_webhook_secret/);
  assert.match(setupSource, /retire_flamexbot_telegram_webhook_legacy_secret/);
  assert.doesNotMatch(setupSource, /fxbot_whsec_[a-f0-9]{32}/);
});

test('subscriptions remain Premium-only in the Mini App', () => {
  assert.match(miniAppSource, /function isPremium\(\) \{ return \['premium','founder'\]/);
  assert.match(miniAppSource, /function planLabel\(\) \{ return isPremium\(\)\?'PREMIUM':'FREE'; \}/);
  assert.doesNotMatch(miniAppSource, /state\.subscription\?\.plan\s*===\s*['"]pro['"]/);
});
