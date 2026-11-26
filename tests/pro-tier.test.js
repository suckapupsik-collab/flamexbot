import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Mini App recognizes the public PRO plan as an active subscription', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /function isPremium\(\) \{ return \['premium','pro'\]\.includes\(state\.subscription\?\.plan\)/);
  assert.match(source, /function planLabel\(\) \{ return state\.subscription\?\.plan==='pro'&&isPremium\(\)\?'PRO'/);
});
