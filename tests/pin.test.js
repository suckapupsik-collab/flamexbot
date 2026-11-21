import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPad } from '../src/features/pin.js';

function makeRoot() {
  const dots = { innerHTML: '' };
  const error = { textContent: '' };
  return {
    dataset: {},
    dots,
    error,
    querySelector(selector) {
      if (selector === '.pin-dots') return dots;
      if (selector === '.pin-error') return error;
      return null;
    },
    querySelectorAll() { return []; },
  };
}

test('PIN keypad clears the busy lock and input when verification throws', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  try {
    const root = makeRoot();
    let attempts = 0;
    const pad = bindPad(root, {
      min: 4,
      max: 8,
      onSubmit: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('crypto unavailable');
        return true;
      },
    });

    for (const digit of '1234') await pad.press(digit);
    assert.equal(await pad.submit(), false);
    assert.equal(root.dataset.busy, '0');
    assert.match(root.error.textContent, /Не удалось проверить PIN/);
    assert.equal(root.dots.innerHTML, '<i></i><i></i><i></i><i></i>');

    for (const digit of '5678') await pad.press(digit);
    assert.equal(await pad.submit(), true);
    assert.equal(root.dataset.busy, '0');
    assert.equal(attempts, 2);
    pad.dispose();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('PIN keypad preserves entered digits when verification succeeds', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  try {
    const root = makeRoot();
    const pad = bindPad(root, { min: 4, onSubmit: async pin => pin === '2468' });
    for (const digit of '2468') await pad.press(digit);
    assert.equal(await pad.submit(), true);
    assert.equal(root.dataset.busy, '0');
    assert.equal((root.dots.innerHTML.match(/class="on"/g) || []).length, 4);
    pad.dispose();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
