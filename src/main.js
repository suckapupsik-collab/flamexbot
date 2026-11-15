import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY && !SUPABASE_KEY.startsWith('YOUR_')
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const state = { session: null, profile: null, businessConnection: null, isAdmin: false, page: 'home', busy: false, friends: [], requests: [], streaks: [], businessChats: [], activeBusinessChat: null, businessMessages: [], businessChatChannel: null, businessListChannel: null };
const app = document.querySelector('#app');
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = name => (name || 'F').trim().slice(0, 1).toUpperCase();
const toast = message => { const el = document.querySelector('.toast'); if (!el) return; el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); };
const avatar = (url, name, size = '') => url ? `<img class="avatar ${size}" src="${esc(url)}" alt="" />` : `<span class="avatar avatar-fallback ${size}">${esc(initials(name))}</span>`;

async function telegramAuthFlow({ linkCurrent = false } = {}) {
  const webApp = window.Telegram?.WebApp;
  const initData = webApp?.initData;
  if (!initData) {
    toast('Открой FLAMEXBOT из Telegram Mini App, чтобы продолжить.');
    return;
  }
  webApp.ready?.();
  webApp.expand?.();
  const button = document.querySelector(linkCurrent ? '[data-telegram-link]' : '#telegram-login');
  if (button) button.disabled = true;
  try {
    const { data, error } = await supabase.functions.invoke('telegram-auth', { body: { initData } });
    if (error) {
      let message = error.message || 'Ошибка Telegram-входа.';
      try { const details = await error.context?.json?.(); if (details?.error) message = details.error; } catch {}
      throw new Error(message);
    }
    if (data?.linked_existing_session) {
      const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
      if (profileError) throw profileError;
      state.profile = profile || state.profile;
      renderApp();
      toast('Telegram успешно привязан к аккаунту.');
      return;
    }
    if (!data?.token_hash) throw new Error('Сервер не вернул токен входа.');
    const { data: authData, error: authError } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: 'magiclink',
    });
    if (authError) throw authError;
    await boot(authData.session);
  } catch (error) {
    const target = document.querySelector('#auth-error');
    if (target) target.textContent = error.message || 'Не удалось войти через Telegram.';
    else toast(error.message || 'Не удалось привязать Telegram.');
  } finally {
    const current = document.querySelector(linkCurrent ? '[data-telegram-link]' : '#telegram-login');
    if (current) current.disabled = false;
  }
}

function renderAuth() {
  const inTelegram = Boolean(window.Telegram?.WebApp?.initData);
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-visual">
        <div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div>
        <div class="visual-copy"><div class="eyebrow"><i></i> YOUR DAILY CONNECTION</div><h1>Не дай<br/>огоньку <em>погаснуть.</em></h1><p>Общайтесь каждый день. Поддерживайте серию вместе. Создавайте историю, которая не прерывается.</p><div class="flame-orbit"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="flame">🔥</div><span class="orbit-label label-a">ONE MESSAGE A DAY</span><span class="orbit-label label-b">KEEP IT ALIVE</span></div></div>
        <div class="visual-footer">© 2026 FLAMEXBOT <span>MADE FOR YOUR PEOPLE</span></div>
      </section>
      <section class="auth-panel"><div class="mobile-brand brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><div class="auth-card">
        <div class="eyebrow">WELCOME TO FLAMEXBOT</div><h2>Вход через Telegram</h2><p class="muted">Без паролей и почты. Используй свой Telegram-аккаунт.</p>
        <button class="telegram-login full" id="telegram-login" ${inTelegram ? '' : 'disabled'}><span>✈</span> Продолжить через Telegram</button>
        <p class="auth-note">${inTelegram ? 'Подтверди вход, чтобы открыть своё пространство FLAMEXBOT.' : 'Открой FLAMEXBOT через кнопку Mini App в нашем Telegram-боте.'}</p>
        <div class="auth-error" id="auth-error"></div>
      </div><div class="panel-bottom">ТВОИ ЛЮДИ. ТВОЯ ИСТОРИЯ. ТВОЙ ОГОНЁК.</div></section>
    </main><div class="toast"></div>`;
  const telegramButton = document.querySelector('#telegram-login');
  telegramButton.addEventListener('click', () => telegramAuthFlow());
}

function navItem(page, icon, label) { return `<button class="nav-item ${state.page === page ? 'selected' : ''}" data-page="${page}"><span>${icon}</span>${label}</button>`; }
function renderApp() {
  const p = state.profile || {};
  app.innerHTML = `
    <div class="app-layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><div class="side-label">МЕНЮ</div><nav>${navItem('home','⌂','Главная')}${navItem('messages','◌','Business-чаты')}${navItem('friends','♧','Друзья')}${navItem('streaks','🔥','Огоньки')}${navItem('profile','◉','Профиль')}${navItem('achievements','🏆','Достижения')}${navItem('notifications','♧','Уведомления')}${navItem('stats','▥','Статистика')}${state.isAdmin ? navItem('admin','⚙','Админ-панель') : ''}</nav><div class="sidebar-bottom"><div class="user-mini">${avatar(p.avatar_url, p.username)}<div><b>${esc(p.username || 'Пользователь')}</b><small>Участник FLAMEXBOT</small></div></div><button class="logout" id="logout">↗ Выйти</button></div></aside>
    <main class="main-area"><header class="topbar"><div><span class="top-kicker">FLAMEXBOT /</span> <b>${({home:'Главная',messages:'Business-чаты',friends:'Друзья',streaks:'Огоньки',profile:'Профиль',admin:'Админ-панель',achievements:'Достижения',notifications:'Уведомления',stats:'Статистика'})[state.page]}</b></div><div class="top-right"><span class="status-dot"></span> На связи <span class="top-avatar">${avatar(p.avatar_url,p.username)}</span></div></header>
    <section class="page-content" id="page-content"></section></main></div><div class="toast"></div>`;
  document.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => {
    if (state.page === 'messages' && btn.dataset.page !== 'messages') {
      if (state.businessChatChannel) { supabase.removeChannel(state.businessChatChannel); state.businessChatChannel = null; }
      if (state.businessListChannel) { supabase.removeChannel(state.businessListChannel); state.businessListChannel = null; }
      state.activeBusinessChat = null;
    }
    state.page = btn.dataset.page; renderApp(); loadPage();
  }));
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
  else if (state.page === 'messages') await renderBusinessMessages(host);
  else if (state.page === 'streaks') await renderStreaks(host);
  else if (state.page === 'profile') await renderProfile(host);
  else if (state.page === 'achievements') await renderAchievements(host);
  else if (state.page === 'notifications') await renderNotifications(host);
  else if (state.page === 'stats') await renderStats(host);
  else if (state.page === 'admin') await renderAdmin(host);
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
    <div class="section-heading"><div><div class="eyebrow">YOUR PEOPLE</div><h3>Мои друзья</h3></div></div><div class="people-list">${state.friends.length ? state.friends.map(f => { const friendId = f.user_low === uid ? f.user_high : f.user_low; const person = profileById[friendId] || {}; return `<div class="person-row">${avatar(person.avatar_url,person.username)}<div class="person-info"><b>${esc(person.username || 'Друг')}</b><small>Ваш общий огонёк может начаться сегодня</small></div><span class="business-only-tag">Переписка через Business</span></div>`; }).join('') : '<div class="empty-state">Здесь появятся ваши друзья после принятия заявки.</div>'}</div>`;
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
}

function renderBusinessChatChoices(chats) {
  const q=(document.querySelector('#business-chat-search')?.value||'').trim().toLowerCase();
  const filtered=chats.filter(c=>!q||[c.username,c.first_name,c.last_name].filter(Boolean).join(' ').toLowerCase().includes(q))
    .sort((a,b)=>Number(Boolean(b.is_pinned))-Number(Boolean(a.is_pinned))||Number(Boolean(b.is_favorite))-Number(Boolean(a.is_favorite))||new Date(b.last_message_at)-new Date(a.last_message_at));
  return filtered.length ? filtered.map(c => {
    const name = [c.first_name,c.last_name].filter(Boolean).join(' ') || (c.username ? '@'+c.username : 'Telegram-пользователь');
    const active = state.activeBusinessChat === c.id;
    return `<div class="business-chat-item"><button class="chat-choice ${active ? 'active' : ''}" data-business-chat="${c.id}">${avatar(c.photo_url,name)}<span><b>${c.is_pinned?'📌 ':''}${c.is_favorite?'★ ':''}${esc(name)}</b><small>${c.username ? '@'+esc(c.username)+' · ' : ''}${c.unread_count?'Непрочитано: '+c.unread_count+' · ':''}${c.last_message_at ? new Date(c.last_message_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Новый чат'}</small></span></button><button class="chat-pref" data-favorite="${c.id}" title="Избранное">${c.is_favorite?'★':'☆'}</button><button class="chat-pref" data-pin="${c.id}" title="Закрепить">${c.is_pinned?'📌':'⌖'}</button></div>`;
  }).join('') : '<div class="empty-state">Чаты не найдены.</div>';
}

function bindBusinessChatPreferences(root) {
  root.querySelectorAll('[data-favorite],[data-pin]').forEach(btn=>btn.addEventListener('click',async e=>{
    e.stopPropagation();const id=btn.dataset.favorite||btn.dataset.pin;const chat=state.businessChats.find(x=>x.id===id);if(!chat)return;
    const field=btn.dataset.favorite?'is_favorite':'is_pinned';
    const {error}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,[field]:!chat[field]},{onConflict:'profile_id,business_chat_id'});
    if(error){toast('Не удалось сохранить настройку чата');return;}
    await refreshBusinessChatList(document.querySelector('#page-content'));
  }));
}

function bindBusinessSearch(host) {
  const input=host.querySelector('#business-chat-search');if(!input||input.dataset.bound)return;
  input.dataset.bound='1';input.addEventListener('input',()=>{const list=host.querySelector('.chat-list');list.innerHTML=renderBusinessChatChoices(state.businessChats);bindBusinessChatChoices(list);bindBusinessChatPreferences(list);});
}

function bindBusinessChatChoices(root) {
  root.querySelectorAll('[data-business-chat]').forEach(btn => btn.addEventListener('click', () => openBusinessChat(btn.dataset.businessChat)));
}

async function refreshBusinessChatList(host) {
  if (!host.querySelector('.business-inbox')) return;
  const { data, error } = await supabase.from('flamexbot_business_chats')
    .select('id,telegram_chat_id,telegram_user_id,username,first_name,last_name,photo_url,last_message_at,business_connection_id')
    .eq('profile_id', state.session.user.id).order('last_message_at', { ascending: false }).limit(100);
  if (error) { toast('Не удалось обновить список Business-чатов'); return; }
  const chats=data||[];const ids=chats.map(x=>x.id);
  const [prefs,recent]=ids.length?await Promise.all([
    supabase.from('flamexbot_business_chat_settings').select('business_chat_id,is_favorite,is_pinned,last_read_at').in('business_chat_id',ids),
    supabase.from('flamexbot_business_messages').select('business_chat_id,created_at').in('business_chat_id',ids).eq('direction','incoming').order('created_at',{ascending:false}).limit(300)
  ]):[{data:[]},{data:[]}];
  const prefMap=Object.fromEntries((prefs.data||[]).map(x=>[x.business_chat_id,x]));
  const unread={};(recent.data||[]).forEach(m=>{const p=prefMap[m.business_chat_id];if(!p?.last_read_at||new Date(m.created_at)>new Date(p.last_read_at))unread[m.business_chat_id]=(unread[m.business_chat_id]||0)+1;});
  state.businessChats=chats.map(x=>({...x,...(prefMap[x.id]||{}),unread_count:unread[x.id]||0}));
  const list = host.querySelector('.business-inbox .chat-list');
  if (!list) return;
  list.innerHTML = renderBusinessChatChoices(state.businessChats);
  bindBusinessChatChoices(list);bindBusinessChatPreferences(list);
}

async function renderBusinessMessages(host) {
  if (state.businessListChannel) {
    await supabase.removeChannel(state.businessListChannel);
    state.businessListChannel = null;
  }
  const uid = state.session.user.id;
  const { data: chats, error } = await supabase.from('flamexbot_business_chats')
    .select('id,telegram_chat_id,telegram_user_id,username,first_name,last_name,photo_url,last_message_at,business_connection_id')
    .eq('profile_id', uid).order('last_message_at', { ascending: false }).limit(100);
  if (error) {
    host.innerHTML = `<div class="page-heading"><div class="eyebrow">TELEGRAM BUSINESS</div><h1>Business-чаты</h1></div><div class="empty-state">${esc(error.message)}</div>`;
    return;
  }
  state.businessChats = chats || [];
  if(state.businessChats.length){
    const {data:prefs}=await supabase.from('flamexbot_business_chat_settings').select('business_chat_id,is_favorite,is_pinned,last_read_at').in('business_chat_id',state.businessChats.map(x=>x.id));
    const map=Object.fromEntries((prefs||[]).map(x=>[x.business_chat_id,x]));
    state.businessChats=state.businessChats.map(x=>({...x,...(map[x.id]||{}),unread_count:0}));
  }
  const { data: connection } = await supabase.from('flamexbot_business_connections')
    .select('is_enabled,rights').eq('profile_id', uid).maybeSingle();
  const connected = Boolean(connection?.is_enabled);
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">TELEGRAM BUSINESS INBOX</div><h1>Business-чаты</h1><p class="muted">Все переписки приходят из Telegram Business. Ответы отправляются от имени твоего Telegram-аккаунта.</p></div>
    <div class="business-inbox-status ${connected ? 'online' : ''}"><span></span><div><b>${connected ? 'Бизнес-бот подключён' : 'Бизнес-бот не подключён'}</b><small>${connected ? 'Входящие чаты синхронизируются через Telegram.' : 'Подключи FLAMEXBOT в Telegram → Настройки → Telegram Business → Чат-боты.'}</small></div></div>
    <div class="business-inbox-tools"><input id="business-chat-search" type="search" placeholder="Поиск по имени или @username"/><div class="quick-replies"><button type="button" data-quick-reply="Привет! Чем могу помочь?">Привет</button><button type="button" data-quick-reply="Спасибо за сообщение!">Спасибо</button><button type="button" data-quick-reply="Сейчас уточню и вернусь с ответом.">Уточню</button></div></div><div class="chat-layout business-inbox"><aside class="chat-list">${renderBusinessChatChoices(state.businessChats)}</aside>
    <section class="chat-window" id="business-chat-window"><div class="chat-placeholder"><span>✈</span><b>Твои Business-переписки</b><small>Выбери чат слева.</small></div></section></div>`;
  bindBusinessChatChoices(host);bindBusinessChatPreferences(host);bindBusinessSearch(host);
  host.querySelectorAll('[data-quick-reply]').forEach(btn=>btn.addEventListener('click',()=>{const input=document.querySelector('#business-send-form input[name=content]');if(input){input.value=btn.dataset.quickReply;input.focus();}}));
  state.businessListChannel = supabase.channel(`business-chat-list-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'flamexbot_business_chats', filter: `profile_id=eq.${uid}` }, () => refreshBusinessChatList(host))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Не удалось включить обновление списка чатов');
    });
}

function renderBusinessBubble(message) {
  const mine = message.direction === 'outbound';
  const content = message.deleted_at ? 'Сообщение удалено в Telegram' : (message.content || '');
  const media = message.message_type && message.message_type !== 'text'
    ? `<div class="business-media-note">Вложение: ${esc(message.message_type)}${message.media_file_id ? ' · файл получен от Telegram' : ''}</div>` : '';
  return `<div class="bubble ${mine ? 'mine' : ''}">${content ? `<div>${esc(content)}</div>` : ''}${media}<small>${new Date(message.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</small></div>`;
}

async function refreshBusinessMessages(chatId) {
  if (state.activeBusinessChat !== chatId) return;
  const list = document.querySelector('#business-message-list');
  if (!list) return;
  const { data, error } = await supabase.from('flamexbot_business_messages')
    .select('id,telegram_message_id,direction,content,message_type,media_file_id,created_at,deleted_at')
    .eq('business_chat_id', chatId).order('created_at', { ascending: true }).limit(100);
  if (state.activeBusinessChat !== chatId) return;
  if (error) { list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  state.businessMessages = data || [];
  list.innerHTML = state.businessMessages.map(renderBusinessBubble).join('') || '<div class="chat-placeholder"><b>Пока нет сообщений</b><small>Входящие сообщения появятся здесь автоматически.</small></div>';
  list.scrollTop = list.scrollHeight;
}

async function openBusinessChat(id) {
  state.activeBusinessChat = id;
  document.querySelectorAll('[data-business-chat]').forEach(btn => btn.classList.toggle('active', btn.dataset.businessChat === id));
  if (state.businessChatChannel) { await supabase.removeChannel(state.businessChatChannel); state.businessChatChannel = null; }
  const chat = state.businessChats.find(item => item.id === id);
  const box = document.querySelector('#business-chat-window');
  if (!box || !chat) return;
  const name = [chat.first_name,chat.last_name].filter(Boolean).join(' ') || (chat.username ? '@'+chat.username : 'Telegram-пользователь');
  await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,last_read_at:new Date().toISOString()},{onConflict:'profile_id,business_chat_id'});
  box.innerHTML = `<div class="chat-head"><b>${esc(name)}</b><small>${chat.username ? '@'+esc(chat.username)+' · ' : ''}Переписка через Telegram Business</small></div><div class="message-list" id="business-message-list"><div class="empty-state">Загружаю сообщения…</div></div><form class="send-form" id="business-send-form"><input name="content" placeholder="Ответить от имени бизнес-аккаунта…" maxlength="4096" required/><button class="primary" type="submit">➤</button></form><div class="upload-hint">Ответ будет отправлен через подключённый Telegram Business-бот.</div>`;
  await refreshBusinessMessages(id);
  state.businessChatChannel = supabase.channel(`business-chat-${id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'flamexbot_business_messages',filter:`business_chat_id=eq.${id}`},() => refreshBusinessMessages(id))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') refreshBusinessMessages(id);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Потеряно обновление переписки в реальном времени');
    });
  document.querySelector('#business-send-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const input = form.querySelector('input[name=content]');
    const text = input.value.trim();
    if (!text) return;
    button.disabled = true;
    const { data, error } = await supabase.functions.invoke('business-chat-send', { body: { chat_id: id, text } });
    button.disabled = false;
    if (error || data?.error) { toast(data?.error || error.message || 'Не удалось отправить сообщение'); return; }
    form.reset();
    await refreshBusinessMessages(id);
  });
}

async function renderAdmin(host) {
  const { data: allowed, error: accessError } = await supabase.rpc('is_flamexbot_admin');
  if (accessError || allowed !== true || !state.isAdmin) {
    host.innerHTML = '<div class="page-heading"><div class="eyebrow">ACCESS DENIED</div><h1>Нет доступа</h1><p class="muted">Админ-панель доступна только владельцу @Racer_Video.</p></div>';
    return;
  }
  const [connections, chats, messages] = await Promise.all([
    supabase.from('flamexbot_business_connections').select('is_enabled,connected_at,rights').eq('profile_id',state.session.user.id).maybeSingle(),
    supabase.from('flamexbot_business_chats').select('id',{count:'exact',head:true}).eq('profile_id',state.session.user.id),
    supabase.from('flamexbot_business_messages').select('id',{count:'exact',head:true})
  ]);
  const connection = connections.data;
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">FOUNDER CONTROL</div><h1>Админ-панель</h1><p class="muted">Закрытая панель владельца FLAMEXBOT.</p></div>
    <div class="admin-owner-card"><span class="admin-crown">✦</span><div><b>@Racer_Video</b><small>Единственный администратор · Founder</small></div><span class="business-status is-connected">Доступ подтверждён</span></div>
    <div class="stats-grid"><div class="stat-card"><small>BUSINESS BOT</small><strong>${connection?.is_enabled ? 'ON' : 'OFF'}</strong><span class="stat-foot">Подключение Telegram</span></div><div class="stat-card"><small>BUSINESS-ЧАТЫ</small><strong>${chats.count || 0}</strong><span class="stat-foot">Полученные переписки</span></div><div class="stat-card"><small>СООБЩЕНИЯ</small><strong>${messages.count || 0}</strong><span class="stat-foot">Сохранённые сообщения</span></div></div>
    <section class="business-card"><div class="business-card-head"><div><div class="eyebrow">SECURITY</div><h2>Права доступа</h2><p class="muted">Обычные личные чаты отключены. В приложении используются только переписки Telegram Business.</p></div><span class="business-status is-connected">Founder only</span></div></section>`;
}

async function renderStreaks(host) {
  const { data, error } = await supabase.from('streaks').select('*').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).order('current_days',{ascending:false});
  state.streaks = data || [];
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">DON'T BREAK THE CHAIN</div><h1>Огоньки 🔥</h1><p class="muted">Серия сохраняется, когда оба человека отправили сообщение за день.</p></div><div class="streak-list large">${error ? esc(error.message) : state.streaks.length ? state.streaks.map(s => `<div class="streak-card"><div class="streak-symbol">🔥</div><div><div class="eyebrow">ОБЩАЯ СЕРИЯ</div><h3>${s.current_days || 0} дней</h3><p class="muted">Лучшая серия: ${s.best_days || 0} дней</p></div></div>`).join('') : '<div class="empty-state">У тебя пока нет активных серий. Найди друга и начните переписываться каждый день!</div>'}</div>`;
}

async function renderProfile(host) {
  const p = state.profile || {};
  const { data: businessConnection, error: businessError } = await supabase
    .from('flamexbot_business_connections').select('is_enabled,rights,connected_at,updated_at')
    .eq('profile_id', state.session.user.id).maybeSingle();
  state.businessConnection = businessConnection || null;
  const businessConnected = Boolean(businessConnection?.is_enabled);
  const rights = businessConnection?.rights || {};
  const grantedRights = Object.entries(rights).filter(([, value]) => value === true).map(([key]) => key);
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">YOUR IDENTITY</div><h1>Профиль</h1><p class="muted">Настрой свой профиль FLAMEXBOT.</p></div>
    <form class="profile-card" id="profile-form">${avatar(p.avatar_url,p.username,'avatar-xl')}
      <label>Никнейм<input name="username" value="${esc(p.username || '')}" placeholder="Твой никнейм" maxlength="32" required/></label>
      <label>Ссылка на аватар<input name="avatar_url" type="url" value="${esc(p.avatar_url || '')}" placeholder="https://…"/></label>
      <div class="profile-id">ID аккаунта <code>${esc(state.session.user.id)}</code></div>
      <div class="telegram-profile"><div><b>Telegram</b><small>${p.telegram_id ? (p.telegram_username ? '@' + esc(p.telegram_username) : 'Аккаунт привязан') : 'Не привязан'}</small></div><button class="outline small" type="button" data-telegram-link>${p.telegram_id ? 'Обновить связь' : 'Привязать Telegram'}</button></div>
      <button class="primary">Сохранить изменения <b>→</b></button>
    </form>
    <section class="business-card">
      <div class="business-card-head"><div><div class="eyebrow">TELEGRAM INTEGRATION</div><h2>Telegram Business</h2><p class="muted">Подключи бизнес-аккаунт, чтобы FLAMEXBOT мог работать с разрешёнными тобой чатами.</p></div><span class="business-status ${businessConnected ? 'is-connected' : ''}">${businessConnected ? 'Подключено' : 'Не подключено'}</span></div>
      <div class="business-steps">
        <div><b>1.</b><span>Открой <strong>@BotFather</strong> и включи Business Mode для бота FLAMEXBOT.</span></div>
        <div><b>2.</b><span>В Telegram открой <strong>Настройки → Telegram Business → Чат-боты</strong>.</span></div>
        <div><b>3.</b><span>Добавь бота FLAMEXBOT и самостоятельно выбери, к каким чатам и сообщениям разрешить доступ.</span></div>
      </div>
      <div class="business-connection-info">
        ${businessConnected ? `<b>Бизнес-аккаунт связан</b><small>Подключено: ${businessConnection.connected_at ? new Date(businessConnection.connected_at).toLocaleString('ru-RU') : 'дата не указана'}</small><small>Выдано разрешений: ${grantedRights.length}</small>` : '<b>Ожидаем подключения</b><small>После подтверждения подключения Telegram статус появится здесь автоматически.</small>'}
      </div>
      ${businessError ? '<p class="business-warning">Не удалось получить статус. Проверь подключение и обнови страницу.</p>' : ''}
      <button class="outline small" type="button" id="refresh-business">↻ Проверить подключение</button>
      <p class="business-note">FLAMEXBOT не может включить Business Mode или выдать себе права вместо тебя. Управляй разрешениями и отключением в настройках Telegram.</p>
    </section>`;
  document.querySelector('[data-telegram-link]').addEventListener('click', () => telegramAuthFlow({ linkCurrent: true }));
  document.querySelector('#refresh-business').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    const { data, error } = await supabase.from('flamexbot_business_connections')
      .select('is_enabled,rights,connected_at,updated_at').eq('profile_id', state.session.user.id).maybeSingle();
    state.businessConnection = data || null;
    if (error) toast('Не удалось обновить статус');
    else { toast(data?.is_enabled ? 'Telegram Business подключён' : 'Подключение пока не найдено'); renderProfile(host); }
    e.currentTarget.disabled = false;
  });
  document.querySelector('#profile-form').addEventListener('submit', async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from('profiles').update({username:fd.get('username'),avatar_url:fd.get('avatar_url') || null}).eq('id',state.session.user.id);
    if (error) toast(error.message); else { state.profile = {...p,username:fd.get('username'),avatar_url:fd.get('avatar_url')}; toast('Профиль сохранён'); renderApp(); }
  });
}


async function renderAchievements(host) {
  const uid=state.session.user.id;
  const [all,earned]=await Promise.all([
    supabase.from('achievements').select('id,code,title,description,icon,points').order('points'),
    supabase.from('user_achievements').select('achievement_id,earned_at').eq('user_id',uid)
  ]);
  const got=new Map((earned.data||[]).map(x=>[x.achievement_id,x]));
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">YOUR COLLECTION</div><h1>Достижения 🏆</h1><p class="muted">Коллекция наград FLAMEXBOT.</p></div><div class="achievement-grid">${(all.data||[]).map(a=>{const e=got.get(a.id);return `<article class="achievement-card ${e?'earned':'locked'}"><div class="achievement-icon">${esc(a.icon||'✦')}</div><div><b>${esc(a.title)}</b><p>${esc(a.description||'')}</p><small>${e?'Получено '+new Date(e.earned_at).toLocaleDateString('ru-RU'):'Пока не получено'} · ${a.points} XP</small></div></article>`;}).join('')||'<div class="empty-state">Каталог достижений пока пуст.</div>'}</div>${all.error||earned.error?'<p class="business-warning">Не удалось полностью загрузить коллекцию.</p>':''}`;
}
async function renderNotifications(host) {
  const uid=state.session.user.id;
  const {data,error}=await supabase.from('notifications').select('id,type,title,body,data,created_at,read_at').eq('user_id',uid).order('created_at',{ascending:false}).limit(50);
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ACTIVITY CENTER</div><h1>Уведомления</h1><p class="muted">События, заявки и важные обновления аккаунта.</p></div><div class="notification-list">${(data||[]).map(n=>`<button class="notification-item ${n.read_at?'read':'unread'}" data-notification="${n.id}"><span class="notification-mark">${n.read_at?'✓':'•'}</span><span><b>${esc(n.title)}</b><small>${esc(n.body||'')}</small><time>${new Date(n.created_at).toLocaleString('ru-RU')}</time></span></button>`).join('')||'<div class="empty-state">Новых уведомлений пока нет.</div>'}</div>${error?'<p class="business-warning">Не удалось загрузить уведомления.</p>':''}`;
  host.querySelectorAll('[data-notification]').forEach(btn=>btn.addEventListener('click',async()=>{
    const {error:updateError}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',btn.dataset.notification).eq('user_id',uid);
    if(updateError)toast('Не удалось отметить уведомление');else{btn.classList.remove('unread');btn.classList.add('read');btn.querySelector('.notification-mark').textContent='✓';}
  }));
}
async function renderStats(host) {
  const uid=state.session.user.id;
  const [friends,streaks,chats,messages,earned,profile]=await Promise.all([
    supabase.from('friendships').select('*',{count:'exact',head:true}).or(`user_low.eq.${uid},user_high.eq.${uid}`),
    supabase.from('streaks').select('current_days,best_days').or(`user_low.eq.${uid},user_high.eq.${uid}`),
    supabase.from('flamexbot_business_chats').select('id',{count:'exact',head:true}).eq('profile_id',uid),
    supabase.from('flamexbot_business_messages').select('id',{count:'exact',head:true}),
    supabase.from('user_achievements').select('achievement_id',{count:'exact',head:true}).eq('user_id',uid),
    supabase.from('profiles').select('created_at,telegram_id').eq('id',uid).maybeSingle()
  ]);
  const best=Math.max(0,...(streaks.data||[]).map(s=>s.best_days||0));
  const current=Math.max(0,...(streaks.data||[]).map(s=>s.current_days||0));
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">YOUR FLAME REPORT</div><h1>Статистика</h1><p class="muted">Твоя история активности в FLAMEXBOT.</p></div><div class="stats-grid"><div class="stat-card"><small>ДРУЗЬЯ</small><strong>${friends.count||0}</strong></div><div class="stat-card"><small>BUSINESS-ЧАТЫ</small><strong>${chats.count||0}</strong></div><div class="stat-card"><small>СООБЩЕНИЯ</small><strong>${messages.count||0}</strong></div><div class="stat-card"><small>ТЕКУЩАЯ СЕРИЯ</small><strong>${current} дн.</strong></div><div class="stat-card"><small>ЛУЧШАЯ СЕРИЯ</small><strong>${best} дн.</strong></div><div class="stat-card"><small>ДОСТИЖЕНИЯ</small><strong>${earned.count||0}</strong></div></div><section class="business-card"><div class="eyebrow">FLAMEX ID</div><h2>${esc(uid.slice(0,8).toUpperCase())}</h2><p class="muted">Уникальный идентификатор твоего пространства FLAMEXBOT.</p><small>В приложении с ${profile.data?.created_at?new Date(profile.data.created_at).toLocaleDateString('ru-RU'):'—'} · Telegram ${profile.data?.telegram_id?'привязан':'не привязан'}</small></section>`;
}

async function boot(session) {
  state.session = session;
  if (!session) { renderAuth(); return; }
  const { data, error } = await supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle();
  state.profile = data || {username:session.user.email?.split('@')[0] || 'Flame user'};
  if (error) console.warn('Profile load:', error.message);
  const { data: adminAccess, error: adminError } = await supabase.rpc('is_flamexbot_admin');
  state.isAdmin = !adminError && adminAccess === true;
  renderApp();
}

if (!supabase) {
  app.innerHTML = `<main class="config-screen"><div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><h1>Почти готово.</h1><p>Добавь переменные окружения Supabase в настройках Cloudflare Pages:</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><p class="muted">Используй publishable key проекта FLAMEXBOT. Никогда не добавляй service_role key во фронтенд.</p></main>`;
} else {
  supabase.auth.getSession().then(({data}) => boot(data.session));
  supabase.auth.onAuthStateChange((_event, session) => { if (session !== state.session) boot(session); });
}
