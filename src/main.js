import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FOUNDER_TELEGRAM_ID = '7781170049';
const FOUNDER_PROFILE_ID = '74a352c0-5a26-46a8-9b88-e71d0c3a9879';
const supabase = SUPABASE_URL && SUPABASE_KEY && !SUPABASE_KEY.startsWith('YOUR_')
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const state = { session: null, profile: null, profileBadges: [], subscription: null, businessConnection: null, businessRights: null, isAdmin: false, page: 'home', busy: false, streaks: [], businessChats: [], activeBusinessChat: null, businessMessages: [], businessChatChannel: null, businessListChannel: null, presenceChannel: null, moderationChannel: null, onlineUserIds: [], notificationChannel: null, notificationCount: 0, menuListenersBound: false, blockedReason: null, friendSearchQuery: '', selectedAdminUserId: null, avatarRefreshAttempted: new Set(), businessMediaUrlCache: new Map(), messageRefreshInFlight: new Set(), messageRefreshPending: new Set(), messageRefreshTimers: new Map(), businessListRefreshTimer: null, userFilters: { search: '', verified: 'all', premium: 'all', banned: 'all', offset: 0 } };
const app = document.querySelector('#app');
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = name => (name || 'F').trim().slice(0, 1).toUpperCase();
const toast = message => { const el = document.querySelector('.toast'); if (!el) return; el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); };
const applyTheme = theme => { document.documentElement.dataset.theme = ['orange','blue','green','red','violet'].includes(theme) ? theme : 'orange'; };
const avatar = (url, name, size = '') => url ? `<img class="avatar ${size}" src="${esc(url)}" alt="" loading="lazy" />` : `<span class="avatar avatar-fallback ${size}">${esc(initials(name))}</span>`;
const mskDateObject = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value+'T12:00:00Z') : new Date(value);
const moscowDateKey = (value = new Date()) => { const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)); const v=Object.fromEntries(p.map(x=>[x.type,x.value])); return `${v.year}-${v.month}-${v.day}`; };
const formatMskDate = (value,options={day:'numeric',month:'long'}) => new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'Europe/Moscow'}).format(mskDateObject(value));
const formatMskTime = (value = new Date()) => new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const formatMskDateTime = (value,options={day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) => new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'Europe/Moscow'}).format(new Date(value));

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
      const {data:badges}=await supabase.from('profile_badges').select('badge_code').eq('user_id',state.session.user.id);
      state.profileBadges=(badges||[]).map(x=>x.badge_code);
      updateHeaderProfile();
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

function renderBlockedScreen() {
  app.innerHTML=`<main class="blocked-screen"><div class="blocked-icon">⛔</div><div class="eyebrow">ACCOUNT RESTRICTED</div><h1>Доступ ограничен</h1><p>${esc(state.blockedReason||'Этот аккаунт временно заблокирован администрацией FLAMEXBOT.')}</p><button class="outline" id="blocked-logout">Вернуться ко входу</button></main><div class="toast"></div>`;
  document.querySelector('#blocked-logout')?.addEventListener('click',()=>{
    state.blockedReason=null;
    renderAuth();
  });
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
const PAGE_LABELS = {
  home:'Обзор', messages:'Переписки', friends:'Друзья', tariffs:'Premium', streaks:'Огоньки',
  missions:'Ежедневные задания', profile:'Профиль', achievements:'Достижения',
  stats:'Статистика', commands:'Все команды', users:'Управление пользователями', admin_user:'Карточка пользователя', admin:'Админ-панель'
};
const BADGE_META = {
  verified:{label:'Подтверждён',icon:'✓',className:'verified'},
  founder:{label:'Основатель',icon:'👑',className:'founder'},
  developer:{label:'Разработчик',icon:'⌘',className:'developer'},
  administrator:{label:'Администратор',icon:'🛡',className:'administrator'},
  moderator:{label:'Модератор',icon:'⚔',className:'moderator'},
  designer:{label:'Дизайнер',icon:'🎨',className:'designer'},
  creator:{label:'Создатель',icon:'✦',className:'creator'},
  supporter:{label:'Поддержка',icon:'💎',className:'supporter'},
  beta_tester:{label:'Бета-тестер',icon:'🧪',className:'beta'},
  community_manager:{label:'Комьюнити',icon:'🌐',className:'community'},
  partner:{label:'Партнёр',icon:'🤝',className:'partner'},
  premium:{label:'Premium',icon:'✧',className:'premium'}
};
function isFounderProfile(profile=state.profile) {
  return String(profile?.telegram_id||'')===FOUNDER_TELEGRAM_ID || String(profile?.id||'')===FOUNDER_PROFILE_ID;
}
function verifiedMarkMarkup(verified=false) {
  return verified ? '<span class="verified-mark" title="Подтверждённый аккаунт" aria-label="Подтверждённый аккаунт">✓</span>' : '';
}
function badgeMarkup(codes=[],compact=false,includeOwnPremium=true) {
  const unique=[...new Set([...(codes||[]),...(includeOwnPremium&&isPremium()?['premium']:[])])];
  return unique.filter(code=>BADGE_META[code]).map(code=>{
    const b=BADGE_META[code];
    return `<span class="role-badge badge-${b.className} ${compact?'compact':''}" title="${esc(b.label)}"><i>${b.icon}</i>${compact?'':`<span>${esc(b.label)}</span>`}</span>`;
  }).join('');
}
function updateHeaderProfile() {
  const p=state.profile||{};
  const url=p.avatar_url||p.telegram_photo_url;
  const top=document.querySelector('#top-avatar');
  const menu=document.querySelector('#menu-avatar');
  if(top)top.innerHTML=avatar(url,p.display_name||p.username);
  if(menu)menu.innerHTML=avatar(url,p.display_name||p.username,'avatar-lg');
  const name=document.querySelector('#menu-display-name');
  if(name)name.innerHTML=esc(p.display_name||p.username||'Пользователь')+verifiedMarkMarkup(isFounderProfile(p));
  const triggerName=document.querySelector('.profile-trigger-name');
  if(triggerName)triggerName.innerHTML=esc(p.display_name||p.username||'Пользователь')+verifiedMarkMarkup(isFounderProfile(p));
  const badges=document.querySelector('#menu-profile-badges');
  if(badges)badges.innerHTML=badgeMarkup(state.profileBadges);
  const triggerBadges=document.querySelector('#top-profile-badges');
  if(triggerBadges)triggerBadges.innerHTML=verifiedMarkMarkup(isFounderProfile(p))+badgeMarkup(state.profileBadges,true);
}
function closeProfileMenu() {
  const menu=document.querySelector('#profile-menu');
  const trigger=document.querySelector('#profile-menu-trigger');
  if(menu)menu.classList.remove('open');
  if(trigger)trigger.setAttribute('aria-expanded','false');
}
function navigateTo(page) {
  if(!PAGE_LABELS[page] || (['users','admin'].includes(page)&&!state.isAdmin))return;
  if(state.page==='messages'&&page!=='messages'){
    if(state.businessChatChannel){supabase.removeChannel(state.businessChatChannel);state.businessChatChannel=null;}
    if(state.businessListChannel){supabase.removeChannel(state.businessListChannel);state.businessListChannel=null;}
    state.activeBusinessChat=null;
  }
  state.page=page;
  closeProfileMenu();
  const title=document.querySelector('#page-title');
  if(title)title.textContent=PAGE_LABELS[page];
  document.querySelectorAll('[data-page]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.page===page));
  const current=document.querySelector('#page-content');
  if(current){
    const next=document.createElement('section');
    next.id='page-content';
    next.className='page-content page-view page-enter';
    current.replaceWith(next);
  }
  loadPage();
}
function renderApp() {
  const p=state.profile||{};
  const profileAvatar=p.avatar_url||p.telegram_photo_url;
  const items=[
    ['home','⌂','Обзор','Главная'],
    ['messages','✉','Переписки','Telegram Business'],
    ['friends','👥','Друзья','Заявки и совместные огоньки'],
    ['streaks','🔥','Огоньки','Общие серии'],
    ['missions','⚡','Ежедневные задания','Новые задания каждый день'],
    ['achievements','🏆','Достижения','Коллекция наград'],
    ['stats','▥','Статистика','Твоя активность'],
    ['commands','⌘','Все команды','Полный список команд'],
    ['tariffs','✧','Premium','Подписка и возможности'],
    ['profile','◉','Профиль','Настройки аккаунта'],
    ...(state.isAdmin?[['users','👥','Управление пользователями','Поиск, карточки и действия'],['admin','⚙','Админ-панель','Управление проектом']]:[])
  ];
  app.innerHTML=`
    <div class="app-layout">
      <main class="main-area">
        <header class="topbar">
          <div class="topbar-brand"><span class="brand-mark">✦</span><span>FLAMEXBOT</span><i class="topbar-divider"></i><span class="topbar-section" id="page-title">${PAGE_LABELS[state.page]||'Обзор'}</span></div>
          <div class="top-right"><span class="top-status"><i></i> Система активна</span>
            <div class="profile-menu-wrap">
              <button type="button" class="profile-menu-trigger" id="profile-menu-trigger" aria-expanded="false" aria-label="Открыть меню профиля">
                <span id="top-avatar">${avatar(profileAvatar,p.display_name||p.username)}</span>
                <span class="profile-trigger-name">${esc(p.display_name||p.username||'Пользователь')}${verifiedMarkMarkup(isFounderProfile(p))}</span>
                <span id="top-profile-badges">${badgeMarkup(state.profileBadges,true)}</span>
                <span class="profile-chevron">⌄</span>
              </button>
              <div class="profile-menu" id="profile-menu">
                <div class="profile-menu-head">
                  <span id="menu-avatar">${avatar(profileAvatar,p.display_name||p.username,'avatar-lg')}</span>
                  <div class="profile-menu-identity"><b id="menu-display-name">${esc(p.display_name||p.username||'Пользователь')}${verifiedMarkMarkup(isFounderProfile(p))}</b><div id="menu-profile-badges">${badgeMarkup(state.profileBadges)}</div><small>${isPremium()?'✦ PREMIUM MEMBER':'FREE MEMBER'}</small></div>
                </div>
                <div class="profile-menu-label">РАЗДЕЛЫ</div>
                <nav class="profile-menu-nav">${items.map(([key,icon,label,sub])=>`<button type="button" class="profile-menu-item ${state.page===key?'selected':''}" data-page="${key}"><span class="menu-item-icon">${icon}</span><span><b>${label}</b><small>${sub}</small></span><i>›</i></button>`).join('')}</nav>
                <div class="profile-menu-footer"><button type="button" class="logout" id="logout"><span>↗</span> Выйти из аккаунта</button><small>FLAMEXBOT · ${new Date().getFullYear()}</small></div>
              </div>
            </div>
          </div>
        </header>
        <section class="page-content page-view" id="page-content"></section>
      </main>
    </div>
    <div class="toast"></div>
  `;
  const trigger=document.querySelector('#profile-menu-trigger');
  const menu=document.querySelector('#profile-menu');
  trigger?.addEventListener('click',()=>{
    const opened=menu.classList.toggle('open');
    trigger.setAttribute('aria-expanded',String(opened));
  });
  menu?.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>navigateTo(btn.dataset.page)));
  document.querySelector('#logout')?.addEventListener('click',async()=>{
    closeProfileMenu();
    if(confirm('Выйти из аккаунта FLAMEXBOT?'))await supabase.auth.signOut();
  });
  if(!state.menuListenersBound){
    document.addEventListener('click',event=>{
      const wrap=document.querySelector('.profile-menu-wrap');
      if(wrap&&!wrap.contains(event.target))closeProfileMenu();
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeProfileMenu();});
    state.menuListenersBound=true;
  }
  loadPage();
}

async function loadPage() {
  const host=document.querySelector('#page-content');
  if(!host)return;
  const p=state.profile||{};
  host.innerHTML=`<div class="page-loading"><div class="loader-mark"><span>✦</span><i></i><b></b></div><strong>Загружаем FLAMEXBOT</strong><small>Подготавливаем твоё пространство…</small></div>`;
  try {
    if(state.page==='home'){
      const [streaks,earned]=await Promise.all([
        supabase.from('streaks').select('*').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).order('current_days',{ascending:false}),
        supabase.from('user_achievements').select('achievement_id',{count:'exact',head:true}).eq('user_id',state.session.user.id)
      ]);
      state.streaks=(streaks.data||[]).sort((a,b)=>effectiveStreakDays(b)-effectiveStreakDays(a)).slice(0,5);
      const p=state.profile||{};
      host.innerHTML=`<div class="welcome-row"><div><div class="eyebrow">ТВОЙ FLAMEXBOT</div><h1>С возвращением, ${esc(p.display_name||p.username||'друг')} ${verifiedMarkMarkup(isFounderProfile(p))} ${badgeMarkup(state.profileBadges,true)}</h1><p class="muted">Твои люди, огоньки, достижения и новые возможности — в одном пространстве.</p></div><div class="date-chip"><span>✦</span> ${formatMskDate(new Date(),{day:'numeric',month:'long',weekday:'long'})}</div></div>
        <div class="hero-card"><div class="hero-copy"><div class="eyebrow">ТВОЯ ИСТОРИЯ ПРОДОЛЖАЕТСЯ</div><h2>Больше общения.<br/><em>Больше огня.</em></h2><p>Поддерживай связь с близкими, открывай достижения и собирай свою историю в FLAMEXBOT.</p><button class="primary" data-go="messages">Открыть переписки <b>→</b></button></div><div class="hero-fire"><span class="hero-fire-core">🔥</span><span class="fire-glow"></span><span class="fire-orbit fire-orbit-a"></span><span class="fire-orbit fire-orbit-b"></span></div><div class="hero-watermark">FLAME</div></div>
        <div class="stats-grid"><div class="stat-card"><span class="stat-icon">✧</span><small>ТВОЙ ТАРИФ</small><strong>${planLabel()}</strong><span class="stat-foot">Твои возможности</span></div><div class="stat-card"><span class="stat-icon">🔥</span><small>АКТИВНЫЕ ОГОНЬКИ</small><strong>${state.streaks.filter(s=>effectiveStreakDays(s)>0).length}</strong><span class="stat-foot">Общие серии</span></div><div class="stat-card"><span class="stat-icon">🏆</span><small>ДОСТИЖЕНИЯ</small><strong>${earned.count||0}</strong><span class="stat-foot">Открытые награды</span></div></div>
        <div class="section-heading"><div><div class="eyebrow">ТВОИ СВЯЗИ</div><h3>Огоньки сообщества</h3></div><button class="text-button" data-go="streaks">Все огоньки →</button></div>
        <div class="streak-list">${state.streaks.filter(s=>effectiveStreakDays(s)>0).length?state.streaks.filter(s=>effectiveStreakDays(s)>0).map(s=>`<div class="streak-row"><span class="streak-symbol">🔥</span><div class="streak-info"><b>Общий огонёк</b><small>Серия продолжается</small></div><strong>${effectiveStreakDays(s)} <small>дн.</small></strong></div>`).join(''):'<div class="empty-state">Пока нет активных серий. Найди друга и начните обмениваться сообщениями каждый день.</div>'}</div>
        <div class="home-feature-grid"><button class="home-feature-card" data-go="friends"><span>👥</span><b>Друзья</b><small>Добавляй близких и зажигай совместные серии</small><i>→</i></button><button class="home-feature-card" data-go="missions"><span>⚡</span><b>Ежедневные задания</b><small>Новые испытания и XP каждый день</small><i>→</i></button><button class="home-feature-card" data-go="achievements"><span>🏆</span><b>Коллекция достижений</b><small>Открывай награды за активность</small><i>→</i></button>${state.isAdmin?'<button class="home-feature-card" data-go="users"><span>👥</span><b>Все пользователи</b><small>Управляй сообществом FLAMEXBOT</small><i>→</i></button>':''}</div>`;
    } else if(state.page==='tariffs') await renderTariffs(host);
    else if(state.page==='messages') await renderBusinessMessages(host);
    else if(state.page==='friends') await renderFriends(host);
    else if(state.page==='streaks') await renderStreaks(host);
    else if(state.page==='missions') await renderDailyMissions(host);
    else if(state.page==='profile') await renderProfile(host);
    else if(state.page==='achievements') await renderAchievements(host);
    else if(state.page==='stats') await renderStats(host);
    else if(state.page==='commands') await renderCommands(host);
    else if(state.page==='users') await renderUsers(host);
    else if(state.page==='admin_user') await renderAdminUser(host);
    else if(state.page==='admin') await renderAdmin(host);
    host.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>{
      if(btn.dataset.filter==='verified')state.userFilters.verified='verified';
      else if(btn.dataset.filter==='premium')state.userFilters.premium='premium';
      else if(btn.dataset.filter==='banned')state.userFilters.banned='banned';
      navigateTo(btn.dataset.go);
    }));
  } catch(error) {
    console.error('FLAMEXBOT page load failed:',error);
    host.innerHTML=`<section class="load-error"><span>⚠</span><h2>Не удалось загрузить раздел</h2><p>${esc(error?.message||'Проверь соединение и попробуй ещё раз.')}</p><button class="primary" id="retry-page">Повторить загрузку</button></section>`;
    host.querySelector('#retry-page')?.addEventListener('click',()=>navigateTo(state.page));
  }
}

function refreshMissingBusinessAvatars(host) {
  const missing=state.businessChats.filter(chat=>!chat.photo_url&&!state.avatarRefreshAttempted.has(chat.id)).slice(0,4);
  if(!missing.length)return;
  missing.forEach(chat=>state.avatarRefreshAttempted.add(chat.id));
  Promise.all(missing.map(async chat=>{
    const {data,error}=await supabase.functions.invoke('business-chat-send',{body:{action:'refresh_avatar',chat_id:chat.id}});
    if(error||data?.error)return null;
    return {id:chat.id,url:data.photo_url||null};
  })).then(results=>{
    let changed=false;
    results.forEach(result=>{
      if(!result?.url)return;
      const chat=state.businessChats.find(item=>item.id===result.id);
      if(chat){chat.photo_url=result.url;changed=true;}
    });
    if(changed&&host.isConnected){
      const list=host.querySelector('.chat-list');
      if(list){list.innerHTML=renderBusinessChatChoices(state.businessChats);bindBusinessChatChoices(host);bindBusinessChatPreferences(host);}
      const active=state.businessChats.find(item=>item.id===state.activeBusinessChat);
      const head=host.querySelector('.chat-head-person');
      if(active&&head)head.innerHTML=avatar(active.photo_url,[active.first_name,active.last_name].filter(Boolean).join(' ')||active.username,'chat-avatar')+head.querySelector('div')?.outerHTML;
      if(state.activeBusinessChat)scheduleBusinessMessagesRefresh(state.activeBusinessChat,120);
    }
  }).catch(error=>console.warn('Business avatar refresh skipped:',error?.message||error));
}

function renderBusinessChatChoices(chats) {
  const q=(document.querySelector('#business-chat-search')?.value||'').trim().toLowerCase();
  const filtered=chats.filter(c=>!q||[c.username,c.first_name,c.last_name].filter(Boolean).join(' ').toLowerCase().includes(q))
    .sort((a,b)=>Number(Boolean(b.is_pinned))-Number(Boolean(a.is_pinned))||Number(Boolean(b.is_favorite))-Number(Boolean(a.is_favorite))||new Date(b.last_message_at)-new Date(a.last_message_at));
  return filtered.length ? filtered.map(c => {
    const name = [c.first_name,c.last_name].filter(Boolean).join(' ') || (c.username ? '@'+c.username : 'Telegram-пользователь');
    const active = state.activeBusinessChat === c.id;
    return `<div class="business-chat-item"><button class="chat-choice ${active ? 'active' : ''}" data-business-chat="${c.id}">${avatar(c.photo_url,name)}<span class="chat-choice-copy"><b>${c.is_pinned?'📌 ':''}${c.is_favorite?'★ ':''}${c.is_muted?'🔕 ':''}${c.antimut_enabled?'🛡 ':''}${String(c.telegram_chat_id)===FOUNDER_TELEGRAM_ID?'👑 ':''}${esc(name)}</b><small>${c.username ? '@'+esc(c.username)+' · ' : ''}${c.last_message_at ? formatMskDateTime(c.last_message_at,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Новый чат'}</small></span>${c.unread_count?'<i class="chat-unread-badge">'+(c.unread_count>99?'99+':c.unread_count)+'</i>':''}</button><button class="chat-pref" data-favorite="${c.id}" title="Избранное">${c.is_favorite?'★':'☆'}</button><button class="chat-pref" data-pin="${c.id}" title="Закрепить">${c.is_pinned?'📌':'⌖'}</button></div>`;
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


function scheduleBusinessChatListRefresh(host,delay=240) {
  if(state.businessListRefreshTimer)clearTimeout(state.businessListRefreshTimer);
  state.businessListRefreshTimer=setTimeout(()=>{
    state.businessListRefreshTimer=null;
    if(host?.isConnected)refreshBusinessChatList(host);
  },delay);
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
  const chatIds=state.businessChats.map(x=>x.id);
  const [prefsResult,unreadResult,connectionResult]=await Promise.all([
    chatIds.length?supabase.from('flamexbot_business_chat_settings').select('business_chat_id,is_favorite,is_pinned,is_muted,antimut_enabled,last_read_at').in('business_chat_id',chatIds):Promise.resolve({data:[]}),
    chatIds.length?supabase.rpc('flamexbot_business_unread_counts'):Promise.resolve({data:[]}),
    supabase.from('flamexbot_business_connections').select('is_enabled,rights').eq('profile_id',uid).maybeSingle()
  ]);
  const prefMap=Object.fromEntries((prefsResult.data||[]).map(x=>[x.business_chat_id,x]));
  const unreadMap=Object.fromEntries((unreadResult.data||[]).map(x=>[x.business_chat_id,Number(x.unread_count)||0]));
  state.businessChats=state.businessChats.map(x=>({...x,...(prefMap[x.id]||{}),unread_count:unreadMap[x.id]||0}));
  const connection=connectionResult.data;
  const connected = Boolean(connection?.is_enabled);
  state.businessRights = connection?.rights || {};
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">ПЕРЕПИСКИ TELEGRAM BUSINESS</div><h1>Переписки</h1><p class="muted">Все диалоги синхронизируются через Telegram Business. Сообщения отправляются от имени подключённого аккаунта — только в пределах выданных Telegram разрешений.</p></div>
    <div class="business-inbox-status ${connected ? 'online' : ''}"><span></span><div><b>${connected ? 'Telegram Business подключён' : 'Telegram Business не подключён'}</b><small>${connected ? 'Список диалогов обновляется автоматически.' : 'Подключи FLAMEXBOT в Telegram → Настройки → Telegram Business → Чат-боты.'}</small></div></div>
    <div class="business-inbox-tools"><input id="business-chat-search" type="search" placeholder="Найти диалог по имени"/><div class="quick-replies"><button type="button" data-quick-reply="Привет! Чем могу помочь?">Привет</button><button type="button" data-quick-reply="Спасибо за сообщение!">Спасибо</button><button type="button" data-quick-reply="Сейчас уточню и вернусь с ответом.">Уточню</button></div></div><div class="chat-layout business-inbox"><aside class="chat-list">${renderBusinessChatChoices(state.businessChats)}</aside>
    <section class="chat-window" id="business-chat-window"><div class="chat-placeholder"><span>✈</span><b>Твои переписки</b><small>Выбери диалог, чтобы открыть историю сообщений и настройки.</small></div></section></div>`;
  bindBusinessChatChoices(host);bindBusinessChatPreferences(host);bindBusinessSearch(host);
  refreshMissingBusinessAvatars(host);
  host.querySelectorAll('[data-quick-reply]').forEach(btn=>btn.addEventListener('click',()=>{const input=document.querySelector('#business-send-form input[name=content]');if(input){input.value=btn.dataset.quickReply;input.focus();}}));
  state.businessListChannel = supabase.channel(`business-chat-list-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'flamexbot_business_chats', filter: `profile_id=eq.${uid}` }, () => scheduleBusinessChatListRefresh(host))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Не удалось подключить обновление переписок');
    });
  // The initial chat list is already populated above; realtime keeps it current.
}

function renderBusinessBubble(message, mediaUrl = '') {
  const mine = message.direction === 'outbound';
  const chat=state.businessChats.find(item=>item.id===state.activeBusinessChat);
  const chatName=[chat?.first_name,chat?.last_name].filter(Boolean).join(' ')||chat?.username||'Telegram-пользователь';
  const senderAvatar=mine?avatar(state.profile?.avatar_url||state.profile?.telegram_photo_url,state.profile?.display_name||state.profile?.username||'Ты','message-avatar mine-avatar'):avatar(chat?.photo_url,chatName,'message-avatar');
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
  const bubble = `<div class="bubble ${mine ? 'mine' : ''}">${reply}${content ? `<div>${esc(content)}</div>` : ''}${media}<div class="bubble-footer"><small>${formatMskTime(message.created_at)}</small>${replyButton}</div></div>`;
  return mine?`<div class="bubble-row mine">${bubble}${senderAvatar}</div>`:`<div class="bubble-row">${senderAvatar}${bubble}</div>`;
}


function scheduleBusinessMessagesRefresh(chatId,delay=180) {
  const old=state.messageRefreshTimers.get(chatId);
  if(old)clearTimeout(old);
  const timer=setTimeout(()=>{
    state.messageRefreshTimers.delete(chatId);
    refreshBusinessMessages(chatId);
  },delay);
  state.messageRefreshTimers.set(chatId,timer);
}
async function refreshBusinessMessages(chatId) {
  if(state.messageRefreshInFlight.has(chatId)){
    state.messageRefreshPending.add(chatId);
    return;
  }
  state.messageRefreshInFlight.add(chatId);
  try{await refreshBusinessMessagesNow(chatId);}
  finally{
    state.messageRefreshInFlight.delete(chatId);
    if(state.messageRefreshPending.delete(chatId))scheduleBusinessMessagesRefresh(chatId,120);
  }
}

async function refreshBusinessMessagesNow(chatId) {
  if (state.activeBusinessChat !== chatId) return;
  const list = document.querySelector('#business-message-list');
  if (!list) return;
  const { data, error } = await supabase.from('flamexbot_business_messages')
    .select('id,telegram_message_id,direction,content,message_type,media_file_id,media_url,reply_to_message_id,created_at,deleted_at,raw')
    .eq('business_chat_id', chatId).order('created_at', { ascending: false }).limit(100);
  if (state.activeBusinessChat !== chatId) return;
  if (error) { list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  state.businessMessages = (data || []).reverse();
  const latestInbound=state.businessMessages.filter(m=>m.direction==='inbound').reduce((latest,m)=>!latest||new Date(m.created_at)>new Date(latest)?m.created_at:latest,null);
  const openChat=state.businessChats.find(chat=>chat.id===chatId);
  if(!document.hidden&&latestInbound&&(!openChat?.last_read_at||new Date(latestInbound)>new Date(openChat.last_read_at))){
    const readAt=new Date().toISOString();
    const {error:readError}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:chatId,last_read_at:readAt},{onConflict:'profile_id,business_chat_id'});
    if(!readError){if(openChat){openChat.last_read_at=readAt;openChat.unread_count=0;}document.querySelector(`[data-business-chat="${chatId}"] .chat-unread-badge`)?.remove();}
  }
  const query=(document.querySelector('#business-message-search')?.value||'').trim().toLowerCase();
  const visible=state.businessMessages.filter(m=>{
    if(!query)return true;
    const raw=m.raw||{};
    const fileName=raw.document?.file_name||raw.audio?.file_name||raw.video?.file_name||raw.animation?.file_name||'';
    return [m.content,fileName,m.message_type].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  const mediaUrls = {};
  const mediaPaths=[...new Set(visible.filter(m=>m.media_url).map(m=>m.media_url))];
  const missingPaths=mediaPaths.filter(path=>!state.businessMediaUrlCache.has(path));
  if(missingPaths.length){
    try{
      const {data,error}=await supabase.storage.from('flamex-business-media').createSignedUrls(missingPaths,3600);
      if(!error)for(const item of data||[])if(item.path&&item.signedUrl)state.businessMediaUrlCache.set(item.path,item.signedUrl);
    }catch(error){console.warn('Business media preview:',error?.message||error);}
  }
  visible.forEach(message=>{if(message.media_url){const url=state.businessMediaUrlCache.get(message.media_url);if(url)mediaUrls[message.id]=url;}});
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
  const readAt=new Date().toISOString();
  const {error:readError}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,is_favorite:Boolean(chat.is_favorite),is_pinned:Boolean(chat.is_pinned),last_read_at:readAt},{onConflict:'profile_id,business_chat_id'});
  if(!readError){chat.last_read_at=readAt;chat.unread_count=0;document.querySelector(`[data-business-chat="${id}"] .chat-unread-badge`)?.remove();}
  box.closest('.business-inbox')?.classList.add('chat-open');
  box.innerHTML = `<div class="chat-head"><button type="button" class="chat-back" id="business-chat-back">← Все чаты</button><div class="chat-head-person">${avatar(chat.photo_url,name,'chat-avatar')}<div><b>${esc(name)}</b><small>${founderChat ? 'Защищённый диалог владельца' : 'Управление командами доступно прямо в этой переписке'}${chat.username ? ' · @'+esc(chat.username) : ''}</small></div></div><input class="message-search" id="business-message-search" type="search" placeholder="Поиск по переписке…"/></div><div id="business-chat-controls"></div><div class="message-list" id="business-message-list"><div class="empty-state">Загружаю сообщения…</div></div><div class="reply-preview" id="business-reply-preview" hidden><span></span><button type="button" id="cancel-business-reply" aria-label="Отменить ответ">×</button></div><form class="send-form" id="business-send-form"><label class="attach-file-button" for="business-media-input" title="Прикрепить файл">＋</label><input id="business-media-input" class="business-media-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,application/pdf,text/plain,text/csv,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/rtf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" /><input name="content" placeholder="Сообщение или подпись к файлу…" maxlength="4096"/><input type="hidden" name="reply_to_message_id"/><button class="primary" type="submit">➤</button></form><div class="selected-media" id="selected-business-media" hidden></div><div class="upload-hint">Фото, видео, аудио и документы до 20 МБ · отправка через Telegram Business.</div>`;
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
  document.querySelector('#business-message-search')?.addEventListener('input',()=>scheduleBusinessMessagesRefresh(id,160));
  state.businessChatChannel = supabase.channel(`business-chat-${id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'flamexbot_business_messages',filter:`business_chat_id=eq.${id}`},() => scheduleBusinessMessagesRefresh(id,180))
    .subscribe(status => {
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
  const {data:allowed,error:accessError}=await supabase.rpc('is_flamexbot_admin');
  if(accessError||allowed!==true||!state.isAdmin){
    host.innerHTML='<div class="page-heading"><div class="eyebrow">ACCESS DENIED</div><h1>Нет доступа</h1><p class="muted">Административные инструменты доступны только уполномоченному владельцу.</p></div>';
    return;
  }
  const [all,verified,premium,banned,audit]=await Promise.all([
    supabase.rpc('admin_list_flamexbot_users',{p_limit:1,p_offset:0,p_verified:'all',p_premium:'all',p_banned:'all'}),
    supabase.rpc('admin_list_flamexbot_users',{p_limit:1,p_offset:0,p_verified:'verified',p_premium:'all',p_banned:'all'}),
    supabase.rpc('admin_list_flamexbot_users',{p_limit:1,p_offset:0,p_verified:'all',p_premium:'premium',p_banned:'all'}),
    supabase.rpc('admin_list_flamexbot_users',{p_limit:1,p_offset:0,p_verified:'all',p_premium:'all',p_banned:'banned'}),
    supabase.rpc('admin_list_flamexbot_audit',{p_limit:10})
  ]);
  const count=result=>result.data?.[0]?.total_count||0;
  const actionLabels={
    ban:'Заблокирован аккаунт',unban:'Снята блокировка',verify:'Выдана синяя галочка',
    unverify:'Снята синяя галочка',premium_grant:'Выдан или продлён Premium',
    premium_revoke:'Снят Premium',badge_grant:'Выдан значок роли',badge_revoke:'Снят значок роли'
  };
  const auditRows=(audit.data||[]).map(item=>{
    const extra=item.reason||item.badge_code||(item.duration_days!=null?'Срок: '+(item.duration_days===0?'бессрочно':item.duration_days+' дн.'):'');
    const icon=item.action==='ban'?'⛔':item.action==='verify'?'🔵':item.action.includes('premium')?'✦':item.action.includes('badge')?'🏷️':'🛡';
    return `<article class="admin-audit-row">
      <span class="admin-audit-icon">${icon}</span>
      <div class="admin-audit-copy"><b>${esc(actionLabels[item.action]||item.action)}</b><small>${esc(item.target_name||'Пользователь')} · ${esc(item.actor_name||'Администратор')}${extra?' · '+esc(extra):''}</small></div>
      <time>${formatMskDateTime(item.created_at,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time>
    </article>`;
  }).join('');
  host.innerHTML=`<div class="page-heading admin-heading"><div class="eyebrow">FOUNDER CONTROL CENTER</div><h1>Админ-панель <span>⚙</span></h1><p class="muted">Управление участниками, верификацией, подписками и безопасностью проекта.</p></div>
    <section class="admin-welcome-card"><div class="admin-welcome-orb">✦</div><div><span class="admin-live-pill"><i></i> FOUNDER ACCESS</span><h2>Добро пожаловать, владелец</h2><p>Все административные действия проверяются сервером. Значки ролей не дают права доступа к панели — права остаются только у владельца.</p></div><span class="admin-crown">👑</span></section>
    <div class="admin-stat-grid">
      <article class="admin-stat"><span>👥</span><small>ВСЕ УЧАСТНИКИ</small><b>${count(all)}</b><em>Зарегистрировано</em></article>
      <article class="admin-stat"><span>🔵</span><small>ВЕРИФИЦИРОВАНЫ</small><b>${count(verified)}</b><em>С синей галочкой</em></article>
      <article class="admin-stat"><span>✦</span><small>PREMIUM</small><b>${count(premium)}</b><em>Активные подписки</em></article>
      <article class="admin-stat"><span>⛔</span><small>ЗАБЛОКИРОВАНЫ</small><b>${count(banned)}</b><em>Модерация</em></article>
    </div>
    <div class="admin-section-title"><div><div class="eyebrow">CONTROL MODULES</div><h3>Инструменты управления</h3></div><span class="admin-secure">🔐 Защищённый доступ</span></div>
    <div class="admin-module-grid">
      <button class="admin-module" data-go="users"><span class="admin-module-icon users">👥</span><b>Все пользователи</b><small>Поиск, сортировка, фильтры и карточки участников</small><i>Открыть →</i></button>
      <button class="admin-module" data-admin-filter="verified"><span class="admin-module-icon verify">🔵</span><b>Верификация</b><small>Синие галочки и официальные значки ролей</small><i>Управлять →</i></button>
      <button class="admin-module" data-admin-filter="premium"><span class="admin-module-icon premium">✦</span><b>Premium</b><small>Выдача, продление и снятие подписки</small><i>Управлять →</i></button>
      <button class="admin-module" data-admin-filter="banned"><span class="admin-module-icon moderation">🛡</span><b>Модерация</b><small>Блокировка аккаунтов и снятие ограничений</small><i>Управлять →</i></button>
    </div>
    <section class="admin-security-card"><div><span>🧬</span><div><b>Защита владельца активна</b><small>Аккаунт владельца защищён от блокировки, снятия Premium, синей галочки и значков ролей. Значки администратора и разработчика не выдают доступ к панели.</small></div></div><span class="business-status is-connected">SECURE</span></section>
    <section class="admin-audit-panel"><div class="section-heading"><div><div class="eyebrow">SECURITY HISTORY</div><h3>Журнал действий</h3></div><span class="admin-secure">Последние 10 событий</span></div>
      <div class="admin-audit-list">${auditRows||'<div class="empty-state">Административных действий пока нет. Здесь появится история блокировок, галочек и Premium.</div>'}</div>
      ${audit.error?'<p class="business-warning">Не удалось загрузить журнал действий: '+esc(audit.error.message)+'</p>':''}
    </section>
    ${all.error||verified.error||premium.error||banned.error?'<p class="business-warning">Не удалось загрузить часть административной статистики.</p>':''}`;
  host.querySelectorAll('[data-admin-filter]').forEach(btn=>btn.addEventListener('click',()=>{
    const filter=btn.dataset.adminFilter;
    state.userFilters={...state.userFilters,verified:filter==='verified'?'verified':'all',premium:filter==='premium'?'premium':'all',banned:filter==='banned'?'banned':'all',offset:0};
    navigateTo('users');
  }));
}

async function renderUsers(host) {
  const {data:allowed,error:accessError}=await supabase.rpc('is_flamexbot_admin');
  if(accessError||allowed!==true||!state.isAdmin){
    host.innerHTML='<div class="page-heading"><h1>Нет доступа</h1><p class="muted">Раздел доступен только владельцу и администраторам FLAMEXBOT.</p></div>';
    return;
  }
  const filters=state.userFilters;
  const {data,error}=await supabase.rpc('admin_list_flamexbot_users',{
    p_search:filters.search||null,p_verified:filters.verified,p_premium:filters.premium,p_banned:filters.banned,p_limit:50,p_offset:filters.offset||0
  });
  const users=data||[];
  const actorOwner=state.session.user.id===FOUNDER_PROFILE_ID;
  const total=users[0]?.total_count||0;
  const roleOptions=[
    ...(actorOwner?[['developer','Разработчик'],['administrator','Администратор']]:[]),
    ['moderator','Модератор'],['designer','Дизайнер'],['creator','Создатель'],['supporter','Поддержка'],
    ['beta_tester','Бета-тестер'],['community_manager','Комьюнити'],['partner','Партнёр']
  ];
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">COMMUNITY DIRECTORY</div><h1>Управление пользователями <span>👥</span></h1><p class="muted">Открой карточку участника для отдельного управления. На каждом аккаунте может быть только один значок роли; новый заменяет предыдущий.</p></div>
    <section class="users-toolbar-card">
      <form id="users-filter-form" class="users-filter-form">
        <label class="users-search-field"><span>⌕</span><input name="search" value="${esc(filters.search)}" placeholder="Имя, никнейм или Telegram ID"/></label>
        <select name="verified"><option value="all" ${filters.verified==='all'?'selected':''}>Все галочки</option><option value="verified" ${filters.verified==='verified'?'selected':''}>🔵 С галочкой</option><option value="unverified" ${filters.verified==='unverified'?'selected':''}>Без галочки</option></select>
        <select name="premium"><option value="all" ${filters.premium==='all'?'selected':''}>Все тарифы</option><option value="premium" ${filters.premium==='premium'?'selected':''}>✦ Premium</option><option value="free" ${filters.premium==='free'?'selected':''}>Free</option></select>
        <select name="banned"><option value="all" ${filters.banned==='all'?'selected':''}>Все статусы</option><option value="active" ${filters.banned==='active'?'selected':''}>Активные</option><option value="banned" ${filters.banned==='banned'?'selected':''}>Заблокированные</option></select>
        <button class="primary small" type="submit">Применить фильтры</button>
      </form>
      <div class="users-toolbar-foot"><span>Найдено участников: <b>${total}</b></span><span>Сортировка: <b>сначала новые ↓</b></span></div>
    </section>
    <div class="admin-user-list">${users.map(u=>{
      const owner=u.telegram_id===FOUNDER_TELEGRAM_ID||u.id===FOUNDER_PROFILE_ID;
      const targetAdmin=owner||(u.badge_codes||[]).some(code=>['founder','developer','administrator'].includes(code));
      const locked=owner||(targetAdmin&&state.session.user.id!==FOUNDER_PROFILE_ID);
      const badges=[...(u.badge_codes||[])];
      if(u.is_premium&&!badges.includes('premium'))badges.push('premium');
      const currentRole=badges.find(code=>code!=='premium')||'';
      const display=u.display_name||u.username||'Пользователь';
      return `<article class="admin-user-card" data-user-card="${u.id}">
        <div class="admin-user-main"><div class="admin-user-avatar">${avatar(u.avatar_url,display,'avatar-lg')}</div><div class="admin-user-identity"><div class="admin-user-name"><b>${esc(display)}${verifiedMarkMarkup(Boolean(u.is_verified)||owner)}</b>${badgeMarkup(badges,false,false)}</div><small>${u.telegram_username?'@'+esc(u.telegram_username):'Telegram не привязан'} · ${u.telegram_id?'ID '+esc(u.telegram_id):'Web-аккаунт'}</small><small>В FLAMEXBOT с ${formatMskDate(u.created_at)}</small></div><div class="admin-user-flags">${u.is_banned?'<span class="user-flag banned">⛔ Заблокирован</span>':'<span class="user-flag active">● Активен</span>'}${u.is_premium?'<span class="user-flag premium">✦ Premium</span>':'<span class="user-flag free">Free</span>'}</div></div>
        <div class="admin-user-actions">
          <button class="admin-action" data-admin-open="${u.id}">Открыть управление →</button>
          <button class="admin-action ${u.is_verified?'verified':''}" data-user-action="${u.is_verified?'unverify':'verify'}" data-user-id="${u.id}" ${locked?'disabled':''}>${u.is_verified?'🔵 Снять галочку':'🔵 Выдать галочку'}</button>
          <button class="admin-action ${u.is_banned?'safe':''}" data-user-action="${u.is_banned?'unban':'ban'}" data-user-id="${u.id}" ${locked?'disabled':''}>${u.is_banned?'♻ Разблокировать':'⛔ Заблокировать'}</button>
          <button class="admin-action premium" data-user-action="premium_grant" data-user-id="${u.id}" ${locked?'disabled':''}>✦ ${owner?'Premium владельца':u.is_premium?'Продлить Premium':'Выдать Premium'}</button>
          <button class="admin-action" data-user-action="premium_revoke" data-user-id="${u.id}" ${!u.is_premium||locked?'disabled':''}>Снять Premium</button>
        </div>
        <div class="admin-role-controls"><label>Заменить значок<select data-role-select="${u.id}" ${locked?'disabled':''}><option value="">Выбрать значок…</option>${roleOptions.map(([code,label])=>`<option value="${code}" ${currentRole===code?'selected':''}>${label}${currentRole===code?' · текущий':''}</option>`).join('')}</select></label><button class="outline small" data-user-action="badge_grant" data-user-id="${u.id}">Заменить значок</button><label>Снять значок<select data-role-remove="${u.id}" ${locked?'disabled':''}><option value="">Выбрать значок…</option>${badges.filter(x=>x!=='verified'&&x!=='founder'&&x!=='premium').map(code=>`<option value="${code}">${esc(BADGE_META[code]?.label||code)}</option>`).join('')}</select></label><button class="outline small" data-user-action="badge_revoke" data-user-id="${u.id}" ${locked?'disabled':''} title="${locked?'Аккаунт администрации защищён от других администраторов':'Снять значок'}">Снять</button>
        </div>
      </article>`;
    }).join('')||'<div class="empty-state">По заданным фильтрам никого не найдено.</div>'}</div>
    <div class="users-pagination"><button class="outline small" id="users-prev" ${(filters.offset||0)<=0?'disabled':''}>← Назад</button><span>Страница ${Math.floor((filters.offset||0)/50)+1} из ${Math.max(1,Math.ceil(total/50))}</span><button class="outline small" id="users-next" ${(filters.offset||0)+50>=total?'disabled':''}>Дальше →</button></div>
    ${error?'<p class="business-warning">Не удалось загрузить пользователей: '+esc(error.message)+'</p>':''}`;
  host.querySelectorAll('[data-admin-open]').forEach(btn=>btn.addEventListener('click',()=>{state.selectedAdminUserId=btn.dataset.adminOpen;navigateTo('admin_user');}));
  host.querySelector('#users-prev')?.addEventListener('click',()=>{state.userFilters.offset=Math.max(0,(filters.offset||0)-50);renderUsers(host);});
  host.querySelector('#users-next')?.addEventListener('click',()=>{state.userFilters.offset=(filters.offset||0)+50;renderUsers(host);});
  host.querySelector('#users-filter-form')?.addEventListener('submit',event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget);
    state.userFilters={search:String(fd.get('search')||'').trim(),verified:String(fd.get('verified')||'all'),premium:String(fd.get('premium')||'all'),banned:String(fd.get('banned')||'all'),offset:0};
    renderUsers(host);
  });
  host.querySelectorAll('[data-user-action]').forEach(btn=>btn.addEventListener('click',async()=>{
    const action=btn.dataset.userAction,userId=btn.dataset.userId;
    const card=btn.closest('[data-user-card]');
    let reason=null,days=30,badgeCode=null;
    if(action==='ban'){reason=prompt('Причина блокировки (будет сохранена в карточке пользователя):','Нарушение правил сообщества');if(reason===null)return;}
    if(action==='premium_grant'){const raw=prompt('На сколько дней выдать или продлить Premium? Введи 0 для бессрочной подписки.','30');if(raw===null)return;days=Number(raw);if(!Number.isInteger(days)||days<0||days>3650){toast('Укажи число от 0 до 3650');return;}}
    if(action==='badge_grant')badgeCode=card?.querySelector('[data-role-select]')?.value||null;
    if(action==='badge_revoke')badgeCode=card?.querySelector('[data-role-remove]')?.value||null;
    if(['badge_grant','badge_revoke'].includes(action)&&!badgeCode){toast('Сначала выбери значок');return;}
    if(['unban','premium_revoke','unverify','badge_revoke'].includes(action)&&!confirm('Подтвердить это действие?'))return;
    btn.disabled=true;
    const {data, error:actionError}=await supabase.rpc('admin_manage_flamexbot_user',{
      p_user_id:userId,p_action:action,p_badge_code:badgeCode,p_reason:reason,p_days:days
    });
    if(actionError){toast('Не удалось выполнить действие: '+actionError.message);btn.disabled=false;return;}
    toast(({ban:'Пользователь заблокирован',unban:'Блокировка снята',verify:'Синяя галочка выдана',unverify:'Галочка снята',premium_grant:'Premium выдан или продлён',premium_revoke:'Premium отключён',badge_grant:'Значок выдан',badge_revoke:'Значок снят'})[action]||'Изменения сохранены');
    await renderUsers(host);
  }));
}

async function renderAdminUser(host) {
  if(!state.selectedAdminUserId){host.innerHTML='<div class="empty-state">Сначала выбери пользователя в списке.</div><button class="outline" data-go="users">К списку пользователей</button>';return;}
  const {data,error}=await supabase.rpc('admin_get_flamexbot_user',{p_user_id:state.selectedAdminUserId});
  const u=data?.[0];
  if(error||!u){host.innerHTML=`<div class="page-heading"><h1>Не удалось открыть карточку</h1><p class="muted">${esc(error?.message||'Пользователь не найден')}</p></div><button class="outline" data-go="users">← К пользователям</button>`;return;}
  const owner=u.telegram_id===FOUNDER_TELEGRAM_ID||u.id===FOUNDER_PROFILE_ID;
  const badges=u.badge_codes||[];
  const actorOwner=state.session.user.id===FOUNDER_PROFILE_ID;
  const targetAdmin=owner||badges.some(code=>['founder','developer','administrator'].includes(code));
  const locked=owner||(targetAdmin&&state.session.user.id!==FOUNDER_PROFILE_ID);
  const roleOptions=[['verified','Подтверждён'],...(actorOwner?[['developer','Разработчик'],['administrator','Администратор']]:[]),['moderator','Модератор'],['designer','Дизайнер'],['creator','Создатель'],['supporter','Поддержка'],['beta_tester','Бета-тестер'],['community_manager','Комьюнити'],['partner','Партнёр']];
  const premiumUntil=u.is_premium?(u.premium_expires_at?formatMskDate(u.premium_expires_at):'Бессрочно'):'Не активен';
  host.innerHTML=`<div class="page-heading"><button class="text-button" data-go="users">← Все пользователи</button><div class="eyebrow">ADMIN USER CONTROL</div><h1>Управление аккаунтом</h1><p class="muted">Все изменения проходят серверную проверку и попадают в журнал администрации.</p></div>
    <section class="admin-user-detail-card"><div class="admin-user-detail-top">${avatar(u.avatar_url||u.telegram_photo_url,u.display_name||u.username,'avatar-xl')}<div><h2>${esc(u.display_name||u.username||'Пользователь')}${verifiedMarkMarkup(Boolean(u.is_verified)||owner)}</h2><p>@${esc(u.telegram_username||u.username||'не задан')} · ${u.telegram_id?'Telegram ID '+esc(u.telegram_id):'Telegram не привязан'}</p><div class="profile-badge-row">${badgeMarkup(badges,false,false)} ${u.is_premium?badgeMarkup(['premium'],false,false):''}</div></div></div>
      <div class="admin-detail-status"><span class="user-flag ${u.is_banned?'banned':'active'}">${u.is_banned?'⛔ Заблокирован':'● Активен'}</span><span class="user-flag ${u.is_premium?'premium':'free'}">${u.is_premium?'✦ Premium':'Free'}</span><span class="user-flag">${u.is_verified?'🔵 Подтверждён':'Без галочки'}</span></div>
      <div class="admin-detail-metrics"><div><small>СООБЩЕНИЯ</small><b>${u.total_messages||0}</b></div><div><small>ДРУЗЬЯ</small><b>${u.friends_count||0}</b></div><div><small>ЛУЧШАЯ СЕРИЯ</small><b>${u.best_streak||0} дн.</b></div><div><small>ДОСТИЖЕНИЯ</small><b>${u.achievements_count||0}</b></div><div><small>ОПЫТ</small><b>${u.xp||0} XP</b></div><div><small>PREMIUM ДО</small><b>${premiumUntil}</b></div></div>
      <div class="admin-detail-actions"><h3>Действия с аккаунтом</h3><div class="admin-detail-action-grid">
        <button class="admin-action" data-admin-detail-action="${u.is_verified?'unverify':'verify'}" ${locked?'disabled':''}>${u.is_verified?'🔵 Снять подтверждение':'🔵 Подтвердить аккаунт'}</button>
        <button class="admin-action ${u.is_banned?'safe':''}" data-admin-detail-action="${u.is_banned?'unban':'ban'}" ${locked?'disabled':''}>${u.is_banned?'♻ Разблокировать':'⛔ Заблокировать'}</button>
        <button class="admin-action premium" data-admin-detail-action="premium_grant" ${locked?'disabled':''}>✦ ${u.is_premium?'Продлить Premium':'Выдать Premium'}</button>
        <button class="admin-action" data-admin-detail-action="premium_revoke" ${!u.is_premium||locked?'disabled':''}>Снять Premium</button>
      </div>
      <div class="admin-detail-badge-form"><label>Единственный значок аккаунта<select id="admin-detail-badge" ${locked?'disabled':''}><option value="">Выбрать значок…</option>${roleOptions.map(([code,label])=>`<option value="${code}">${label}</option>`).join('')}</select></label><button class="primary small" data-admin-detail-action="badge_grant" ${locked?'disabled':''}>Заменить значок</button><button class="outline small" data-admin-detail-action="badge_revoke" ${locked?'disabled':''}>Снять значок</button></div>
      <small class="admin-detail-note">На одном аккаунте может быть только один значок роли. Выдача нового заменяет предыдущий. Premium отображается отдельно и не занимает слот значка.</small>
      ${locked&&!owner?'<p class="business-warning">Управлять аккаунтом другого администратора может только владелец FLAMEXBOT.</p>':''}
      ${u.is_banned&&u.ban_reason?'<p class="business-warning">Причина блокировки: '+esc(u.ban_reason)+'</p>':''}
    </div></section>`;
  host.querySelectorAll('[data-admin-detail-action]').forEach(btn=>btn.addEventListener('click',async()=>{
    const action=btn.dataset.adminDetailAction;
    let reason=null,days=30,badgeCode=null;
    if(action==='ban'){reason=prompt('Причина блокировки:','Нарушение правил сообщества');if(reason===null)return;}
    if(action==='premium_grant'){const raw=prompt('На сколько дней выдать или продлить Premium? 0 — бессрочно.','30');if(raw===null)return;days=Number(raw);if(!Number.isInteger(days)||days<0||days>3650){toast('Укажи число от 0 до 3650');return;}}
    if(action==='badge_grant'||action==='badge_revoke'){badgeCode=host.querySelector('#admin-detail-badge')?.value||badges[0]||null;if(!badgeCode){toast('Выбери значок');return;}}
    if(['ban','unban','unverify','premium_revoke','badge_revoke'].includes(action)&&!confirm('Подтвердить действие?'))return;
    btn.disabled=true;
    const {error:actionError}=await supabase.rpc('admin_manage_flamexbot_user',{p_user_id:u.id,p_action:action,p_badge_code:badgeCode,p_reason:reason,p_days:days});
    if(actionError){toast('Не удалось выполнить действие: '+actionError.message);btn.disabled=false;return;}
    toast(({ban:'Аккаунт заблокирован',unban:'Блокировка снята',verify:'Аккаунт подтверждён',unverify:'Подтверждение снято',premium_grant:'Premium выдан или продлён',premium_revoke:'Premium отключён',badge_grant:'Значок заменён',badge_revoke:'Значок снят'})[action]||'Готово');
    await renderAdminUser(host);
  }));
}

async function renderTariffs(host) {
 const premium=isPremium();
 const lifetime=premium&&!state.subscription?.expires_at;
 const expires=state.subscription?.expires_at?formatMskDate(state.subscription.expires_at):'Без срока';
 const buyLabel=premium?'↻ Продлить Premium за 100 ⭐':'⭐ Оплатить 100 Stars';
 host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT MEMBERSHIP</div><h1>Тарифы и возможности <span>✦</span></h1><p class="muted">Больше контроля над Telegram Business, удобные инструменты и расширенные возможности аккаунта.</p></div>
 <div class="tariff-grid">
  <section class="business-card tariff-card ${!premium?'tariff-current':''}">
   <div class="eyebrow">СТАРТ</div><h2>Free</h2><p class="muted">Всё необходимое, чтобы пользоваться FLAMEXBOT и оставаться на связи.</p>
   <ul><li>Telegram Mini App и профиль</li><li>Подключение Telegram Business</li><li>Переписки, отправка текста и файлов</li><li>Друзья, огоньки и ежедневные задания</li><li>Достижения, уровни и базовая статистика</li></ul>
   <span class="business-status ${!premium?'is-connected':''}">${!premium?'Твой текущий тариф':'Бесплатно'}</span>
  </section>
  <section class="business-card tariff-card premium-card ${premium?'tariff-current':''}">
   <div class="eyebrow">БОЛЬШЕ КОНТРОЛЯ</div><h2>⭐ FLAMEX Premium</h2><p class="muted">Дополнительные инструменты для управления Business-диалогами и оформления аккаунта.</p>
   <ul>
    <li><code>.mute</code> / <code>.unmute</code> — управление удалением новых входящих сообщений</li>
    <li><code>.antimute on/off</code> — безопасное включение ручной попытки отправки</li>
    <li><code>.antimute текст</code> — одна отправка через разрешённый Telegram Business</li>
    <li>AFK-автоответ и автоматическое прочтение сообщений</li>
    <li>Статусы «печатает…» и «записывает голосовое»</li>
    <li>Фильтр входящих стикеров, время профиля по МСК и оформление текста</li>
    <li>Премиум-эмодзи в сообщениях и уведомлениях, если их поддерживает Telegram</li>
    <li>Расширенные настройки и управление Business-диалогами</li>
   </ul>
   <div class="premium-price-line"><b>100 ⭐</b><span>30 дней · разовая оплата</span></div>
   <span class="business-status ${premium?'is-connected':''}">${premium?'Premium активен · '+(lifetime?'бессрочно':'до '+expires):'Подписка не активна'}</span>
   ${lifetime?'':'<button class="primary premium-buy-button" id="buy-premium" type="button">'+buyLabel+'</button>'}
   <small class="premium-payment-note">Оплата проходит внутри Telegram. Подписка действует 30 дней и не продлевается автоматически.</small>
  </section>
 </div>
 <div class="business-command-hint"><span>⌘</span><div><b>Команды отправляются прямо в нужной переписке</b><small>Открой Business-диалог с человеком и отправь команду туда. FLAMEXBOT сам определит текущий чат — без @username и ID.</small></div></div>
 <p class="business-note">Антимут не снимает блокировки и не обходит ограничения Telegram: он выполняет только одну ручную попытку отправки. Если Telegram отказывает, FLAMEXBOT показывает причину и не повторяет отправку автоматически.</p>`;
 const buyButton=host.querySelector('#buy-premium');
 buyButton?.addEventListener('click',async()=>{
   buyButton.disabled=true;buyButton.classList.add('is-loading');buyButton.textContent='Подготавливаем оплату…';
   try{
     const {data,error}=await supabase.functions.invoke('create-premium-invoice');
     if(error||data?.error||!data?.invoice_link)throw new Error(data?.error||error?.message||'Не удалось создать ссылку на оплату');
     const webApp=window.Telegram?.WebApp;
     if(typeof webApp?.openInvoice!=='function'){
       if(typeof webApp?.openTelegramLink==='function')webApp.openTelegramLink(data.invoice_link);
       else window.open(data.invoice_link,'_blank','noopener');
       toast('Открываем счёт Telegram Stars');
       return;
     }
     webApp.openInvoice(data.invoice_link,async status=>{
       if(status==='paid'){
         toast('Оплата принята. Активируем Premium…');
         let activated=false;
         for(let attempt=0;attempt<8;attempt++){
           const {data:subscription}=await supabase.from('user_subscriptions').select('plan,expires_at,starts_at').eq('user_id',state.session.user.id).maybeSingle();
           if(subscription?.plan==='premium'&&(!subscription.expires_at||new Date(subscription.expires_at).getTime()>Date.now())){
             state.subscription=subscription;activated=true;break;
           }
           await new Promise(resolve=>setTimeout(resolve,900));
         }
         updateHeaderProfile();
         toast(activated?'⭐ Premium успешно активирован!':'Платёж получен. Статус Premium обновится в ближайшие секунды.');
         await renderTariffs(host);
       }else if(status==='cancelled')toast('Оплата отменена. Списания не произошло.');
       else if(status==='failed')toast('Telegram не смог завершить оплату. Попробуй ещё раз.');
       else if(status==='pending')toast('Платёж обрабатывается. Premium появится после подтверждения Telegram.');
     });
   }catch(error){toast('Оплата не запущена: '+(error?.message||'неизвестная ошибка'));}
   finally{if(host.contains(buyButton)){buyButton.disabled=false;buyButton.classList.remove('is-loading');buyButton.textContent=buyLabel;}}
 });
}

function effectiveStreakDays(streak) {
  if(!streak)return 0;
  const days=Math.max(0,Number(streak.current_days)||0);
  if(!days)return 0;
  if(streak.expires_at)return new Date(streak.expires_at).getTime()>Date.now()?days:0;
  if(!streak.last_activity_date)return 0;
  const today=moscowDateKey();
  const yesterday=moscowDateKey(new Date(Date.now()-86400000));
  return streak.last_activity_date===today||streak.last_activity_date===yesterday?days:0;
}

async function renderFriends(host) {
  const uid=state.session.user.id;
  const [friendRows,incoming,outgoing,streakResult]=await Promise.all([
    supabase.from('friendships').select('user_low,user_high').or(`user_low.eq.${uid},user_high.eq.${uid}`),
    supabase.from('friend_requests').select('id,sender_id,created_at').eq('receiver_id',uid).eq('status','pending').order('created_at',{ascending:false}),
    supabase.from('friend_requests').select('id,receiver_id,created_at').eq('sender_id',uid).eq('status','pending').order('created_at',{ascending:false}),
    supabase.from('streaks').select('*').or(`user_low.eq.${uid},user_high.eq.${uid}`)
  ]);
  const friendIds=(friendRows.data||[]).map(x=>x.user_low===uid?x.user_high:x.user_low);
  const incomingIds=(incoming.data||[]).map(x=>x.sender_id);
  const outgoingIds=(outgoing.data||[]).map(x=>x.receiver_id);
  const ids=[...new Set([...friendIds,...incomingIds,...outgoingIds])];
  const [profileResult,badgeResult,searchResult]=await Promise.all([
    ids.length?supabase.from('profiles').select('id,username,display_name,avatar_url,telegram_photo_url,telegram_username,telegram_id').in('id',ids):Promise.resolve({data:[],error:null}),
    ids.length?supabase.from('profile_badges').select('user_id,badge_code').in('user_id',ids):Promise.resolve({data:[],error:null}),
    state.friendSearchQuery.length>=2
      ?supabase.rpc('search_flamexbot_profiles',{p_query:state.friendSearchQuery,p_limit:15})
      :Promise.resolve({data:[],error:null})
  ]);
  const profileMap=new Map((profileResult.data||[]).map(p=>[p.id,p]));
  const badgeMap=new Map();
  (badgeResult.data||[]).forEach(b=>{if(!badgeMap.has(b.user_id))badgeMap.set(b.user_id,[]);badgeMap.get(b.user_id).push(b.badge_code);});
  const friendSet=new Set(friendIds);
  const incomingByUser=new Map((incoming.data||[]).map(r=>[r.sender_id,r]));
  const outgoingByUser=new Map((outgoing.data||[]).map(r=>[r.receiver_id,r]));
  const streakByFriend=new Map((streakResult.data||[]).map(s=>[s.user_low===uid?s.user_high:s.user_low,s]));
  const displayName=id=>{const p=profileMap.get(id);return p?.display_name||p?.username||'Пользователь';};
  const profileCard=(p,subline,actions='',badges=[])=>`<article class="friend-card"><div class="friend-card-main"><div class="friend-avatar">${avatar(p.avatar_url||p.telegram_photo_url,p.display_name||p.username,'avatar-lg')}</div><div class="friend-card-identity"><b>${esc(p.display_name||p.username||'Пользователь')} ${badgeMarkup(badges,false,false)}</b><small>${esc(subline)}</small></div></div><div class="friend-card-actions">${actions}</div></article>`;
  const friendCards=friendIds.map(id=>{
    const p=profileMap.get(id);if(!p)return '';
    const streak=streakByFriend.get(id),days=effectiveStreakDays(streak);
    const handle=String(p.telegram_username||'').replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
    const link=handle?`<a class="friend-link" href="https://t.me/${handle}" target="_blank" rel="noopener noreferrer">Открыть Telegram ↗</a>`:'';
    const status=days>0?`🔥 Огонёк горит · ${days} дн.`:streak?.best_days?`Огонёк погас · рекорд ${streak.best_days} дн.`:'Огонёк ещё не зажжён';
    return profileCard(p,`@${p.telegram_username||p.username} · ${status}`,link,badgeMap.get(id)||[]);
  }).join('');
  const incomingCards=(incoming.data||[]).map(r=>{
    const p=profileMap.get(r.sender_id);if(!p)return '';
    return profileCard(p,`Заявка · ${formatMskDate(r.created_at)}`,
      `<button class="primary small" data-friend-response="accepted" data-request-id="${r.id}">Принять</button><button class="outline small" data-friend-response="rejected" data-request-id="${r.id}">Отклонить</button>`,
      badgeMap.get(r.sender_id)||[]);
  }).join('');
  const outgoingCards=(outgoing.data||[]).map(r=>{
    const p=profileMap.get(r.receiver_id);if(!p)return '';
    return profileCard(p,`Ожидает ответа · ${formatMskDate(r.created_at)}`,
      `<button class="outline small" data-friend-cancel="${r.id}">Отменить заявку</button>`,
      badgeMap.get(r.receiver_id)||[]);
  }).join('');
  const searchCards=(searchResult.data||[]).map(p=>{
    const isFriend=friendSet.has(p.id),inRequest=incomingByUser.get(p.id),outRequest=outgoingByUser.get(p.id);
    let action=isFriend?'<span class="friend-state-pill">✓ Вы друзья</span>'
      :inRequest?'<span class="friend-state-pill">Заявка уже у тебя</span>'
      :outRequest?`<button class="outline small" data-friend-cancel="${outRequest.id}">Отменить заявку</button>`
      :`<button class="primary small" data-friend-send="${p.id}">＋ Добавить</button>`;
    return profileCard(p,`@${p.telegram_username||p.username} · Telegram подключён`,action,p.badge_codes||[]);
  }).join('');
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ТВОЙ КРУГ ОБЩЕНИЯ</div><h1>Друзья <span>👥</span></h1><p class="muted">Находи людей, отправляй заявки и поддерживай совместные огоньки. Для ежедневной серии оба участника должны обмениваться сообщениями в Telegram.</p></div>
    <section class="friends-search-panel"><div class="section-heading"><div><div class="eyebrow">ПОИСК УЧАСТНИКОВ</div><h3>Найти друга</h3></div><span class="friend-counter">${friendIds.length} друзей</span></div>
      <form id="friend-search-form" class="friend-search-form"><input name="query" value="${esc(state.friendSearchQuery)}" maxlength="48" placeholder="Имя, никнейм или @username" autocomplete="off"/><button class="primary" type="submit">Найти</button></form>
      <small class="friend-search-hint">Минимум 2 символа. В поиске отображаются участники с привязанным Telegram.</small>
      <div class="friend-list friend-search-results">${state.friendSearchQuery.length<2?'<div class="empty-state">Введи имя или никнейм, чтобы найти участника.</div>':searchResult.error?'<div class="business-warning">Не удалось выполнить поиск: '+esc(searchResult.error.message)+'</div>':searchCards||'<div class="empty-state">Ничего не найдено. Проверь написание и попробуй ещё раз.</div>'}</div>
    </section>
    <div class="friends-columns">
      <section class="friends-section"><div class="section-heading"><div><div class="eyebrow">ТВОЁ СООБЩЕСТВО</div><h3>Мои друзья</h3></div><span class="friend-counter">${friendIds.length}</span></div><div class="friend-list">${friendCards||'<div class="empty-state">Пока нет друзей. Найди знакомых через поиск выше.</div>'}</div></section>
      <section class="friends-section"><div class="section-heading"><div><div class="eyebrow">ВХОДЯЩИЕ</div><h3>Заявки в друзья</h3></div><span class="friend-counter">${(incoming.data||[]).length}</span></div><div class="friend-list">${incomingCards||'<div class="empty-state">Новых заявок нет.</div>'}</div>
        <div class="outgoing-heading"><b>Отправленные</b><span>${(outgoing.data||[]).length}</span></div><div class="friend-list">${outgoingCards||'<div class="empty-state compact-empty">Ты пока никого не приглашал.</div>'}</div>
      </section>
    </div>
    ${friendRows.error||incoming.error||outgoing.error||streakResult.error||profileResult.error||badgeResult.error?'<p class="business-warning">Не удалось загрузить часть данных друзей. Попробуй обновить раздел.</p>':''}`;
  host.querySelector('#friend-search-form')?.addEventListener('submit',event=>{
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    state.friendSearchQuery=String(fd.get('query')||'').trim();
    renderFriends(host);
  });
  host.querySelectorAll('[data-friend-send]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    const {error}=await supabase.rpc('send_flamexbot_friend_request',{p_receiver_id:btn.dataset.friendSend});
    if(error){toast(error.message.includes('already exists')?'Заявка уже существует':error.message.includes('уже друзья')?'Вы уже друзья':error.message.includes('привяжи Telegram')?'Сначала привяжи Telegram в профиле':error.message);}
    else toast('Заявка отправлена');
    await renderFriends(host);
  }));
  host.querySelectorAll('[data-friend-response]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    const {error}=await supabase.rpc('respond_flamexbot_friend_request',{p_request_id:btn.dataset.requestId,p_response:btn.dataset.friendResponse});
    if(error)toast('Не удалось обработать заявку: '+error.message);
    else toast(btn.dataset.friendResponse==='accepted'?'Теперь вы друзья!':'Заявка отклонена');
    await renderFriends(host);
  }));
  host.querySelectorAll('[data-friend-cancel]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(!confirm('Отменить отправленную заявку?'))return;
    btn.disabled=true;
    const {error}=await supabase.rpc('cancel_flamexbot_friend_request',{p_request_id:btn.dataset.friendCancel});
    if(error)toast('Не удалось отменить заявку: '+error.message);
    else toast('Заявка отменена');
    await renderFriends(host);
  }));
}

async function renderStreaks(host) {
  const uid=state.session.user.id;
  const {data,error}=await supabase.from('streaks').select('*').or(`user_low.eq.${uid},user_high.eq.${uid}`).order('current_days',{ascending:false});
  state.streaks=data||[];
  const friendIds=state.streaks.map(s=>s.user_low===uid?s.user_high:s.user_low);
  const [profiles,badges]=await Promise.all([
    friendIds.length?supabase.from('profiles').select('id,username,display_name,avatar_url,telegram_photo_url,telegram_username').in('id',friendIds):Promise.resolve({data:[],error:null}),
    friendIds.length?supabase.from('profile_badges').select('user_id,badge_code').in('user_id',friendIds):Promise.resolve({data:[],error:null})
  ]);
  const profileMap=new Map((profiles.data||[]).map(p=>[p.id,p]));
  const badgeMap=new Map();
  (badges.data||[]).forEach(b=>{if(!badgeMap.has(b.user_id))badgeMap.set(b.user_id,[]);badgeMap.get(b.user_id).push(b.badge_code);});
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">DON'T BREAK THE CHAIN</div><h1>Огоньки 🔥</h1><p class="muted">Огонёк продлевается, когда оба друга отправили хотя бы одно сообщение за день. Пропустите полный день — серия погаснет, но личный рекорд сохранится.</p></div>
    <div class="streak-list large">${error?esc(error.message):state.streaks.length?state.streaks.map(s=>{
      const id=s.user_low===uid?s.user_high:s.user_low,p=profileMap.get(id),days=effectiveStreakDays(s),name=p?.display_name||p?.username||'Друг';
      const waiting=!s.last_activity_date;
      const status=days>0?'СЕРИЯ ГОРИТ':waiting?'ОЖИДАЕМ ПЕРВЫЙ ОБМЕН':'СЕРИЯ ПОГАСЛА';
      return `<div class="streak-card ${days>0?'streak-active':'streak-expired'}"><div class="streak-symbol">${days>0?'🔥':waiting?'✨':'🕯️'}</div><div class="streak-card-main"><div class="eyebrow">${status}</div><h3>${esc(name)} · ${days} ${days===1?'день':'дн.'}</h3><p class="muted">Личный рекорд: ${s.best_days||0} дн. · ${s.last_activity_date?'Последний общий день: '+formatMskDate(s.last_activity_date):'Один из вас уже начал общение — нужен ответ друга'}</p></div><div class="streak-days-badge">${days>0?'🔥 '+days:'—'}</div></div>`;
    }).join(''):'<div class="empty-state">Огоньков пока нет. Добавь друга и начните переписываться каждый день.</div>'}</div>
    <button class="outline" data-go="friends">Найти друзей <b>→</b></button>
    ${profiles.error||badges.error?'<p class="business-warning">Не удалось загрузить имена или значки участников.</p>':''}`;
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
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">ТВОЙ АККАУНТ</div><h1>Профиль ${verifiedMarkMarkup(isFounderProfile(p))}</h1><div class="profile-badge-row">${badgeMarkup(state.profileBadges)}</div><p class="muted">Управляй именем, оформлением, значками и подключением Telegram Business.</p></div>
    <form class="profile-card" id="profile-form">${avatar(profileAvatar,p.display_name||p.username,'avatar-xl')}
      <label>Отображаемое имя<input name="display_name" value="${esc(p.display_name || '')}" placeholder="Как тебя называть" maxlength="48"/></label>
      <label>Никнейм<input name="username" value="${esc(p.username || '')}" placeholder="Твой никнейм" maxlength="32" required/></label>
      <label>О себе<textarea name="bio" maxlength="180" placeholder="Расскажи немного о себе">${esc(p.bio || '')}</textarea></label>
      <label>Цветовая тема<select name="theme"><option value="orange" ${(p.theme||'orange')==='orange'?'selected':''}>Огненная</option><option value="blue" ${p.theme==='blue'?'selected':''}>Синяя</option><option value="green" ${p.theme==='green'?'selected':''}>Зелёная</option><option value="red" ${p.theme==='red'?'selected':''}>Красная</option><option value="violet" ${p.theme==='violet'?'selected':''}>Фиолетовая</option></select></label>
      <label>Ссылка на аватар<input name="avatar_url" type="url" value="${esc(p.avatar_url || '')}" placeholder="https://…"/></label>
      <div class="profile-time-display">${p.show_profile_time === false ? 'Время в профиле выключено' : 'Сейчас: '+formatMskTime()+' · МСК'}</div>
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
        ${businessConnected ? `<b>Бизнес-аккаунт связан</b><small>Подключено: ${businessConnection.connected_at ? formatMskDateTime(businessConnection.connected_at,{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'дата не указана'}</small><small>Выдано разрешений: ${grantedRights.length}</small>` : '<b>Ожидаем подтверждения</b><small>После подтверждения подключения Telegram статус появится здесь автоматически.</small>'}
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
    if (error) toast(error.message); else { state.profile = {...p,display_name:fd.get('display_name')||'Пользователь',username:fd.get('username'),bio:fd.get('bio')||'',avatar_url:fd.get('avatar_url'),theme:fd.get('theme')||'orange'}; applyTheme(state.profile.theme); updateHeaderProfile(); toast('Изменения профиля сохранены'); }
  });
}


async function renderDailyMissions(host) {
  const uid=state.session.user.id;
  const today=moscowDateKey();
  const [catalog,progress,claims]=await Promise.all([
    supabase.rpc('get_flamexbot_daily_tasks'),
    supabase.rpc('get_flamexbot_daily_task_progress'),
    supabase.from('flamexbot_daily_task_claims').select('task_code,xp_reward').eq('user_id',uid).eq('task_date',today)
  ]);
  const progressByCode=new Map((progress.data||[]).map(item=>[item.task_code,item]));
  const completed=new Set((claims.data||[]).map(item=>item.task_code));
  const tasks=catalog.data||[];
  const totalXp=(claims.data||[]).reduce((sum,item)=>sum+(item.xp_reward||0),0);
  const claimedCount=completed.size;
  const doneCount=tasks.filter(t=>progressByCode.get(t.task_code)?.completed===true).length;
  const maxXp=tasks.reduce((sum,t)=>sum+(Number(t.xp_reward)||0),0);
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">НОВЫЙ ЦИКЛ КАЖДЫЙ ДЕНЬ</div><h1>Ежедневные задания <span>⚡</span></h1><p class="muted">Каждый день система выбирает три новых испытания. Выполняй их, забирай XP и прокачивай свой уровень.</p></div>
    <section class="daily-mission-hero"><div><span class="mission-live-dot"></span><b>Сегодняшний набор</b><small>Обновление ежедневно в 00:00 МСК · ${formatMskDate(today,{day:'numeric',month:'long'})}</small></div><strong>+ ${totalXp} / ${maxXp} XP <small>забрано ${claimedCount} из ${tasks.length} · готово ${doneCount} из ${tasks.length}</small></strong></section>
    <div class="daily-task-list">${tasks.map(t=>{
      const stat=progressByCode.get(t.task_code)||{current_progress:0,target_progress:1,completed:false};
      const current=Number(stat.current_progress)||0,target=Math.max(1,Number(stat.target_progress)||1);
      const claimed=completed.has(t.task_code),done=stat.completed===true||current>=target;
      const percent=Math.min(100,Math.round(current/target*100));
      return `<article class="daily-task task-v2 ${claimed?'claimed':done?'ready':''}">
        <div class="daily-task-icon">${esc(t.icon||'⚡')}</div>
        <div class="daily-task-copy"><div class="task-title-line"><b>${esc(t.title)}</b><span class="task-reward">+${t.xp_reward} XP</span></div><p>${esc(t.description||'')}</p>
          <div class="task-progress-track"><span style="width:${percent}%"></span></div>
          <small>${claimed?'Награда уже у тебя':done?'Выполнено — забери награду':`Прогресс: ${Math.min(current,target)}/${target}`}</small>
        </div>
        <button class="${done&&!claimed?'primary':'outline'} small" data-claim-task="${esc(t.task_code)}" ${!done||claimed?'disabled':''}>${claimed?'Получено':done?'Забрать XP':'В процессе'}</button>
      </article>`;
    }).join('')||'<div class="empty-state">Новый набор заданий скоро появится.</div>'}</div>
    <div class="daily-task-footer"><span>🎯</span><div><b>Задания меняются автоматически</b><small>Прогресс рассчитывается на сервере только по твоим чатам. Награду за одно задание можно забрать один раз в день.</small></div></div>
    ${catalog.error||progress.error||claims.error?'<p class="business-warning">Не удалось загрузить прогресс заданий: '+esc(catalog.error?.message||progress.error?.message||claims.error?.message||'попробуй ещё раз')+'</p>':''}`;
  host.querySelectorAll('[data-claim-task]').forEach(btn=>btn.addEventListener('click',async()=>{
    const taskCode=btn.dataset.claimTask;
    btn.disabled=true;btn.classList.add('is-loading');
    const {data,error}=await supabase.rpc('claim_flamexbot_daily_task',{p_task_code:taskCode});
    if(error){const raw=error.message||'';toast(raw.includes('already claimed')?'Награда уже получена сегодня':raw.includes('not active today')?'Набор заданий обновился. Открой страницу ещё раз.':raw.includes('task_code_check')?'Награда временно недоступна. Обнови страницу и попробуй ещё раз.':'Не удалось забрать награду: '+raw);btn.disabled=false;btn.classList.remove('is-loading');return;}
    await supabase.rpc('sync_flamexbot_achievements');
    toast('Получено +'+(data?.xp_reward||0)+' XP');
    await renderDailyMissions(host);
  }));
}

async function renderAchievements(host) {
  const uid=state.session.user.id;
  await supabase.rpc('sync_flamexbot_achievements');
  const [all,earned,taskClaims,leaderboard]=await Promise.all([
    supabase.from('achievements').select('id,code,title,description,icon,points').order('points'),
    supabase.from('user_achievements').select('achievement_id,earned_at').eq('user_id',uid),
    supabase.from('flamexbot_daily_task_claims').select('xp_reward').eq('user_id',uid),
    supabase.rpc('get_flamexbot_leaderboard')
  ]);
  const got=new Map((earned.data||[]).map(x=>[x.achievement_id,x]));
  const achievementXp=(all.data||[]).filter(a=>got.has(a.id)).reduce((sum,a)=>sum+(a.points||0),0);
  const totalXp=achievementXp+(taskClaims.data||[]).reduce((sum,x)=>sum+(x.xp_reward||0),0);
  const level=Math.floor(totalXp/100)+1,progress=totalXp%100;
  const items=all.data||[];
  const rarity=points=>points>=200?['Легендарное','legendary']:points>=100?['Эпическое','epic']:points>=50?['Редкое','rare']:['Обычное','common'];
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ТВОЯ КОЛЛЕКЦИЯ</div><h1>Достижения <span>🏆</span></h1><p class="muted">Не ежедневные поручения, а настоящие вехи твоего пути в FLAMEXBOT. Каждая награда открывается за конкретное достижение.</p></div>
    <section class="business-card level-card level-card-v2"><div class="level-line"><div><small>ТВОЙ УРОВЕНЬ</small><h2>Уровень ${level}</h2><div class="level-badges">${badgeMarkup(state.profileBadges)}</div></div><strong>${totalXp} XP</strong></div><div class="xp-track"><span style="width:${progress}%"></span></div><div class="level-foot"><small>${progress}/100 XP до следующего уровня</small><b>${got.size} / ${items.length} открыто</b></div></section>
    <div class="achievement-filter-row"><button class="achievement-filter active" data-achievement-filter="all">Все <span>${items.length}</span></button><button class="achievement-filter" data-achievement-filter="earned">Полученные <span>${got.size}</span></button><button class="achievement-filter" data-achievement-filter="locked">Закрытые <span>${items.length-got.size}</span></button></div>
    <div class="achievement-grid achievement-grid-v2">${items.map(a=>{
      const e=got.get(a.id),r=rarity(a.points||0);
      return `<article class="achievement-card achievement-v2 ${e?'earned':'locked'} rarity-${r[1]}" data-achievement-state="${e?'earned':'locked'}">
        <div class="achievement-icon-wrap"><div class="achievement-icon">${esc(a.icon||'✦')}</div><span class="achievement-glint"></span></div>
        <div class="achievement-copy"><div class="achievement-card-top"><b>${esc(a.title)}</b><span class="achievement-rarity">${r[0]}</span></div><p>${esc(a.description||'')}</p><small>${e?'Открыто '+formatMskDate(e.earned_at):'Ещё впереди'} · +${a.points} XP</small></div>
        <span class="achievement-state-mark">${e?'✓':'🔒'}</span>
      </article>`;
    }).join('')||'<div class="empty-state">Каталог достижений пока пуст.</div>'}</div>
    <section class="leaderboard-panel leaderboard-v2"><div class="section-heading"><div><div class="eyebrow">РЕЙТИНГ СООБЩЕСТВА</div><h3>Таблица лидеров</h3></div><span class="leaderboard-live">● LIVE</span></div><div class="leaderboard-list">${(leaderboard.data||[]).map((u,i)=>`<div class="leaderboard-row"><strong>#${i+1}</strong><span><b>${esc(u.display_name||u.username)}</b><small>Уровень ${u.level}</small></span><em>${u.xp} XP</em></div>`).join('')||'<div class="empty-state">Рейтинг появится, когда участники начнут получать XP.</div>'}</div></section>
    ${all.error||earned.error||taskClaims.error||leaderboard.error?'<p class="business-warning">Не удалось полностью загрузить коллекцию или рейтинг.</p>':''}`;
  host.querySelectorAll('[data-achievement-filter]').forEach(btn=>btn.addEventListener('click',()=>{
    host.querySelectorAll('[data-achievement-filter]').forEach(x=>x.classList.toggle('active',x===btn));
    const filter=btn.dataset.achievementFilter;
    host.querySelectorAll('[data-achievement-state]').forEach(card=>card.hidden=filter!=='all'&&card.dataset.achievementState!==filter);
  }));
}


async function renderCommands(host) {
  const entries=[
    {syntax:'.ping',title:'Проверка связи',description:'Проверяет, что FLAMEXBOT отвечает в текущем Business-диалоге.',access:'free',group:'Основные'},
    {syntax:'.help',title:'Справка',description:'Показывает список команд прямо в переписке.',access:'free',group:'Основные'},
    {syntax:'.inf',title:'Справка (короткий алиас)',description:'То же самое, что .help.',access:'free',group:'Основные'},
    {syntax:'.commands',title:'Полный справочник',description:'Открывает список всех доступных команд в переписке.',access:'free',group:'Основные'},
    {syntax:'.mute',title:'Включить мут',description:'Удаляет новые входящие сообщения в выбранном диалоге. Нужны Premium и право Telegram Business «Удалять все сообщения».',access:'premium',group:'Управление чатом'},
    {syntax:'.unmute',title:'Выключить мут',description:'Останавливает автоматическое удаление новых сообщений. Доступно бесплатно.',access:'free',group:'Управление чатом'},
    {syntax:'.antimute on',title:'Включить антимут',description:'Разрешает одну ручную попытку отправки через Telegram Business. Нужны Premium и право «Отвечать».',access:'premium',group:'Управление чатом'},
    {syntax:'.antimute off',title:'Выключить антимут',description:'Отключает ручную отправку через антимут. Доступно бесплатно.',access:'free',group:'Управление чатом'},
    {syntax:'.antimute текст',title:'Ручная отправка',description:'Одна попытка отправить указанный текст через подключённый Telegram Business. Ограничения Telegram не обходятся.',access:'premium',group:'Управление чатом'},
    {syntax:'.antimut on',title:'Включить антимут (короткий алиас)',description:'Включает антимут. Нужны Premium и право Telegram Business «Отвечать».',access:'premium',group:'Управление чатом'},
    {syntax:'.antimut off',title:'Выключить антимут (короткий алиас)',description:'Отключает антимут бесплатно.',access:'free',group:'Управление чатом'},
    {syntax:'.antimut текст',title:'Ручная отправка (алиас)',description:'Одна ручная попытка отправки через Telegram Business.',access:'premium',group:'Управление чатом'},
    {syntax:'.spam 2-5 текст',title:'Повторная отправка',description:'Отправляет от двух до пяти копий текста с паузой. Используй только когда получатель согласен.',access:'premium',group:'Управление чатом'},
    {syntax:'.afk причина',title:'Включить автоответ',description:'Включает AFK-режим и задаёт текст автоматического ответа.',access:'premium',group:'Автоматизация'},
    {syntax:'.unafk',title:'Выключить автоответ',description:'Отключает AFK-режим. Доступно бесплатно.',access:'free',group:'Автоматизация'},
    {syntax:'.autoread on',title:'Автопрочтение',description:'Автоматически отмечает входящие Business-сообщения прочитанными.',access:'premium',group:'Автоматизация'},
    {syntax:'.autoread off',title:'Отключить автопрочтение',description:'Выключает автоматическое прочтение. Доступно бесплатно.',access:'free',group:'Автоматизация'},
    {syntax:'.autotyping on',title:'Статус «печатает…»',description:'Включает статус набора текста. Нужен Premium.',access:'premium',group:'Автоматизация'},
    {syntax:'.autotyping off',title:'Отключить статус набора',description:'Выключает статус набора бесплатно.',access:'free',group:'Автоматизация'},
    {syntax:'.autovoice on',title:'Статус записи голосового',description:'Включает статус записи голосового. Нужен Premium.',access:'premium',group:'Автоматизация'},
    {syntax:'.autovoice off',title:'Отключить статус записи',description:'Выключает статус записи бесплатно.',access:'free',group:'Автоматизация'},
    {syntax:'.mutestick on',title:'Фильтр стикеров',description:'Включает фильтрацию входящих стикеров. Нужен Premium.',access:'premium',group:'Автоматизация'},
    {syntax:'.mutestick off',title:'Отключить фильтр стикеров',description:'Выключает фильтрацию бесплатно.',access:'free',group:'Автоматизация'},
    {syntax:'.timeprofile',title:'Московское время',description:'Закрепляет часовой пояс FLAMEXBOT: Москва, UTC+3.',access:'premium',group:'Профиль'},
    {syntax:'.time',title:'Показывать время',description:'Включает отображение времени в профиле.',access:'premium',group:'Профиль'},
    {syntax:'.untime',title:'Скрыть время',description:'Выключает отображение времени в профиле. Доступно бесплатно.',access:'free',group:'Профиль'},
    {syntax:'.bold текст',title:'Жирный текст',description:'Отправляет указанный текст жирным начертанием.',access:'premium',group:'Оформление'},
    {syntax:'.dumb текст',title:'Игровое оформление',description:'Преобразует текст в шуточный стиль.',access:'premium',group:'Оформление'},
    {syntax:'.link текст',title:'Ссылка на диалог',description:'Создаёт ссылку на текущий Telegram-диалог.',access:'premium',group:'Оформление'},
    {syntax:'.streak 7',title:'Установить огонёк',description:'Мгновенно создаёт или устанавливает серию на указанное число дней (1–3650). Только владелец и администраторы.',access:'admin',group:'Администрация'}
  ];
  const filters=[['all','Все'],['free','Бесплатные'],['premium','Premium'],['admin','Администрация']];
  host.innerHTML='<div class="page-heading"><div class="eyebrow">FLAMEXBOT COMMAND CENTER</div><h1>Все команды <span>⌘</span></h1><p class="muted">Полный справочник команд. Отправляй их прямо в нужной Telegram Business-переписке — без @username и ID. Команды управления не применяются к диалогам владельца FLAMEXBOT.</p></div>'+
    '<section class="commands-toolbar"><label class="commands-search"><span>⌕</span><input id="commands-search" type="search" placeholder="Найти команду или функцию…"/></label><div class="commands-filters">'+filters.map(([key,label])=>'<button type="button" class="command-filter '+key+'" data-command-filter="'+key+'">'+label+'</button>').join('')+'</div></section>'+
    '<div class="commands-result-meta"><span id="commands-count">'+entries.length+' команд и вариантов</span><span>Префикс: <code>.</code> или <code>/</code></span></div>'+
    '<div id="commands-list" class="commands-list"></div>'+
    '<div class="business-note">Уровень доступа проверяется сервером. Отключение функций доступно бесплатно там, где это указано. Команды работают в личной переписке Telegram Business с конкретным собеседником.</div>';
  let activeFilter='all';
  const list=host.querySelector('#commands-list');
  const search=host.querySelector('#commands-search');
  const draw=()=>{
    const query=(search.value||'').trim().toLowerCase();
    const visible=entries.filter(item=>(activeFilter==='all'||item.access===activeFilter)&&(!query||[item.syntax,item.title,item.description,item.group].join(' ').toLowerCase().includes(query)));
    host.querySelector('#commands-count').textContent='Показано '+visible.length+' из '+entries.length;
    const groups=[...new Set(visible.map(item=>item.group))];
    list.innerHTML=groups.map(group=>'<section class="commands-group"><div class="commands-group-title">'+esc(group)+'<span>'+visible.filter(item=>item.group===group).length+'</span></div><div class="commands-group-grid">'+visible.filter(item=>item.group===group).map(item=>'<article class="command-card command-'+item.access+'"><div class="command-card-top"><code>'+esc(item.syntax)+'</code><span class="command-access '+item.access+'">'+(item.access==='premium'?'✦ PREMIUM':item.access==='admin'?'♛ АДМИН':'FREE')+'</span></div><b>'+esc(item.title)+'</b><p>'+esc(item.description)+'</p><button type="button" class="command-copy" data-copy-command="'+esc(item.syntax)+'">Скопировать команду</button></article>').join('')+'</div></section>').join('')||'<div class="empty-state">По запросу ничего не найдено. Попробуй другое название.</div>';
    list.querySelectorAll('[data-copy-command]').forEach(button=>button.addEventListener('click',async()=>{
      const value=button.dataset.copyCommand;
      try{await navigator.clipboard.writeText(value);toast('Команда скопирована: '+value);}
      catch{const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();try{document.execCommand('copy');toast('Команда скопирована: '+value);}catch{toast('Не удалось скопировать команду');}input.remove();}
    }));
  };
  host.querySelectorAll('[data-command-filter]').forEach(button=>button.addEventListener('click',()=>{
    activeFilter=button.dataset.commandFilter;
    host.querySelectorAll('[data-command-filter]').forEach(item=>item.classList.toggle('active',item===button));
    draw();
  }));
  search.addEventListener('input',draw);
  draw();
}

async function renderStats(host) {
  const uid=state.session.user.id;
  const [statsResult,profileResult]=await Promise.all([
    supabase.rpc('get_flamexbot_user_stats'),
    supabase.from('profiles').select('created_at,telegram_id').eq('id',uid).maybeSingle()
  ]);
  const stats=statsResult.data?.[0]||{};
  const week=Array.isArray(stats.weekly_activity)?stats.weekly_activity:[];
  const maxActivity=Math.max(1,...week.map(day=>(Number(day.sent)||0)+(Number(day.received)||0)));
  const bars=week.map(day=>{
    const sent=Number(day.sent)||0,received=Number(day.received)||0,total=sent+received;
    const height=Math.max(5,Math.round(total/maxActivity*100));
    return `<div class="activity-day" title="${formatMskDate(day.date,{day:'numeric',month:'long'})}: ${sent} отправлено, ${received} получено">
      <div class="activity-bar"><span style="height:${height}%"></span></div>
      <small>${formatMskDate(day.date,{weekday:'short'})}</small>
      <b>${total}</b>
    </div>`;
  }).join('');
  const cards=[
    ['✦','ТАРИФ',planLabel()],['👥','ДРУЗЬЯ',stats.friends||0],
    ['✉','BUSINESS-ДИАЛОГИ',stats.business_chats||0],['↗','ОТПРАВЛЕНО',stats.messages_sent||0],
    ['↙','ПОЛУЧЕНО',stats.messages_received||0],['🔥','АКТИВНЫЕ ОГОНЬКИ',stats.current_streaks||0],
    ['🏅','ЛУЧШАЯ СЕРИЯ',(stats.best_streak||0)+' дн.'],['🏆','ДОСТИЖЕНИЯ',stats.achievements||0],
    ['⚡','ОБЩИЙ ОПЫТ',(stats.xp||0)+' XP'],['◈','УРОВЕНЬ',stats.level||1],
    ['📅','СООБЩЕНИЯ ЗА 30 ДНЕЙ',stats.messages_last_30d||0],['🌟','АКТИВНЫХ ДНЕЙ ЗА 30 ДНЕЙ',stats.active_days_30d||0]
  ];
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">ТВОЯ АКТИВНОСТЬ · МОСКОВСКОЕ ВРЕМЯ</div><h1>Статистика <span>📊</span></h1><p class="muted">Подробная сводка общения, прогресса и достижений. Все даты и дневные периоды считаются по МСК.</p></div>
    <div class="stats-grid advanced-stats-grid">${cards.map(([icon,label,value])=>`<article class="stat-card"><span class="stat-icon">${icon}</span><small>${label}</small><strong>${value}</strong></article>`).join('')}</div>
    <section class="activity-panel"><div class="section-heading"><div><div class="eyebrow">ПОСЛЕДНИЕ 7 ДНЕЙ</div><h3>Активность по дням</h3></div><span class="activity-legend"><i></i> Сообщения</span></div>
      <div class="activity-chart">${bars||'<div class="empty-state">Данных пока недостаточно.</div>'}</div>
      <div class="activity-foot"><span>За неделю отправлено: <b>${week.reduce((sum,d)=>sum+(Number(d.sent)||0),0)}</b></span><span>Получено: <b>${week.reduce((sum,d)=>sum+(Number(d.received)||0),0)}</b></span></div>
    </section>
    <section class="business-card"><div class="eyebrow">FLAMEX ID</div><div class="flame-id-line"><h2>${esc(uid.slice(0,8).toUpperCase())}</h2><button class="outline small" type="button" id="copy-flame-id">Скопировать ID</button></div><p class="muted">Уникальный идентификатор твоего пространства FLAMEXBOT.</p><small>В приложении с ${profileResult.data?.created_at?formatMskDate(profileResult.data.created_at):'—'} · Telegram ${profileResult.data?.telegram_id?'привязан':'не привязан'}</small></section>
    ${statsResult.error?'<p class="business-warning">Не удалось загрузить статистику: '+esc(statsResult.error.message)+'</p>':''}`;
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

async function startModerationRealtime(session) {
  if(state.moderationChannel){await supabase.removeChannel(state.moderationChannel);state.moderationChannel=null;}
  if(!session?.user?.id)return;
  const uid=session.user.id;
  const channel=supabase.channel(`flamexbot-moderation-${uid}`)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles',filter:`id=eq.${uid}`},async payload=>{
      const profile=payload.new||{};
      if(profile.is_banned){
        state.blockedReason=profile.ban_reason||'Этот аккаунт заблокирован администрацией FLAMEXBOT.';
        await supabase.auth.signOut();
        renderBlockedScreen();
      }
    })
    .subscribe(status=>{if(status==='SUBSCRIBED')console.info('FLAMEXBOT moderation watch active');});
  state.moderationChannel=channel;
}

async function startNotificationRealtime(session) {
  if(state.notificationChannel){await supabase.removeChannel(state.notificationChannel);state.notificationChannel=null;}
  if(!session?.user?.id)return;
  const uid=session.user.id;
  const readAt=new Date().toISOString();
  const {error:existingError}=await supabase.from('notifications').update({read_at:readAt}).eq('user_id',uid).is('read_at',null);
  if(existingError)console.warn('Auto-read existing notifications:',existingError.message);
  const channel=supabase.channel(`flamexbot-notifications-${uid}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},async payload=>{
      const n=payload.new||{};
      if(!n.id||n.read_at)return;
      const {error}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',n.id).eq('user_id',uid);
      if(error)console.warn('Auto-read notification:',error.message);
    })
    .subscribe(status=>{if(status==='SUBSCRIBED')console.info('FLAMEXBOT notifications auto-read enabled');});
  state.notificationChannel=channel;
}

async function boot(session) {
  const nextUserId=session?.user?.id||null;
  const currentUserId=state.session?.user?.id||null;
  state.session=session;
  if(!session){
    if(state.presenceChannel){await supabase.removeChannel(state.presenceChannel);state.presenceChannel=null;}
    if(state.notificationChannel){await supabase.removeChannel(state.notificationChannel);state.notificationChannel=null;}
    if(state.moderationChannel){await supabase.removeChannel(state.moderationChannel);state.moderationChannel=null;}
    state.onlineUserIds=[];state.notificationCount=0;state.profileBadges=[];
    if(state.blockedReason)renderBlockedScreen();else renderAuth();
    return;
  }
  if(nextUserId===currentUserId&&document.querySelector('.app-layout'))return;
  app.innerHTML=`<main class="app-boot-loading"><div class="loader-mark"><span>✦</span><i></i><b></b></div><h2>FLAMEXBOT</h2><p>Подготавливаем твоё пространство…</p></main>`;
  const [profileResult,preferencesResult,badgesResult,subscriptionResult,adminResult]=await Promise.all([
    supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle(),
    supabase.from('flamexbot_user_preferences').select('timezone_offset').eq('profile_id',session.user.id).maybeSingle(),
    supabase.from('profile_badges').select('badge_code').eq('user_id',session.user.id),
    supabase.from('user_subscriptions').select('plan,starts_at,expires_at').eq('user_id',session.user.id).maybeSingle(),
    supabase.rpc('is_flamexbot_admin')
  ]);
  if(profileResult.error)console.warn('Profile load:',profileResult.error.message);
  if(profileResult.data?.is_banned){
    state.blockedReason=profileResult.data.ban_reason||'Этот аккаунт временно заблокирован администрацией FLAMEXBOT.';
    await supabase.auth.signOut();
    renderBlockedScreen();
    return;
  }
  state.blockedReason=null;
  const data=profileResult.data;
  state.profile={...(data||{username:session.user.email?.split('@')[0]||'Flame user'}),timezone_offset:preferencesResult.data?.timezone_offset??0};
  state.profileBadges=(badgesResult.data||[]).map(x=>x.badge_code);
  if(state.profile.telegram_id){
    supabase.functions.invoke('setup-flamexbot-webhook').then(({error})=>{
      if(error)console.warn('Telegram webhook setup:',error.message);
    });
  }
  const subscription=subscriptionResult.data;
  state.subscription=subscription&&(!subscription.expires_at||new Date(subscription.expires_at).getTime()>Date.now())?subscription:{plan:'free',expires_at:null};
  applyTheme(state.profile.theme);
  state.isAdmin=!adminResult.error&&adminResult.data===true;
  renderApp();
  Promise.all([
    supabase.rpc('sync_flamexbot_achievements').then(({error})=>{if(error)console.warn('Achievement sync:',error.message);}),
    startPresence(session),startNotificationRealtime(session),startModerationRealtime(session)
  ]).catch(error=>console.warn('FLAMEXBOT background initialization:',error?.message||error));
}

if (!supabase) {
  app.innerHTML = `<main class="config-screen"><div class="brand"><span class="brand-mark">✦</span> FLAMEXBOT</div><h1>Почти готово.</h1><p>Добавь переменные окружения Supabase в настройках Cloudflare Pages:</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><p class="muted">Используй publishable key проекта FLAMEXBOT. Никогда не добавляй service_role key во фронтенд.</p></main>`;
} else {
  supabase.auth.onAuthStateChange((event,session)=>{
    const nextId=session?.user?.id||null;
    const currentId=state.session?.user?.id||null;
    if(event==='INITIAL_SESSION'||event==='SIGNED_OUT'||nextId!==currentId){
      queueMicrotask(()=>boot(session));
    }else{
      state.session=session;
    }
  });
}
