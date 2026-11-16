import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FOUNDER_TELEGRAM_ID = '7781170049';
const supabase = SUPABASE_URL && SUPABASE_KEY && !SUPABASE_KEY.startsWith('YOUR_')
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const state = { session: null, profile: null, subscription: null, businessConnection: null, businessRights: null, isAdmin: false, page: 'home', busy: false, streaks: [], businessChats: [], activeBusinessChat: null, businessMessages: [], businessChatChannel: null, businessListChannel: null, presenceChannel: null, onlineUserIds: [], notificationChannel: null, notificationCount: 0 };
const app = document.querySelector('#app');
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = name => (name || 'F').trim().slice(0, 1).toUpperCase();
const toast = message => { const el = document.querySelector('.toast'); if (!el) return; el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); };
const applyTheme = theme => { document.documentElement.dataset.theme = ['orange','blue','green','red','violet'].includes(theme) ? theme : 'orange'; };
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
        <div class="visual-copy"><div class="eyebrow"><i></i> ТВОИ ЛЮДИ — ТВОЯ СВЯЗЬ</div><h1>Не дай<br/>огоньку <em>погаснуть.</em></h1><p>Общайтесь каждый день. Поддерживайте серию вместе. Создавайте историю, которая не прерывается.</p><div class="flame-orbit"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="flame">🔥</div><span class="orbit-label label-a">ОДНО СООБЩЕНИЕ В ДЕНЬ</span><span class="orbit-label label-b">ПОДДЕРЖИВАЙ ОГОНЁК</span></div></div>
        <div class="visual-footer">© 2026 FLAMEXBOT <span>СОЗДАНО ДЛЯ ОБЩЕНИЯ</span></div>
      </section>
      <section class="auth-panel"><div class="mobile-brand brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><div class="auth-card">
        <div class="eyebrow">ТВОЁ ПРОСТРАНСТВО НАЧИНАЕТСЯ ЗДЕСЬ</div><h2>Войти через Telegram</h2><p class="muted">Один быстрый вход — и все твои переписки, огоньки и настройки будут под рукой.</p>
        <button class="telegram-login full" id="telegram-login" ${inTelegram ? '' : 'disabled'}><span>✈</span> Продолжить через Telegram</button>
        <p class="auth-note">${inTelegram ? 'Подтверди вход, чтобы открыть своё пространство FLAMEXBOT.' : 'Открой FLAMEXBOT через кнопку Mini App в нашем Telegram-боте.'}</p>
        <div class="auth-error" id="auth-error"></div>
      </div><div class="panel-bottom">ТВОИ ЛЮДИ. ТВОЯ ИСТОРИЯ. ТВОЙ ОГОНЁК.</div></section>
    </main><div class="toast"></div>`;
  const telegramButton = document.querySelector('#telegram-login');
  telegramButton.addEventListener('click', () => telegramAuthFlow());
}

function navItem(page, icon, label) { return `<button class="nav-item ${state.page === page ? 'selected' : ''}" data-page="${page}"><span>${icon}</span>${label}</button>`; }
function isPremium() { return state.subscription?.plan === 'premium' && (!state.subscription.expires_at || new Date(state.subscription.expires_at).getTime() > Date.now()); }
function planLabel() { return isPremium() ? 'PREMIUM' : 'FREE'; }
function renderApp() {
  const p = state.profile || {}; const profileAvatar = p.avatar_url || p.telegram_photo_url;
  app.innerHTML = `
    <div class="app-layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><div class="side-label">МЕНЮ</div><nav>${navItem('home','⌂','Обзор')}${navItem('messages','◌','Переписки')}${navItem('tariffs','✦','Premium')}${navItem('streaks','🔥','Огоньки')}${navItem('missions','⚡','Задания')}${navItem('profile','◉','Профиль')}${navItem('achievements','🏆','Награды')}${`<button class="nav-item ${state.page === 'notifications' ? 'selected' : ''}" data-page="notifications"><span>♧</span>Уведомления${state.notificationCount ? `<i class="nav-unread-count">${state.notificationCount > 99 ? '99+' : state.notificationCount}</i>` : ''}</button>`}${navItem('stats','▥','Статистика')}${state.isAdmin ? navItem('admin','⚙','Админ-панель') : ''}</nav><div class="sidebar-bottom"><div class="user-mini">${avatar(profileAvatar, p.username)}<div><b>${esc(p.username || 'Пользователь')}</b><small>Участник FLAMEXBOT</small></div></div><button class="logout" id="logout">↗ Выйти</button></div></aside>
    <main class="main-area"><header class="topbar"><div><span class="top-kicker">FLAMEXBOT /</span> <b>${({home:'Обзор',messages:'Переписки',tariffs:'Premium',streaks:'Огоньки',missions:'Задания',profile:'Профиль',admin:'Админ-панель',achievements:'Достижения',notifications:'Уведомления',stats:'Статистика'})[state.page]}</b></div><div class="top-right"><span class="status-dot"></span> На связи <span class="top-avatar">${avatar(profileAvatar,p.username)}</span></div></header>
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
    const [streaks, unread] = await Promise.all([
      supabase.from('streaks').select('*').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).order('current_days',{ascending:false}).limit(5),
      supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',state.session.user.id).is('read_at',null)
    ]);
    state.streaks = streaks.data || [];
    host.innerHTML = `<div class="welcome-row"><div><div class="eyebrow">ТВОЙ FLAMEXBOT</div><h1>С возвращением, ${esc(p.username || 'друг')} <span>✦</span></h1><p class="muted">Твои переписки, общие огоньки и важные события — в одном месте.</p></div><div class="date-chip">${new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'})}</div></div>
      <div class="hero-card"><div class="hero-copy"><div class="eyebrow">НЕ ДАЙ ОГОНЬКУ ПОГАСНУТЬ</div><h2>Один день.<br/><em>Одно сообщение.</em></h2><p>Поддерживай связь с близкими, возвращайся к важным диалогам и не давай общим огонькам гаснуть.</p><button class="primary" data-go="messages">Перейти к перепискам <b>→</b></button></div><div class="hero-fire">🔥<span class="fire-glow"></span></div><div class="hero-watermark">FLAME</div></div>
      <div class="stats-grid"><div class="stat-card"><span class="stat-icon">✦</span><small>ТАРИФ</small><strong>${planLabel()}</strong><span class="stat-foot">Твои возможности</span></div><div class="stat-card"><span class="stat-icon">🔥</span><small>АКТИВНЫЕ ОГОНЬКИ</small><strong>${state.streaks.length}</strong><span class="stat-foot">Общие серии</span></div><div class="stat-card"><span class="stat-icon">✉</span><small>УВЕДОМЛЕНИЯ</small><strong>${unread.count || 0}</strong><span class="stat-foot">Непрочитанные</span></div></div>
      <div class="section-heading"><div><div class="eyebrow">ТВОИ СВЯЗИ</div><h3>Твои огоньки</h3></div><button class="text-button" data-go="streaks">Все огоньки →</button></div>
      <div class="streak-list">${state.streaks.length ? state.streaks.map(s => `<div class="streak-row"><span class="streak-symbol">🔥</span><div class="streak-info"><b>Общий огонёк</b><small>Серия продолжается</small></div><strong>${s.current_days || 0} <small>дн.</small></strong></div>`).join('') : '<div class="empty-state">Здесь появятся ваши общие серии. Начни с ежедневного сообщения в Telegram Business.</div>'}</div>`;
  } else if (state.page === 'tariffs') await renderTariffs(host);
  else if (state.page === 'messages') await renderBusinessMessages(host);
  else if (state.page === 'streaks') await renderStreaks(host);
  else if (state.page === 'missions') await renderDailyMissions(host);
  else if (state.page === 'profile') await renderProfile(host);
  else if (state.page === 'achievements') await renderAchievements(host);
  else if (state.page === 'notifications') await renderNotifications(host);
  else if (state.page === 'stats') await renderStats(host);
  else if (state.page === 'admin') await renderAdmin(host);
  host.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => { state.page = btn.dataset.go; renderApp(); }));
}

function renderBusinessChatChoices(chats) {
  const q=(document.querySelector('#business-chat-search')?.value||'').trim().toLowerCase();
  const filtered=chats.filter(c=>!q||[c.username,c.first_name,c.last_name].filter(Boolean).join(' ').toLowerCase().includes(q))
    .sort((a,b)=>Number(Boolean(b.is_pinned))-Number(Boolean(a.is_pinned))||Number(Boolean(b.is_favorite))-Number(Boolean(a.is_favorite))||new Date(b.last_message_at)-new Date(a.last_message_at));
  return filtered.length ? filtered.map(c => {
    const name = [c.first_name,c.last_name].filter(Boolean).join(' ') || (c.username ? '@'+c.username : 'Telegram-пользователь');
    const active = state.activeBusinessChat === c.id;
    return `<div class="business-chat-item"><button class="chat-choice ${active ? 'active' : ''}" data-business-chat="${c.id}">${avatar(c.photo_url,name)}<span class="chat-choice-copy"><b>${c.is_pinned?'📌 ':''}${c.is_favorite?'★ ':''}${c.is_muted?'🔕 ':''}${c.antimut_enabled?'🛡 ':''}${String(c.telegram_chat_id)===FOUNDER_TELEGRAM_ID?'👑 ':''}${esc(name)}</b><small>${c.username ? '@'+esc(c.username)+' · ' : ''}${c.last_message_at ? new Date(c.last_message_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Новый чат'}</small></span>${c.unread_count?'<i class="chat-unread-badge">'+(c.unread_count>99?'99+':c.unread_count)+'</i>':''}</button><button class="chat-pref" data-favorite="${c.id}" title="Избранное">${c.is_favorite?'★':'☆'}</button><button class="chat-pref" data-pin="${c.id}" title="Закрепить">${c.is_pinned?'📌':'⌖'}</button></div>`;
  }).join('') : '<div class="empty-state">Чаты не найдены.</div>';
}

function bindBusinessChatPreferences(root) {
  root.querySelectorAll('[data-favorite],[data-pin]').forEach(btn=>btn.addEventListener('click',async e=>{
    e.stopPropagation();const id=btn.dataset.favorite||btn.dataset.pin;const chat=state.businessChats.find(x=>x.id===id);if(!chat)return;
    const field=btn.dataset.favorite?'is_favorite':'is_pinned';
    const {error}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,is_favorite:field==='is_favorite'?!chat.is_favorite:Boolean(chat.is_favorite),is_pinned:field==='is_pinned'?!chat.is_pinned:Boolean(chat.is_pinned),last_read_at:chat.last_read_at||null},{onConflict:'profile_id,business_chat_id'});
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
  if (error) { toast('Не удалось обновить список переписок'); return; }
  const chats=data||[];const ids=chats.map(x=>x.id);
  const [prefs,unreadResult]=ids.length?await Promise.all([
    supabase.from('flamexbot_business_chat_settings').select('business_chat_id,is_favorite,is_pinned,is_muted,antimut_enabled,last_read_at').in('business_chat_id',ids),
    supabase.rpc('flamexbot_business_unread_counts')
  ]):[{data:[]},{data:[]}];
  const prefMap=Object.fromEntries((prefs.data||[]).map(x=>[x.business_chat_id,x]));
  const unread=Object.fromEntries((unreadResult.data||[]).map(x=>[x.business_chat_id,Number(x.unread_count)||0]));
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
    host.innerHTML = `<div class="page-heading"><div class="eyebrow">TELEGRAM BUSINESS</div><h1>Переписки</h1></div><div class="empty-state">${esc(error.message)}</div>`;
    return;
  }
  state.businessChats = chats || [];
  if(state.businessChats.length){
    const {data:prefs}=await supabase.from('flamexbot_business_chat_settings').select('business_chat_id,is_favorite,is_pinned,is_muted,antimut_enabled,last_read_at').in('business_chat_id',state.businessChats.map(x=>x.id));
    const map=Object.fromEntries((prefs||[]).map(x=>[x.business_chat_id,x]));
    state.businessChats=state.businessChats.map(x=>({...x,...(map[x.id]||{}),unread_count:0}));
  }
  const { data: connection } = await supabase.from('flamexbot_business_connections')
    .select('is_enabled,rights').eq('profile_id', uid).maybeSingle();
  const connected = Boolean(connection?.is_enabled);
  state.businessRights = connection?.rights || {};
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">ПЕРЕПИСКИ TELEGRAM BUSINESS</div><h1>Переписки</h1><p class="muted">Все диалоги синхронизируются через Telegram Business. Сообщения отправляются от имени подключённого аккаунта — только в пределах выданных Telegram разрешений.</p></div>
    <div class="business-inbox-status ${connected ? 'online' : ''}"><span></span><div><b>${connected ? 'Telegram Business подключён' : 'Telegram Business не подключён'}</b><small>${connected ? 'Список диалогов обновляется автоматически.' : 'Подключи FLAMEXBOT в Telegram → Настройки → Telegram Business → Чат-боты.'}</small></div></div>
    <div class="business-inbox-tools"><input id="business-chat-search" type="search" placeholder="Найти диалог по имени"/><div class="quick-replies"><button type="button" data-quick-reply="Привет! Чем могу помочь?">Привет</button><button type="button" data-quick-reply="Спасибо за сообщение!">Спасибо</button><button type="button" data-quick-reply="Сейчас уточню и вернусь с ответом.">Уточню</button></div></div><div class="chat-layout business-inbox"><aside class="chat-list">${renderBusinessChatChoices(state.businessChats)}</aside>
    <section class="chat-window" id="business-chat-window"><div class="chat-placeholder"><span>✈</span><b>Твои переписки</b><small>Выбери диалог, чтобы открыть историю сообщений и настройки.</small></div></section></div>`;
  bindBusinessChatChoices(host);bindBusinessChatPreferences(host);bindBusinessSearch(host);
  host.querySelectorAll('[data-quick-reply]').forEach(btn=>btn.addEventListener('click',()=>{const input=document.querySelector('#business-send-form input[name=content]');if(input){input.value=btn.dataset.quickReply;input.focus();}}));
  state.businessListChannel = supabase.channel(`business-chat-list-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'flamexbot_business_chats', filter: `profile_id=eq.${uid}` }, () => refreshBusinessChatList(host))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Не удалось подключить обновление переписок');
    });
  await refreshBusinessChatList(host);
}

function renderBusinessBubble(message, mediaUrl = '') {
  const mine = message.direction === 'outbound';
  const content = message.deleted_at ? 'Сообщение удалено в Telegram' : (message.content || '');
  const raw = message.raw || {};
  const mediaName = raw.document?.file_name || raw.audio?.file_name || raw.video?.file_name || 'Вложение';
  const mediaSize = [raw.document?.file_size,raw.audio?.file_size,raw.video?.file_size].find(Boolean);
  const mediaSizeLabel = mediaSize ? ' · '+(mediaSize/1024/1024).toFixed(1)+' МБ' : '';
  const mediaType = message.message_type || 'text';
  let media = '';
  if (mediaType !== 'text' && !message.deleted_at) {
    if (mediaUrl && mediaType === 'photo') media = `<a class="business-media-preview" href="${esc(mediaUrl)}" target="_blank" rel="noopener"><img src="${esc(mediaUrl)}" loading="lazy" alt="Фото"/></a>`;
    else if (mediaUrl && ['animation','sticker'].includes(mediaType)) media = `<a class="business-media-preview business-animation-preview" href="${esc(mediaUrl)}" target="_blank" rel="noopener"><img src="${esc(mediaUrl)}" loading="lazy" alt="${mediaType==='sticker'?'Стикер':'GIF-анимация'}"/></a>`;
    else if (mediaUrl && ['video','video_note'].includes(mediaType)) media = `<video class="business-video-preview" controls playsinline preload="metadata" src="${esc(mediaUrl)}"></video>`;
    else if (mediaUrl && ['audio','voice'].includes(mediaType)) media = `<div class="business-audio-card"><span>${mediaType==='voice'?'🎙 Голосовое сообщение':'🎵 Аудио'}</span><audio class="business-audio-preview" controls preload="metadata" src="${esc(mediaUrl)}"></audio></div>`;
    else if (mediaUrl) media = `<a class="business-file-link" href="${esc(mediaUrl)}" target="_blank" rel="noopener" download="${esc(mediaName)}"><span>📎</span><span><b>${esc(mediaName)}</b><small>${esc(mediaType.toUpperCase())}${mediaSizeLabel}</small></span><span>↓</span></a>`;
    else media = `<div class="business-media-note">Вложение: ${esc(mediaType)}${message.media_file_id ? ' · получено от Telegram' : ''}</div>`;
  }
  const reply = message.reply_to_message_id ? `<div class="reply-reference">↪ Ответ на сообщение #${message.reply_to_message_id}</div>` : '';
  const replyButton = !message.deleted_at && message.telegram_message_id ? `<button type="button" class="reply-message" data-reply-to="${message.telegram_message_id}">Ответить</button>` : '';
  return `<div class="bubble ${mine ? 'mine' : ''}">${reply}${content ? `<div>${esc(content)}</div>` : ''}${media}<div class="bubble-footer"><small>${new Date(message.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</small>${replyButton}</div></div>`;
}

async function refreshBusinessMessages(chatId) {
  if (state.activeBusinessChat !== chatId) return;
  const list = document.querySelector('#business-message-list');
  if (!list) return;
  const { data, error } = await supabase.from('flamexbot_business_messages')
    .select('id,telegram_message_id,direction,content,message_type,media_file_id,media_url,reply_to_message_id,created_at,deleted_at,raw')
    .eq('business_chat_id', chatId).order('created_at', { ascending: true }).limit(300);
  if (state.activeBusinessChat !== chatId) return;
  if (error) { list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  state.businessMessages = data || [];
  const latestInbound=state.businessMessages.filter(m=>m.direction==='inbound').reduce((latest,m)=>!latest||new Date(m.created_at)>new Date(latest)?m.created_at:latest,null);
  const openChat=state.businessChats.find(chat=>chat.id===chatId);
  if(!document.hidden&&latestInbound&&(!openChat?.last_read_at||new Date(latestInbound)>new Date(openChat.last_read_at))){
    const readAt=new Date().toISOString();
    const {error:readError}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:chatId,last_read_at:readAt},{onConflict:'profile_id,business_chat_id'});
    if(!readError){if(openChat){openChat.last_read_at=readAt;openChat.unread_count=0;}const inbox=document.querySelector('#page-content');if(inbox?.querySelector('.business-inbox'))await refreshBusinessChatList(inbox);}
  }
  const query=(document.querySelector('#business-message-search')?.value||'').trim().toLowerCase();
  const visible=state.businessMessages.filter(m=>{
    if(!query)return true;
    const raw=m.raw||{};
    const fileName=raw.document?.file_name||raw.audio?.file_name||raw.video?.file_name||raw.animation?.file_name||'';
    return [m.content,fileName,m.message_type].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  const mediaUrls = {};
  await Promise.all(visible.filter(m=>m.media_url).map(async m=>{
    const {data}=await supabase.storage.from('flamex-business-media').createSignedUrl(m.media_url,3600);
    if(data?.signedUrl) mediaUrls[m.id]=data.signedUrl;
  }));
  list.innerHTML = visible.map(m=>renderBusinessBubble(m,mediaUrls[m.id]||'')).join('') || '<div class="chat-placeholder"><b>Сообщений не найдено</b><small>Измени поисковый запрос.</small></div>';
  list.querySelectorAll('[data-reply-to]').forEach(btn=>btn.addEventListener('click',()=>{
    const form=document.querySelector('#business-send-form');
    const preview=document.querySelector('#business-reply-preview');
    if(!form||!preview)return;
    form.querySelector('[name=reply_to_message_id]').value=btn.dataset.replyTo;
    preview.hidden=false;
    preview.querySelector('span').textContent='Ответ на сообщение #'+btn.dataset.replyTo;
    form.querySelector('input[name=content]').focus();
  }));
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
  const founderChat = String(chat.telegram_chat_id) === FOUNDER_TELEGRAM_ID || String(chat.telegram_user_id || '') === FOUNDER_TELEGRAM_ID;
  let chatMuted = Boolean(chat.is_muted) && !founderChat;
  let antimutEnabled = Boolean(chat.antimut_enabled) && !founderChat;
  const canDeleteMessages = state.businessRights?.can_delete_all_messages === true;
  const canReplyMessages = state.businessRights?.can_reply === true;
  const premiumAccess = isPremium();
  await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,is_favorite:Boolean(chat.is_favorite),is_pinned:Boolean(chat.is_pinned),last_read_at:new Date().toISOString()},{onConflict:'profile_id,business_chat_id'});
  await refreshBusinessChatList(document.querySelector('#page-content'));
  box.closest('.business-inbox')?.classList.add('chat-open');
  box.innerHTML = `<div class="chat-head"><button type="button" class="chat-back" id="business-chat-back">← Все чаты</button><div><b>${esc(name)}</b><small>${founderChat ? 'Защищённый диалог владельца' : 'Управление командами доступно прямо в этой переписке'}${chat.username ? ' · @'+esc(chat.username) : ''}</small></div><input class="message-search" id="business-message-search" type="search" placeholder="Поиск по переписке…"/></div><div id="business-chat-controls"></div><div class="message-list" id="business-message-list"><div class="empty-state">Загружаю сообщения…</div></div><div class="reply-preview" id="business-reply-preview" hidden><span></span><button type="button" id="cancel-business-reply" aria-label="Отменить ответ">×</button></div><form class="send-form" id="business-send-form"><label class="attach-file-button" for="business-media-input" title="Прикрепить файл">＋</label><input id="business-media-input" class="business-media-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,application/pdf,text/plain,text/csv,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/rtf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" /><input name="content" placeholder="Сообщение или подпись к файлу…" maxlength="4096"/><input type="hidden" name="reply_to_message_id"/><button class="primary" type="submit">➤</button></form><div class="selected-media" id="selected-business-media" hidden></div><div class="upload-hint">Фото, видео, аудио и документы до 20 МБ · отправка через Telegram Business.</div>`;
  const controlsHost = box.querySelector('#business-chat-controls');
  const renderBusinessControls = () => {
    if (!controlsHost) return;
    controlsHost.innerHTML = `<div class="business-control-intro">
      ${founderChat ? '<div class="business-protection-banner"><span>👑</span><div><b>Защищённый диалог владельца</b><small>Все команды и автоматические действия FLAMEXBOT здесь отключены.</small></div></div>' : '<div class="business-command-hint"><span>⌘</span><div><b>Команды вводятся прямо в этом Telegram-диалоге</b><small>Без @username и ID. Например: <code>.mute</code>, <code>.unmute</code>, <code>.antimute on</code>.</small></div></div>'}
    </div><div class="business-control-grid">
      <section class="business-control-card">
        <div class="business-control-title"><b>🔇 Мут</b><span class="business-control-state ${chatMuted?'active':''}">${chatMuted?'Включён':'Выключен'}</span></div>
        <p>Удаляет новые входящие сообщения в этом диалоге. Уже сохранённая переписка остаётся на месте.</p>
        ${!founderChat && !canDeleteMessages && !chatMuted ? '<small class="business-control-note">В Telegram Business нужно разрешить «Удалять все сообщения».</small>' : ''}
        ${!founderChat && !premiumAccess && !chatMuted ? '<small class="business-control-note">Для включения нужна активная Premium-подписка.</small>' : ''}
        <button type="button" class="outline small" id="toggle-business-mute" ${founderChat||(!premiumAccess && !chatMuted)||(!canDeleteMessages && !chatMuted)?'disabled':''}>${chatMuted?'Выключить мут':'Включить мут'}</button>
      </section>
      <section class="business-control-card">
        <div class="business-control-title"><b>🛡 Антимут</b><span class="business-control-state ${antimutEnabled?'active':''}">${antimutEnabled?'Включён':'Выключен'}</span></div>
        <p>Позволяет сделать одну ручную попытку отправки через твой Telegram Business. Антимут не снимает блокировки и не обходит запреты Telegram.</p>
        ${!founderChat && !canReplyMessages && !antimutEnabled ? '<small class="business-control-note">Нужно разрешение Telegram Business «Отвечать».</small>' : ''}
        ${!founderChat && !premiumAccess && !antimutEnabled ? '<small class="business-control-note">Для включения нужна активная Premium-подписка.</small>' : ''}
        <button type="button" class="outline small" id="toggle-business-antimut" ${founderChat||(!premiumAccess && !antimutEnabled)||(!canReplyMessages && !antimutEnabled)?'disabled':''}>${antimutEnabled?'Выключить антимут':'Включить антимут'}</button>
        ${antimutEnabled && !founderChat ? '<small class="business-control-note">Для одной попытки отправь в этом же диалоге: <code>.antimute текст</code>. Повторная отправка не запускается автоматически.</small>' : ''}
      </section>
    </div>`;
    controlsHost.querySelector('#toggle-business-mute')?.addEventListener('click', async e => {
      const next = !chatMuted;
      if (next && (founderChat || !premiumAccess || !canDeleteMessages)) return;
      e.currentTarget.disabled = true;
      const { error } = await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,is_muted:next},{onConflict:'profile_id,business_chat_id'});
      if (error) { toast('Не удалось изменить мут: '+error.message); e.currentTarget.disabled = false; return; }
      chatMuted = next; chat.is_muted = next;
      toast(next ? 'Мут включён: новые сообщения будут удаляться' : 'Размут выполнен: сообщения больше не удаляются');
      renderBusinessControls();
      await refreshBusinessChatList(document.querySelector('#page-content'));
    });
    controlsHost.querySelector('#toggle-business-antimut')?.addEventListener('click', async e => {
      const next = !antimutEnabled;
      if (next && (founderChat || !premiumAccess || !canReplyMessages)) return;
      e.currentTarget.disabled = true;
      const { error } = await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,antimut_enabled:next},{onConflict:'profile_id,business_chat_id'});
      if (error) { toast('Не удалось изменить антимут: '+error.message); e.currentTarget.disabled = false; return; }
      antimutEnabled = next; chat.antimut_enabled = next;
      toast(next ? 'Антимут включён: доступна ручная попытка отправки' : 'Антимут выключен');
      renderBusinessControls();
      await refreshBusinessChatList(document.querySelector('#page-content'));
    });

  };
  renderBusinessControls();
  box.querySelector('#business-chat-back')?.addEventListener('click', () => {
    state.activeBusinessChat = null;
    box.closest('.business-inbox')?.classList.remove('chat-open');
    box.innerHTML = '<div class="chat-placeholder"><span>✈</span><b>Твои переписки</b><small>Выбери чат слева.</small></div>';
    document.querySelectorAll('[data-business-chat]').forEach(btn => btn.classList.remove('active'));
  });
  await refreshBusinessMessages(id);
  document.querySelector('#business-message-search')?.addEventListener('input',()=>refreshBusinessMessages(id));
  state.businessChatChannel = supabase.channel(`business-chat-${id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'flamexbot_business_messages',filter:`business_chat_id=eq.${id}`},() => refreshBusinessMessages(id))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') refreshBusinessMessages(id);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Связь с обновлением переписки прервалась');
    });
  const sendForm=document.querySelector('#business-send-form');
  const mediaInput=document.querySelector('#business-media-input');
  const selectedMedia=document.querySelector('#selected-business-media');
  let selectedPreviewUrl=null;
  const clearSelectedMedia=()=>{
    if(selectedPreviewUrl){URL.revokeObjectURL(selectedPreviewUrl);selectedPreviewUrl=null;}
    mediaInput.value='';
    selectedMedia.hidden=true;selectedMedia.innerHTML='';
  };
  const cancelReply=document.querySelector('#cancel-business-reply');
  cancelReply?.addEventListener('click',()=>{
    sendForm.querySelector('[name=reply_to_message_id]').value='';
    document.querySelector('#business-reply-preview').hidden=true;
  });
  mediaInput?.addEventListener('change',()=>{
    if(selectedPreviewUrl){URL.revokeObjectURL(selectedPreviewUrl);selectedPreviewUrl=null;}
    const file=mediaInput.files?.[0];
    if(!file){selectedMedia.hidden=true;selectedMedia.innerHTML='';return;}
    const size=(file.size/1024/1024).toFixed(1)+' МБ';
    let preview='';
    if(file.type.startsWith('image/')){selectedPreviewUrl=URL.createObjectURL(file);preview='<img class="selected-media-thumb" src="'+selectedPreviewUrl+'" alt="Предпросмотр"/>';}
    else if(file.type.startsWith('video/')){selectedPreviewUrl=URL.createObjectURL(file);preview='<video class="selected-media-thumb" muted playsinline src="'+selectedPreviewUrl+'"></video>';}
    else preview='<span class="selected-media-icon">📎</span>';
    selectedMedia.innerHTML=preview+'<span class="selected-media-name"><b>'+esc(file.name)+'</b><small>'+size+'</small></span><button type="button" data-clear-media aria-label="Убрать вложение">×</button>';
    selectedMedia.hidden=false;
    selectedMedia.querySelector('[data-clear-media]')?.addEventListener('click',clearSelectedMedia);
  });
  sendForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type=submit]');
    const input = form.querySelector('input[name=content]');
    const text = input.value.trim();
    const file=mediaInput.files?.[0]||null;
    if (!text && !file) return;
    if(file && file.size>20*1024*1024){toast('Максимальный размер файла — 20 МБ');return;}
    button.disabled = true;
    let storagePath=null;
    let mediaType=null;
    if(file){
      mediaType=file.type.startsWith('image/')?'photo':file.type.startsWith('video/')?'video':file.type==='audio/ogg'?'voice':file.type==='audio/mpeg'||file.type==='audio/mp4'?'audio':'document';
      storagePath=state.session.user.id+'/'+id+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const {error:uploadError}=await supabase.storage.from('flamex-business-media').upload(storagePath,file,{contentType:file.type||'application/octet-stream',upsert:false});
      if(uploadError){button.disabled=false;toast('Не удалось загрузить файл: '+uploadError.message);return;}
    }
    const command=!file&&text.startsWith('.')?text.trim():'';
    if(command){
      const [rawName,...rest]=command.slice(1).split(/\s+/);const name=(rawName||'').toLowerCase();const args=rest.join(' ').trim();
      if(['help','inf'].includes(name)){toast('.spam 2-5 текст · .mute · .unmute · .antimute on/off · .antimute текст');button.disabled=false;return;}
      if(!isPremium()){toast('Эта команда доступна только в Premium.');button.disabled=false;return;}
      if(name==='mute'||name==='unmute'){
        const next=name==='mute';
        if(next && String(chat.telegram_chat_id)===FOUNDER_TELEGRAM_ID){button.disabled=false;toast('Владелец FLAMEXBOT защищён от мута.');return;}
        if(next && !state.businessRights?.can_delete_all_messages){button.disabled=false;toast('Для мута нужно разрешение Telegram Business «Удалять все сообщения».');return;}
        const {error:settingError}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,is_muted:next},{onConflict:'profile_id,business_chat_id'});
        button.disabled=false;if(settingError){toast('Не удалось изменить настройку чата');return;}
        chatMuted=next;chat.is_muted=next;renderBusinessControls();toast(next?'Мут включён':'Собеседник размучен');form.reset();await refreshBusinessChatList(document.querySelector('#page-content'));return;
      }
      if(name==='antimute'){
        if(!isPremium()){button.disabled=false;toast('Антимут доступен только в Premium.');return;}
        if(args==='on'||args==='off'){
          const next=args==='on';
          if(next && state.businessRights?.can_reply!==true){button.disabled=false;toast('Telegram Business не выдал право «Отвечать» для этого чата.');return;}
          const {error:antiError}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,antimut_enabled:next},{onConflict:'profile_id,business_chat_id'});
          button.disabled=false;if(antiError){toast('Не удалось изменить антимут');return;}
          antimutEnabled=next;chat.antimut_enabled=next;renderBusinessControls();toast(next?'Антимут включён: доступна ручная попытка отправки':'Антимут выключен');form.reset();return;
        }
        if(!antimutEnabled){button.disabled=false;toast('Сначала включи антимут командой .antimute on или в настройках чата.');return;}
        if(!args){button.disabled=false;toast('Формат: .antimute on/off или .antimute текст');return;}
        const {data:antiData,error:antiError}=await supabase.functions.invoke('business-chat-send',{body:{chat_id:id,text:args,antimut_mode:true}});
        button.disabled=false;if(antiError||antiData?.error){toast(antiData?.error||antiError?.message||'Telegram отклонил отправку');return;}
        form.reset();toast('Telegram принял сообщение для отправки');await refreshBusinessMessages(id);return;
      }
      if(name==='time'||name==='untime'){
        const enabled=name==='time';const {error:timeError}=await supabase.from('profiles').update({show_profile_time:enabled}).eq('id',state.session.user.id);
        button.disabled=false;if(timeError){toast('Не удалось обновить время профиля');return;}state.profile={...state.profile,show_profile_time:enabled};toast(enabled?'Время в профиле включено':'Время в профиле выключено');form.reset();return;
      }
      if(name==='spam'){
        const match=args.match(/^(\d{1,2})\s+([\s\S]+)$/);if(!match){button.disabled=false;toast('Формат: .spam 2-5 текст сообщения');return;}
        const count=Number(match[1]),spamText=match[2].trim();if(count<2||count>5||!spamText){button.disabled=false;toast('Разрешено отправить от 2 до 5 повторов.');return;}
        const replyId=form.querySelector('[name=reply_to_message_id]').value||null;
        for(let i=0;i<count;i++){const {data:spamData,error:spamError}=await supabase.functions.invoke('business-chat-send',{body:{chat_id:id,text:spamText,reply_to_message_id:i===0?replyId:null}});
          if(spamError||spamData?.error){button.disabled=false;toast(spamData?.error||spamError?.message||'Отправка остановлена');await refreshBusinessMessages(id);return;}
          if(i<count-1)await new Promise(resolve=>setTimeout(resolve,1200));
        }
        button.disabled=false;form.reset();document.querySelector('#business-reply-preview').hidden=true;toast(`Отправлено ${count} сообщений`);await refreshBusinessMessages(id);return;
      }
      button.disabled=false;toast('Неизвестная команда. Напиши .help');return;
    }
    const replyId=form.querySelector('[name=reply_to_message_id]').value||null;
    const { data, error } = await supabase.functions.invoke('business-chat-send', { body: { chat_id:id,text,storage_path:storagePath,media_type:mediaType,reply_to_message_id:replyId } });
    button.disabled = false;
    if (error || data?.error) {
      if(storagePath) await supabase.storage.from('flamex-business-media').remove([storagePath]);
      toast(data?.error || error.message || 'Не удалось отправить сообщение'); return;
    }
    form.reset();
    clearSelectedMedia();
    document.querySelector('#business-reply-preview').hidden=true;
    await refreshBusinessMessages(id);
    await supabase.rpc('sync_flamexbot_achievements');
  });
}

async function renderAdmin(host) {
  const { data: allowed, error: accessError } = await supabase.rpc('is_flamexbot_admin');
  if (accessError || allowed !== true || !state.isAdmin) {
    host.innerHTML = '<div class="page-heading"><div class="eyebrow">ACCESS DENIED</div><h1>Нет доступа</h1><p class="muted">Админ-панель доступна только владельцу @Racer_Video.</p></div>';
    return;
  }
  const [connections, chats, messages, users, recentChats] = await Promise.all([
    supabase.from('flamexbot_business_connections').select('is_enabled,connected_at,rights').eq('profile_id',state.session.user.id).maybeSingle(),
    supabase.from('flamexbot_business_chats').select('id',{count:'exact',head:true}).eq('profile_id',state.session.user.id),
    supabase.from('flamexbot_business_messages').select('id',{count:'exact',head:true}),
    supabase.from('profiles').select('id,username,display_name,telegram_username,telegram_id,created_at').order('created_at',{ascending:false}).limit(8),
    supabase.from('flamexbot_business_chats').select('id,username,first_name,last_name,last_message_at').eq('profile_id',state.session.user.id).order('last_message_at',{ascending:false}).limit(8)
  ]);
  const connection = connections.data;
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">FOUNDER CONTROL</div><h1>Админ-панель</h1><p class="muted">Закрытая панель владельца FLAMEXBOT.</p></div>
    <div class="admin-owner-card"><span class="admin-crown">✦</span><div><b>@Racer_Video</b><small>Единственный администратор · Founder</small></div><span class="business-status is-connected">Доступ подтверждён</span></div>
    <div class="stats-grid"><div class="stat-card"><small>BUSINESS BOT</small><strong>${connection?.is_enabled ? 'ON' : 'OFF'}</strong><span class="stat-foot">Подключение Telegram</span></div><div class="stat-card"><small>BUSINESS-ЧАТЫ</small><strong>${chats.count || 0}</strong><span class="stat-foot">Полученные переписки</span></div><div class="stat-card"><small>СООБЩЕНИЯ</small><strong>${messages.count || 0}</strong><span class="stat-foot">Сохранённые сообщения</span></div></div>
    <section class="business-card"><div class="business-card-head"><div><div class="eyebrow">SECURITY</div><h2>Права доступа</h2><p class="muted">Обычные личные чаты отключены. В приложении используются только переписки Telegram Business.</p></div><span class="business-status is-connected">Founder only</span></div></section>
    <div class="section-heading"><div><div class="eyebrow">COMMUNITY</div><h3>Последние пользователи</h3></div></div>
    <div class="people-list">${(users.data||[]).map(u=>`<div class="person-row"><div class="person-info"><b>${esc(u.display_name||u.username)}</b><small>${u.telegram_username?'@'+esc(u.telegram_username):'Telegram не привязан'} · ${new Date(u.created_at).toLocaleDateString('ru-RU')}</small></div><span class="business-status">${u.telegram_id?'Telegram':'Web ID'}</span></div>`).join('')||'<div class="empty-state">Пользователей пока нет.</div>'}</div>
    <div class="section-heading"><div><div class="eyebrow">BUSINESS INBOX</div><h3>Последние переписки</h3></div></div>
    <div class="people-list">${(recentChats.data||[]).map(ch=>`<div class="person-row"><div class="person-info"><b>${esc([ch.first_name,ch.last_name].filter(Boolean).join(' ')||ch.username||'Telegram-пользователь')}</b><small>${ch.username?'@'+esc(ch.username)+' · ':''}${ch.last_message_at?new Date(ch.last_message_at).toLocaleString('ru-RU'):'Нет сообщений'}</small></div><span class="business-only-tag">Business</span></div>`).join('')||'<div class="empty-state">Business-чатов пока нет.</div>'}</div>`;

}

async function renderTariffs(host) {
 const premium=isPremium();
 const expires=state.subscription?.expires_at?new Date(state.subscription.expires_at).toLocaleDateString('ru-RU'):'Без срока';
 host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT MEMBERSHIP</div><h1>Тарифы и возможности</h1><p class="muted">Выбирай подходящий уровень доступа. Оплата и продление проходят через Telegram Stars.</p></div>
 <div class="tariff-grid">
  <section class="business-card tariff-card ${!premium?'tariff-current':''}">
   <div class="eyebrow">ДЛЯ СТАРТА</div><h2>Free</h2><p class="muted">Всё необходимое, чтобы оставаться на связи и пользоваться FLAMEXBOT каждый день.</p>
   <ul><li>Telegram Mini App и профиль</li><li>Подключение Telegram Business</li><li>Переписки, отправка текста и файлов</li><li>Друзья, огоньки и уведомления</li><li>Базовая статистика и достижения</li></ul>
   <span class="business-status ${!premium?'is-connected':''}">${!premium?'Твой текущий тариф':'Бесплатно'}</span>
  </section>
  <section class="business-card tariff-card premium-card ${premium?'tariff-current':''}">
   <div class="eyebrow">БОЛЬШЕ ВОЗМОЖНОСТЕЙ</div><h2>✦ Premium</h2><p class="muted">Расширенное управление Telegram Business и дополнительные инструменты для твоих диалогов.</p>
   <ul>
    <li><code>.mute</code> / <code>.unmute</code> — удаление новых сообщений и отключение мута в текущем диалоге</li>
    <li><code>.antimute on/off</code> — включить или выключить одну ручную попытку отправки через Business</li>
    <li><code>.antimute текст</code> — отправить одно сообщение через Business с учётом ответа Telegram</li>
    <li><code>.spam 2-5 текст</code> — отправить от 2 до 5 копий сообщения в текущий диалог</li>
    <li>AFK-автоответ, авто-прочтение и статусы набора</li>
    <li>Фильтр стикеров, часовой пояс и оформление текста</li>
    <li>Премиум-эмодзи в сообщениях и уведомлениях бота, если Telegram разрешает их отправку</li>
    <li>Расширенные настройки Business-диалогов</li>
   </ul>
   <span class="business-status ${premium?'is-connected':''}">${premium?'Premium активен · до '+expires:'100 ⭐ · 30 дней'}</span>
   ${premium?'': '<button class="primary" id="buy-premium" type="button">✦ Подключить Premium за 100 ⭐</button>'}
  </section>
 </div>
 <div class="business-command-hint"><span>⌘</span><div><b>Команды не нужно отправлять боту в личные сообщения</b><small>Открой переписку с нужным человеком и отправь команду прямо туда. FLAMEXBOT сам определит текущий диалог — без @username и ID.</small></div></div>
 <p class="business-note">Premium действует 30 дней с момента оплаты. Антимут не снимает блокировки и не обходит ограничения Telegram: он выполняет только одну ручную попытку отправки через разрешённое Business-подключение. Если Telegram отказывает, FLAMEXBOT показывает причину и не повторяет отправку автоматически.</p>`;
 const buyButton=host.querySelector('#buy-premium');
 buyButton?.addEventListener('click',async()=>{
   buyButton.disabled=true;buyButton.textContent='Создаём счёт…';
   const {data,error}=await supabase.functions.invoke('create-premium-invoice');
   buyButton.disabled=false;buyButton.textContent='✦ Подключить Premium за 100 ⭐';
   if(error||data?.error){toast(data?.error||error?.message||'Не удалось создать счёт на оплату');return;}
   toast('Счёт создан. Открой диалог с FLAMEXBOT и подтверди оплату в Telegram.');
 });
}

async function renderStreaks(host) {
  const { data, error } = await supabase.from('streaks').select('*').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).order('current_days',{ascending:false});
  state.streaks = data || [];
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">DON'T BREAK THE CHAIN</div><h1>Огоньки 🔥</h1><p class="muted">Поддерживай ежедневное общение, чтобы продлевать общие серии.</p></div><div class="streak-list large">${error ? esc(error.message) : state.streaks.length ? state.streaks.map(s => `<div class="streak-card"><div class="streak-symbol">🔥</div><div><div class="eyebrow">ОБЩАЯ СЕРИЯ</div><h3>${s.current_days || 0} дней</h3><p class="muted">Лучшая серия: ${s.best_days || 0} дней</p></div></div>`).join('') : '<div class="empty-state">Активных серий пока нет. История серий останется доступна.</div>'}</div>`;
}

async function renderProfile(host) {
  const p = state.profile || {}; const profileAvatar = p.avatar_url || p.telegram_photo_url;
  const { data: businessConnection, error: businessError } = await supabase
    .from('flamexbot_business_connections').select('is_enabled,rights,connected_at,updated_at')
    .eq('profile_id', state.session.user.id).maybeSingle();
  state.businessConnection = businessConnection || null;
  const businessConnected = Boolean(businessConnection?.is_enabled);
  const rights = businessConnection?.rights || {};
  const grantedRights = Object.entries(rights).filter(([, value]) => value === true).map(([key]) => key);
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">ТВОЙ АККАУНТ</div><h1>Профиль</h1><p class="muted">Управляй именем, оформлением и подключением Telegram Business.</p></div>
    <form class="profile-card" id="profile-form">${avatar(profileAvatar,p.display_name||p.username,'avatar-xl')}
      <label>Отображаемое имя<input name="display_name" value="${esc(p.display_name || '')}" placeholder="Как тебя называть" maxlength="48"/></label>
      <label>Никнейм<input name="username" value="${esc(p.username || '')}" placeholder="Твой никнейм" maxlength="32" required/></label>
      <label>О себе<textarea name="bio" maxlength="180" placeholder="Расскажи немного о себе">${esc(p.bio || '')}</textarea></label>
      <label>Цветовая тема<select name="theme"><option value="orange" ${(p.theme||'orange')==='orange'?'selected':''}>Огненная</option><option value="blue" ${p.theme==='blue'?'selected':''}>Синяя</option><option value="green" ${p.theme==='green'?'selected':''}>Зелёная</option><option value="red" ${p.theme==='red'?'selected':''}>Красная</option><option value="violet" ${p.theme==='violet'?'selected':''}>Фиолетовая</option></select></label>
      <label>Ссылка на аватар<input name="avatar_url" type="url" value="${esc(p.avatar_url || '')}" placeholder="https://…"/></label>
      <div class="profile-time-display">${p.show_profile_time === false ? 'Время в профиле выключено' : 'Сейчас: '+new Date(Date.now()+(Number(p.timezone_offset)||0)*3600000).toISOString().slice(11,16)+' · UTC'+((Number(p.timezone_offset)||0)>=0?'+':'')+(Number(p.timezone_offset)||0)}</div>
      <div class="profile-id">ID аккаунта <code>${esc(state.session.user.id)}</code></div>
      <div class="telegram-profile"><div><b>Telegram</b><small>${p.telegram_id ? (p.telegram_username ? '@' + esc(p.telegram_username) : 'Аккаунт привязан') : 'Не привязан'}</small></div><button class="outline small" type="button" data-telegram-link>${p.telegram_id ? 'Обновить связь' : 'Привязать Telegram'}</button></div>
      <button class="primary">Сохранить изменения <b>→</b></button>
    </form>
    <section class="business-card">
      <div class="business-card-head"><div><div class="eyebrow">ПОДКЛЮЧЕНИЕ TELEGRAM</div><h2>Telegram Business</h2><p class="muted">Подключи Telegram Business и выбери разрешения, с которыми FLAMEXBOT сможет работать в твоих диалогах.</p></div><span class="business-status ${businessConnected ? 'is-connected' : ''}">${businessConnected ? 'Подключено' : 'Не подключено'}</span></div>
      <div class="business-steps">
        <div><b>1.</b><span>В <strong>@BotFather</strong> включи Business Mode для бота FLAMEXBOT.</span></div>
        <div><b>2.</b><span>В Telegram открой <strong>Настройки → Telegram Business → Чат-боты</strong>.</span></div>
        <div><b>3.</b><span>Добавь FLAMEXBOT и самостоятельно выбери, к каким диалогам и данным открыть доступ.</span></div>
      </div>
      <div class="business-connection-info">
        ${businessConnected ? `<b>Бизнес-аккаунт связан</b><small>Подключено: ${businessConnection.connected_at ? new Date(businessConnection.connected_at).toLocaleString('ru-RU') : 'дата не указана'}</small><small>Выдано разрешений: ${grantedRights.length}</small>` : '<b>Ожидаем подтверждения</b><small>После подтверждения подключения Telegram статус появится здесь автоматически.</small>'}
      </div>
      ${businessError ? '<p class="business-warning">Не удалось получить статус подключения. Проверь Telegram Business и попробуй ещё раз.</p>' : ''}
      <button class="outline small" type="button" id="refresh-business">↻ Проверить подключение</button>
      <p class="business-note">FLAMEXBOT не меняет настройки Telegram и не выдаёт себе разрешения. Ты в любой момент можешь проверить или отозвать доступ в настройках Telegram Business.</p>
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
    const { error } = await supabase.from('profiles').update({display_name:fd.get('display_name')||'Пользователь',username:fd.get('username'),bio:fd.get('bio')||'',avatar_url:fd.get('avatar_url') || null,theme:fd.get('theme')||'orange'}).eq('id',state.session.user.id);
    if (error) toast(error.message); else { state.profile = {...p,display_name:fd.get('display_name')||'Пользователь',username:fd.get('username'),bio:fd.get('bio')||'',avatar_url:fd.get('avatar_url'),theme:fd.get('theme')||'orange'}; applyTheme(state.profile.theme); toast('Изменения профиля сохранены'); renderApp(); }
  });
}


async function renderDailyMissions(host) {
  const uid=state.session.user.id;
  const now=new Date();const dayStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const dayEnd=new Date(dayStart.getTime()+86400000);
  const start=dayStart.toISOString();const end=dayEnd.toISOString();const today=dayStart.toISOString().slice(0,10);
  const [sent,received,streaks,claims]=await Promise.all([
    supabase.from('flamexbot_business_messages').select('id',{count:'exact',head:true}).eq('direction','outbound').gte('created_at',start).lt('created_at',end),
    supabase.from('flamexbot_business_messages').select('id',{count:'exact',head:true}).eq('direction','inbound').gte('created_at',start).lt('created_at',end),
    supabase.from('streaks').select('id',{count:'exact',head:true}).or(`user_low.eq.${uid},user_high.eq.${uid}`).eq('last_activity_date',today),
    supabase.from('flamexbot_daily_task_claims').select('task_code,xp_reward').eq('user_id',uid).eq('task_date',today)
  ]);
  const completed=new Set((claims.data||[]).map(x=>x.task_code));
  const tasks=[
    {code:'send_message',title:'Зажечь диалог',desc:'Отправь хотя бы одно сообщение через Business',reward:10,done:(sent.count||0)>0,progress:Math.min(1,sent.count||0)},
    {code:'receive_message',title:'Быть на связи',desc:'Получи хотя бы одно входящее сообщение',reward:5,done:(received.count||0)>0,progress:Math.min(1,received.count||0)},
    {code:'keep_streak',title:'Сохранить огонёк',desc:'Поддержи совместную серию сегодня',reward:10,done:(streaks.count||0)>0,progress:Math.min(1,streaks.count||0)}
  ];
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ЕЖЕДНЕВНЫЕ ЗАДАНИЯ</div><h1>Ежедневные задания ⚡</h1><p class="muted">Выполняй небольшие ежедневные задания, получай XP и открывай новые достижения. Прогресс обновляется каждый день.</p></div><div class="daily-task-list">${tasks.map(t=>{const claimed=completed.has(t.code);return `<article class="daily-task ${claimed?'claimed':t.done?'ready':''}"><div class="daily-task-icon">${t.code==='send_message'?'💬':t.code==='receive_message'?'📩':'🔥'}</div><div class="daily-task-copy"><b>${t.title}</b><p>${t.desc}</p><small>${claimed?'Награда получена':t.done?'Задание выполнено':'Прогресс: '+(t.progress?'1':'0')+'/1'} · +${t.reward} XP</small></div><button class="${t.done&&!claimed?'primary':'outline'} small" data-claim-task="${t.code}" ${!t.done||claimed?'disabled':''}>${claimed?'Получено':t.done?'Забрать':'В процессе'}</button></article>`;}).join('')}</div>${sent.error||received.error||streaks.error||claims.error?'<p class="business-warning">Часть прогресса не удалось загрузить. Попробуй обновить страницу.</p>':''}`;
  host.querySelectorAll('[data-claim-task]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;const {data,error}=await supabase.rpc('claim_flamexbot_daily_task',{p_task_code:btn.dataset.claimTask});
    if(error){toast(error.message.includes('already claimed')?'Награда уже получена сегодня':'Не удалось забрать награду: '+error.message);btn.disabled=false;return;}
    toast('Получено +'+(data?.xp_reward||0)+' XP');renderDailyMissions(host);
  }));
}

async function renderAchievements(host) {
  const uid=state.session.user.id;
  const [all,earned,taskClaims,leaderboard]=await Promise.all([
    supabase.from('achievements').select('id,code,title,description,icon,points').order('points'),
    supabase.from('user_achievements').select('achievement_id,earned_at').eq('user_id',uid),
    supabase.from('flamexbot_daily_task_claims').select('xp_reward').eq('user_id',uid),
    supabase.rpc('get_flamexbot_leaderboard')
  ]);
  const got=new Map((earned.data||[]).map(x=>[x.achievement_id,x]));
  const achievementXp=(all.data||[]).filter(a=>got.has(a.id)).reduce((sum,a)=>sum+(a.points||0),0);
  const totalXp=achievementXp+(taskClaims.data||[]).reduce((sum,x)=>sum+(x.xp_reward||0),0);
  const level=Math.floor(totalXp/100)+1;
  const nextXp=level*100;
  const progress=totalXp%100;
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ТВОЯ КОЛЛЕКЦИЯ</div><h1>Достижения 🏆</h1><p class="muted">Каждое достижение связано с активностью внутри FLAMEXBOT.</p></div><section class="business-card level-card"><div class="level-line"><div><small>ТВОЙ УРОВЕНЬ</small><h2>Уровень ${level}</h2></div><strong>${totalXp} XP</strong></div><div class="xp-track"><span style="width:${progress}%"></span></div><small>${progress}/100 XP до следующего уровня</small></section><div class="achievement-grid">${(all.data||[]).map(a=>{const e=got.get(a.id);return `<article class="achievement-card ${e?'earned':'locked'}"><div class="achievement-icon">${esc(a.icon||'✦')}</div><div><b>${esc(a.title)}</b><p>${esc(a.description||'')}</p><small>${e?'Получено '+new Date(e.earned_at).toLocaleDateString('ru-RU'):'Пока не получено'} · ${a.points} XP</small></div></article>`;}).join('')||'<div class="empty-state">Каталог достижений пока пуст.</div>'}</div><section class="leaderboard-panel"><div class="section-heading"><div><div class="eyebrow">РЕЙТИНГ СООБЩЕСТВА</div><h3>Таблица лидеров</h3></div></div><div class="leaderboard-list">${(leaderboard.data||[]).map((u,i)=>`<div class="leaderboard-row"><strong>#${i+1}</strong><span><b>${esc(u.display_name||u.username)}</b><small>Уровень ${u.level}</small></span><em>${u.xp} XP</em></div>`).join('')||'<div class="empty-state">Рейтинг появится, когда участники начнут получать XP.</div>'}</div></section>${all.error||earned.error||taskClaims.error||leaderboard.error?'<p class="business-warning">Не удалось полностью загрузить коллекцию или рейтинг.</p>':''}`;
}
async function renderNotifications(host) {
  const uid=state.session.user.id;
  const {data,error}=await supabase.from('notifications').select('id,type,title,body,data,created_at,read_at').eq('user_id',uid).order('created_at',{ascending:false}).limit(50);
  state.notificationCount=(data||[]).filter(n=>!n.read_at).length;
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ЦЕНТР УВЕДОМЛЕНИЙ</div><h1>Уведомления</h1><p class="muted">Здесь собраны новые сообщения, события и изменения в твоём аккаунте.</p><div class="notification-toolbar"><span class="muted">${state.notificationCount} непрочитанных</span><button class="outline small" type="button" id="read-all-notifications" ${state.notificationCount?'':'disabled'}>Отметить всё прочитанным</button></div></div><div class="notification-list">${(data||[]).map(n=>`<button class="notification-item ${n.read_at?'read':'unread'}" data-notification="${n.id}"><span class="notification-mark">${n.read_at?'✓':'•'}</span><span><b>${esc(n.title)}</b><small>${esc(n.body||'')}</small><time>${new Date(n.created_at).toLocaleString('ru-RU')}</time></span></button>`).join('')||'<div class="empty-state">Пока тихо. Новые сообщения и события появятся здесь автоматически.</div>'}</div>${error?'<p class="business-warning">Не удалось загрузить уведомления.</p>':''}`;
  host.querySelector('#read-all-notifications')?.addEventListener('click',async()=>{
    const {error:markError}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',uid).is('read_at',null);
    if(markError)toast('Не удалось обновить уведомления');else{state.notificationCount=0;renderNotifications(host);renderApp();}
  });
  host.querySelectorAll('[data-notification]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(btn.classList.contains('read'))return;
    const {error:updateError}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',btn.dataset.notification).eq('user_id',uid);
    if(updateError)toast('Не удалось отметить уведомление');else{state.notificationCount=Math.max(0,state.notificationCount-1);btn.classList.remove('unread');btn.classList.add('read');btn.querySelector('.notification-mark').textContent='✓';const count=host.querySelector('.notification-toolbar .muted');if(count)count.textContent=state.notificationCount+' непрочитанных';renderApp();}
  }));
}
async function renderStats(host) {
  const uid=state.session.user.id;
  const [streaks,chats,messages,earned,profile]=await Promise.all([
    supabase.from('streaks').select('current_days,best_days').or(`user_low.eq.${uid},user_high.eq.${uid}`),
    supabase.from('flamexbot_business_chats').select('id',{count:'exact',head:true}).eq('profile_id',uid),
    supabase.from('flamexbot_business_messages').select('id',{count:'exact',head:true}),
    supabase.from('user_achievements').select('achievement_id',{count:'exact',head:true}).eq('user_id',uid),
    supabase.from('profiles').select('created_at,telegram_id').eq('id',uid).maybeSingle()
  ]);
  const best=Math.max(0,...(streaks.data||[]).map(s=>s.best_days||0));
  const current=Math.max(0,...(streaks.data||[]).map(s=>s.current_days||0));
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ТВОЯ АКТИВНОСТЬ</div><h1>Статистика</h1><p class="muted">Краткая сводка твоих переписок, серий и достижений.</p></div><div class="stats-grid"><div class="stat-card"><small>ТАРИФ</small><strong>${planLabel()}</strong></div><div class="stat-card"><small>BUSINESS-ЧАТЫ</small><strong>${chats.count||0}</strong></div><div class="stat-card"><small>СООБЩЕНИЯ</small><strong>${messages.count||0}</strong></div><div class="stat-card"><small>ТЕКУЩАЯ СЕРИЯ</small><strong>${current} дн.</strong></div><div class="stat-card"><small>ЛУЧШАЯ СЕРИЯ</small><strong>${best} дн.</strong></div><div class="stat-card"><small>ДОСТИЖЕНИЯ</small><strong>${earned.count||0}</strong></div></div><section class="business-card"><div class="eyebrow">FLAMEX ID</div><div class="flame-id-line"><h2>${esc(uid.slice(0,8).toUpperCase())}</h2><button class="outline small" type="button" id="copy-flame-id">Скопировать ID</button></div><p class="muted">Уникальный идентификатор твоего пространства FLAMEXBOT.</p><small>В приложении с ${profile.data?.created_at?new Date(profile.data.created_at).toLocaleDateString('ru-RU'):'—'} · Telegram ${profile.data?.telegram_id?'привязан':'не привязан'}</small></section>`;
  host.querySelector('#copy-flame-id')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(uid);toast('FLAMEX ID скопирован');}catch{toast('Не удалось скопировать ID');}});
}

async function startPresence(session) {
  if (state.presenceChannel) { await supabase.removeChannel(state.presenceChannel); state.presenceChannel=null; }
  state.onlineUserIds=[];
  if (!session?.user?.id) return;
  const uid=session.user.id;
  const channel=supabase.channel('flamexbot-presence',{config:{presence:{key:uid}}});
  const refresh=()=>{
    const presence=channel.presenceState();
    state.onlineUserIds=[...new Set(Object.values(presence).flat().filter(meta=>meta.online!==false).map(meta=>meta.user_id).filter(id=>id&&id!==uid))];
    const host=document.querySelector('#page-content');

  };
  channel.on('presence',{event:'sync'},refresh);
  channel.on('presence',{event:'join'},refresh);
  channel.on('presence',{event:'leave'},refresh);
  state.presenceChannel=channel;
  channel.subscribe(async status=>{
    if(status==='SUBSCRIBED') {
      await channel.track({user_id:uid,online:!document.hidden,seen_at:new Date().toISOString()});
    }
  });
}
document.addEventListener('visibilitychange',()=>{
  const channel=state.presenceChannel;
  if(channel&&state.session?.user?.id) channel.track({user_id:state.session.user.id,online:!document.hidden,seen_at:new Date().toISOString()});
});

async function startNotificationRealtime(session) {
  if(state.notificationChannel){await supabase.removeChannel(state.notificationChannel);state.notificationChannel=null;}
  state.notificationCount=0;
  if(!session?.user?.id)return;
  const uid=session.user.id;
  const refreshCount=async()=>{
    const {count,error}=await supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',uid).is('read_at',null);
    if(error)return;
    state.notificationCount=count||0;
    const nav=document.querySelector('[data-page="notifications"]');
    if(nav){const badge=nav.querySelector('.nav-unread-count');if(state.notificationCount){if(badge)badge.textContent=state.notificationCount>99?'99+':String(state.notificationCount);else nav.insertAdjacentHTML('beforeend',`<i class="nav-unread-count">${state.notificationCount>99?'99+':state.notificationCount}</i>`);}else badge?.remove();}
  };
  const channel=supabase.channel(`flamexbot-notifications-${uid}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},payload=>{
      state.notificationCount+=1;
      const nav=document.querySelector('[data-page="notifications"]');
      if(nav){const badge=nav.querySelector('.nav-unread-count');if(badge)badge.textContent=state.notificationCount>99?'99+':String(state.notificationCount);else nav.insertAdjacentHTML('beforeend',`<i class="nav-unread-count">${state.notificationCount>99?'99+':state.notificationCount}</i>`);}
      const n=payload.new||{};
      if(n.title)toast(`Новое уведомление: ${n.title}`);
      if(state.page==='notifications'){const host=document.querySelector('#page-content');if(host)renderNotifications(host);}
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},()=>refreshCount())
    .subscribe(status=>{if(status==='SUBSCRIBED')refreshCount();});
  state.notificationChannel=channel;
}
async function boot(session) {
  state.session = session;
  if (!session) { if(state.presenceChannel){supabase.removeChannel(state.presenceChannel);state.presenceChannel=null;} if(state.notificationChannel){supabase.removeChannel(state.notificationChannel);state.notificationChannel=null;} state.onlineUserIds=[]; state.notificationCount=0; renderAuth(); return; }
  const { error: achievementSyncError } = await supabase.rpc('sync_flamexbot_achievements');
  if (achievementSyncError) console.warn('Achievement sync:', achievementSyncError.message);
  const { data, error } = await supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle();
  const { data: preferences } = await supabase.from('flamexbot_user_preferences').select('timezone_offset').eq('profile_id',session.user.id).maybeSingle();
  state.profile = {...(data || {username:session.user.email?.split('@')[0] || 'Flame user'}), timezone_offset: preferences?.timezone_offset ?? 0};
  if (state.profile.telegram_id) {
    supabase.functions.invoke('setup-flamexbot-webhook').then(({error}) => {
      if (error) console.warn('Telegram webhook setup:', error.message);
    });
  }
  const { data: subscription } = await supabase.from('user_subscriptions').select('plan,starts_at,expires_at').eq('user_id',session.user.id).maybeSingle();
  state.subscription = subscription && (!subscription.expires_at || new Date(subscription.expires_at).getTime() > Date.now()) ? subscription : { plan: 'free', expires_at: null };
  applyTheme(state.profile.theme);
  if (error) console.warn('Profile load:', error.message);
  const { data: adminAccess, error: adminError } = await supabase.rpc('is_flamexbot_admin');
  state.isAdmin = !adminError && adminAccess === true;
  await Promise.all([startPresence(session),startNotificationRealtime(session)]);
  renderApp();
}

if (!supabase) {
  app.innerHTML = `<main class="config-screen"><div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><h1>Почти готово.</h1><p>Добавь переменные окружения Supabase в настройках Cloudflare Pages:</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><p class="muted">Используй publishable key проекта FLAMEXBOT. Никогда не добавляй service_role key во фронтенд.</p></main>`;
} else {
  supabase.auth.getSession().then(({data}) => boot(data.session));
  supabase.auth.onAuthStateChange((_event, session) => { if (session !== state.session) boot(session); });
}
