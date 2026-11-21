// PIN lock screen (keypad, dots, haptics, lockout) and in-app PIN prompts (replace window.prompt).
const haptic = (kind = 'light') => {
  try {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (!h) return;
    if (kind === 'error' || kind === 'success') h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  } catch { /* no haptics available */ }
};
const lockKey = id => 'flamexbot.pin.lock.' + id;
const readLock = id => { try { return JSON.parse(localStorage.getItem(lockKey(id)) || '{}'); } catch { return {}; } };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

function padMarkup(len) {
  const keys = KEYS.map(k => k === ''
    ? '<span></span>'
    : `<button type="button" class="pin-key ${k === '⌫' ? 'is-back' : ''}" data-key="${k}" aria-label="${k === '⌫' ? 'Стереть' : k}">${k}</button>`).join('');
  return `<div class="pin-dots">${Array.from({ length: len }, () => '<i></i>').join('')}</div><div class="pin-pad">${keys}</div>`;
}

/** Keypad driver. onSubmit(pin) must resolve true when accepted (pad stays), anything else clears the input. */
export function bindPad(root, { min = 4, max = 8, onSubmit }) {
  let value = '';
  const dotsEl = root.querySelector('.pin-dots');
  const render = () => {
    const slots = Math.max(min, value.length);
    dotsEl.innerHTML = Array.from({ length: slots }, (_, i) => `<i class="${i < value.length ? 'on' : ''}"></i>`).join('');
  };
  const submit = async () => {
    if (root.dataset.busy === '1' || value.length < min) return false;
    root.dataset.busy = '1';
    let res = false;
    try {
      res = await onSubmit(value);
    } catch {
      const errorEl = root.querySelector('.pin-error');
      if (errorEl) errorEl.textContent = 'Не удалось проверить PIN. Попробуй ещё раз.';
      haptic('error');
    } finally {
      root.dataset.busy = '0';
    }
    if (res !== true) { value = ''; render(); }
    return res === true;
  };
  const press = async k => {
    if (root.dataset.busy === '1') return;
    if (k === '⌫') { value = value.slice(0, -1); haptic('light'); render(); return; }
    if (k === 'OK') { await submit(); return; }
    if (value.length >= max) return;
    value += k; haptic('light'); render();
    if (value.length === max) await submit();
  };
  root.querySelectorAll('.pin-key').forEach(b => b.addEventListener('click', () => press(b.dataset.key)));
  const keyHandler = e => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('⌫');
    else if (e.key === 'Enter') press('OK');
  };
  document.addEventListener('keydown', keyHandler);
  render();
  return { submit, dispose: () => document.removeEventListener('keydown', keyHandler) };
}

export function gatePin({ app, session, pinKey, unlockKey, checkPin, onSignOut }) {
  const id = session?.user?.id;
  if (!id || !localStorage.getItem(pinKey(id)) || sessionStorage.getItem(unlockKey(id)) === '1') return Promise.resolve(true);
  return new Promise(resolve => {
    app.innerHTML = `<main class="pin-screen"><div class="pin-bg"><span></span><span></span><span></span></div>
      <section class="pin-card" id="pin-card"><div class="pin-emblem"><span>✦</span><i></i><b></b></div>
      <div class="eyebrow">FLAMEXBOT SECURITY</div><h2>Введи PIN-код</h2><p class="muted" id="pin-hint">Разблокируй FLAMEXBOT</p>
      ${padMarkup(4)}<p id="pin-error" class="pin-error" role="alert"></p>
      <div class="pin-foot"><button class="pin-link" id="pin-ok" type="button">Подтвердить</button><button class="pin-link danger" id="pin-exit" type="button">Выйти из аккаунта</button></div></section></main>`;
    const card = app.querySelector('#pin-card');
    const err = app.querySelector('#pin-error');
    const hint = app.querySelector('#pin-hint');
    const updateLock = () => {
      const left = (readLock(id).until || 0) - Date.now();
      if (left > 0) { card.classList.add('is-locked'); hint.textContent = `Слишком много попыток · повтори через ${Math.ceil(left / 1000)} с`; return true; }
      card.classList.remove('is-locked');
      if (hint.textContent.startsWith('Слишком')) { hint.textContent = 'Разблокируй FLAMEXBOT'; err.textContent = ''; }
      return false;
    };
    const timer = setInterval(updateLock, 500);
    updateLock();
    let pad;
    pad = bindPad(card, {
      onSubmit: async pin => {
        if (updateLock()) { haptic('error'); return false; }
        if (await checkPin(id, pin)) {
          localStorage.removeItem(lockKey(id));
          sessionStorage.setItem(unlockKey(id), '1');
          haptic('success');
          card.classList.add('is-unlocked');
          clearInterval(timer); pad.dispose();
          setTimeout(() => resolve(true), 320);
          return true;
        }
        const fails = (readLock(id).fails || 0) + 1;
        const until = fails % 5 === 0 ? Date.now() + Math.min(300, 15 * 2 ** (fails / 5 - 1)) * 1000 : 0;
        localStorage.setItem(lockKey(id), JSON.stringify({ fails, until }));
        card.classList.remove('is-shaking'); void card.offsetWidth; card.classList.add('is-shaking');
        haptic('error');
        const left = 5 - (fails % 5);
        err.textContent = until ? 'Слишком много неверных попыток.' : `Неверный PIN-код${left <= 2 ? ' · осталось попыток: ' + left : ''}`;
        updateLock();
        return false;
      },
    });
    app.querySelector('#pin-ok').addEventListener('click', () => pad.submit());
    app.querySelector('#pin-exit').addEventListener('click', async () => { clearInterval(timer); pad.dispose(); await onSignOut(); resolve(false); });
  });
}

function sheet(html) {
  const el = document.createElement('div');
  el.className = 'fx-sheet-backdrop';
  el.innerHTML = `<div class="fx-sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 260); };
  el.addEventListener('click', e => { if (e.target === el) el.dispatchEvent(new CustomEvent('dismiss')); });
  return { el, close };
}

/** Ask for a single PIN. Resolves with the entered PIN or null if cancelled. */
function askPin(title, subtitle, { min = 4, max = 8 } = {}) {
  return new Promise(resolve => {
    const { el, close } = sheet(`<div class="pin-emblem sm"><span>✦</span><i></i></div><h3>${title}</h3><p class="muted">${subtitle}</p>${padMarkup(min)}<div class="pin-foot"><button class="pin-link" data-ok type="button">Далее</button><button class="pin-link danger" data-cancel type="button">Отмена</button></div>`);
    const root = el.querySelector('.fx-sheet');
    let pad;
    pad = bindPad(root, { min, max, onSubmit: async pin => { pad.dispose(); close(); resolve(pin); return true; } });
    const cancel = () => { pad.dispose(); close(); resolve(null); };
    el.querySelector('[data-ok]').addEventListener('click', () => pad.submit());
    el.querySelector('[data-cancel]').addEventListener('click', cancel);
    el.addEventListener('dismiss', cancel);
  });
}

export async function promptPinVerify(id, checkPin, title = 'Введи текущий PIN') {
  const pin = await askPin(title, 'Для продолжения подтверди PIN-код');
  if (pin === null) return false;
  if (await checkPin(id, pin)) return true;
  haptic('error');
  return false;
}

export async function promptPinSetup() {
  const first = await askPin('Придумай PIN-код', 'От 4 до 8 цифр');
  if (first === null) return null;
  const second = await askPin('Повтори PIN-код', 'Введи тот же PIN ещё раз');
  if (second === null) return null;
  if (first !== second) { haptic('error'); return { mismatch: true }; }
  return { pin: first };
}
