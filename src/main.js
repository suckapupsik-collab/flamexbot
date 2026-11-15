import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY && !SUPABASE_KEY.startsWith('YOUR_')
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const state = { session: null, profile: null, page: 'home', busy: false, friends: [], requests: [], streaks: [], conversations: [], activeConversation: null, messages: [] };
const app = document.querySelector('#app');
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = name => (name || 'F').trim().slice(0, 1).toUpperCase();
const toast = message => { const el = document.querySelector('.toast'); if (!el) return; el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); };
const avatar = (url, name, size = '') => url ? `<img class="avatar ${size}" src="${esc(url)}" alt="" />` : `<span class="avatar avatar-fallback ${size}">${esc(initials(name))}</span>`;

function renderAuth() {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-visual">
        <div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div>
        <div class="visual-copy"><div class="eyebrow"><i></i> YOUR DAILY CONNECTION</div><h1>Не дай<br/>огоньку <em>погаснуть.</em></h1><p>Общайтесь каждый день. Поддерживайте серию вместе. Создавайте историю, которая не прерывается.</p><div class="flame-orbit"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="flame">🔥</div><span class="orbit-label label-a">ONE MESSAGE A DAY</span><span class="orbit-label label-b">KEEP IT ALIVE</span></div></div>
        <div class="visual-footer">© 2026 FLAMEXBOT <span>MADE FOR YOUR PEOPLE</span></div>
      </section>
      <section class="auth-panel"><div class="mobile-brand brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><div class="auth-card">
        <div class="eyebrow">WELCOME TO FLAMEXBOT</div><h2 id="auth-title">С возвращением</h2><p class="muted" id="auth-subtitle">Войди, чтобы продолжить общение.</p>
        <div class="auth-tabs"><button class="tab active" data-mode="login">Вход</button><button class="tab" data-mode="signup">Регистрация</button></div>
        <form id="auth-form"><label>Электронная почта<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required /></label><label>Пароль<input name="password" type="password" placeholder="Минимум 6 символов" minlength="6" autocomplete="current-password" required /></label><button class="primary full" type="submit"><span id="auth-submit">Войти в аккаунт</span><b>→</b></button></form>
        <div class="separator"><span>или продолжить с</span></div><button class="google full" id="google-login"><span class="google-g">G</span> Google</button>
        <p class="auth-note">Продолжая, ты соглашаешься с правилами использования FLAMEXBOT.</p><div class="auth-error" id="auth-error"></div>
      </div><div class="panel-bottom">ТВОИ ЛЮДИ. ТВОЯ ИСТОРИЯ. ТВОЙ ОГОНЁК.</div></section>
    </main><div class="toast"></div>`;
  let mode = 'login';
  document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
    mode = btn.dataset.mode; document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === btn));
    document.querySelector('#auth-title').textContent = mode === 'login' ? 'С возвращением' : 'Создай аккаунт';
    document.querySelector('#auth-subtitle').textContent = mode === 'login' ? 'Войди, чтобы продолжить общение.' : 'Зарегистрируйся и зажги свой первый огонёк.';
    document.querySelector('#auth-submit').textContent = mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт';
  }));
  document.querySelector('#auth-form').addEventListener('submit', async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const email = fd.get('email'); const password = fd.get('password');
    const button = e.currentTarget.querySelector('button[type=submit]'); button.disabled = true; document.querySelector('#auth-error').textContent = '';
    const result = mode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    button.disabled = false;
    if (result.error) document.querySelector('#auth-error').textContent = result.error.message;
    else if (mode === 'signup' && !result.data.session) document.querySelector('#auth-error').textContent = 'Проверь почту и подтверди регистрацию.';
  });
  document.querySelector('#google-login').addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
    if (error) document.querySelector('#auth-error').textContent = error.message;
  });
}

function navItem(page, icon, label) { return `<button class="nav-item ${state.page === page ? 'selected' : ''}" data-page="${page}"><span>${icon}</span>${label}</button>`; }
function renderApp() {
  const p = state.profile || {};
  app.innerHTML = `
    <div class="app-layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><div class="side-label">МЕНЮ</div><nav>${navItem('home','⌂','Главная')}${navItem('messages','◌','Сообщения')}${navItem('friends','♧','Друзья')}${navItem('streaks','🔥','Огоньки')}${navItem('profile','◉','Профиль')}</nav><div class="sidebar-bottom"><div class="user-mini">${avatar(p.avatar_url, p.username)}<div><b>${esc(p.username || 'Пользователь')}</b><small>Участник FLAMEXBOT</small></div></div><button class="logout" id="logout">↗ Выйти</button></div></aside>
    <main class="main-area"><header class="topbar"><div><span class="top-kicker">FLAMEXBOT /</span> <b>${({home:'Главная',messages:'Сообщения',friends:'Друзья',streaks:'Огоньки',profile:'Профиль'})[state.page]}</b></div><div class="top-right"><span class="status-dot"></span> На связи <span class="top-avatar">${avatar(p.avatar_url,p.username)}</span></div></header>
    <section class="page-content" id="page-content"></section></main></div><div class="toast"></div>`;
  document.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => { state.page = btn.dataset.page; renderApp(); loadPage(); }));
  document.querySelector('#logout').addEventListener('click', async () => { if (confirm('Выйти из аккаунта?')) await supabase.auth.signOut(); });
  loadPage();
}

async function loadPage() {
  const host = document.querySelector('#page-content'); if (!host) return;
  const p = state.profile || {};
  if (state.page === 'home') {
    const [friends, streaks, unread] = await Promise.all([
      supabase.from('friendships').select('user_low,user_high,created_at').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).limit(6),
      supabase.from('streaks').select('*').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).order('current_days',{ascending:false}).limit(5),
      supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',state.session.user.id).is('read_at',null)
    ]);
    state.streaks = streaks.data || [];
    host.innerHTML = `<div class="welcome-row"><div><div class="eyebrow">ТВОЁ ПРОСТРАНСТВО</div><h1>Привет, ${esc(p.username || 'друг')} <span>✦</span></h1><p class="muted">Каждый день — ещё один повод оставаться на связи.</p></div><div class="date-chip">${new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'})}</div></div>
      <div class="hero-card"><div class="hero-copy"><div class="eyebrow">KEEP THE FLAME ALIVE</div><h2>Один день.<br/><em>Одно сообщение.</em></h2><p>Обменивайтесь сообщениями каждый день, чтобы ваш общий огонёк продолжал гореть.</p><button class="primary" data-go="friends">Найти друзей <b>→</b></button></div><div class="hero-fire">🔥<span class="fire-glow"></span></div><div class="hero-watermark">FLAME</div></div>
      <div class="stats-grid"><div class="stat-card"><span class="stat-icon">♧</span><small>ДРУЗЬЯ</small><strong>${friends.data?.length || 0}</strong><span class="stat-foot">Твои связи</span></div><div class="stat-card"><span class="stat-icon">🔥</span><small>АКТИВНЫЕ ОГОНЬКИ</small><strong>${state.streaks.length}</strong><span class="stat-foot">Общие серии</span></div><div class="stat-card"><span class="stat-icon">✉</span><small>УВЕДОМЛЕНИЯ</small><strong>${unread.count || 0}</strong><span class="stat-foot">Непрочитанные</span></div></div>
      <div class="section-heading"><div><div class="eyebrow">YOUR CONNECTIONS</div><h3>Твои огоньки</h3></div><button class="text-button" data-go="streaks">Все огоньки →</button></div>
      <div class="streak-list">${state.streaks.length ? state.streaks.map(s => `<div class="streak-row"><span class="streak-symbol">🔥</span><div class="streak-info"><b>Общий огонёк</b><small>Серия продолжается</small></div><strong>${s.current_days || 0} <small>дн.</small></strong></div>`).join('') : '<div class="empty-state">Пока нет огоньков. Добавь друга и отправьте друг другу сообщения сегодня.</div>'}</div>`;
  } else if (state.page === 'friends') await renderFriends(host);
  else if (state.page === 'messages') await renderMessages(host);
  else if (state.page === 'streaks') await renderStreaks(host);
  else if (state.page === 'profile') renderProfile(host);
  host.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => { state.page = btn.dataset.go; renderApp(); }));
}

async function renderFriends(host) {
  const uid = state.session.user.id;
  const [requests, friends] = await Promise.all([
    supabase.from('friend_requests').select('*').eq('receiver_id',uid).eq('status','pending'),
    supabase.from('friendships').select('*').or(`user_low.eq.${uid},user_high.eq.${uid}`)
  ]);
  state.requests = requests.data || []; state.friends = friends.data || [];
  const friendIds = state.friends.map(f => f.user_low === uid ? f.user_high : f.user_low);
  const { data: friendProfiles } = friendIds.length ? await supabase.from('profiles').select('id,username,avatar_url').in('id',friendIds) : {data:[]};
  const profileById = Object.fromEntries((friendProfiles || []).map(profile => [profile.id, profile]));
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">YOUR CIRCLE</div><h1>Друзья</h1><p class="muted">Люди, с которыми горит твой огонёк.</p></div>
    <form class="search-form" id="friend-search"><input name="query" placeholder="Найти пользователя по никнейму" required/><button class="primary">Найти <b>→</b></button></form><div id="search-results"></div>
    <div class="section-heading"><div><div class="eyebrow">INCOMING</div><h3>Заявки <span class="count-pill">${state.requests.length}</span></h3></div></div><div class="people-list">${state.requests.length ? state.requests.map(r => `<div class="person-row"><div class="person-avatar">${avatar('', 'U')}</div><div class="person-info"><b>Запрос в друзья</b><small>${esc(r.id)}</small></div><button class="primary small" data-accept="${r.id}">Принять</button></div>`).join('') : '<div class="empty-state">Новых заявок пока нет.</div>'}</div>
    <div class="section-heading"><div><div class="eyebrow">YOUR PEOPLE</div><h3>Мои друзья</h3></div></div><div class="people-list">${state.friends.length ? state.friends.map(f => { const friendId = f.user_low === uid ? f.user_high : f.user_low; const person = profileById[friendId] || {}; return `<div class="person-row">${avatar(person.avatar_url,person.username)}<div class="person-info"><b>${esc(person.username || 'Друг')}</b><small>Ваш общий огонёк может начаться сегодня</small></div><button class="outline small" data-chat-user="${friendId}">Написать</button></div>`; }).join('') : '<div class="empty-state">Здесь появятся ваши друзья после принятия заявки.</div>'}</div>`;
  document.querySelector('#friend-search').addEventListener('submit', async e => {
    e.preventDefault(); const q = new FormData(e.currentTarget).get('query').trim();
    const { data, error } = await supabase.from('profiles').select('id,username,avatar_url').ilike('username',`%${q}%`).neq('id',uid).limit(8);
    const target = document.querySelector('#search-results');
    target.innerHTML = error ? `<div class="empty-state">${esc(error.message)}</div>` : (data?.length ? data.map(u => `<div class="person-row">${avatar(u.avatar_url,u.username)}<div class="person-info"><b>${esc(u.username || 'Пользователь')}</b><small>${esc(u.id.slice(0,8))}…</small></div><button class="outline small" data-request="${u.id}">Добавить</button></div>`).join('') : '<div class="empty-state">Пользователь не найден.</div>');
    target.querySelectorAll('[data-request]').forEach(btn => btn.addEventListener('click', async () => {
      const { error } = await supabase.from('friend_requests').insert({sender_id:uid,receiver_id:btn.dataset.request,status:'pending'});
      toast(error ? error.message : 'Заявка отправлена'); btn.disabled = true;
    }));
  });
  host.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', async () => {
    const { error } = await supabase.from('friend_requests').update({status:'accepted',responded_at:new Date().toISOString()}).eq('id',btn.dataset.accept);
    toast(error ? error.message : 'Заявка принята'); renderFriends(host);
  }));
  host.querySelectorAll('[data-chat-user]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const { data, error } = await supabase.rpc('create_direct_conversation',{target_user_id:btn.dataset.chatUser});
    if (error) { toast(error.message); btn.disabled = false; return; }
    state.page = 'messages'; renderApp();
  }));
}

async function renderMessages(host) {
  const uid = state.session.user.id;
  const { data: memberships, error: memberError } = await supabase.from('conversation_members').select('conversation_id').eq('user_id',uid);
  if (memberError) { host.innerHTML = `<div class="empty-state">${esc(memberError.message)}</div>`; return; }
  const ids = (memberships || []).map(x => x.conversation_id);
  const { data: conversations, error } = ids.length ? await supabase.from('conversations').select('*').in('id',ids).order('last_message_at',{ascending:false}) : {data:[],error:null};
  if (error) { host.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  state.conversations = conversations || [];
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">STAY IN TOUCH</div><h1>Сообщения</h1><p class="muted">Личные разговоры и обмен фотографиями и видео.</p></div><div class="chat-layout"><aside class="chat-list">${state.conversations.length ? state.conversations.map(c => `<button class="chat-choice" data-chat="${c.id}"><span class="avatar avatar-fallback">🔥</span><span><b>Личный чат</b><small>${c.last_message_at ? new Date(c.last_message_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Начать разговор'}</small></span></button>`).join('') : '<div class="empty-state">Пока нет чатов. Добавь друга и нажми «Написать» в его профиле.</div>'}</aside><section class="chat-window" id="chat-window"><div class="chat-placeholder"><span>✉</span><b>Твои разговоры начинаются здесь</b><small>Выбери чат слева.</small></div></section></div>`;
  host.querySelectorAll('[data-chat]').forEach(btn => btn.addEventListener('click', () => openChat(btn.dataset.chat)));
}

async function renderMessageBubble(m) {
  let media = '';
  if (m.media_url) {
    const { data } = await supabase.storage.from('chat-media').createSignedUrl(m.media_url, 3600);
    if (data?.signedUrl) {
      media = m.message_type === 'video'
        ? `<video class="chat-media" controls preload="metadata" src="${esc(data.signedUrl)}"></video>`
        : `<a class="media-link" href="${esc(data.signedUrl)}" target="_blank" rel="noopener"><img class="chat-media" loading="lazy" src="${esc(data.signedUrl)}" alt="Вложение"/></a>`;
    } else media = '<small class="media-unavailable">Вложение недоступно</small>';
  }
  return `<div class="bubble ${m.sender_id === state.session.user.id ? 'mine' : ''}">${m.content ? `<div>${esc(m.content)}</div>` : ''}${media}<small>${new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</small></div>`;
}

async function refreshChatMessages(id) {
  if (state.activeConversation !== id) return;
  const list = document.querySelector('#message-list');
  if (!list) return;
  const { data: messages, error } = await supabase.from('messages').select('*').eq('conversation_id',id).order('created_at',{ascending:true}).limit(100);
  if (state.activeConversation !== id) return;
  if (error) { list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  state.messages = messages || [];
  list.innerHTML = (await Promise.all(state.messages.map(renderMessageBubble))).join('') || '<div class="chat-placeholder"><b>Пока нет сообщений</b><small>Отправь первое сообщение!</small></div>';
  list.scrollTop = list.scrollHeight;
}

async function openChat(id) {
  state.activeConversation = id;
  if (state.chatChannel) { await supabase.removeChannel(state.chatChannel); state.chatChannel = null; }
  const box = document.querySelector('#chat-window'); if (!box) return;
  box.innerHTML = `<div class="chat-head"><b>Личный разговор</b><small>Сообщения и вложения доступны только участникам</small></div><div class="message-list" id="message-list"><div class="empty-state">Загружаю сообщения…</div></div><form class="send-form" id="send-message"><label class="attach-button" title="Прикрепить фото или видео">＋<input name="media" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden/></label><input name="content" placeholder="Напиши сообщение…" maxlength="4000"/><button class="primary" type="submit">➤</button></form><div class="upload-hint" id="upload-hint">Фото и видео до 20 МБ</div>`;
  await refreshChatMessages(id);
  state.chatChannel = supabase.channel(`chat-${id}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${id}`},() => refreshChatMessages(id))
    .subscribe();
  const form = document.querySelector('#send-message');
  const fileInput = form.querySelector('input[type=file]');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    document.querySelector('#upload-hint').textContent = file ? `Выбрано: ${file.name}` : 'Фото и видео до 20 МБ';
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    const content = new FormData(form).get('content').trim();
    const file = fileInput.files?.[0];
    if (!content && !file) return;
    if (file && file.size > 20 * 1024 * 1024) { toast('Файл больше 20 МБ'); return; }
    submit.disabled = true;
    let mediaPath = null;
    let messageType = 'text';
    if (file) {
      const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g,'') || 'bin';
      mediaPath = `${id}/${state.session.user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('chat-media').upload(mediaPath,file,{contentType:file.type,upsert:false});
      if (uploadError) { toast(uploadError.message); submit.disabled = false; return; }
      messageType = file.type.startsWith('video/') ? 'video' : 'image';
    }
    const { error: sendError } = await supabase.from('messages').insert({conversation_id:id,sender_id:state.session.user.id,content,message_type:messageType,media_url:mediaPath});
    submit.disabled = false;
    if (sendError) {
      if (mediaPath) await supabase.storage.from('chat-media').remove([mediaPath]);
      toast(sendError.message);
    } else {
      form.reset();
      document.querySelector('#upload-hint').textContent = 'Фото и видео до 20 МБ';
      await refreshChatMessages(id);
    }
  });
}
async function renderStreaks(host) {
  const { data, error } = await supabase.from('streaks').select('*').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).order('current_days',{ascending:false});
  state.streaks = data || [];
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">DON'T BREAK THE CHAIN</div><h1>Огоньки 🔥</h1><p class="muted">Серия сохраняется, когда оба человека отправили сообщение за день.</p></div><div class="streak-list large">${error ? esc(error.message) : state.streaks.length ? state.streaks.map(s => `<div class="streak-card"><div class="streak-symbol">🔥</div><div><div class="eyebrow">ОБЩАЯ СЕРИЯ</div><h3>${s.current_days || 0} дней</h3><p class="muted">Лучшая серия: ${s.best_days || 0} дней</p></div></div>`).join('') : '<div class="empty-state">У тебя пока нет активных серий. Найди друга и начните переписываться каждый день!</div>'}</div>`;
}

function renderProfile(host) {
  const p = state.profile || {};
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">YOUR IDENTITY</div><h1>Профиль</h1><p class="muted">Настрой свой профиль FLAMEXBOT.</p></div><form class="profile-card" id="profile-form">${avatar(p.avatar_url,p.username,'avatar-xl')}<label>Никнейм<input name="username" value="${esc(p.username || '')}" placeholder="Твой никнейм" maxlength="32" required/></label><label>Ссылка на аватар<input name="avatar_url" type="url" value="${esc(p.avatar_url || '')}" placeholder="https://…"/></label><div class="profile-id">ID аккаунта <code>${esc(state.session.user.id)}</code></div><button class="primary">Сохранить изменения <b>→</b></button></form>`;
  document.querySelector('#profile-form').addEventListener('submit', async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from('profiles').update({username:fd.get('username'),avatar_url:fd.get('avatar_url') || null}).eq('id',state.session.user.id);
    if (error) toast(error.message); else { state.profile = {...p,username:fd.get('username'),avatar_url:fd.get('avatar_url')}; toast('Профиль сохранён'); renderApp(); }
  });
}

async function boot(session) {
  state.session = session;
  if (!session) { renderAuth(); return; }
  const { data, error } = await supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle();
  state.profile = data || {username:session.user.email?.split('@')[0] || 'Flame user'};
  if (error) console.warn('Profile load:', error.message);
  renderApp();
}

if (!supabase) {
  app.innerHTML = `<main class="config-screen"><div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><h1>Почти готово.</h1><p>Добавь переменные окружения Supabase в настройках Cloudflare Pages:</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><p class="muted">Используй publishable key проекта FLAMEXBOT. Никогда не добавляй service_role key во фронтенд.</p></main>`;
} else {
  supabase.auth.getSession().then(({data}) => boot(data.session));
  supabase.auth.onAuthStateChange((_event, session) => { if (session !== state.session) boot(session); });
}
