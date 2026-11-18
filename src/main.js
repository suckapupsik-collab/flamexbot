import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FOUNDER_TELEGRAM_ID = '7781170049';
const FOUNDER_PROFILE_ID = '74a352c0-5a26-46a8-9b88-e71d0c3a9879';
const supabase = SUPABASE_URL && SUPABASE_KEY && !SUPABASE_KEY.startsWith('YOUR_')
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const state = { session: null, profile: null, profileBadges: [], subscription: null, businessConnection: null, businessRights: null, isAdmin: false, page: 'home', busy: false, streaks: [], businessChats: [], activeBusinessChat: null, businessMessages: [], businessMessagesHasMore: false, businessMessagesLoadingOlder: false, businessMessagesInitialLoaded: false, businessMessagesOldestAt: null, businessChatChannel: null, businessListChannel: null, presenceChannel: null, moderationChannel: null, onlineUserIds: [], notificationChannel: null, notificationCount: 0, menuListenersBound: false, blockedReason: null, friendSearchQuery: '', selectedAdminUserId: null, avatarRefreshAttempted: new Set(), webhookSetupAttempted: false, businessMediaUrlCache: new Map(), messageRefreshInFlight: new Set(), messageRefreshPending: new Set(), messageRefreshTimers: new Map(), businessListRefreshTimer: null, userFilters: { search: '', verified: 'all', premium: 'all', banned: 'all', offset: 0 } };
const app = document.querySelector('#app');
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = name => (name || 'F').trim().slice(0, 1).toUpperCase();
let toastTimer = null;
const toast = message => { const el = document.querySelector('.toast'); if (!el) return; clearTimeout(toastTimer); el.textContent = String(message || ''); el.classList.toggle('show', Boolean(message)); if (!message) return; toastTimer = setTimeout(() => { el.classList.remove('show'); el.textContent = ''; }, 3000); };
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
function isPremium() { return ['premium','founder'].includes(state.subscription?.plan) && (!state.subscription.expires_at || new Date(state.subscription.expires_at).getTime() > Date.now()); }
function planLabel() { return isPremium()?'PREMIUM':'FREE'; }
async function notifyTelegramAboutAdminAction(targetUserId, action, badgeCode=null, auditId=null) {
  try {
    const {data,error}=await supabase.functions.invoke('flamexbot-user-notify',{
      body:{target_user_id:targetUserId,action,badge_code:badgeCode,audit_id:auditId}
    });
    if(error) {
      console.warn('Telegram admin notification:',error.message);
      toast('Изменение сохранено, но уведомление в Telegram не отправлено.');
      return;
    }
    if(data?.delivered===false) {
      toast(data.reason==='notification_queued'
        ? 'Изменение сохранено. Уведомление уже обрабатывается и будет доставлено из очереди.'
        : 'Изменение сохранено. Бот не смог написать пользователю — он должен хотя бы раз запустить FLAMEXBOT.');
    }
  } catch(error) {
    console.warn('Telegram admin notification:',error?.message||error);
    toast('Изменение сохранено, но уведомление в Telegram не отправлено.');
  }
}
const PAGE_LABELS = {
  home:'Обзор', support:'Техподдержка', support_user:'Написать в техподдержку', inbox:'Личные сообщения бота', messages:'Переписки', deleted:'Удалённые сообщения', edited:'Изменённые сообщения', friends:'Друзья', tariffs:'Тарифы', streaks:'Огоньки',
  missions:'Ежедневные задания', wallet:'Баланс', season:'Сезонный пропуск', banners:'Баннеры бота', profile:'Профиль', achievements:'Достижения',
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
  premium:{label:'Premium',icon:'✧',className:'premium'},
};
function isFounderProfile(profile=state.profile) {
  return String(profile?.telegram_id||'')===FOUNDER_TELEGRAM_ID || String(profile?.id||'')===FOUNDER_PROFILE_ID;
}
function verifiedMarkMarkup(verified=false) {
  return verified ? '<span class="verified-mark" title="Подтверждённый аккаунт" aria-label="Подтверждённый аккаунт">✓</span>' : '';
}
function badgeMarkup(codes=[],compact=false,includeOwnPremium=true) {
  const ownPlan=state.subscription?.plan;
  const ownCodes=includeOwnPremium&&state.profile?.show_badges===false?[]:includeOwnPremium&&state.profile?.show_role===false?(codes||[]).filter(code=>code==='verified'):(codes||[]);
  const unique=[...new Set([...ownCodes,...(includeOwnPremium&&ownPlan==='premium'&&isPremium()&&state.profile?.show_subscription!==false?['premium']:[])])];
  return unique.filter(code=>code!=='verified'&&BADGE_META[code]).map(code=>{
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
  if(name)name.innerHTML=esc(p.display_name||p.username||'Пользователь')+verifiedMarkMarkup((isFounderProfile(p)||state.profileBadges.includes('verified'))&&p.show_badges!==false);
  const triggerName=document.querySelector('.profile-trigger-name');
  if(triggerName)triggerName.innerHTML=esc(p.display_name||p.username||'Пользователь')+verifiedMarkMarkup((isFounderProfile(p)||state.profileBadges.includes('verified'))&&p.show_badges!==false);
  const badges=document.querySelector('#menu-profile-badges');
  if(badges)badges.innerHTML=badgeMarkup(state.profileBadges);
  const triggerBadges=document.querySelector('#top-profile-badges');
  if(triggerBadges)triggerBadges.innerHTML=badgeMarkup(state.profileBadges,true);
}
function closeProfileMenu() {
  const menu=document.querySelector('#profile-menu');
  const trigger=document.querySelector('#profile-menu-trigger');
  if(menu)menu.classList.remove('open');
  if(trigger)trigger.setAttribute('aria-expanded','false');
}
function navigateTo(page) {
  if(!PAGE_LABELS[page] || (['users','admin','banners','support'].includes(page)&&!state.isAdmin))return;
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
    ['deleted','🗑️','Удалённые сообщения','Архив удалённых сообщений собеседников'],
    ['edited','✏️','Изменённые сообщения','История правок сообщений собеседников'],
    ['friends','👥','Друзья','Заявки и совместные огоньки'],
    ['streaks','🔥','Огоньки','Общие серии'],
    ['missions','⚡','Ежедневные задания','Новые задания каждый день'],
    ['season','🎟️','Сезонный пропуск','Награды Free и Pro'],
    ['wallet','🪙','Баланс','Монеты и пополнение'],
    ['achievements','🏆','Достижения','Коллекция наград'],
    ['support_user','🛟','Написать в техподдержку','Задать вопрос команде'],
    ['stats','▥','Статистика','Твоя активность'],
    ['commands','⌘','Все команды','Полный список команд'],
    ['tariffs','✧','Тарифы','Подписка и дополнения'],
    ['profile','◉','Профиль','Настройки аккаунта'],
    ...(state.isAdmin?[['support','✉','Техподдержка','Обращения пользователей'],['banners','🖼️','Баннеры бота','Оформление /start и инструкции'],['users','👥','Управление пользователями','Поиск, карточки и действия'],['admin','⚙','Админ-панель','Управление проектом']]:[])
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
                <span class="profile-trigger-name">${esc(p.display_name||p.username||'Пользователь')}${verifiedMarkMarkup(isFounderProfile(p)&&p.show_badges!==false)}</span>
                <span id="top-profile-badges">${badgeMarkup(state.profileBadges,true)}</span>
                <span class="profile-chevron">⌄</span>
              </button>
              <div class="profile-menu" id="profile-menu">
                <div class="profile-menu-head">
                  <span id="menu-avatar">${avatar(profileAvatar,p.display_name||p.username,'avatar-lg')}</span>
                  <div class="profile-menu-identity"><b id="menu-display-name">${esc(p.display_name||p.username||'Пользователь')}${verifiedMarkMarkup(isFounderProfile(p)&&p.show_badges!==false)}</b><div id="menu-profile-badges">${badgeMarkup(state.profileBadges)}</div><small>${state.profile?.show_subscription===false?'':isPremium()?'✦ '+planLabel()+' MEMBER':'FREE MEMBER'}</small></div>
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
  host.classList.remove('page-enter');void host.offsetWidth;host.classList.add('page-enter');
  host.innerHTML=`<div class="page-loading"><div class="loader-mark"><span>✦</span><i></i><b></b></div><strong>Загружаем FLAMEXBOT</strong><small>Подготавливаем твоё пространство…</small></div>`;
  try {
    if(state.page==='home'){
      const [streaks,earned,deletedEvents,editedEvents]=await Promise.all([
        supabase.from('streaks').select('*').or(`user_low.eq.${state.session.user.id},user_high.eq.${state.session.user.id}`).order('current_days',{ascending:false}),
        supabase.from('user_achievements').select('achievement_id',{count:'exact',head:true}).eq('user_id',state.session.user.id),
        supabase.from('flamexbot_business_message_events').select('id',{count:'exact',head:true}).eq('profile_id',state.session.user.id).eq('event_type','deleted'),
        supabase.from('flamexbot_business_message_events').select('id',{count:'exact',head:true}).eq('profile_id',state.session.user.id).eq('event_type','edited')
      ]);
      const deletedCount=deletedEvents.count||0;
      const editedCount=editedEvents.count||0;
      state.streaks=(streaks.data||[]).sort((a,b)=>effectiveStreakDays(b)-effectiveStreakDays(a)).slice(0,5);
      const p=state.profile||{};
      const incomingReferral=new URLSearchParams(window.location.search).get('ref');
      if(incomingReferral&&p.telegram_id){
        const {data:refApplied,error:refApplyError}=await supabase.rpc('apply_flamexbot_referral_code',{p_code:incomingReferral});
        if(refApplyError)toast('Реферальный код: '+refApplyError.message);
        else if(refApplied)toast('🔥 Реферальная награда начислена пригласившему!');
        window.history.replaceState({},'',window.location.pathname+window.location.hash);
      }
      const [{data:referralLinkData,error:refCodeError},{count:referralCount,error:refCountError}]=await Promise.all([
        supabase.functions.invoke('flamexbot-referral-link'),
        supabase.from('flamexbot_referrals').select('id',{count:'exact',head:true}).eq('referrer_id',state.session.user.id)
      ]);
      const referralCode=referralLinkData?.code||null;
      host.innerHTML=`<div class="welcome-row"><div><div class="eyebrow">ТВОЙ FLAMEXBOT</div><h1>С возвращением, ${esc(p.display_name||p.username||'друг')} ${verifiedMarkMarkup((isFounderProfile(p)||state.profileBadges.includes('verified'))&&p.show_badges!==false)} ${badgeMarkup(state.profileBadges,true)}</h1><p class="muted">Твои люди, огоньки, достижения и новые возможности — в одном пространстве.</p></div><div class="date-chip"><span>✦</span> ${formatMskDate(new Date(),{day:'numeric',month:'long',weekday:'long'})}</div></div>
        <div class="hero-card"><div class="hero-copy"><div class="eyebrow">ТВОЯ ИСТОРИЯ ПРОДОЛЖАЕТСЯ</div><h2>Больше общения.<br/><em>Больше огня.</em></h2><p>Поддерживай связь с близкими, открывай достижения и собирай свою историю в FLAMEXBOT.</p><button class="primary" data-go="messages">Открыть переписки <b>→</b></button></div><div class="hero-fire"><span class="hero-fire-core">🔥</span><span class="fire-glow"></span><span class="fire-orbit fire-orbit-a"></span><span class="fire-orbit fire-orbit-b"></span></div><div class="hero-watermark">FLAME</div></div>
        <div class="stats-grid"><div class="stat-card"><span class="stat-icon">✧</span><small>ТВОЙ ТАРИФ</small><strong>${planLabel()}</strong><span class="stat-foot">Твои возможности</span></div><div class="stat-card"><span class="stat-icon">🔥</span><small>АКТИВНЫЕ ОГОНЬКИ</small><strong>${state.streaks.filter(s=>effectiveStreakDays(s)>0).length}</strong><span class="stat-foot">Общие серии</span></div><div class="stat-card"><span class="stat-icon">🏆</span><small>ДОСТИЖЕНИЯ</small><strong>${earned.count||0}</strong><span class="stat-foot">Открытые награды</span></div></div>
        <div class="section-heading archive-section-heading"><div><div class="eyebrow">TELEGRAM BUSINESS</div><h3>История сообщений</h3></div><span class="archive-section-note">Архив переписок</span></div>
        <div class="home-archive-grid">
          <button class="home-archive-card deleted" data-go="deleted" type="button">
            <span class="home-archive-icon">▤</span><span class="home-archive-copy"><b>Удалённые сообщения</b><small>Сообщения, удалённые в Telegram</small></span><strong class="home-archive-count">${deletedCount}</strong><i>→</i>
          </button>
          <button class="home-archive-card edited" data-go="edited" type="button">
            <span class="home-archive-icon">✎</span><span class="home-archive-copy"><b>Изменённые сообщения</b><small>Предыдущие и текущие версии сообщений</small></span><strong class="home-archive-count">${editedCount}</strong><i>→</i>
          </button>
        </div>
        <section class="home-referral-card">
          <div class="home-referral-copy"><span class="eyebrow">ПРИГЛАШАЙ ДРУЗЕЙ</span><h3>1 день Premium за каждого участника</h3><p>Поделись ссылкой. Когда новый участник привяжет Telegram и зарегистрируется, тебе начислится 1 день Premium.</p><small>Приглашено: <b>${referralCount||0}</b></small></div>
          <div class="home-referral-actions"><code>${esc(referralCode||'Код недоступен')}</code><button class="primary small" id="copy-referral" type="button" ${!referralCode?'disabled':''}>Скопировать ссылку</button></div>
        </section>
        <div class="section-heading"><div><div class="eyebrow">ТВОИ СВЯЗИ</div><h3>Огоньки сообщества</h3></div><button class="text-button" data-go="streaks">Все огоньки →</button></div>
        <div class="streak-list">${state.streaks.filter(s=>effectiveStreakDays(s)>0).length?state.streaks.filter(s=>effectiveStreakDays(s)>0).map(s=>`<div class="streak-row"><span class="streak-symbol">🔥</span><div class="streak-info"><b>Общий огонёк</b><small>Серия продолжается</small></div><strong>${effectiveStreakDays(s)} <small>дн.</small></strong></div>`).join(''):'<div class="empty-state">Пока нет активных серий. Найди друга и начните обмениваться сообщениями каждый день.</div>'}</div>
        <div class="home-feature-grid"><button class="home-feature-card" data-go="friends"><span>👥</span><b>Друзья</b><small>Добавляй близких и зажигай совместные серии</small><i>→</i></button><button class="home-feature-card" data-go="missions"><span>⚡</span><b>Ежедневные задания</b><small>Новые испытания и XP каждый день</small><i>→</i></button><button class="home-feature-card" data-go="season"><span>🎟️</span><b>Сезонный пропуск</b><small>Открывай награды и прокачивай сезон</small><i>→</i></button><button class="home-feature-card" data-go="wallet"><span>🪙</span><b>Баланс</b><small>Монеты, история и пополнение через Stars</small><i>→</i></button><button class="home-feature-card" data-go="support_user"><span>🛟</span><b>Написать в техподдержку</b><small>Свяжись с командой FLAMEXBOT</small><i>→</i></button><button class="home-feature-card" data-go="achievements"><span>🏆</span><b>Коллекция достижений</b><small>Открывай награды за активность</small><i>→</i></button>${state.isAdmin?'<button class="home-feature-card" data-go="users"><span>👥</span><b>Все пользователи</b><small>Управляй сообществом FLAMEXBOT</small><i>→</i></button>':''}</div>`;
      host.querySelector('#copy-referral')?.addEventListener('click',async()=>{
        const link=referralLinkData?.link;
        if(!link){toast(refCodeError?.message||referralLinkData?.error||'Реферальная ссылка пока недоступна.');return;}
        try{await navigator.clipboard.writeText(link);toast('Реферальная ссылка бота скопирована!');}
        catch{window.prompt('Скопируй ссылку приглашения',link);}
      });
      if(refCodeError||refCountError)console.warn('Referral panel load:',refCodeError?.message||refCountError?.message);
    } else if(state.page==='tariffs') await renderTariffs(host);
    else if(state.page==='messages') await renderBusinessMessages(host);
    else if(state.page==='deleted') await renderBusinessMessageEvents(host,'deleted');
    else if(state.page==='edited') await renderBusinessMessageEvents(host,'edited');
    else if(state.page==='friends') await renderFriends(host);
    else if(state.page==='streaks') await renderStreaks(host);
    else if(state.page==='missions') await renderDailyMissions(host);
    else if(state.page==='wallet') await renderWallet(host);
    else if(state.page==='season') await renderSeasonPass(host);
    else if(state.page==='support_user') await renderUserSupport(host);
    else if(state.page==='banners'&&state.isAdmin) await renderBotBanners(host);
    else if(state.page==='profile') await renderProfile(host);
    else if(state.page==='achievements') await renderAchievements(host);
    else if(state.page==='stats') await renderStats(host);
    else if(state.page==='commands') await renderCommands(host);
    else if(state.page==='support') await renderSupportInbox(host);
    else if(state.page==='inbox') await renderBotInbox(host);
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
  const missing=state.businessChats.filter(chat=>!chat.photo_url&&!state.avatarRefreshAttempted.has(chat.id)).slice(0,40);
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
       if(host.isConnected&&state.businessChats.some(chat=>!chat.photo_url&&!state.avatarRefreshAttempted.has(chat.id))){
       refreshMissingBusinessAvatars(host);
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
  const {data,error}=await supabase.functions.invoke('business-chat-send',{body:{action:'list_chats'}});
  if(error||data?.error){
    const list=host.querySelector('.business-inbox .chat-list');
    if(list)list.innerHTML='<div class="empty-state">Не удалось получить чаты: '+esc(data?.error||error?.message||'ошибка')+'</div>';
    return;
  }
  state.businessChats=data?.chats||[];
  const list=host.querySelector('.business-inbox .chat-list');
  if(!list)return;
  list.innerHTML=renderBusinessChatChoices(state.businessChats);
  bindBusinessChatChoices(list);bindBusinessChatPreferences(list);
}

async function renderBusinessMessageEvents(host,eventType) {
  const uid=state.session.user.id;
  const deleted=eventType==='deleted';
  const title=deleted?'Удалённые сообщения':'Изменённые сообщения';
  const icon=deleted?'🗑️':'✏️';
  host.innerHTML=`<div class="page-heading"><button class="outline small" type="button" data-go="home">← Назад</button><div class="eyebrow">TELEGRAM BUSINESS · ИСТОРИЯ</div><h1>${icon} ${title}</h1><p class="muted">История сгруппирована по отдельным перепискам.</p></div><div class="message-events-list"><div class="page-loading"><div class="loader-mark"><span>✦</span><i></i><b></b></div><strong>Загружаем историю</strong></div></div>`;
  const list=host.querySelector('.message-events-list');
  const {data:events,error}=await supabase.from('flamexbot_business_message_events')
    .select('id,business_chat_id,telegram_message_id,event_type,original_content,message_type,media_file_id,media_url,original_raw,occurred_at')
    .eq('profile_id',uid).eq('event_type',eventType).order('occurred_at',{ascending:false}).limit(100);
  if(error){list.innerHTML=`<div class="empty-state">Не удалось загрузить историю: ${esc(error.message)}</div>`;return;}
  if(!events?.length){list.innerHTML=`<div class="empty-state">${deleted?'Удалённых сообщений пока нет.':'Изменённых сообщений пока нет.'}</div>`;return;}
  const missingTextPlaceholder='[Текст не был сохранён до получения события об удалении]';
  const visibleEvents=deleted?events.filter(event=>{const raw=event.original_raw||{};const body=String(event.original_content||raw.text||raw.caption||'').trim();return body!==missingTextPlaceholder&&Boolean(body||event.media_url||event.media_file_id||(event.message_type&&event.message_type!=='text'));}):events;
  if(!visibleEvents.length){list.innerHTML='<div class="empty-state">Удалённых сообщений с сохранённым содержимым пока нет.</div>';return;}
  const chatIds=[...new Set(visibleEvents.map(e=>e.business_chat_id))];
  const {data:chats,error:chatError}=await supabase.from('flamexbot_business_chats')
    .select('id,telegram_chat_id,username,first_name,last_name,photo_url').eq('profile_id',uid).in('id',chatIds);
  if(chatError){list.innerHTML=`<div class="empty-state">Не удалось загрузить переписки: ${esc(chatError.message)}</div>`;return;}
  const chatMap=new Map((chats||[]).map(c=>[c.id,c]));
  const currentMessageMap=new Map();
  if(!deleted){
    const messageIds=[...new Set(visibleEvents.map(e=>e.telegram_message_id))];
    const {data:currentMessages,error:currentError}=await supabase.from('flamexbot_business_messages')
      .select('business_chat_id,telegram_message_id,content,message_type')
      .eq('direction','inbound').in('business_chat_id',chatIds).in('telegram_message_id',messageIds);
    if(currentError){list.innerHTML=`<div class="empty-state">Не удалось загрузить актуальные версии: ${esc(currentError.message)}</div>`;return;}
    (currentMessages||[]).forEach(m=>currentMessageMap.set(m.business_chat_id+':'+m.telegram_message_id,m));
  }
  const paths=[...new Set(visibleEvents.map(e=>e.media_url).filter(Boolean))];
  const mediaUrlMap={};
  if(paths.length){
    try{
      const {data:signed,error:signedError}=await supabase.storage.from('flamex-business-media').createSignedUrls(paths,3600);
      if(!signedError)for(const item of signed||[])if(item.path&&item.signedUrl)mediaUrlMap[item.path]=item.signedUrl;
    }catch(error){console.warn('Message event media preview:',error?.message||error);}
  }
  const grouped=new Map();
  visibleEvents.forEach(event=>{if(!grouped.has(event.business_chat_id))grouped.set(event.business_chat_id,[]);grouped.get(event.business_chat_id).push(event);});
  list.innerHTML=[...grouped.entries()].map(([chatId,chatEvents])=>{
    const chat=chatMap.get(chatId)||{};
    const chatName=[chat.first_name,chat.last_name].filter(Boolean).join(' ')||(chat.username?'@'+chat.username:'Telegram-пользователь');
    const cards=chatEvents.map(event=>{
      const raw=event.original_raw||{};
      const mediaType=event.message_type||'text';
      const mediaUrl=mediaUrlMap[event.media_url]||'';
      const mediaName=raw.document?.file_name||raw.audio?.file_name||raw.video?.file_name||raw.animation?.file_name||'Вложение';
      let media='';
      if(mediaUrl&&mediaType==='photo')media=`<a class="event-media" href="${esc(mediaUrl)}" target="_blank" rel="noopener"><img src="${esc(mediaUrl)}" loading="lazy" alt="Фото из сообщения"/></a>`;
      else if(mediaUrl&&['video','video_note','animation'].includes(mediaType))media=`<video class="event-video" controls preload="metadata" src="${esc(mediaUrl)}"></video>`;
      else if(mediaUrl&&['voice','audio'].includes(mediaType))media=`<audio class="event-audio" controls preload="metadata" src="${esc(mediaUrl)}"></audio>`;
      else if(mediaUrl&&mediaType==='sticker')media=`<img class="event-sticker" src="${esc(mediaUrl)}" loading="lazy" alt="Стикер из сообщения"/>`;
      else if(mediaType!=='text')media=`<div class="event-attachment">📎 ${esc(mediaName)} · ${esc(mediaType)}${!mediaUrl?' · файл недоступен':''}</div>`;
      const body=event.original_content||raw.text||raw.caption||'';
      const current=currentMessageMap.get(event.business_chat_id+':'+event.telegram_message_id);
      const currentMarkup=!deleted&&current?`<div class="message-event-current"><small>Текущая версия</small><div>${current.content?esc(current.content):'<span class="muted">Текст отсутствует</span>'}</div></div>`:'';
      return `<article class="message-event-card ${deleted?'is-deleted':'is-edited'}">
        <div class="message-event-top">${avatar(chat.photo_url,chatName,'message-event-avatar')}<span class="message-event-icon">${deleted?'🗑️':'✏️'}</span><div><b>${esc(chatName)}</b><small>${chat.username?'@'+esc(chat.username)+' · ':''}${deleted?'Сообщение удалено':'Сохранена предыдущая версия'} · #${esc(event.telegram_message_id)}</small></div><time>${formatMskDateTime(event.occurred_at,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div>
        <div class="message-event-content"><small>${deleted?'Удалённое сообщение':'Было'}</small><div>${body?esc(body):'<span class="muted">Текст отсутствует</span>'}</div></div>${media}${currentMarkup}
        <div class="message-event-footer"><span>${deleted?'Удалено в Telegram':'Отредактировано в Telegram'}</span><small>Только входящее сообщение</small></div>
      </article>`;
    }).join('');
    return `<details class="message-event-chat"><summary>${avatar(chat.photo_url,chatName)}<span>${esc(chatName)}</span><small>${chatEvents.length} ${deleted?'удалённых':'изменённых'}</small></summary><div class="message-event-chat-list">${cards}</div></details>`;
  }).join('');
}

async function renderBusinessMessages(host) {
  if (state.businessListChannel) {
    await supabase.removeChannel(state.businessListChannel);
    state.businessListChannel = null;
  }
  const uid = state.session.user.id;
  const {data:chatData,error}=await supabase.functions.invoke('business-chat-send',{body:{action:'list_chats'}});
  if(error||chatData?.error){
    host.innerHTML = `<div class="page-heading"><div class="eyebrow">TELEGRAM BUSINESS</div><h1>Переписки</h1></div><div class="empty-state">${esc(chatData?.error||error?.message||'Не удалось загрузить чаты')}</div>`;
    return;
  }
  state.businessChats=chatData?.chats||[];
  const connection=chatData?.connection;
  const connected = Boolean(connection?.is_enabled);
  state.businessRights = connection?.rights || {};
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">ПЕРЕПИСКИ TELEGRAM BUSINESS</div><h1>Переписки</h1><p class="muted">Все диалоги синхронизируются через Telegram Business. Сообщения отправляются от имени подключённого аккаунта — только в пределах выданных Telegram разрешений.</p><button class="outline small" type="button" data-go="inbox">✉ Личные сообщения бота</button></div>
    <div class="business-inbox-status ${connected ? 'online' : ''}"><span></span><div><b>${connected ? 'Telegram Business подключён' : 'Telegram Business не подключён'}</b><small>${connected ? 'Список диалогов обновляется автоматически.' : 'Подключи FLAMEXBOT в Telegram → Настройки → Telegram Business → Чат-боты.'}</small></div></div>
    <div class="business-inbox-tools"><input id="business-chat-search" type="search" placeholder="Найти диалог по имени"/></div><div class="chat-layout business-inbox"><aside class="chat-list">${renderBusinessChatChoices(state.businessChats)}</aside>
    <section class="chat-window" id="business-chat-window"><div class="chat-placeholder"><span>✈</span><b>Твои переписки</b><small>Выбери диалог, чтобы открыть историю сообщений и настройки.</small></div></section></div>`;
  bindBusinessChatChoices(host);bindBusinessChatPreferences(host);bindBusinessSearch(host);
  refreshMissingBusinessAvatars(host);
  if(state.businessChatListPollTimer){clearInterval(state.businessChatListPollTimer);state.businessChatListPollTimer=null;}
  state.businessChatListPollTimer=setInterval(()=>{if(state.page==='messages'&&!document.hidden)refreshBusinessChatList(host);},5000);
  state.businessListChannel = supabase.channel(`business-chat-list-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'flamexbot_business_chats', filter: `profile_id=eq.${uid}` }, () => scheduleBusinessChatListRefresh(host))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Не удалось подключить обновление переписок');
    });
  // The initial chat list is already populated above; realtime keeps it current.
}

function openBusinessMediaViewer(url,type) {
  if(!url)return;
  document.querySelector('.business-media-viewer')?.remove();
  const overlay=document.createElement('div');
  overlay.className='business-media-viewer';
  const safeUrl=esc(url);
  let media='';
  if(type==='video')media='<video class="media-viewer-content" controls autoplay playsinline src="'+safeUrl+'"></video>';
  else media='<img class="media-viewer-content" src="'+safeUrl+'" alt="Просмотр вложения"/>';
  overlay.innerHTML='<button type="button" class="media-viewer-close" aria-label="Закрыть">×</button><div class="media-viewer-stage">'+media+'</div><a class="media-viewer-open" href="'+safeUrl+'" target="_blank" rel="noopener">Открыть оригинал ↗</a>';
  const close=()=>{const video=overlay.querySelector('video');if(video)video.pause();overlay.remove();document.removeEventListener('keydown',onKey);};
  const onKey=event=>{if(event.key==='Escape')close();};
  overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.classList.contains('media-viewer-stage'))close();});
  overlay.querySelector('.media-viewer-close')?.addEventListener('click',close);
  document.addEventListener('keydown',onKey);
  document.body.appendChild(overlay);
}

function bindBusinessMediaViewer(list) {
  list.querySelectorAll('[data-media-viewer]').forEach(control=>control.addEventListener('click',event=>{
    event.preventDefault();
    const type=control.dataset.mediaViewer;
    const url=control.dataset.mediaUrl||control.getAttribute('href');
    openBusinessMediaViewer(url,type);
  }));
}

function bindBusinessMessageActions(list) {
  list.querySelectorAll('[data-copy-message]').forEach(button=>button.addEventListener('click',async()=>{
    const value=button.getAttribute('data-copy-message')||'';
    try{
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';
        document.body.appendChild(field);field.select();const copied=document.execCommand('copy');field.remove();
        if(!copied)throw new Error('copy unavailable');
      }
      const previous=button.textContent;button.textContent='Скопировано';button.disabled=true;
      setTimeout(()=>{button.textContent=previous;button.disabled=false;},1200);
    }catch{toast('Не удалось скопировать текст.');}
  }));
}

function renderBusinessBubble(message, mediaUrl = '') {
  const mine = message.direction === 'outbound';
  const chat=state.businessChats.find(item=>item.id===state.activeBusinessChat);
  const chatName=[chat?.first_name,chat?.last_name].filter(Boolean).join(' ')||chat?.username||'Telegram-пользователь';
  const senderAvatar=mine?avatar(state.profile?.avatar_url||state.profile?.telegram_photo_url,state.profile?.display_name||state.profile?.username||'Ты','message-avatar mine-avatar'):avatar(chat?.photo_url,chatName,'message-avatar');
  if (message.deleted_at) return '';
  const content = message.content || '';
  const raw = message.raw || {};
  const mediaName = raw.document?.file_name || raw.audio?.file_name || raw.video?.file_name || raw.animation?.file_name || 'Вложение';
  const mediaSize = [raw.document?.file_size,raw.audio?.file_size,raw.video?.file_size,raw.animation?.file_size].find(Boolean);
  const mediaSizeLabel = mediaSize ? ' · '+(mediaSize/1024/1024).toFixed(1)+' МБ' : '';
  const mediaType = message.message_type || 'text';
  let media = '';
  if (mediaType !== 'text' && !message.deleted_at) {
    if (mediaUrl && mediaType === 'photo') media = `<a class="business-media-preview" href="${esc(mediaUrl)}" data-media-viewer="image" aria-label="Открыть фото"><img src="${esc(mediaUrl)}" loading="lazy" alt="Фото"/></a>`;
    else if (mediaUrl && ['animation','sticker'].includes(mediaType)) media = `<a class="business-media-preview business-animation-preview" href="${esc(mediaUrl)}" data-media-viewer="image" aria-label="Открыть ${mediaType==='sticker'?'стикер':'GIF-анимацию'}"><img src="${esc(mediaUrl)}" loading="lazy" alt="${mediaType==='sticker'?'Стикер':'GIF-анимация'}"/></a>`;
    else if (mediaUrl && ['video','video_note'].includes(mediaType)) media = `<div class="business-video-wrap"><video class="business-video-preview" controls playsinline preload="metadata" src="${esc(mediaUrl)}"></video><button type="button" class="media-expand-button" data-media-viewer="video" data-media-url="${esc(mediaUrl)}">Развернуть видео</button></div>`;
    else if (mediaUrl && ['audio','voice'].includes(mediaType)) media = `<div class="business-audio-card"><span>${mediaType==='voice'?'🎙 Голосовое сообщение':'🎵 Аудио'}</span><audio class="business-audio-preview" controls preload="metadata" src="${esc(mediaUrl)}"></audio></div>`;
    else if (mediaUrl) media = `<a class="business-file-link" href="${esc(mediaUrl)}" target="_blank" rel="noopener" download="${esc(mediaName)}"><span>📎</span><span><b>${esc(mediaName)}</b><small>${esc(mediaType.toUpperCase())}${mediaSizeLabel}</small></span><span>↓</span></a>`;
    else media = `<div class="business-media-note">Вложение: ${esc(mediaType)}${message.media_file_id ? ' · получено от Telegram' : ''}</div>`;
  }
  const reply = message.reply_to_message_id ? `<div class="reply-reference">↪ Ответ на сообщение #${message.reply_to_message_id}</div>` : '';
  const replyButton = !message.deleted_at && message.telegram_message_id ? `<button type="button" class="reply-message" data-reply-to="${message.telegram_message_id}">Ответить</button>` : '';
  const copyButton = content && !message.deleted_at ? `<button type="button" class="copy-message" data-copy-message="${esc(content)}">Копировать</button>` : '';
  const deliveryStatus = mine ? '<span class="message-delivery-status" title="Сообщение сохранено после успешной отправки">✓ Отправлено</span>' : '';
  const bubble = `<div class="bubble ${mine ? 'mine' : ''}">${reply}${content ? `<div>${esc(content)}</div>` : ''}${media}<div class="bubble-footer"><small>${formatMskTime(message.created_at)}</small><span class="bubble-actions">${deliveryStatus}${copyButton}${replyButton}</span></div></div>`;
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

function compareBusinessMessages(a,b) {
  const dateOrder=String(a.created_at||"").localeCompare(String(b.created_at||""));
  return dateOrder || String(a.id||"").localeCompare(String(b.id||""));
}

async function refreshBusinessMessagesNow(chatId) {
  if (state.activeBusinessChat !== chatId) return;
  const list=document.querySelector("#business-message-list");
  if(!list)return;
  const initialLoad=!state.businessMessagesInitialLoaded;
  const oldScrollTop=list.scrollTop;
  const wasNearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<140;
  const {data:messageData,error}=await supabase.functions.invoke('business-chat-send',{body:{action:'list_messages',chat_id:chatId}});
  if(state.activeBusinessChat!==chatId)return;
  if(error||messageData?.error){list.innerHTML='<div class="empty-state">'+esc(messageData?.error||error?.message||'Не удалось загрузить сообщения')+'</div>';return;}
  const newest=messageData?.messages||[];
  const data=newest;
  const byId=new Map();
  [...(state.businessMessages||[]),...newest].forEach(message=>byId.set(message.id,message));
  state.businessMessages=[...byId.values()].sort(compareBusinessMessages);
  if(initialLoad)state.businessMessagesHasMore=Boolean(messageData?.has_more);
  state.businessMessagesOldestAt=state.businessMessages[0]?.created_at||null;
  state.businessMessagesInitialLoaded=true;

  const latestInbound=state.businessMessages.filter(m=>m.direction==="inbound")
    .reduce((latest,m)=>!latest||new Date(m.created_at)>new Date(latest)?m.created_at:latest,null);
  const openChat=state.businessChats.find(chat=>chat.id===chatId);
  if(!document.hidden&&latestInbound&&(!openChat?.last_read_at||new Date(latestInbound)>new Date(openChat.last_read_at))){
    const readAt=new Date().toISOString();
    const {error:readError}=await supabase.from("flamexbot_business_chat_settings")
      .upsert({profile_id:state.session.user.id,business_chat_id:chatId,last_read_at:readAt},{onConflict:"profile_id,business_chat_id"});
    if(!readError){
      if(openChat){openChat.last_read_at=readAt;openChat.unread_count=0;}
      document.querySelector('[data-business-chat="'+chatId+'"] .chat-unread-badge')?.remove();
    }
  }
  await renderBusinessMessagesList(chatId,{
    scrollToBottom:true,
    scrollTop:oldScrollTop
  });
}

async function loadOlderBusinessMessages(chatId) {
  if(state.activeBusinessChat!==chatId||state.businessMessagesLoadingOlder||!state.businessMessagesHasMore)return;
  const cursor=state.businessMessages[0];
  const list=document.querySelector("#business-message-list");
  if(!cursor||!list)return;
  const scrollHeightBefore=list.scrollHeight;
  const scrollTopBefore=list.scrollTop;
  state.businessMessagesLoadingOlder=true;
  const button=list.querySelector("#business-load-older");
  if(button){button.disabled=true;button.textContent="Загружаю…";}
  const cursorFilter="created_at.lt."+cursor.created_at+",and(created_at.eq."+cursor.created_at+",id.lt."+cursor.id+")";
  const {data,error}=await supabase.from("flamexbot_business_messages")
    .select("id,telegram_message_id,direction,content,message_type,media_file_id,media_url,reply_to_message_id,created_at,deleted_at,raw")
    .eq("business_chat_id",chatId).or(cursorFilter)
    .order("created_at",{ascending:false}).order("id",{ascending:false}).limit(100);
  if(state.activeBusinessChat!==chatId){state.businessMessagesLoadingOlder=false;return;}
  if(error){
    state.businessMessagesLoadingOlder=false;
    toast("Не удалось загрузить предыдущие сообщения: "+error.message);
    if(button){button.disabled=false;button.textContent="Загрузить предыдущие сообщения";}
    return;
  }
  const older=(data||[]).reverse();
  const byId=new Map();
  [...older,...state.businessMessages].forEach(message=>byId.set(message.id,message));
  state.businessMessages=[...byId.values()].sort(compareBusinessMessages);
  state.businessMessagesHasMore=(data||[]).length===100;
  state.businessMessagesOldestAt=state.businessMessages[0]?.created_at||null;
  state.businessMessagesLoadingOlder=false;
  await renderBusinessMessagesList(chatId,{
    preserveScroll:true,
    scrollHeightBefore,
    scrollTopBefore
  });
}

async function renderBusinessMessagesList(chatId,scrollOptions={}) {
  if(state.activeBusinessChat!==chatId)return;
  const list=document.querySelector("#business-message-list");
  if(!list)return;
  const query=(document.querySelector("#business-message-search")?.value||"").trim().toLowerCase();
  const visible=state.businessMessages.filter(message=>!message.deleted_at).filter(message=>{
    if(!query)return true;
    const raw=message.raw||{};
    const fileName=raw.document?.file_name||raw.audio?.file_name||raw.video?.file_name||raw.animation?.file_name||"";
    return [message.content,fileName,message.message_type].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
  const mediaUrls={};
  const mediaPaths=[...new Set(visible.filter(message=>message.media_url).map(message=>message.media_url))];
  const missingPaths=mediaPaths.filter(path=>{
    const cached=state.businessMediaUrlCache.get(path);
    return !cached||typeof cached!=="object"||cached.expiresAt<Date.now()+60000;
  });
  if(missingPaths.length){
    try{
      const {data,error}=await supabase.storage.from("flamex-business-media").createSignedUrls(missingPaths,3600);
      if(!error)for(const item of data||[])if(item.path&&item.signedUrl){
        state.businessMediaUrlCache.set(item.path,{url:item.signedUrl,expiresAt:Date.now()+55*60*1000});
      }
    }catch(error){console.warn("Business media preview:",error?.message||error);}
  }
  visible.forEach(message=>{
    if(!message.media_url)return;
    const cached=state.businessMediaUrlCache.get(message.media_url);
    const url=typeof cached==="string"?cached:cached?.url;
    if(url)mediaUrls[message.id]=url;
  });
  const loadOlderMarkup=state.businessMessagesHasMore
    ? '<button type="button" class="load-older-messages" id="business-load-older" '+(state.businessMessagesLoadingOlder?'disabled':'')+'>'+
      (state.businessMessagesLoadingOlder?'Загружаю…':'Загрузить предыдущие сообщения')+'</button>'
    : "";
  const messagesMarkup=visible.map(message=>renderBusinessBubble(message,mediaUrls[message.id]||"")).join("")
    || '<div class="chat-placeholder"><b>Сообщений не найдено</b><small>Измени поисковый запрос или загрузи более раннюю историю.</small></div>';
  list.innerHTML=loadOlderMarkup+messagesMarkup;
  list.querySelector("#business-load-older")?.addEventListener("click",()=>loadOlderBusinessMessages(chatId));
  bindBusinessMessageActions(list);
  bindBusinessMediaViewer(list);
  list.querySelectorAll("[data-reply-to]").forEach(button=>button.addEventListener("click",()=>{
    const form=document.querySelector("#business-send-form");
    const preview=document.querySelector("#business-reply-preview");
    if(!form||!preview)return;
    form.querySelector('[name=reply_to_message_id]').value=button.dataset.replyTo;
    preview.hidden=false;
    preview.querySelector("span").textContent="Ответ на сообщение #"+button.dataset.replyTo;
    form.querySelector('input[name=content]').focus();
  }));
  if(scrollOptions.scrollToBottom){requestAnimationFrame(()=>{if(list.isConnected)list.scrollTo({top:list.scrollHeight,behavior:'auto'});});}
  if(scrollOptions.preserveScroll){
    list.scrollTop=scrollOptions.scrollTopBefore+(list.scrollHeight-scrollOptions.scrollHeightBefore);
  }else if(scrollOptions.scrollToBottom){
    list.scrollTop=list.scrollHeight;
  }else if(Number.isFinite(scrollOptions.scrollTop)){
    list.scrollTop=scrollOptions.scrollTop;
  }
}

async function openBusinessChat(id) {
  if(state.businessChatPollTimer){clearInterval(state.businessChatPollTimer);state.businessChatPollTimer=null;}
  state.activeBusinessChat = id;
  state.businessMessages=[];
  state.businessMessagesHasMore=false;
  state.businessMessagesLoadingOlder=false;
  state.businessMessagesInitialLoaded=false;
  state.businessMessagesOldestAt=null;
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
  const premiumAccess = isPremium();
  const readAt=new Date().toISOString();
  const {error:readError}=await supabase.from('flamexbot_business_chat_settings').upsert({profile_id:state.session.user.id,business_chat_id:id,is_favorite:Boolean(chat.is_favorite),is_pinned:Boolean(chat.is_pinned),last_read_at:readAt},{onConflict:'profile_id,business_chat_id'});
  if(!readError){chat.last_read_at=readAt;chat.unread_count=0;document.querySelector(`[data-business-chat="${id}"] .chat-unread-badge`)?.remove();}
  box.closest('.business-inbox')?.classList.add('chat-open');
  box.innerHTML = `<div class="chat-head"><button type="button" class="chat-back" id="business-chat-back">← Все чаты</button><div class="chat-head-person">${avatar(chat.photo_url,name,'chat-avatar')}<div><b>${esc(name)}</b><small>${founderChat ? 'Защищённый диалог владельца' : 'Управление командами доступно прямо в этой переписке'}${chat.username ? ' · @'+esc(chat.username) : ''}</small></div></div><div class="message-search-tools"><input class="message-search" id="business-message-search" type="search" placeholder="Поиск в загруженных сообщениях…"/><button type="button" class="outline small" id="business-search-all">Вся история</button></div> ${premiumAccess?'<button type="button" class="chat-export-button" id="export-business-chat">↓ Экспорт</button>':''}</div><div id="business-chat-controls"></div><div class="message-list" id="business-message-list"><div class="empty-state">Загружаю сообщения…</div></div><div class="reply-preview" id="business-reply-preview" hidden><span></span><button type="button" id="cancel-business-reply" aria-label="Отменить ответ">×</button></div><form class="send-form" id="business-send-form" autocomplete="off"><label class="attach-file-button" for="business-media-input" title="Прикрепить файл">＋</label><input id="business-media-input" class="business-media-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,application/pdf,text/plain,text/csv,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/rtf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" /><input name="content" placeholder="Сообщение или подпись к файлу…" maxlength="4096" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" aria-autocomplete="none" inputmode="text" enterkeyhint="send"/><input type="hidden" name="reply_to_message_id"/><button class="primary" type="submit">➤</button></form><div class="selected-media" id="selected-business-media" hidden></div><div class="upload-hint">Фото, видео, аудио и документы до 20 МБ · отправка через Telegram Business.</div>`;
  const searchAllButton=box.querySelector('#business-search-all');
  searchAllButton?.addEventListener('click',async()=>{
    const input=box.querySelector('#business-message-search');
    const query=(input?.value||'').trim();
    if(query.length<2){toast('Введи минимум 2 символа для поиска по всей истории.');input?.focus();return;}
    searchAllButton.disabled=true;searchAllButton.textContent='Ищем…';
    try{
      const escapedQuery=query.replace(/[\\%_]/g, char=>'\\'+char);
      const {data:matches,error:searchError}=await supabase.from('flamexbot_business_messages')
        .select('id,telegram_message_id,direction,content,message_type,media_file_id,media_url,reply_to_message_id,created_at,deleted_at,raw')
        .eq('business_chat_id',id).ilike('content','%'+escapedQuery+'%')
        .order('created_at',{ascending:false}).limit(100);
      if(searchError)throw searchError;
      const found=matches||[];const paths=[...new Set(found.map(message=>message.media_url).filter(Boolean))];const mediaMap={};
      if(paths.length){const {data:signed,error:signedError}=await supabase.storage.from('flamex-business-media').createSignedUrls(paths,3600);if(!signedError)for(const item of signed||[])if(item.path&&item.signedUrl)mediaMap[item.path]=item.signedUrl;}
      const list=box.querySelector('#business-message-list');if(!list)return;
      list.innerHTML='<div class="business-search-results"><b>Результаты по всей сохранённой истории: '+found.length+'</b><small>Показаны последние совпадения, максимум 100.</small><button type="button" class="outline small" id="business-search-restore">Вернуться к переписке</button></div>'+(found.length?found.filter(message=>!message.deleted_at).reverse().map(message=>renderBusinessBubble(message,mediaMap[message.media_url]||'')).join(''):'<div class="chat-placeholder"><b>Совпадений не найдено</b><small>Попробуй изменить поисковый запрос.</small></div>');
      list.querySelector('#business-search-restore')?.addEventListener('click',()=>refreshBusinessMessages(id));
      bindBusinessMessageActions(list);
      bindBusinessMediaViewer(list);
      list.querySelectorAll('[data-reply-to]').forEach(button=>button.addEventListener('click',()=>{const form=box.querySelector('#business-send-form');const preview=box.querySelector('#business-reply-preview');if(!form||!preview)return;form.querySelector('[name=reply_to_message_id]').value=button.dataset.replyTo;preview.hidden=false;preview.querySelector('span').textContent='Ответ на сообщение #'+button.dataset.replyTo;form.querySelector('input[name=content]').focus();}));
    }catch(error){toast('Не удалось выполнить поиск: '+(error?.message||'ошибка'));}
    finally{searchAllButton.disabled=false;searchAllButton.textContent='Вся история';}
  });
  const exportButton=box.querySelector('#export-business-chat');
  exportButton?.addEventListener('click',async()=>{
    if(!isPremium()){
      toast('Экспорт переписки доступен в Premium и у основателя.');return;
    }
    exportButton.disabled=true;exportButton.textContent='Готовим экспорт…';
    try{
      const allMessages=[];
      const pageSize=1000;
      for(let offset=0;offset<50000;offset+=pageSize){
        const {data,error}=await supabase.from('flamexbot_business_messages')
          .select('telegram_message_id,direction,content,message_type,created_at,edited_at,deleted_at,reply_to_message_id,media_url')
          .eq('business_chat_id',id)
          .order('created_at',{ascending:true})
          .order('telegram_message_id',{ascending:true})
          .range(offset,offset+pageSize-1);
        if(error)throw error;
        allMessages.push(...(data||[]));
        if(!data||data.length<pageSize)break;
      }
      if(!allMessages.length){toast('В этой переписке пока нет сохранённых сообщений.');return;}
      const exportData={
        format:'FLAMEXBOT chat export v1',
        exported_at:new Date().toISOString(),
        chat:{id,username:chat.username||null,name,telegram_chat_id:chat.telegram_chat_id},
        messages:allMessages
      };
      const blob=new Blob([JSON.stringify(exportData,null,2)],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;link.download='flamexbot-chat-'+String(id).slice(0,8)+'.json';
      document.body.appendChild(link);link.click();link.remove();
      URL.revokeObjectURL(url);
      toast('Экспортировано сообщений: '+allMessages.length);
    }catch(error){
      toast('Не удалось экспортировать переписку: '+(error?.message||'ошибка'));
    }finally{
      exportButton.disabled=false;exportButton.textContent='↓ Экспорт';
    }
  });
  const controlsHost = box.querySelector('#business-chat-controls');
  if(controlsHost) controlsHost.innerHTML='';
  box.querySelector('#business-chat-back')?.addEventListener('click', () => {
    state.activeBusinessChat = null;
    if(state.businessChatPollTimer){clearInterval(state.businessChatPollTimer);state.businessChatPollTimer=null;}
    box.closest('.business-inbox')?.classList.remove('chat-open');
    box.innerHTML = '<div class="chat-placeholder"><span>✈</span><b>Твои переписки</b><small>Выбери чат слева.</small></div>';
    document.querySelectorAll('[data-business-chat]').forEach(btn => btn.classList.remove('active'));
  });
  await refreshBusinessMessages(id);
  state.businessChatPollTimer=setInterval(()=>{if(state.activeBusinessChat===id&&!document.hidden)refreshBusinessMessages(id);},2500);
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
      const extension=(file.name.split('.').pop()||'').toLowerCase();
      const mimeByExtension={
        jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',
        mp4:'video/mp4',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',opus:'audio/ogg',wav:'audio/wav',
        pdf:'application/pdf',txt:'text/plain',csv:'text/csv',zip:'application/zip',
        doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        rtf:'application/rtf'
      };
      const fileMimeType=file.type&&file.type!=='application/octet-stream'?file.type:(mimeByExtension[extension]||'application/octet-stream');
      mediaType=fileMimeType==='image/gif'?'animation'
        :(['image/jpeg','image/png'].includes(fileMimeType)&&file.size<=10*1024*1024)?'photo'
        :fileMimeType==='video/mp4'?'video'
        :fileMimeType==='audio/ogg'?'voice'
        :['audio/mpeg','audio/mp4'].includes(fileMimeType)?'audio':'document';
      storagePath=state.session.user.id+'/'+id+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const {error:uploadError}=await supabase.storage.from('flamex-business-media').upload(storagePath,file,{contentType:fileMimeType,upsert:false});
      if(uploadError){button.disabled=false;toast('Не удалось загрузить файл: '+uploadError.message);return;}
    }
    const command=!file&&text.startsWith('.')?text.trim():'';
    if(command){
      const [rawName,...rest]=command.slice(1).split(/\s+/);const name=(rawName||'').toLowerCase();const args=rest.join(' ').trim();
      if(['help','inf'].includes(name)){toast('.mute · .unmute · .antimute · .unantimute · .autoread · .unautoread · .autotyping · .unautotyping · .autovoice · .unautovoice · .mutestick · .unmutestick · .antimat · .unantimat · .copyp · .qr текст');button.disabled=false;return;}
      const freeCommand=['unmute','unantimute','unantimut','untime','unafk','unautoread','unautotyping','unautovoice','unmutestick','unantimat','qr'].includes(name);
      if(!isPremium()&&!freeCommand){toast('Эта команда доступна только в Premium.');button.disabled=false;return;}
      if(name==='mute'||name==='unmute'){
        const next=name==='mute';
        if(next && String(chat.telegram_chat_id)===FOUNDER_TELEGRAM_ID){button.disabled=false;toast('Владелец FLAMEXBOT защищён от мута.');return;}
        if(next && !state.businessRights?.can_delete_all_messages){button.disabled=false;toast('Для мута нужно разрешение Telegram Business «Удалять все сообщения».');return;}
        const {data:settingData,error:settingError}=await supabase.functions.invoke('business-chat-send',{body:{action:'set_mute',chat_id:id,enabled:next}});
        button.disabled=false;if(settingError||settingData?.error){toast(settingData?.error||settingError?.message||'Не удалось изменить настройку чата');return;}
        chatMuted=next;chat.is_muted=next;renderBusinessControls();toast(next?'Мут включён':'Собеседник размучен');form.reset();await refreshBusinessChatList(document.querySelector('#page-content'));return;
      }
      if(['antimute','unantimute','antimut','unantimut'].includes(name)){
        const next=name==='antimute'||name==='antimut';
        if(args){button.disabled=false;toast('Команда не принимает аргументы: .antimute или .unantimute');return;}
        if(next&&!isPremium()){button.disabled=false;toast('Включение антимута доступно только в Premium.');return;}
        const {data:antiSettingData,error:antiError}=await supabase.functions.invoke('business-chat-send',{body:{action:'set_antimute',chat_id:id,enabled:next,command_mode:true,command_name:name}});
        button.disabled=false;if(antiError||antiSettingData?.error){toast(antiSettingData?.error||antiError?.message||'Не удалось изменить антимут');return;}
        antimutEnabled=next;chat.antimut_enabled=next;renderBusinessControls();toast(next?'Антимут включён: сообщения будут отправляться от имени бота':'Антимут выключен');form.reset();return;
      }
      const preferenceCommands={
        autoread:['autoread',true,'Автопрочтение'],unautoread:['autoread',false,'Автопрочтение'],
        autotyping:['autotyping',true,'Статус набора'],unautotyping:['autotyping',false,'Статус набора'],
        autovoice:['autovoice',true,'Статус записи голосового'],unautovoice:['autovoice',false,'Статус записи голосового'],
        mutestick:['mutestick',true,'Фильтр стикеров'],unmutestick:['mutestick',false,'Фильтр стикеров'],
        antimat:['antimat',true,'Антимат'],unantimat:['antimat',false,'Антимат']
      };
      if(preferenceCommands[name]){
        const [preference,enabled,label]=preferenceCommands[name];
        if(args){button.disabled=false;toast('Команда не принимает on/off: .'+name);return;}
        const {data:prefData,error:prefError}=await supabase.functions.invoke('business-chat-send',{body:{action:'set_preference',chat_id:id,preference,enabled,command_mode:true,command_name:name}});
        button.disabled=false;if(prefError||prefData?.error){toast(prefData?.error||prefError?.message||'Не удалось изменить настройку');return;}
        form.reset();toast(label+(enabled?' включён':' выключен'));return;
      }
      if(name==='time'||name==='untime'){
        const enabled=name==='time';const {error:timeError}=await supabase.from('profiles').update({show_profile_time:enabled}).eq('id',state.session.user.id);
        button.disabled=false;if(timeError){toast('Не удалось обновить время профиля');return;}state.profile={...state.profile,show_profile_time:enabled};toast(enabled?'Время в профиле включено':'Время в профиле выключено');form.reset();return;
      }
      if(['copyp','qr','afk','unafk'].includes(name)){
        if(name==='qr'&&!args){button.disabled=false;toast('Формат: .qr ссылка или текст');return;}
        const {data:utilityData,error:utilityError}=await supabase.functions.invoke('business-chat-send',{body:{chat_id:id,text,command_mode:true,command_name:name}});
        button.disabled=false;
        if(utilityError||utilityData?.error){toast(utilityData?.error||utilityError?.message||'Не удалось выполнить команду');return;}
        form.reset();
        if(name==='copyp')toast('Запрос профиля обработан FLAMEXBOT');
        else if(name==='qr')toast('Создаём QR-код…');
        else if(name==='afk')toast(utilityData?.message||'AFK включён только в этом диалоге');
        else if(name==='unafk')toast(utilityData?.message||'AFK выключен в этом диалоге');
        await refreshBusinessMessages(id);return;
      }
      button.disabled=false;toast('Неизвестная команда. Напиши .help');return;
    }
    const replyId=form.querySelector('[name=reply_to_message_id]').value||null;
    const { data, error } = await supabase.functions.invoke('business-chat-send', { body: { chat_id:id,text,storage_path:storagePath,media_type:mediaType,reply_to_message_id:replyId,antimut_mode:antimutEnabled } });
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

async function renderSupportInbox(host) {
  const {data:allowed,error:accessError}=await supabase.rpc('is_flamexbot_admin');
  if(accessError||allowed!==true||!state.isAdmin){
    host.innerHTML='<div class="page-heading"><h1>Нет доступа</h1><p class="muted">Входящие доступны только владельцу и администраторам.</p></div>';
    return;
  }
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT · SUPPORT</div><h1>Техподдержка</h1><p class="muted">Обращения пользователей, входящие сообщения и ответы от имени FLAMEXBOT.</p></div>
    <div class="support-inbox"><aside class="support-chat-list"><div class="support-list-head"><b>Диалоги</b><button class="outline small" id="support-refresh" type="button">↻</button></div><div class="support-chat-items"><div class="empty-state">Загрузка диалогов…</div></div></aside>
    <section class="support-thread"><div class="support-thread-placeholder"><span>✉</span><b>Выбери диалог</b><small>Здесь появится история сообщений с пользователем.</small></div></section></div>`;
  const list=host.querySelector('.support-chat-items');
  const thread=host.querySelector('.support-thread');
  let activeId=null;
  const supportMediaInfo=raw=>{try{const value=JSON.parse(raw||"");return value&&value._fx_media===1?value:null;}catch{return null;}};
  const renderSupportMessages=messages=>(messages||[]).map(msg=>{
    const media=supportMediaInfo(msg.content);
    const caption=media?.caption||(!media?msg.content:"");
    const attachment=media?'<button type="button" class="support-attachment" data-support-media="'+esc(msg.telegram_message_id)+'">📎 '+esc(media.file_name||msg.message_type||"Вложение")+' · Открыть</button>':"";
    return '<article class="support-message '+(msg.direction==='outgoing'?'outgoing':'incoming')+'">'+(caption?'<p>'+esc(caption)+'</p>':"")+attachment+'<time>'+formatMskDateTime(msg.created_at,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</time></article>';
  }).join('')||'<div class="empty-state">Сообщений пока нет.</div>';
  const bindSupportMedia=root=>{
    root.querySelectorAll('[data-support-media]').forEach(button=>button.addEventListener('click',async()=>{
      if(button.dataset.loading==="1"||button.dataset.loaded==="1")return;
      button.dataset.loading="1";button.disabled=true;button.textContent="Загружаем файл…";
      try{
        const {data:{session}}=await supabase.auth.getSession();
        if(!session?.access_token)throw new Error("Сессия администратора истекла");
        const response=await fetch(SUPABASE_URL+'/functions/v1/flamexbot-support-inbox',{
          method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_KEY,Authorization:'Bearer '+session.access_token},
          body:JSON.stringify({action:'media',chat_id:activeId,message_id:Number(button.dataset.supportMedia)})
        });
        if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Не удалось загрузить файл');}
        const blob=await response.blob(),url=URL.createObjectURL(blob),article=button.closest('.support-message');
        const type=blob.type||"";
        if(type.startsWith('image/')){
          const image=document.createElement('img');image.src=url;image.alt='Вложение пользователя';image.className='support-media-preview';image.loading='lazy';article.insertBefore(image,button);
        }else if(type.startsWith('video/')){
          const video=document.createElement('video');video.src=url;video.controls=true;video.playsInline=true;video.className='support-media-preview';article.insertBefore(video,button);
        }else{
          const link=document.createElement('a');link.href=url;link.download='';link.textContent='Скачать файл';link.className='support-media-download';article.insertBefore(link,button);
        }
        button.textContent='Файл загружен';button.dataset.loaded="1";
      }catch(error){toast(error.message||'Ошибка загрузки');button.textContent='Повторить загрузку';}
      finally{button.disabled=false;button.dataset.loading="0";}
    }));
  };
  const loadList=async()=>{
    const {data,error}=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'list'}});
    if(error||data?.error){list.innerHTML='<div class="empty-state">Не удалось загрузить входящие: '+esc(data?.error||error?.message||'ошибка')+'</div>';return;}
    const chats=data?.chats||[];
    list.innerHTML=chats.length?chats.map(chat=>{
      const name=[chat.first_name,chat.last_name].filter(Boolean).join(' ')||chat.username||chat.telegram_user_id;
      return `<button type="button" class="support-chat-choice ${activeId===chat.id?'selected':''}" data-support-chat="${esc(chat.id)}">
        <span class="support-avatar">${esc((name||'U').slice(0,1).toUpperCase())}</span><span class="support-chat-copy"><b>${esc(name)}</b><small>${chat.username?'@'+esc(chat.username)+' · ':''}${esc(chat.last_message_preview||'Новое сообщение')} · ${chat.status==='closed'?'Закрыто':'Открыто'}</small></span>
        <span class="support-chat-meta">${chat.unread_count?'<i>'+Number(chat.unread_count)+'</i>':''}<time>${chat.last_message_at?formatMskTime(chat.last_message_at):''}</time></span></button>`;
    }).join(''):'<div class="empty-state">Пока нет входящих сообщений. Когда пользователь напишет боту, диалог появится здесь автоматически.</div>';
    list.querySelectorAll('[data-support-chat]').forEach(btn=>btn.addEventListener('click',()=>openChat(btn.dataset.supportChat)));
  };
  const openChat=async id=>{
    activeId=id;
    list.querySelectorAll('[data-support-chat]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.supportChat===id));
    const {data,error}=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'messages',chat_id:id}});
    if(error||data?.error){thread.innerHTML='<div class="empty-state">Не удалось открыть диалог: '+esc(data?.error||error?.message||'ошибка')+'</div>';return;}
    const chat=data.chat||{};
    const name=[chat.first_name,chat.last_name].filter(Boolean).join(' ')||chat.username||chat.telegram_user_id;
    thread.innerHTML=`<div class="support-thread-head"><button class="support-back outline small" id="support-back" type="button">← Диалоги</button><div><b>${esc(name)}</b><small>${chat.username?'@'+esc(chat.username)+' · ':''}ID ${esc(chat.telegram_user_id||'')} · ${chat.status==='closed'?'Закрыто':'Открыто'}</small></div><button class="outline small" id="support-close-ticket" type="button">${chat.status==='closed'?'Закрыто':'Закрыть обращение'}</button></div>
      <div class="support-message-list">${renderSupportMessages(data.messages||[])}</div>
      <form class="support-reply-form" id="support-reply-form"><label class="support-attach-label" title="Прикрепить файл">＋<input type="file" name="attachment" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt" hidden></label><textarea name="content" rows="2" maxlength="4096" placeholder="Сообщение или подпись к файлу…"></textarea><span class="support-selected-file" aria-live="polite"></span><button class="primary" type="submit">Отправить ↗</button></form>`;
    thread.classList.add('active');
    thread.querySelector('#support-back')?.addEventListener('click',()=>thread.classList.remove('active'));
    thread.querySelector('#support-close-ticket')?.addEventListener('click',async event=>{
      if(chat.status==='closed')return;
      const button=event.currentTarget;button.disabled=true;button.textContent='Закрываем…';
      const result=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'close',chat_id:id}});
      if(result.error||result.data?.error){button.disabled=false;button.textContent='Закрыть обращение';toast(result.data?.error||result.error?.message||'Не удалось закрыть обращение');return;}
      toast('Обращение закрыто');await openChat(id);await loadList();
    });
    const messageList=thread.querySelector('.support-message-list');
    if(messageList)messageList.scrollTop=messageList.scrollHeight;
    bindSupportMedia(thread);
    const replyForm=thread.querySelector('#support-reply-form');
    const attachmentInput=replyForm?.elements.attachment;
    const selectedFile=replyForm?.querySelector('.support-selected-file');
    attachmentInput?.addEventListener('change',()=>{const file=attachmentInput.files?.[0];if(selectedFile)selectedFile.textContent=file?file.name+' · '+(file.size/1024/1024).toFixed(1)+' МБ':'';});
    replyForm?.addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget,input=form.elements.content,file=form.elements.attachment?.files?.[0];
      const content=String(input.value||'').trim(),button=form.querySelector('button[type=submit]');
      if(!content&&!file)return;
      if(file&&file.size>20*1024*1024){toast('Максимальный размер файла — 20 МБ');return;}
      button.disabled=true;button.textContent='Отправляем…';
      let result;
      if(file){
        try{
          const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file);});
          const base64=String(dataUrl).split(',')[1]||'';
          result=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'send_media',chat_id:id,file_name:file.name,mime_type:file.type||'application/octet-stream',file_base64:base64,caption:content}});
        }catch(error){result={data:{error:error.message}};}
      }else result=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'send',chat_id:id,content}});
      button.disabled=false;button.textContent='Отправить ↗';
      if(result.error||result.data?.error){toast(result.data?.error||result.error?.message||'Не удалось отправить');return;}
      input.value='';if(attachmentInput)attachmentInput.value='';if(selectedFile)selectedFile.textContent='';
      await openChat(id);await loadList();
    });
    await loadList();
  };
  host.querySelector('#support-refresh')?.addEventListener('click',loadList);
  await loadList();
  let polling=false;
  const refreshTimer=setInterval(async()=>{
    if(!host.isConnected||state.page!=='support'){clearInterval(refreshTimer);return;}
    if(polling)return;
    polling=true;
    try{
      await loadList();
      if(activeId){
        const {data}=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'messages',chat_id:activeId}});
        const messageList=thread.querySelector('.support-message-list');
        if(data?.messages&&messageList){
          const wasNearBottom=messageList.scrollHeight-messageList.scrollTop-messageList.clientHeight<90;
          messageList.innerHTML=renderSupportMessages(data.messages||[]);
          bindSupportMedia(messageList);
          if(wasNearBottom)messageList.scrollTop=messageList.scrollHeight;
        }
      }
    }catch(error){console.warn('Support inbox refresh skipped:',error?.message||error);}
    finally{polling=false;}
  },6000);
}


async function renderBotInbox(host) {
  const {data:allowed,error:accessError}=await supabase.rpc('is_flamexbot_admin');
  if(accessError||allowed!==true||!state.isAdmin){
    host.innerHTML='<div class="page-heading"><h1>Нет доступа</h1><p class="muted">Личные сообщения бота доступны только владельцу и администраторам.</p></div>';
    return;
  }
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT · BOT INBOX</div><h1>Личные сообщения бота</h1><p class="muted">Все обычные личные сообщения, которые пользователи отправляют FLAMEXBOT. Обращения в техподдержку находятся в отдельном разделе.</p></div>
    <div class="support-inbox bot-private-inbox"><aside class="support-chat-list"><div class="support-list-head"><b>Диалоги</b><button class="outline small" id="bot-inbox-refresh" type="button">↻</button></div><div class="support-chat-items"><div class="empty-state">Загрузка диалогов…</div></div></aside>
    <section class="support-thread"><div class="support-thread-placeholder"><span>✉</span><b>Выбери личный чат</b><small>Здесь появятся сообщения пользователя и ответы бота.</small></div></section></div>`;
  const list=host.querySelector('.support-chat-items'),thread=host.querySelector('.support-thread');
  let activeId=null,polling=false;
  const parseMedia=raw=>{try{const value=JSON.parse(raw||'');return value&&value._fx_media===1?value:null;}catch{return null;}};
  const renderMessages=messages=>(messages||[]).map(msg=>{
    const media=parseMedia(msg.content),caption=media?.caption||(!media?msg.content:'');
    const attachment=media?'<div class="support-attachment">📎 '+esc(media.file_name||msg.message_type||'Вложение')+'</div>':'';
    return '<article class="support-message '+(msg.direction==='outgoing'?'outgoing':'incoming')+'">'+(caption?'<p>'+esc(caption)+'</p>':'')+attachment+'<time>'+formatMskDateTime(msg.created_at,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</time></article>';
  }).join('')||'<div class="empty-state">Сообщений пока нет.</div>';
  const loadList=async()=>{
    const {data,error}=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'inbox_list'}});
    if(error||data?.error){list.innerHTML='<div class="empty-state">Не удалось загрузить личные сообщения: '+esc(data?.error||error?.message||'ошибка')+'</div>';return;}
    const chats=data?.chats||[];
    list.innerHTML=chats.length?chats.map(chat=>{
      const name=[chat.first_name,chat.last_name].filter(Boolean).join(' ')||chat.username||chat.telegram_user_id||'Пользователь';
      return '<button type="button" class="support-chat-choice '+(activeId===chat.id?'selected':'')+'" data-bot-inbox-chat="'+esc(chat.id)+'"><span class="support-avatar">'+esc((name||'U').slice(0,1).toUpperCase())+'</span><span class="support-chat-copy"><b>'+esc(name)+'</b><small>'+(chat.username?'@'+esc(chat.username)+' · ':'')+esc(chat.last_message_preview||'Новое сообщение')+'</small></span><span class="support-chat-meta">'+(chat.unread_count?'<i>'+Number(chat.unread_count)+'</i>':'')+'<time>'+(chat.last_message_at?formatMskTime(chat.last_message_at):'')+'</time></span></button>';
    }).join(''):'<div class="empty-state">Личных сообщений пока нет. Новые диалоги появятся автоматически, когда пользователь напишет боту.</div>';
    list.querySelectorAll('[data-bot-inbox-chat]').forEach(btn=>btn.addEventListener('click',()=>openChat(btn.dataset.botInboxChat)));
  };
  const openChat=async id=>{
    activeId=id;
    const {data,error}=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'inbox_messages',chat_id:id}});
    if(error||data?.error){thread.innerHTML='<div class="empty-state">Не удалось открыть чат: '+esc(data?.error||error?.message||'ошибка')+'</div>';return;}
    const chat=data.chat||{},name=[chat.first_name,chat.last_name].filter(Boolean).join(' ')||chat.username||chat.telegram_user_id||'Пользователь';
    thread.innerHTML='<div class="support-thread-head"><button class="support-back outline small" id="bot-inbox-back" type="button">← Диалоги</button><div><b>'+esc(name)+'</b><small>'+(chat.username?'@'+esc(chat.username)+' · ':'')+'ID '+esc(chat.telegram_user_id||'')+'</small></div></div><div class="support-message-list">'+renderMessages(data.messages||[])+'</div><form class="support-reply-form" id="bot-inbox-reply"><textarea name="content" rows="2" maxlength="4096" placeholder="Ответить пользователю от имени FLAMEXBOT…"></textarea><button class="primary" type="submit">Отправить ↗</button></form>';
    thread.classList.add('active');
    thread.querySelector('#bot-inbox-back')?.addEventListener('click',()=>thread.classList.remove('active'));
    const messageList=thread.querySelector('.support-message-list');if(messageList)messageList.scrollTop=messageList.scrollHeight;
    thread.querySelector('#bot-inbox-reply')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,input=form.elements.content,content=String(input.value||'').trim(),button=form.querySelector('button[type=submit]');
      if(!content)return;button.disabled=true;button.textContent='Отправляем…';
      const result=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'inbox_send',chat_id:id,content}});
      button.disabled=false;button.textContent='Отправить ↗';
      if(result.error||result.data?.error){toast(result.data?.error||result.error?.message||'Не удалось отправить');return;}
      input.value='';await openChat(id);await loadList();
    });
    await loadList();
  };
  host.querySelector('#bot-inbox-refresh')?.addEventListener('click',loadList);
  await loadList();
  const timer=setInterval(async()=>{
    if(!host.isConnected||state.page!=='inbox'){clearInterval(timer);return;}
    if(polling||document.hidden)return;
    polling=true;
    try{
      await loadList();
      if(activeId){
        const {data}=await supabase.functions.invoke('flamexbot-support-inbox',{body:{action:'inbox_messages',chat_id:activeId}});
        const messageList=thread.querySelector('.support-message-list');
        if(data?.messages&&messageList){
          const near=messageList.scrollHeight-messageList.scrollTop-messageList.clientHeight<90;
          messageList.innerHTML=renderMessages(data.messages);
          if(near)messageList.scrollTop=messageList.scrollHeight;
        }
      }
    }catch(error){console.warn('Bot inbox refresh skipped:',error?.message||error);}
    finally{polling=false;}
  },5000);
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
    premium_revoke:'Снят Premium',
    badge_grant:'Выдан значок роли',badge_revoke:'Снят значок роли'
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
      <button class="admin-module" data-go="inbox"><span class="admin-module-icon users">✉</span><b>Личные сообщения бота</b><small>Все личные сообщения, которые пользователи отправляют FLAMEXBOT</small><i>Открыть →</i></button>
       <button class="admin-module" data-go="support"><span class="admin-module-icon users">🛟</span><b>Техподдержка</b><small>Отдельные обращения пользователей и ответы поддержки</small><i>Открыть →</i></button>
      <button class="admin-module" data-go="users"><span class="admin-module-icon users">👥</span><b>Все пользователи</b><small>Поиск, сортировка, фильтры и карточки участников</small><i>Открыть →</i></button>
      <button class="admin-module" data-admin-filter="verified"><span class="admin-module-icon verify">🔵</span><b>Верификация</b><small>Синие галочки и официальные значки ролей</small><i>Управлять →</i></button>
      <button class="admin-module" data-admin-filter="premium"><span class="admin-module-icon premium">✦</span><b>Premium</b><small>Выдача, продление и снятие подписки</small><i>Управлять →</i></button>
      <button class="admin-module" data-admin-filter="banned"><span class="admin-module-icon moderation">🛡</span><b>Модерация</b><small>Блокировка аккаунтов и снятие ограничений</small><i>Управлять →</i></button>
      <button class="admin-module" data-go="wallet"><span class="admin-module-icon premium">🪙</span><b>Управление балансом</b><small>Начисление и списание монет, история операций</small><i>Открыть →</i></button>
      <button class="admin-module" data-go="banners"><span class="admin-module-icon verify">🖼️</span><b>Баннеры бота</b><small>Изображения для /start и инструкции</small><i>Настроить →</i></button>
    </div>
    <section class="admin-security-card"><div><span>🧬</span><div><b>Защита владельца активна</b><small>Аккаунт владельца защищён от блокировки, снятия Premium, синей галочки и значков ролей. Значки администратора и разработчика не выдают доступ к панели.</small></div></div><span class="business-status is-connected">SECURE</span></section>
    <section class="admin-owner-settings">
      <div class="section-heading"><div><div class="eyebrow">FOUNDER SETTINGS</div><h3>Моя приватность и защита</h3></div><span class="admin-secure">Только владелец</span></div>
      <p class="muted">Настройки применяются к публичному отображению твоего профиля и защите от команд других Business-аккаунтов.</p>
      <div class="admin-owner-settings-grid">
        <label class="admin-owner-setting"><span><b>Скрыть подписку</b><small>Premium не показывается в публичных элементах профиля</small></span><input type="checkbox" data-founder-setting="hide_subscription" ${state.profile?.show_subscription===false?'checked':''}></label>
        <label class="admin-owner-setting"><span><b>Скрыть роль</b><small>Скрыть значок роли рядом с профилем</small></span><input type="checkbox" data-founder-setting="hide_role" ${state.profile?.show_role===false?'checked':''}></label>
        <label class="admin-owner-setting"><span><b>Скрыть все бейджи</b><small>Скрыть значки профиля, включая Premium и роль</small></span><input type="checkbox" data-founder-setting="hide_badges" ${state.profile?.show_badges===false?'checked':''}></label>
        <label class="admin-owner-setting"><span><b>Скрыть активность</b><small>Не показывать публичную статистику активности</small></span><input type="checkbox" data-founder-setting="hide_activity" ${state.profile?.show_activity===false?'checked':''}></label>
        <label class="admin-owner-setting"><span><b>Отключить защиту от команд</b><small>Разрешить другим пользователям применять к тебе команды FLAMEXBOT</small></span><input type="checkbox" data-founder-setting="disable_command_protection" ${state.profile?.command_protection_disabled===true?'checked':''}></label>
      </div>
      <small class="admin-owner-settings-note">Отключение защиты не отключает защиту аккаунта от блокировки и не меняет права администратора.</small>
    </section>
    <section class="admin-audit-panel"><div class="section-heading"><div><div class="eyebrow">SECURITY HISTORY</div><h3>Журнал действий</h3></div><span class="admin-secure">Последние 10 событий</span></div>
      <div class="admin-audit-list">${auditRows||'<div class="empty-state">Административных действий пока нет. Здесь появится история блокировок, галочек и Premium.</div>'}</div>
      ${audit.error?'<p class="business-warning">Не удалось загрузить журнал действий: '+esc(audit.error.message)+'</p>':''}
    </section>
    ${all.error||verified.error||premium.error||banned.error?'<p class="business-warning">Не удалось загрузить часть административной статистики.</p>':''}`;
  if(isFounderProfile(state.profile)){
    host.querySelectorAll('[data-founder-setting]').forEach(input=>input.addEventListener('change',async()=>{
      const key=input.dataset.founderSetting,checked=input.checked;
      const column=key==='hide_subscription'?'show_subscription':key==='hide_role'?'show_role':key==='hide_badges'?'show_badges':key==='hide_activity'?'show_activity':'command_protection_disabled';
      const value=key==='disable_command_protection'?checked:!checked;
      input.disabled=true;
      const {error}=await supabase.from('profiles').update({[column]:value}).eq('id',state.session.user.id);
      input.disabled=false;
      if(error){input.checked=!checked;toast('Не удалось сохранить настройку: '+error.message);return;}
      state.profile={...state.profile,[column]:value};
      updateHeaderProfile();
      toast('Настройка приватности сохранена');
    }));
  }
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
  const userIds=users.map(user=>user.id);
  const connectionLookup=userIds.length?await supabase.from('flamexbot_business_connections').select('profile_id,is_enabled').in('profile_id',userIds):{data:[]};
  const connectionMap=new Map((connectionLookup.data||[]).map(connection=>[connection.profile_id,Boolean(connection.is_enabled)]));
  users.forEach(user=>{user.business_connected=connectionMap.get(user.id)===true;});
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
      const currentRole=badges.find(code=>code!=='premium'&&code!=='verified')||'';
      const display=u.display_name||u.username||'Пользователь';
      return `<article class="admin-user-card" data-user-card="${u.id}">
        <div class="admin-user-main"><div class="admin-user-avatar">${avatar(u.avatar_url,display,'avatar-lg')}</div><div class="admin-user-identity"><div class="admin-user-name"><b>${esc(display)}${verifiedMarkMarkup(Boolean(u.is_verified)||owner)}</b>${badgeMarkup(badges,false,false)}</div><small>${u.telegram_username?'@'+esc(u.telegram_username):'Telegram не привязан'} · ${u.telegram_id?'ID '+esc(u.telegram_id):'Web-аккаунт'}</small><small>В FLAMEXBOT с ${formatMskDate(u.created_at)}</small></div><div class="admin-user-flags">${u.is_banned?'<span class="user-flag banned">⛔ Заблокирован</span>':u.business_connected?'<span class="user-flag active">● Business подключён</span>':'<span class="user-flag free">○ Business не подключён</span>'}${u.is_premium?'<span class="user-flag premium">✦ Premium</span>':'<span class="user-flag free">Free</span>'}</div></div>
        <div class="admin-user-actions">
          <button class="admin-action" data-admin-open="${u.id}">Открыть управление →</button>
          <button class="admin-action ${u.is_verified?'verified':''}" data-user-action="${u.is_verified?'unverify':'verify'}" data-user-id="${u.id}" ${locked?'disabled':''}>${u.is_verified?'🔵 Снять галочку':'🔵 Выдать галочку'}</button>
          <button class="admin-action ${u.is_banned?'safe':''}" data-user-action="${u.is_banned?'unban':'ban'}" data-user-id="${u.id}" ${locked?'disabled':''}>${u.is_banned?'♻ Разблокировать':'⛔ Заблокировать'}</button>
          <button class="admin-action premium" data-user-action="premium_grant" data-user-id="${u.id}" ${locked?'disabled':''}>✦ ${u.is_premium?'Продлить Premium':'Выдать Premium'}</button>
          <button class="admin-action" data-user-action="premium_revoke" data-user-id="${u.id}" ${!u.is_premium||locked?'disabled':''}>Снять Premium</button>
        </div>
        <div class="admin-role-controls"><label>Заменить значок<div class="role-picker" data-role-picker><button type="button" class="role-picker-trigger" data-role-picker-toggle ${locked?'disabled':''}>${esc(roleOptions.find(([code])=>code===currentRole)?.[1]||'Выбрать значок…')} <span>⌄</span></button><div class="role-picker-menu" hidden>${roleOptions.map(([code,label])=>`<button type="button" data-role-option="${code}">${esc(label)}${currentRole===code?' · текущий':''}</button>`).join('')}</div><input type="hidden" data-role-select="${u.id}" value="${esc(currentRole)}"/></div></label><button class="outline small" data-user-action="badge_grant" data-user-id="${u.id}" ${locked?'disabled':''} title="${locked?'Аккаунт администрации защищён от других администраторов':'Заменить значок роли'}">Заменить значок</button><label>Снять значок<div class="role-picker" data-role-picker><button type="button" class="role-picker-trigger" data-role-picker-toggle ${locked?'disabled':''}>Выбрать значок… <span>⌄</span></button><div class="role-picker-menu" hidden>${badges.filter(x=>x!=='verified'&&x!=='founder'&&x!=='premium').map(code=>`<button type="button" data-role-option="${code}">${esc(BADGE_META[code]?.label||code)}</button>`).join('')}</div><input type="hidden" data-role-remove="${u.id}" value=""/></div></label><button class="outline small" data-user-action="badge_revoke" data-user-id="${u.id}" ${locked?'disabled':''} title="${locked?'Аккаунт администрации защищён от других администраторов':'Снять значок'}">Снять</button>
        </div>
      </article>`;
    }).join('')||'<div class="empty-state">По заданным фильтрам никого не найдено.</div>'}</div>
    <div class="users-pagination"><button class="outline small" id="users-prev" ${(filters.offset||0)<=0?'disabled':''}>← Назад</button><span>Страница ${Math.floor((filters.offset||0)/50)+1} из ${Math.max(1,Math.ceil(total/50))}</span><button class="outline small" id="users-next" ${(filters.offset||0)+50>=total?'disabled':''}>Дальше →</button></div>
    ${error?'<p class="business-warning">Не удалось загрузить пользователей: '+esc(error.message)+'</p>':''}`;
  host.querySelectorAll('[data-role-picker]').forEach(picker=>{const trigger=picker.querySelector('[data-role-picker-toggle]');const menu=picker.querySelector('.role-picker-menu');const hidden=picker.querySelector('input[type=hidden]');trigger?.addEventListener('click',()=>{host.querySelectorAll('.role-picker-menu').forEach(other=>{if(other!==menu)other.hidden=true;});if(menu)menu.hidden=!menu.hidden;});picker.querySelectorAll('[data-role-option]').forEach(option=>option.addEventListener('click',()=>{if(hidden)hidden.value=option.dataset.roleOption||'';if(trigger)trigger.innerHTML=esc(option.textContent.trim())+' <span>⌄</span>';if(menu)menu.hidden=true;}));});
  host.addEventListener('click',event=>{if(!event.target.closest('[data-role-picker]'))host.querySelectorAll('.role-picker-menu').forEach(menu=>menu.hidden=true);});
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
    if(action==='premium_grant'){const label='Premium';const raw=prompt('На сколько дней выдать или продлить '+label+'? Введи 0 для бессрочной подписки.','30');if(raw===null)return;days=Number(raw);if(!Number.isInteger(days)||days<0||days>3650){toast('Укажи число от 0 до 3650');return;}reason=prompt('Комментарий к выдаче '+label+' (будет виден в уведомлении):','Подарок от администрации');if(reason===null)return;reason=reason.trim()||'Выдано администрацией FLAMEXBOT';}
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
    await notifyTelegramAboutAdminAction(userId,action,badgeCode,data?.audit_id);
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
  const roleOptions=[...(actorOwner?[['developer','Разработчик'],['administrator','Администратор']]:[]),['moderator','Модератор'],['designer','Дизайнер'],['creator','Создатель'],['supporter','Поддержка'],['beta_tester','Бета-тестер'],['community_manager','Комьюнити'],['partner','Партнёр']];
  const premiumUntil=u.is_premium?(u.premium_expires_at?formatMskDate(u.premium_expires_at):'Бессрочно'):'Не активен';
  host.innerHTML=`<div class="page-heading"><button class="text-button" data-go="users">← Все пользователи</button><div class="eyebrow">ADMIN USER CONTROL</div><h1>Управление аккаунтом</h1><p class="muted">Все изменения проходят серверную проверку и попадают в журнал администрации.</p></div>
    <section class="admin-user-detail-card"><div class="admin-user-detail-top">${avatar(u.avatar_url||u.telegram_photo_url,u.display_name||u.username,'avatar-xl')}<div><h2>${esc(u.display_name||u.username||'Пользователь')}${verifiedMarkMarkup(Boolean(u.is_verified)||owner)}</h2><p>@${esc(u.telegram_username||u.username||'не задан')} · ${u.telegram_id?'Telegram ID '+esc(u.telegram_id):'Telegram не привязан'}</p><div class="profile-badge-row">${badgeMarkup(badges,false,false)} ${u.is_premium?badgeMarkup(['premium'],false,false):''}</div></div></div>
      <div class="admin-detail-status"><span class="user-flag ${u.is_banned?'banned':'active'}">${u.is_banned?'⛔ Заблокирован':'● Активен'}</span><span class="user-flag ${u.is_premium?'premium':'free'}">${badges.includes('founder')?'👑 Основатель':u.is_premium?'✦ Premium':'Free'}</span><span class="user-flag">${u.is_verified?'🔵 Подтверждён':'Без галочки'}</span></div>
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
    if(action==='premium_grant'){const label='Premium';const raw=prompt('На сколько дней выдать или продлить '+label+'? 0 — бессрочно.','30');if(raw===null)return;days=Number(raw);if(!Number.isInteger(days)||days<0||days>3650){toast('Укажи число от 0 до 3650');return;}reason=prompt('Комментарий к выдаче (необязательно):','')||null;}
    if(action==='badge_grant'||action==='badge_revoke'){badgeCode=host.querySelector('#admin-detail-badge')?.value||badges.find(code=>code!=='verified'&&code!=='premium')||null;if(!badgeCode){toast('Выбери значок');return;}}
    if(['ban','unban','unverify','premium_revoke','badge_revoke'].includes(action)&&!confirm('Подтвердить действие?'))return;
    btn.disabled=true;
    const {error:actionError}=await supabase.rpc('admin_manage_flamexbot_user',{p_user_id:u.id,p_action:action,p_badge_code:badgeCode,p_reason:reason,p_days:days});
    if(actionError){toast('Не удалось выполнить действие: '+actionError.message);btn.disabled=false;return;}
    toast(({ban:'Аккаунт заблокирован',unban:'Блокировка снята',verify:'Аккаунт подтверждён',unverify:'Подтверждение снято',premium_grant:'Premium выдан или продлён',premium_revoke:'Premium отключён',badge_grant:'Значок заменён',badge_revoke:'Значок снят'})[action]||'Готово');
    await notifyTelegramAboutAdminAction(u.id,action,badgeCode);
    await renderAdminUser(host);
  }));
}



function animateFortuneWheel(prizeType) {
 const wheel=document.querySelector('#fortune-wheel');
 if(!wheel)return Promise.resolve();
 const centers={free_spin:36,addon:108,premium_7d:180,premium_30d:252,premium_90d:324,premium_day:180};
 const target=centers[prizeType]??252;
 if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
   wheel.style.transform='rotate('+((360-target)%360)+'deg)';
   return Promise.resolve();
 }
 wheel.style.transition='none';
 wheel.style.transform='rotate(0deg)';
 void wheel.offsetWidth;
 return new Promise(resolve=>{
   requestAnimationFrame(()=>{
     wheel.style.transition='transform 5.1s cubic-bezier(.12,.78,.12,1)';
     wheel.style.transform='rotate('+(360*6-target)+'deg)';
   });
   window.setTimeout(resolve,5250);
 });
}

async function renderTariffs(host, initialTab='premium') {
 const premium=isPremium();
 const weeklySpins=premium?2:0;
  const rareLuck=premium?10:0;
  const rareWeightBoost=premium?1.1:1;
  const wheelOddsTotal=92+8*rareWeightBoost;
 const wheelOddsHtml=[
  ['Прокрутка',55],['Защита 5 дней',25],['Premium 7 дней',12],
  ['Premium 30 дней',5*rareWeightBoost],['Premium 90 дней',3*rareWeightBoost]
 ].map(([label,weight])=>'<span>'+((weight/wheelOddsTotal)*100).toLocaleString('ru-RU',{maximumFractionDigits:2})+'% · '+label+'</span>').join('');
 const {data:trialRecord,error:trialRecordError}=await supabase.from('flamexbot_trials').select('expires_at').eq('user_id',state.session.user.id).maybeSingle();
 const [{data:subscriptionPayments,error:subscriptionPaymentError},{data:addonPayments,error:addonPaymentError}]=await Promise.all([
   supabase.from('flamexbot_star_payments')
     .select('created_at,plan,total_amount,currency,period_days')
     .eq('user_id',state.session.user.id)
     .order('created_at',{ascending:false})
     .limit(10),
   supabase.from('flamexbot_addon_star_payments')
     .select('addon_code,total_amount,currency,period_days,paid_at')
     .eq('user_id',state.session.user.id)
     .eq('status','paid')
     .not('paid_at','is',null)
     .order('paid_at',{ascending:false})
     .limit(10)
 ]);
 const paymentHistory=[
   ...(subscriptionPayments||[]).map(payment=>({...payment,kind:'subscription',history_at:payment.created_at})),
   ...(addonPayments||[]).map(payment=>({...payment,kind:'addon',history_at:payment.paid_at}))
 ].sort((a,b)=>new Date(b.history_at).getTime()-new Date(a.history_at).getTime()).slice(0,10);
 const paymentHistoryError=subscriptionPaymentError||addonPaymentError;
 const trialUsed=Boolean(trialRecord);
 const lifetime=premium&&!state.subscription?.expires_at;
 const expires=state.subscription?.expires_at?formatMskDate(state.subscription.expires_at):'Без срока';
 const buyLabel=premium?'↻ Продлить Premium за 100 ⭐':'⭐ Оплатить 100 Stars';
 const protectionExpires=state.profile?.command_protection_expires_at||null;
 const protectionActive=Boolean(protectionExpires&&new Date(protectionExpires).getTime()>Date.now());
 const protectionFounder=isFounderProfile(state.profile);
 const protectionLabel=protectionActive?'Продлить защиту ещё на 5 дней · 15 ⭐':'Купить защиту за 15 ⭐';
 host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT MEMBERSHIP</div><h1>Тарифы и возможности <span>✦</span></h1><p class="muted">Выбирай возможности FLAMEXBOT и дополнительные уровни защиты аккаунта.</p></div>
 <div class="tariff-tabs" role="tablist" aria-label="Разделы тарифов">
  <button type="button" class="tariff-tab" data-tariff-tab="premium" role="tab" aria-selected="true">Тарифы</button>
  <button type="button" class="tariff-tab" data-tariff-tab="addons" role="tab" aria-selected="false">Дополнение</button>
 </div>
 <section class="tariff-tab-panel" data-tariff-panel="premium">
  <div class="tariff-grid">
   <section class="business-card tariff-card ${!premium?'tariff-current':''}">
    <div class="eyebrow">СТАРТ</div><h2>Free</h2>
    <p class="muted">Базовые возможности FLAMEXBOT для обычного использования.</p>
    <ul><li>Telegram Mini App и профиль</li><li>Подключение Telegram Business</li><li>Переписки, отправка текста и файлов</li><li>Друзья, огоньки и ежедневные задания</li><li>Достижения и базовая статистика</li></ul>
    <span class="business-status ${!premium?'is-connected':''}">${!premium?'Твой текущий тариф':'Бесплатно'}</span>
   </section>
   <section class="business-card tariff-card premium-card ${premium&&state.subscription?.plan==='premium'?'tariff-current':''}">
    <div class="eyebrow">БОЛЬШЕ КОНТРОЛЯ</div><h2>⭐ FLAMEX Premium</h2>
    <p class="muted">Дополнительные инструменты для управления Telegram Business-переписками.</p>
    <ul>
     <li><code>.mute</code> / <code>.unmute</code> — управление новыми входящими сообщениями</li>
     <li><code>.antimute</code> / <code>.unantimute</code> — альтернативная отправка от имени FLAMEXBOT, когда это разрешает Telegram</li>
     <li><code>.antimat</code> / <code>.unantimat</code> — фильтр ненормативной лексики</li>
     <li>Персональный AFK-автоответ и автоматическое прочтение</li>
     <li>Статусы «печатает…» и «записывает голосовое»</li>
     <li>Фильтр стикеров, время профиля по МСК и оформление текста</li>
     <li><b>+2 бесплатные прокрутки колеса каждую неделю</b></li><li><b>+10% к весам редких наград колеса</b></li><li>Бейдж Premium и ранний доступ к новым функциям</li><li>Экспорт выбранной Business-переписки в JSON</li>
    </ul>
    <div class="premium-price-line"><b>100 ⭐</b><span>30 дней · разовая оплата</span></div>
    <span class="business-status ${premium?'is-connected':''}">${premium?'Premium активен · '+(lifetime?'бессрочно':'до '+expires):'Подписка не активна'}</span>
    ${lifetime?'':'<button class="primary premium-buy-button" id="buy-premium" type="button">'+buyLabel+'</button>'}
    <small class="premium-payment-note">Оплата проходит через Telegram Stars. Срок — 30 дней; повторная покупка продлевает доступ. Автосписания и автопродления нет — продлевай вручную здесь или командой /premium.</small>
   </section>
   
  </div>
  <section class="business-card payment-history-card" aria-labelledby="payment-history-title">
   <div class="payment-history-heading"><div><div class="eyebrow">BILLING</div><h2 id="payment-history-title">История оплат</h2></div><span class="payment-history-count">${paymentHistory?.length||0}/10</span></div>
   ${paymentHistory?.length
     ? '<div class="payment-history-list">'+paymentHistory.map(payment=>'<div class="payment-history-row"><div><b>'+(payment.kind==='addon'?(payment.addon_code==='command_protection'?'Защита от команд':'Дополнение FLAMEXBOT'):'FLAMEX Premium')+'</b><small>'+esc(formatMskDateTime(payment.history_at,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+' · '+esc(String(payment.period_days))+' дней</small></div><strong>'+esc(String(payment.total_amount))+' '+(payment.currency==='XTR'?'⭐':esc(String(payment.currency)))+'</strong></div>').join('')+'</div>'
     : paymentHistoryError
       ? '<p class="muted">Не удалось загрузить историю оплат. Попробуй обновить раздел позже.</p>'
       : '<p class="muted payment-history-empty">Пока нет завершённых оплат подписки. После первой покупки здесь появится история последних 10 платежей.</p>'}
   ${paymentHistoryError&&paymentHistory?.length?'<p class="premium-payment-note">Показана доступная часть истории; некоторые платежи временно не загрузились.</p>':''}
   <small class="premium-payment-note">Показываются только подтверждённые оплаты подписки. Платежи за отдельные дополнения учитываются отдельно.</small>
  </section>
  <div class="business-command-hint"><span>⌘</span><div><b>Команды отправляются прямо в нужной переписке</b><small>Открой Business-диалог с человеком и отправь команду туда. FLAMEXBOT сам определит текущий чат — без @username и ID.</small></div></div>
  <p class="business-note">Антимут отправляет новые сообщения от имени FLAMEXBOT, если собеседник заранее запустил бота. Он не снимает мут в Telegram и не обходит блокировки.</p>
  <section class="business-card trial-card" ${premium?'hidden':''}>
   <div class="eyebrow">ПОПРОБУЙ FLAMEXBOT</div><h2>🎁 Пробный Premium на 3 дня</h2>
   <p class="muted">Один раз на аккаунт. Без оплаты и автоматического продления.</p>
   ${trialUsed?'<span class="business-status">Пробный период уже использован</span>':'<button class="primary" id="claim-trial" type="button">Активировать 3 дня Premium</button>'}
   ${trialRecordError?'<small class="business-warning">Не удалось проверить историю пробного периода.</small>':''}
  </section>
  <section class="business-card wheel-card">
   <div class="eyebrow">LUCKY SPIN</div><h2>🎡 Колесо фортуны</h2>
   <div class="fortune-wheel-stage" aria-label="Колесо фортуны">
    <span class="fortune-wheel-pointer">▼</span>
    <div class="fortune-wheel" id="fortune-wheel">
     <span class="wheel-prize wheel-prize-spin">🎁</span>
     <span class="wheel-prize wheel-prize-addon">🛡️</span>
     <span class="wheel-prize wheel-prize-premium7">⭐<small>7д</small></span>
     <span class="wheel-prize wheel-prize-premium30">⭐<small>30д</small></span>
     <span class="wheel-prize wheel-prize-premium90">⭐<small>90д</small></span>
     <span class="fortune-wheel-center">✦</span>
    </div>
   </div>
   <p class="muted">Прокрутка стоит 5 ⭐. Можно выиграть Premium на 7, 30 и 90 дней, защиту от команд либо ещё одну прокрутку.</p>
   <div class="wheel-odds-controls"><button class="outline small" type="button" id="toggle-wheel-odds" aria-expanded="false">Показать шансы</button><div class="wheel-odds" id="wheel-odds-panel" hidden>${wheelOddsHtml}</div></div>
   <button class="primary" id="spin-wheel" type="button">${(state.profile?.wheel_free_spins||0)>0?'Использовать бесплатную прокрутку':'Крутить за 5 ⭐'}</button>
   <small class="premium-payment-note">На твоём счёте: ${state.profile?.wheel_free_spins||0} бесплатных прокруток. Еженедельно: ${weeklySpins} для текущего тарифа${rareLuck?' · веса редких наград +' + rareLuck + '%':''}.</small>
  </section>
 </section>
 <section class="tariff-tab-panel" data-tariff-panel="addons" hidden>
  <section class="business-card addon-card">
   <div class="addon-card-heading"><div><div class="eyebrow">АККАУНТ И ПРИВАТНОСТЬ</div><h2>🛡 Защита от команд</h2></div><span class="addon-price-pill">15 ⭐</span></div>
   <p class="muted">Запрещает другим пользователям применять команды FLAMEXBOT к вашему Telegram-аккаунту.</p>
   <ul>
    <li>Другие пользователи не смогут использовать на вас команды в Telegram Business.</li>
    <li>Защита проверяется сервером и действует для всех команд, включая команды управления.</li>
    <li>Основатель FLAMEXBOT может использовать команды на любых аккаунтах, даже если защита включена.</li>
    <li>Покупка добавляет 5 дней к текущему сроку, если защита уже активна.</li>
    <li>Обычная переписка остаётся доступной — блокируются команды и их автоматические действия.</li>
   </ul>
   <div class="addon-price-line"><b>15 ⭐</b><span>5 дней · разовая оплата</span></div>
   ${protectionFounder
     ? '<div class="addon-status addon-status-active">Защита Основателя действует постоянно. Покупка не требуется.</div>'
     : protectionActive
       ? '<div class="addon-status addon-status-active">Защита активна до '+formatMskDate(protectionExpires)+'</div>'
       : '<div class="addon-status">Защита пока не активна</div>'}
   ${protectionFounder?'':'<button class="primary addon-buy-button" id="buy-command-protection" type="button">'+protectionLabel+'</button>'}
   <small class="premium-payment-note">Оплата — Telegram Stars. Срок начинается после подтверждения успешного платежа. Продление суммируется с оставшимся временем.</small>
  </section>
  <div class="addon-feature-heading"><div class="eyebrow">ТОЛЬКО ОТДЕЛЬНЫЕ ПОКУПКИ</div><h2>🧩 Дополнения</h2><p class="muted">Здесь только независимые модули, которые покупаются отдельно. Возможности Premium здесь не дублируются.</p></div>
  <p class="business-note">Сейчас доступно отдельное дополнение «Защита от команд» на 5 дней. Новые модули появятся здесь отдельными карточками и не будут смешиваться с тарифами.</p>
 </section>
 <p class="business-note">Управление подпиской: текущий тариф и дата окончания показаны в карточке выше. Premium — разовая покупка без автосписаний. Продление выполняется вручную в этом разделе или командой /premium в личном чате с ботом.  Платёж подтверждается Telegram, доступ открывается только после проверки successful_payment на сервере.</p>`;
 const tabs=[...host.querySelectorAll('[data-tariff-tab]')];
 const panels=[...host.querySelectorAll('[data-tariff-panel]')];
 const showTab=(name)=>{
   const selected=name==='addons'?'addons':'premium';
   tabs.forEach(tab=>{
     const active=tab.dataset.tariffTab===selected;
     tab.classList.toggle('active',active);
     tab.setAttribute('aria-selected',String(active));
   });
   panels.forEach(panel=>{panel.hidden=panel.dataset.tariffPanel!==selected;});
 };
 tabs.forEach(tab=>tab.addEventListener('click',()=>showTab(tab.dataset.tariffTab)));
 showTab(initialTab);

 const waitForInvoiceClose=(webApp,invoiceLink,onStatus)=>{
   if(typeof webApp?.openInvoice!=='function'){
     if(typeof webApp?.openTelegramLink==='function')webApp.openTelegramLink(invoiceLink);
     else window.open(invoiceLink,'_blank','noopener');
     return Promise.resolve(false);
   }
   return new Promise(resolve=>{
     webApp.openInvoice(invoiceLink,async status=>{
       try{await onStatus(status);}
       catch(error){console.error('Telegram invoice callback:',error);toast('Платёж получен, но статус пока не удалось обновить. Открой тарифы ещё раз.');}
       finally{resolve(true);}
     });
   });
 };

 const startTierPurchase=async(button,plan)=>{
   if(!button)return;
   const label='Premium';
   button.disabled=true;button.classList.add('is-loading');button.textContent='Подготавливаем оплату…';
   try{
     const {data,error}=await supabase.functions.invoke('create-premium-invoice',{body:{plan}});
     if(error||data?.error||!data?.invoice_link)throw new Error(data?.error||error?.message||'Не удалось создать ссылку на оплату');
     const webApp=window.Telegram?.WebApp;
     const opened=await waitForInvoiceClose(webApp,data.invoice_link,async status=>{
       if(status==='paid'){
         toast('Оплата принята. Активируем '+label+'…');
         let activated=false;
         for(let attempt=0;attempt<15;attempt++){
           const {data:subscription,error:subscriptionError}=await supabase.from('user_subscriptions')
             .select('plan,expires_at,starts_at').eq('user_id',state.session.user.id).maybeSingle();
           if(subscriptionError)console.warn(label+' status refresh:',subscriptionError.message);
           if(subscription&&subscription.plan===plan&&(!subscription.expires_at||new Date(subscription.expires_at).getTime()>Date.now())){
             state.subscription=subscription;activated=true;break;
           }
           await new Promise(resolve=>setTimeout(resolve,700));
         }
         updateHeaderProfile();
         toast(activated?('⭐ Premium успешно активирован!'):'Платёж получен. Тариф появится после подтверждения Telegram.');
         await renderTariffs(host,'premium');
       }else if(status==='cancelled')toast('Оплата отменена. Списания не произошло.');
       else if(status==='failed')toast('Telegram не смог завершить оплату. Попробуй ещё раз.');
       else if(status==='pending')toast('Платёж обрабатывается. Тариф появится после подтверждения Telegram.');
     });
     if(!opened)toast('Открываем счёт Telegram Stars');
   }catch(error){toast('Оплата не запущена: '+(error?.message||'неизвестная ошибка'));}
   finally{
     if(host.contains(button)){
       button.disabled=false;button.classList.remove('is-loading');
       button.textContent=buyLabel;
     }
   }
 };
 host.querySelector('#buy-premium')?.addEventListener('click',event=>startTierPurchase(event.currentTarget,'premium'));
 
 const trialButton=host.querySelector('#claim-trial');
 trialButton?.addEventListener('click',async()=>{
   trialButton.disabled=true;trialButton.textContent='Активируем…';
   try{
     const {data:expiry,error}=await supabase.rpc('claim_flamexbot_trial');
     if(error)throw error;
     const {data:subscription,error:subError}=await supabase.from('user_subscriptions').select('plan,expires_at,starts_at').eq('user_id',state.session.user.id).maybeSingle();
     if(subError)throw subError;
     state.subscription=subscription;updateHeaderProfile();
     toast('🎁 Premium активирован на 3 дня — до '+formatMskDateTime(expiry,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}));
     await renderTariffs(host,'premium');
   }catch(error){toast('Не удалось активировать пробный период: '+(error.message||'ошибка'));trialButton.disabled=false;trialButton.textContent='Активировать 3 дня Premium';}
 });
 const oddsToggle=host.querySelector('#toggle-wheel-odds');
 if(oddsToggle)oddsToggle.addEventListener('click',()=>{const panel=host.querySelector('#wheel-odds-panel');if(!panel)return;const opening=panel.hidden;panel.hidden=!opening;oddsToggle.textContent=opening?'Скрыть шансы':'Показать шансы';oddsToggle.setAttribute('aria-expanded',String(opening));});
 const wheelButton=host.querySelector('#spin-wheel');
 wheelButton?.addEventListener('click',async()=>{
   const freeSpin=(state.profile?.wheel_free_spins||0)>0;
   wheelButton.disabled=true;wheelButton.textContent=freeSpin?'Используем прокрутку…':'Создаём счёт…';
   try{
     const {data,error}=await supabase.functions.invoke('create-wheel-invoice',{body:freeSpin?{action:'free_spin'}:{}});
     if(freeSpin&&data?.prize?.prize_label){
       await animateFortuneWheel(data.prize.prize_type);
       const {data:profile}=await supabase.from('profiles').select('wheel_free_spins,command_protection_expires_at').eq('id',state.session.user.id).maybeSingle();
       state.profile={...(state.profile||{}),wheel_free_spins:profile?.wheel_free_spins||0,command_protection_expires_at:profile?.command_protection_expires_at};
       if(String(data.prize.prize_type||'').startsWith('premium_')){
         const {data:subscription}=await supabase.from('user_subscriptions').select('plan,expires_at,starts_at').eq('user_id',state.session.user.id).maybeSingle();
         state.subscription=subscription;
       }
       toast('🎉 Выпало: '+data.prize.prize_label);
       updateHeaderProfile();await renderTariffs(host,'premium');return;
     }
     if(error||data?.error||!data?.invoice_link)throw new Error(data?.error||error?.message||'Не удалось создать счёт');
     const webApp=window.Telegram?.WebApp;
     const opened=await waitForInvoiceClose(webApp,data.invoice_link,async status=>{
       if(status==='paid'){
         toast('Оплата принята. Определяем награду…');
         let result=null;
         for(let attempt=0;attempt<18;attempt++){
           const {data:order,error:orderError}=await supabase.from('flamexbot_wheel_orders').select('status,prize_label,prize_type').eq('id',data.order_id).maybeSingle();
           if(orderError)console.warn('Wheel status:',orderError.message);
           if(order?.status==='paid'){result=order;break;}
           await new Promise(resolve=>setTimeout(resolve,600));
         }
         if(result)await animateFortuneWheel(result.prize_type);
         toast(result?'🎉 Выпало: '+result.prize_label:'Платёж принят. Награда появится после подтверждения Telegram.');
         const {data:profile}=await supabase.from('profiles').select('wheel_free_spins,command_protection_expires_at').eq('id',state.session.user.id).maybeSingle();
         state.profile={...(state.profile||{}),wheel_free_spins:profile?.wheel_free_spins||0,command_protection_expires_at:profile?.command_protection_expires_at};
         if(result&&(/^premium_/.test(result.prize_type||''))){
           const {data:subscription}=await supabase.from('user_subscriptions').select('plan,expires_at,starts_at').eq('user_id',state.session.user.id).maybeSingle();
           state.subscription=subscription;
         }
         await renderTariffs(host,'premium');
       }else if(status==='cancelled')toast('Оплата отменена.');
       else if(status==='failed')toast('Telegram не смог завершить оплату.');
     });
     if(!opened)toast('Счёт открыт в Telegram.');
   }catch(error){toast('Колесо: '+(error.message||'ошибка'));}
   finally{if(host.contains(wheelButton)){wheelButton.disabled=false;wheelButton.textContent=(state.profile?.wheel_free_spins||0)>0?'Использовать бесплатную прокрутку':'Крутить за 5 ⭐';}}
 });
 const addonButton=host.querySelector('#buy-command-protection');
 addonButton?.addEventListener('click',async()=>{
   addonButton.disabled=true;addonButton.classList.add('is-loading');addonButton.textContent='Подготавливаем оплату…';
   try{
     const {data,error}=await supabase.functions.invoke('create-command-protection-invoice');
     if(error||data?.error||!data?.invoice_link)throw new Error(data?.error||error?.message||'Не удалось создать счёт на защиту');
     const webApp=window.Telegram?.WebApp;
     const opened=await waitForInvoiceClose(webApp,data.invoice_link,async status=>{
       if(status==='paid'){
         toast('Оплата принята. Включаем защиту…');
         let activated=false;
         for(let attempt=0;attempt<15;attempt++){
           const {data:profile,error:profileError}=await supabase.from('profiles')
             .select('command_protection_expires_at').eq('id',state.session.user.id).maybeSingle();
           if(profileError)console.warn('Command protection refresh:',profileError.message);
           const expiry=profile?.command_protection_expires_at||null;
           if(expiry&&new Date(expiry).getTime()>Date.now()){
             state.profile={...(state.profile||{}),command_protection_expires_at:expiry};
             activated=true;break;
           }
           await new Promise(resolve=>setTimeout(resolve,700));
         }
         updateHeaderProfile();
         toast(activated?'🛡 Защита от команд активирована на 5 дней!':'Платёж получен. Защита появится после подтверждения Telegram.');
         await renderTariffs(host,'addons');
       }else if(status==='cancelled')toast('Оплата отменена. Списания не произошло.');
       else if(status==='failed')toast('Telegram не смог завершить оплату. Попробуй ещё раз.');
       else if(status==='pending')toast('Платёж обрабатывается. Защита включится после подтверждения Telegram.');
     });
     if(!opened)toast('Открываем счёт Telegram Stars');
   }catch(error){toast('Не удалось купить защиту: '+(error?.message||'неизвестная ошибка'));}
   finally{if(host.contains(addonButton)){addonButton.disabled=false;addonButton.classList.remove('is-loading');addonButton.textContent=protectionLabel;}}
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
    ids.length?supabase.from('profiles').select('id,username,display_name,avatar_url,telegram_photo_url,telegram_username,telegram_id,created_at,show_subscription,show_role,show_badges,show_activity').in('id',ids):Promise.resolve({data:[],error:null}),
    ids.length?supabase.from('profile_badges').select('user_id,badge_code').in('user_id',ids):Promise.resolve({data:[],error:null}),
    state.friendSearchQuery.length>=2
      ?supabase.rpc('search_flamexbot_profiles',{p_query:state.friendSearchQuery,p_limit:15})
      :Promise.resolve({data:[],error:null})
  ]);
  const profileMap=new Map((profileResult.data||[]).map(p=>[p.id,p]));
  const searchIds=(searchResult.data||[]).map(p=>p.id);
  const searchPrivacy=searchIds.length?await supabase.from('profiles').select('id,show_subscription,show_role,show_badges,show_activity').in('id',searchIds):{data:[]};
  const searchPrivacyMap=new Map((searchPrivacy.data||[]).map(p=>[p.id,p]));
  const publicSearchResults=(searchResult.data||[]).map(p=>({...p,...(searchPrivacyMap.get(p.id)||{})}));
  const badgeMap=new Map();
  (badgeResult.data||[]).forEach(b=>{if(!badgeMap.has(b.user_id))badgeMap.set(b.user_id,[]);badgeMap.get(b.user_id).push(b.badge_code);});
  const friendSet=new Set(friendIds);
  const incomingByUser=new Map((incoming.data||[]).map(r=>[r.sender_id,r]));
  const outgoingByUser=new Map((outgoing.data||[]).map(r=>[r.receiver_id,r]));
  const streakByFriend=new Map((streakResult.data||[]).map(s=>[s.user_low===uid?s.user_high:s.user_low,s]));
  const displayName=id=>{const p=profileMap.get(id);return p?.display_name||p?.username||'Пользователь';};
  let favoriteIds=[];
  try{favoriteIds=JSON.parse(localStorage.getItem('flamexbot-favorite-friends')||'[]');if(!Array.isArray(favoriteIds))favoriteIds=[];}catch{favoriteIds=[];}
  const favoriteSet=new Set(favoriteIds);
  const sortedFriendIds=[...friendIds].sort((a,b)=>{
    const favoriteDiff=Number(favoriteSet.has(b))-Number(favoriteSet.has(a));
    if(favoriteDiff)return favoriteDiff;
    const sa=streakByFriend.get(a),sb=streakByFriend.get(b);
    const activeDiff=effectiveStreakDays(sb)-effectiveStreakDays(sa);
    if(activeDiff)return activeDiff;
    const bestDiff=(Number(sb?.best_days)||0)-(Number(sa?.best_days)||0);
    if(bestDiff)return bestDiff;
    return displayName(a).localeCompare(displayName(b),'ru');
  });
  const activeFriendCount=friendIds.filter(id=>effectiveStreakDays(streakByFriend.get(id))>0).length;

  const profileCard=(p,subline,actions='',badges=[])=>{
    const shownBadges=p.show_badges===false?[]:p.show_role===false?(badges||[]).filter(code=>code==='verified'||(code==='premium'&&p.show_subscription!==false)):(badges||[]).filter(code=>p.show_subscription!==false||code!=='premium');
    const verified=(badges||[]).includes('verified')||isFounderProfile(p);
    return `<article class="friend-card"><div class="friend-card-main"><div class="friend-avatar">${avatar(p.avatar_url||p.telegram_photo_url,p.display_name||p.username,'avatar-lg')}</div><div class="friend-card-identity"><b>${esc(p.display_name||p.username||'Пользователь')} ${verifiedMarkMarkup(verified&&p.show_badges!==false)} ${badgeMarkup(shownBadges,false,false)}</b><small>${esc(subline)}</small></div></div><div class="friend-card-actions">${actions}</div></article>`;
  };
  const friendCards=sortedFriendIds.map(id=>{
    const p=profileMap.get(id);if(!p)return '';
    const streak=streakByFriend.get(id),days=effectiveStreakDays(streak);
    const handle=String(p.telegram_username||'').replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
    const link=handle?`<a class="friend-link" href="https://t.me/${handle}" target="_blank" rel="noopener noreferrer">Открыть Telegram ↗</a>`:'';
    const status=days>0?`🔥 Огонёк горит · ${days} дн.`:streak?.best_days?`Огонёк погас · рекорд ${streak.best_days} дн.`:'Огонёк ещё не зажжён';
    const favorite=favoriteSet.has(id);
    const actions=`${link}<button class="outline small" type="button" data-friend-profile="${id}">Профиль</button><button class="outline small friend-favorite-button ${favorite?'is-favorite':''}" type="button" data-friend-favorite="${id}" aria-label="${favorite?'Убрать из избранного':'Закрепить друга'}">${favorite?'★ Закреплён':'☆ Закрепить'}</button>`;
    return profileCard(p,`@${p.telegram_username||p.username} · ${status}`,actions,badgeMap.get(id)||[]);
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
  const searchCards=publicSearchResults.map(p=>{
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
      <section class="friends-section"><div class="section-heading"><div><div class="eyebrow">ТВОЁ СООБЩЕСТВО</div><h3>Мои друзья</h3></div><span class="friend-counter">${friendIds.length} · ${activeFriendCount} с огоньком</span></div><label class="friend-list-filter"><span>⌕</span><input id="friend-list-filter" type="search" maxlength="48" placeholder="Поиск среди друзей…" autocomplete="off"/></label><div class="friend-list" id="my-friend-list">${friendCards||'<div class="empty-state">Пока нет друзей. Найди знакомых через поиск выше.</div>'}</div></section>
      <section class="friends-section"><div class="section-heading"><div><div class="eyebrow">ВХОДЯЩИЕ</div><h3>Заявки в друзья</h3></div><span class="friend-counter">${(incoming.data||[]).length}</span></div><div class="friend-list">${incomingCards||'<div class="empty-state">Новых заявок нет.</div>'}</div>
        <div class="outgoing-heading"><b>Отправленные</b><span>${(outgoing.data||[]).length}</span></div><div class="friend-list">${outgoingCards||'<div class="empty-state compact-empty">Ты пока никого не приглашал.</div>'}</div>
      </section>
    </div>
    ${friendRows.error||incoming.error||outgoing.error||streakResult.error||profileResult.error||badgeResult.error||searchPrivacy.error?'<p class="business-warning">Не удалось загрузить часть данных друзей. Попробуй обновить раздел.</p>':''}
    <section class="friend-profile-panel" id="friend-profile-panel" hidden></section>`;
  host.querySelectorAll('[data-friend-profile]').forEach(btn=>btn.addEventListener('click',()=>openFriendProfile(btn.dataset.friendProfile)));
  host.querySelectorAll('[data-friend-favorite]').forEach(btn=>btn.addEventListener('click',async()=>{
    const id=btn.dataset.friendFavorite;
    const next=favoriteSet.has(id)?favoriteIds.filter(x=>x!==id):[...favoriteIds,id];
    try{localStorage.setItem('flamexbot-favorite-friends',JSON.stringify(next));}catch{toast('Не удалось сохранить избранное на этом устройстве.');return;}
    toast(favoriteSet.has(id)?'Друг убран из избранного':'Друг закреплён в избранном');
    await renderFriends(host);
  }));
  async function openFriendProfile(friendId){
    const friend=profileMap.get(friendId);
    if(!friend||!friendSet.has(friendId))return;
    const panel=host.querySelector('#friend-profile-panel');
    if(!panel)return;
    const streak=streakByFriend.get(friendId);
    const {data:activity,error:activityError}=streak?.id
      ?await supabase.from('streak_daily_activity').select('activity_date,message_count').eq('streak_id',streak.id).eq('user_id',uid).order('activity_date',{ascending:false}).limit(14)
      :{data:[],error:null};
    const myMessages=(activity||[]).reduce((sum,row)=>sum+(Number(row.message_count)||0),0);
    const days=effectiveStreakDays(streak);
    const handle=String(friend.telegram_username||'').replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
    const isFavorite=favoriteSet.has(friendId);
    panel.hidden=false;
    const friendBadges=badgeMap.get(friendId)||[];
    const publicBadges=friend.show_badges===false?[]:friend.show_role===false?friendBadges.filter(code=>code==='verified'||(code==='premium'&&friend.show_subscription!==false)):friendBadges.filter(code=>friend.show_subscription!==false||code!=='premium');
    const showActivity=friend.show_activity!==false;
    panel.innerHTML=`<div class="friend-profile-top"><div class="friend-profile-identity">${avatar(friend.avatar_url||friend.telegram_photo_url,friend.display_name||friend.username,'avatar-xl')}<div><div class="eyebrow">ПРОФИЛЬ ДРУГА</div><h3>${esc(friend.display_name||friend.username||'Пользователь')} ${verifiedMarkMarkup((friendBadges.includes('verified')||isFounderProfile(friend))&&friend.show_badges!==false)}</h3><p>${friend.telegram_username?'@'+esc(friend.telegram_username):'Telegram не указан'} ${badgeMarkup(publicBadges,false,false)}</p></div></div><button class="outline small" type="button" id="close-friend-profile">Закрыть ×</button></div>
      ${showActivity?`<div class="friend-profile-stats"><div><small>ОГОНЁК СЕЙЧАС</small><b>${days} дн.</b></div><div><small>ЛИЧНЫЙ РЕКОРД СЕРИИ</small><b>${Number(streak?.best_days)||0} дн.</b></div><div><small>ТВОИ СООБЩЕНИЯ В СЕРИИ</small><b>${myMessages}</b></div></div>`:''}
      <div class="friend-profile-meta"><span>В FLAMEXBOT с <b>${friend.created_at?formatMskDate(friend.created_at):'дата неизвестна'}</b></span>${handle?`<a class="friend-link" href="https://t.me/${handle}" target="_blank" rel="noopener noreferrer">Открыть Telegram ↗</a>`:''}<button class="outline small ${isFavorite?'is-favorite':''}" type="button" id="friend-profile-favorite">${isFavorite?'★ В избранном':'☆ Закрепить друга'}</button></div>
      ${showActivity?`<div class="friend-profile-history"><div class="eyebrow">ИСТОРИЯ ОГОНЬКА</div><p>${activityError?'Не удалось загрузить историю активности.':activity?.length?'Твои дни активности в этой совместной серии:':'История активности пока не появилась.'}</p><div class="friend-activity-days">${(activity||[]).map(row=>`<div><b>${formatMskDate(row.activity_date,{day:'numeric',month:'short'})}</b><small>${Number(row.message_count)||0} сообщ.</small></div>`).join('')}</div><small class="friend-profile-privacy">Показывается только твоя активность в общей серии. Личные достижения и статистика друга не раскрываются.</small></div>`:''}`;
    panel.scrollIntoView({behavior:'smooth',block:'nearest'});
    panel.querySelector('#close-friend-profile')?.addEventListener('click',()=>{panel.hidden=true;panel.innerHTML='';});
    panel.querySelector('#friend-profile-favorite')?.addEventListener('click',async()=>{
      const next=favoriteSet.has(friendId)?favoriteIds.filter(x=>x!==friendId):[...favoriteIds,friendId];
      try{localStorage.setItem('flamexbot-favorite-friends',JSON.stringify(next));}catch{toast('Не удалось сохранить избранное на этом устройстве.');return;}
      await renderFriends(host);
      const refreshed=host.querySelector(`[data-friend-profile="${friendId}"]`);
      refreshed?.click();
    });
  }
  host.querySelector('#friend-list-filter')?.addEventListener('input',event=>{
    const query=String(event.currentTarget.value||'').trim().toLocaleLowerCase('ru');
    host.querySelectorAll('#my-friend-list .friend-card').forEach(card=>{
      const text=card.querySelector('.friend-card-identity')?.textContent?.toLocaleLowerCase('ru')||'';
      card.hidden=Boolean(query)&&!text.includes(query);
    });
  });
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
  state.streaks.sort((a,b)=>effectiveStreakDays(b)-effectiveStreakDays(a)||(Number(b.best_days)||0)-(Number(a.best_days)||0));
  const friendIds=state.streaks.map(s=>s.user_low===uid?s.user_high:s.user_low);
  const activeStreakCount=state.streaks.filter(s=>effectiveStreakDays(s)>0).length;
  const bestStreak=Math.max(0,...state.streaks.map(s=>Number(s.best_days)||0));
  const [profiles,badges]=await Promise.all([
    friendIds.length?supabase.from('profiles').select('id,username,display_name,avatar_url,telegram_photo_url,telegram_username').in('id',friendIds):Promise.resolve({data:[],error:null}),
    friendIds.length?supabase.from('profile_badges').select('user_id,badge_code').in('user_id',friendIds):Promise.resolve({data:[],error:null})
  ]);
  const profileMap=new Map((profiles.data||[]).map(p=>[p.id,p]));
  const badgeMap=new Map();
  (badges.data||[]).forEach(b=>{if(!badgeMap.has(b.user_id))badgeMap.set(b.user_id,[]);badgeMap.get(b.user_id).push(b.badge_code);});
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">DON'T BREAK THE CHAIN</div><h1>Огоньки 🔥</h1><p class="muted">Огонёк продлевается, когда оба друга отправили хотя бы одно сообщение за день. Пропустите полный день — серия погаснет, но личный рекорд сохранится.</p></div>
    <div class="streak-overview-grid"><div><small>ВСЕ ОГОНЬКИ</small><b>${state.streaks.length}</b></div><div><small>ГОРЯТ СЕЙЧАС</small><b>${activeStreakCount}</b></div><div><small>ЛИЧНЫЙ РЕКОРД</small><b>${bestStreak} дн.</b></div></div>
    <div class="streak-list large">${error?esc(error.message):state.streaks.length?state.streaks.map(s=>{
      const id=s.user_low===uid?s.user_high:s.user_low,p=profileMap.get(id),days=effectiveStreakDays(s),name=p?.display_name||p?.username||'Друг';
      const waiting=!s.last_activity_date;
      const status=days>0?'СЕРИЯ ГОРИТ':waiting?'ОЖИДАЕМ ПЕРВЫЙ ОБМЕН':'СЕРИЯ ПОГАСЛА';
      return `<div class="streak-card ${days>0?'streak-active':'streak-expired'}"><div class="streak-symbol streak-person-avatar">${avatar(p?.avatar_url||p?.telegram_photo_url,name,'avatar-lg')}</div><div class="streak-card-main"><div class="eyebrow">${status}</div><h3>${esc(name)} · ${days} ${days===1?'день':'дн.'}</h3><p class="muted">Личный рекорд: ${s.best_days||0} дн. · ${s.last_activity_date?'Последний общий день: '+formatMskDate(s.last_activity_date):'Один из вас уже начал общение — нужен ответ друга'}</p></div><div class="streak-days-badge">${days>0?'🔥 '+days:'—'}</div></div>`;
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
  host.innerHTML = `<div class="page-heading"><div class="eyebrow">ТВОЙ АККАУНТ</div><h1>Профиль ${verifiedMarkMarkup((isFounderProfile(p)||state.profileBadges.includes('verified'))&&p.show_badges!==false)}</h1><div class="profile-badge-row">${badgeMarkup(state.profileBadges)}</div><p class="muted">Управляй именем, оформлением, значками и подключением Telegram Business.</p></div>
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
      <div class="business-card-head"><div><div class="eyebrow">ПОДКЛЮЧЕНИЕ TELEGRAM</div><h2>Telegram Business</h2><p class="muted">Подключи Telegram Business и выбери разрешения, с которыми FLAMEXBOT сможет работать в твоих диалогах.</p></div><span class="business-status ${businessConnected ? 'is-connected' : ''}">${businessConnected ? 'Активен' : 'Неактивен'}</span></div>
      <div class="business-steps">
        <div><b>1.</b><span>В Telegram открой <strong>Настройки → Telegram Business → Чат-боты</strong>.</span></div>
        <div><b>2.</b><span>Добавь FLAMEXBOT и самостоятельно выбери, к каким диалогам и данным открыть доступ.</span></div>
      </div>
      <div class="business-connection-info">
        ${businessConnected ? `<b>Бот активен</b><small>Подключено: ${businessConnection.connected_at ? formatMskDateTime(businessConnection.connected_at,{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'дата не указана'}</small><small>Выдано разрешений: ${grantedRights.length}</small>` : '<b>Ожидаем подтверждения</b><small>После подтверждения подключения Telegram статус появится здесь автоматически.</small>'}
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
    {syntax:'/start',title:'Запустить бота',description:'Показывает приветствие и кнопку открытия FLAMEXBOT.',access:'free',group:'Личный чат с ботом'},
    {syntax:'/app',title:'Открыть Mini App',description:'Показывает кнопку запуска приложения и включает кнопку меню Telegram.',access:'free',group:'Личный чат с ботом'},
    {syntax:'/ping',title:'Проверка бота',description:'Проверяет, что бот отвечает в личном чате.',access:'free',group:'Личный чат с ботом'},
    {syntax:'/status',title:'Статус Telegram Business',description:'Показывает, подключён ли Business и какие права выданы.',access:'free',group:'Личный чат с ботом'},
    {syntax:'/help',title:'Помощь в личном чате',description:'Объясняет, что команды управления нужно отправлять в переписке с человеком.',access:'free',group:'Личный чат с ботом'},
    {syntax:'/commands',title:'Справка по командам',description:'Открывает ту же справку, что и /help.',access:'free',group:'Личный чат с ботом'},
    {syntax:'/premium',title:'Купить или продлить Premium',description:'Создаёт счёт Telegram Stars на 30 дней. Оплата разовая, автоматического продления нет.',access:'free',group:'Подписка · личный чат'},
        {syntax:'.unantimute',title:'Выключить антимут',description:'Отключает альтернативную отправку от имени бота.',access:'free',group:'Управление чатом'},
    {syntax:'.commands',title:'Полный справочник',description:'Открывает список всех доступных команд в переписке.',access:'free',group:'Основные'},
    {syntax:'.mute',title:'Включить мут',description:'Удаляет новые входящие сообщения в выбранном диалоге. Нужны Premium и право Telegram Business «Удалять все сообщения».',access:'premium',group:'Управление чатом'},
    {syntax:'.unmute',title:'Выключить мут',description:'Останавливает автоматическое удаление новых сообщений. Доступно бесплатно.',access:'free',group:'Управление чатом'},
    {syntax:'.antimute',title:'Включить антимут',description:'Отправляет новые сообщения от имени бота FLAMEXBOT. Получатель должен открыть бота и нажать Start. Нужен Premium.',access:'premium',group:'Управление чатом'},
    {syntax:'.unantimute',title:'Выключить антимут',description:'Выключает режим антимута. Доступно бесплатно.',access:'free',group:'Управление чатом'},
    
    {syntax:'.afk причина',title:'Включить автоответ',description:'Включает автоответ только в этом диалоге и задаёт текст ответа.',access:'premium',group:'Автоматизация'},
    {syntax:'.unafk',title:'Выключить автоответ',description:'Отключает автоответ только в этом диалоге. Доступно бесплатно.',access:'free',group:'Автоматизация'},
    {syntax:'.autoread',title:'Автопрочтение',description:'Автоматически отмечает входящие сообщения прочитанными только в этом диалоге.',access:'premium',group:'Автоматизация'},
    {syntax:'.unautoread',title:'Выключить автопрочтение',description:'Отключает автоматическое прочтение сообщений.',access:'free',group:'Автоматизация'},
    {syntax:'.autotyping',title:'Статус набора',description:'Включает статус «печатает…» только в этом диалоге.',access:'premium',group:'Автоматизация'},
    {syntax:'.unautotyping',title:'Отключить статус набора',description:'Выключает статус «печатает…».',access:'free',group:'Автоматизация'},
    {syntax:'.autovoice',title:'Статус записи голосового',description:'Включает статус записи голосового только в этом диалоге.',access:'premium',group:'Автоматизация'},
    {syntax:'.unautovoice',title:'Отключить статус записи',description:'Выключает статус записи голосового.',access:'free',group:'Автоматизация'},
    {syntax:'.mutestick',title:'Фильтр стикеров',description:'Автоматически удаляет входящие стикеры только в этом диалоге.',access:'premium',group:'Фильтры'},
    {syntax:'.unmutestick',title:'Отключить фильтр стикеров',description:'Отключает фильтр входящих стикеров.',access:'free',group:'Фильтры'},
    {syntax:'.antimat',title:'Антимат',description:'Фильтрует часть ненормативной лексики только в этом диалоге.',access:'premium',group:'Фильтры'},
    {syntax:'.unantimat',title:'Отключить антимат',description:'Отключает фильтр ненормативной лексики.',access:'free',group:'Фильтры'},
    {syntax:'.timeprofile',title:'Московское время',description:'Закрепляет часовой пояс FLAMEXBOT: Москва, UTC+3.',access:'premium',group:'Профиль'},
    {syntax:'.time',title:'Показывать время',description:'Включает отображение времени в профиле.',access:'premium',group:'Профиль'},
    {syntax:'.untime',title:'Скрыть время',description:'Выключает отображение времени в профиле. Доступно бесплатно.',access:'free',group:'Профиль'},
    {syntax:'.bold текст',title:'Жирный текст',description:'Отправляет указанный текст жирным начертанием.',access:'premium',group:'Оформление'},
    {syntax:'.dumb текст',title:'Игровое оформление',description:'Преобразует текст в шуточный стиль.',access:'premium',group:'Оформление'},
    {syntax:'.link текст',title:'Ссылка на диалог',description:'Создаёт ссылку на текущий Telegram-диалог.',access:'premium',group:'Оформление'},
    {syntax:'.copyp',title:'Копировать профиль',description:'Показывает имя, юзернейм, Telegram ID и ссылку на профиль собеседника.',access:'premium',group:'Профиль'},
    {syntax:'.qr текст',title:'QR-код',description:'Создаёт изображение QR-кода для ссылки или текста до 512 символов.',access:'free',group:'Утилиты'},
    {syntax:'.id',title:'ID собеседника',description:'Показывает Telegram ID, ID чата и username собеседника.',access:'free',group:'Утилиты'},
    {syntax:'.chatid',title:'ID диалога',description:'Показывает идентификатор текущего Business-чата.',access:'free',group:'Утилиты'},
    {syntax:'.date',title:'Дата и время',description:'Показывает текущую дату и время по Москве.',access:'free',group:'Утилиты'},
    {syntax:'.calc выражение',title:'Калькулятор',description:'Считает выражения со скобками и операциями +, −, ×, ÷, %.',access:'free',group:'Утилиты'},
    {syntax:'.upper текст',title:'В верхний регистр',description:'Преобразует текст в заглавные буквы.',access:'free',group:'Работа с текстом'},
    {syntax:'.lower текст',title:'В нижний регистр',description:'Преобразует текст в строчные буквы.',access:'free',group:'Работа с текстом'},
    {syntax:'.reverse текст',title:'Перевернуть текст',description:'Меняет порядок символов в тексте.',access:'free',group:'Работа с текстом'},
    {syntax:'.count текст',title:'Подсчёт символов',description:'Считает количество символов в тексте.',access:'free',group:'Работа с текстом'},
    {syntax:'.wordcount текст',title:'Подсчёт слов',description:'Считает количество слов в тексте.',access:'free',group:'Работа с текстом'},
    {syntax:'.choose A | B',title:'Случайный выбор',description:'Выбирает один из вариантов, разделённых символом |.',access:'free',group:'Утилиты'},
    {syntax:'.roll 100',title:'Случайное число',description:'Выдаёт случайное число от 1 до заданного максимума.',access:'free',group:'Утилиты'},
    {syntax:'.profile',title:'Публичная карточка',description:'Анимированно показывает открытые сведения текущего Telegram-диалога. Не обращается к утечкам и закрытым базам.',access:'premium',group:'Профиль'},
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


async function renderWallet(host) {
  const uid=state.session.user.id;
  const [walletResult,txResult]=await Promise.all([
    supabase.from('flamexbot_wallets').select('balance').eq('user_id',uid).maybeSingle(),
    supabase.from('flamexbot_wallet_transactions').select('id,amount,reason,source,created_at').eq('user_id',uid).order('created_at',{ascending:false}).limit(25)
  ]);
  const balance=Number(walletResult.data?.balance||0);
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT WALLET</div><h1>Баланс 🪙</h1><p class="muted">Твои монеты, пополнения и покупки внутри FLAMEXBOT.</p></div>
    <section class="business-card wallet-balance-card"><small>ТЕКУЩИЙ БАЛАНС</small><strong>${balance.toLocaleString('ru-RU')} <span>монет</span></strong><p>1 Telegram Star = 2 монеты</p></section>
    <section class="business-card"><div class="eyebrow">ПОПОЛНЕНИЕ ЧЕРЕЗ TELEGRAM STARS</div><h3>Выбери количество звёзд</h3><form id="wallet-topup-form" class="wallet-topup-form"><label>Звёзды<input name="stars" type="number" min="5" max="5000" step="1" value="50" required></label><div class="wallet-conversion" id="wallet-conversion">Ты получишь 100 монет</div><button class="primary" type="submit">Создать счёт в Telegram ⭐</button></form><small class="muted">Оплата проводится через официальный счёт Telegram Stars. После подтверждения монеты автоматически поступят на баланс.</small></section>
    ${state.isAdmin?`<section class="business-card"><div class="eyebrow">УПРАВЛЕНИЕ БАЛАНСОМ</div><h3>Начислить или списать монеты</h3><form id="admin-wallet-form" class="wallet-topup-form"><label>Telegram ID пользователя<input name="telegram_id" inputmode="numeric" placeholder="Например, 123456789" required></label><label>Количество монет<input name="amount" type="number" step="1" min="-1000000" max="1000000" required placeholder="Например, 500 или -100"></label><label>Причина<input name="reason" maxlength="240" placeholder="Бонус от владельца"></label><button class="primary" type="submit">Применить изменение</button></form></section>`:''}
    <section class="business-card"><div class="section-heading"><div><div class="eyebrow">ИСТОРИЯ ОПЕРАЦИЙ</div><h3>Последние движения</h3></div><span class="payment-history-count">${(txResult.data||[]).length}</span></div><div class="payment-history-list">${(txResult.data||[]).map(tx=>`<div class="payment-history-row"><div><b>${esc(tx.reason||'Операция')}</b><small>${formatMskDateTime(tx.created_at)} · ${esc(tx.source||'')}</small></div><strong class="${tx.amount>=0?'wallet-credit':'wallet-debit'}">${tx.amount>0?'+':''}${Number(tx.amount).toLocaleString('ru-RU')} 🪙</strong></div>`).join('')||'<div class="empty-state">Операций пока нет.</div>'}</div></section>
    ${walletResult.error||txResult.error?'<p class="business-warning">Не удалось загрузить баланс или историю.</p>':''}`;
  const starsInput=host.querySelector('[name="stars"]');
  const conversion=host.querySelector('#wallet-conversion');
  starsInput?.addEventListener('input',()=>{const n=Math.max(0,Math.floor(Number(starsInput.value)||0));conversion.textContent='Ты получишь '+(n*2).toLocaleString('ru-RU')+' монет';});
  host.querySelector('#wallet-topup-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Создаём счёт…';
    try{
      const stars=Math.floor(Number(new FormData(event.currentTarget).get('stars')));
      const {data,error}=await supabase.functions.invoke('create-wallet-invoice',{body:{stars}});
      if(error||data?.error)throw new Error(data?.error||error?.message||'Не удалось создать счёт');
      const webApp=window.Telegram?.WebApp;
      if(webApp?.openInvoice)webApp.openInvoice(data.invoice_url,status=>{if(status==='paid'){toast('Оплата получена. Обновляем баланс…');setTimeout(()=>renderWallet(host),1200);}else if(status==='failed')toast('Оплата не прошла.');});
      else if(webApp?.openLink)webApp.openLink(data.invoice_url);else window.location.href=data.invoice_url;
    }catch(error){toast(error?.message||'Ошибка пополнения');}
    finally{button.disabled=false;button.textContent='Создать счёт в Telegram ⭐';}
  });
  host.querySelector('#admin-wallet-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget);const telegramId=String(fd.get('telegram_id')||'').trim();const amount=Number(fd.get('amount'));const reason=String(fd.get('reason')||'Изменение баланса владельцем').trim();
    if(!/^[0-9]{5,20}$/.test(telegramId)||!Number.isSafeInteger(amount)||amount===0){toast('Проверь Telegram ID и количество монет.');return;}
    const button=event.currentTarget.querySelector('button');button.disabled=true;
    try{
      const {data:profile,error:profileError}=await supabase.from('profiles').select('id,username,display_name').eq('telegram_id',telegramId).maybeSingle();
      if(profileError)throw profileError;if(!profile)throw new Error('Пользователь с таким Telegram ID не найден.');
      const {data,error}=await supabase.rpc('admin_adjust_flamexbot_balance',{p_user_id:profile.id,p_amount:amount,p_reason:reason});
      if(error)throw error;toast('Баланс изменён. Новый баланс: '+data+' монет.');await renderWallet(host);
    }catch(error){toast(error?.message||'Не удалось изменить баланс');}
    finally{button.disabled=false;}
  });
}

async function renderSeasonPass(host) {
  const uid=state.session.user.id;
  const {data:season,error:seasonError}=await supabase.from('flamexbot_seasons').select('id,season_key,title,starts_at,ends_at').eq('is_active',true).lte('starts_at',new Date().toISOString()).gt('ends_at',new Date().toISOString()).order('starts_at',{ascending:false}).limit(1).maybeSingle();
  if(seasonError||!season){host.innerHTML='<div class="page-heading"><h1>Сезонный пропуск 🎟️</h1></div><div class="empty-state">Активный сезон пока не запущен.</div>';return;}
  const [progressResult,levelsResult,claimsResult,walletResult]=await Promise.all([
    supabase.from('flamexbot_season_pass_progress').select('xp,level,pass_tier').eq('user_id',uid).eq('season_id',season.id).maybeSingle(),
    supabase.from('flamexbot_season_pass_levels').select('pass_tier,level,reward_type,reward_amount,reward_payload').eq('season_id',season.id).order('level'),
    supabase.from('flamexbot_season_pass_claims').select('pass_tier,level').eq('user_id',uid).eq('season_id',season.id),
    supabase.from('flamexbot_wallets').select('balance').eq('user_id',uid).maybeSingle()
  ]);
  const progress=progressResult.data||{xp:0,level:0,pass_tier:'free'};
  const claimed=new Set((claimsResult.data||[]).map(x=>x.pass_tier+':'+x.level));
  const levels=levelsResult.data||[];
  const tier=progress.pass_tier||'free';
  const labelReward=r=>r.reward_type==='coins'?r.reward_amount+' монет':r.reward_type==='premium_days'?r.reward_amount+' дн. Premium':r.reward_type==='wheel_spins'?r.reward_amount+' прокрутка(и)':r.reward_type==='addon'?'Дополнение: '+(r.reward_payload?.addon_code||'бонус'):'Награда';
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT SEASON PASS</div><h1>${esc(season.title)} 🎟️</h1><p class="muted">Выполняй ежедневные задания, получай сезонный опыт и забирай награды. Free открыт всем, Pro открывает дополнительную дорожку.</p></div>
    <section class="business-card season-progress-card"><div class="level-line"><div><small>ТВОЙ УРОВЕНЬ СЕЗОНА</small><h2>Уровень ${progress.level||1}</h2></div><strong>${progress.xp||0} XP</strong></div><div class="xp-track"><span style="width:${Math.min(100,(Number(progress.xp||0)%100))}%"></span></div><div class="level-foot"><small>Баланс: ${Number(walletResult.data?.balance||0)} монет</small><b>${tier==='pro'?'PRO PASS АКТИВЕН':'FREE PASS'}</b></div></section>
    <div class="season-tier-row"><button class="season-tier active" data-season-tier="free">Free Pass</button><button class="season-tier" data-season-tier="pro">Pro Pass</button></div>
    <section class="business-card season-pro-card"><div><div class="eyebrow">ДОПОЛНИТЕЛЬНАЯ ДОРОЖКА</div><h3>Pro Pass</h3><p class="muted">Дополнительные награды: Premium-дни, прокрутки и дополнения.</p></div><button class="primary small" id="season-upgrade" ${tier==='pro'?'disabled':''}>${tier==='pro'?'Уже куплен':'Открыть за 500 монет'}</button></section>
    <div class="season-level-grid" id="season-level-grid"></div>
    ${progressResult.error||levelsResult.error||claimsResult.error?'<p class="business-warning">Не удалось загрузить прогресс сезонного пропуска.</p>':''}`;
  let selectedTier='free';
  const draw=()=>{
    const grid=host.querySelector('#season-level-grid');
    host.querySelectorAll('[data-season-tier]').forEach(btn=>btn.classList.toggle('active',btn.dataset.seasonTier===selectedTier));
    const rows=levels.filter(x=>x.pass_tier===selectedTier);
    grid.innerHTML=rows.map(r=>{
      const isClaimed=claimed.has(selectedTier+':'+r.level);
      const unlocked=Number(progress.level||1)>=r.level;
      const proLocked=selectedTier==='pro'&&tier!=='pro';
      return `<article class="season-level-card ${isClaimed?'claimed':unlocked&&!proLocked?'ready':'locked'}"><div class="season-level-number">LEVEL ${r.level}</div><b>${esc(labelReward(r))}</b><small>${unlocked&&!proLocked?'Награда доступна':proLocked?'Нужен Pro Pass':'Нужно '+r.level*100+' XP'}</small><button class="${unlocked&&!proLocked&&!isClaimed?'primary':'outline'} small" data-claim-season="${r.level}" ${!unlocked||proLocked||isClaimed?'disabled':''}>${isClaimed?'Получено':unlocked&&!proLocked?'Забрать':'Закрыто'}</button></article>`;
    }).join('')||'<div class="empty-state">Награды ещё не добавлены.</div>';
    grid.querySelectorAll('[data-claim-season]').forEach(btn=>btn.addEventListener('click',async()=>{
      btn.disabled=true;const {data,error}=await supabase.rpc('claim_flamexbot_season_reward',{p_season_id:season.id,p_tier:selectedTier,p_level:Number(btn.dataset.claimSeason)});
      if(error){toast(error.message.includes('already claimed')?'Награда уже получена':error.message);btn.disabled=false;return;}
      claimed.add(selectedTier+':'+btn.dataset.claimSeason);toast('Сезонная награда получена: '+labelReward({reward_type:data.reward_type,reward_amount:data.reward_amount,reward_payload:{}}));draw();
    }));
  };
  host.querySelectorAll('[data-season-tier]').forEach(btn=>btn.addEventListener('click',()=>{selectedTier=btn.dataset.seasonTier;draw();}));
  host.querySelector('#season-upgrade')?.addEventListener('click',async()=>{
    const button=host.querySelector('#season-upgrade');button.disabled=true;
    const {data,error}=await supabase.rpc('upgrade_flamexbot_season_pass',{p_season_id:season.id,p_cost:500});
    if(error){toast(error.message.includes('insufficient balance')?'Недостаточно монет. Пополни баланс.':error.message);button.disabled=false;return;}
    toast('Pro Pass открыт!');await renderSeasonPass(host);
  });
  draw();
}

async function renderUserSupport(host) {
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">FLAMEXBOT · HELP DESK</div><h1>Техподдержка 🛟</h1><p class="muted">Напиши команде. Ответ появится здесь, в Mini App.</p></div><section class="support-thread active" id="user-support-thread"><div class="support-thread-placeholder">Загружаем обращение…</div></section>`;
  const thread=host.querySelector('#user-support-thread');
  const refresh=async()=>{
    if(!thread.isConnected||state.page!=='support_user')return;
    const {data,error}=await supabase.functions.invoke('flamexbot-user-support',{body:{action:'messages'}});
    if(error||data?.error){thread.innerHTML='<div class="empty-state">'+esc(data?.error||error?.message||'Не удалось загрузить обращение')+'</div>';return;}
    const messages=data.messages||[];
    const previousDraft=thread.querySelector('textarea[name="content"]')?.value||'';
    const keepFocus=document.activeElement===thread.querySelector('textarea[name="content"]');
    thread.innerHTML='<div class="support-thread-head"><div><b>Твоё обращение</b><small>'+(data.chat?.status==='closed'?'Закрыто':'Открыто')+'</small></div></div><div class="support-message-list">'+(messages.map(msg=>'<article class="support-message '+(msg.direction==='outgoing'?'outgoing':'incoming')+'"><p>'+esc(msg.content||'')+'</p><time>'+formatMskDateTime(msg.created_at)+'</time></article>').join('')||'<div class="empty-state">Опиши проблему в поле ниже — обращение будет создано.</div>')+'</div><form class="support-reply-form" id="user-support-form"><textarea name="content" maxlength="4000" placeholder="Опиши проблему…" required></textarea><button class="primary" type="submit">Отправить</button></form>';
    const draftInput=thread.querySelector('textarea[name="content"]');
    if(draftInput){draftInput.value=previousDraft;if(keepFocus)draftInput.focus({preventScroll:true});}
    const list=thread.querySelector('.support-message-list');if(list)list.scrollTop=list.scrollHeight;
    thread.querySelector('#user-support-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget;const content=String(new FormData(form).get('content')||'').trim();if(!content)return;
      const button=form.querySelector('button');button.disabled=true;
      const {data:sent,error:sendError}=await supabase.functions.invoke('flamexbot-user-support',{body:{action:'send',content}});
      if(sendError||sent?.error)toast(sent?.error||sendError?.message||'Не удалось отправить обращение');else{toast('Сообщение отправлено в техподдержку');await refresh();}
      button.disabled=false;
    });
  };
  await refresh();
  if(state.userSupportPollTimer)clearInterval(state.userSupportPollTimer);
  state.userSupportPollTimer=setInterval(()=>{if(state.page==='support_user'&&!document.hidden)refresh();},5000);
}

async function renderBotBanners(host) {
  const {data:rows,error}=await supabase.from('flamexbot_bot_banners').select('banner_key,image_url,caption,enabled').order('banner_key');
  const map=new Map((rows||[]).map(x=>[x.banner_key,x]));
  host.innerHTML=`<div class="page-heading"><div class="eyebrow">FOUNDER SETTINGS</div><h1>Баннеры бота 🖼️</h1><p class="muted">Настрой изображения и подписи для приветствия /start и меню инструкции.</p></div>${['start','instruction'].map(key=>{const item=map.get(key)||{image_url:'',caption:'',enabled:true};return `<form class="business-card banner-form" data-banner-key="${key}"><div class="eyebrow">${key==='start'?'ПРИВЕТСТВИЕ /START':'ИНСТРУКЦИЯ'}</div><label>Ссылка на изображение<input name="image_url" type="url" value="${esc(item.image_url||'')}" placeholder="https://…"></label><label>Текст подписи<textarea name="caption" maxlength="900" rows="3">${esc(item.caption||'')}</textarea></label><label class="admin-owner-setting"><span><b>Баннер включён</b><small>Если выключить, бот отправит обычное текстовое сообщение.</small></span><input type="checkbox" name="enabled" ${item.enabled?'checked':''}></label><button class="primary" type="submit">Сохранить баннер</button></form>`;}).join('')}${error?'<p class="business-warning">'+esc(error.message)+'</p>':''}`;
  host.querySelectorAll('[data-banner-key]').forEach(form=>form.addEventListener('submit',async event=>{
    event.preventDefault();const fd=new FormData(form);const key=form.dataset.bannerKey;const image=String(fd.get('image_url')||'').trim();if(image&&!/^https:\/\//i.test(image)){toast('Нужна HTTPS-ссылка на изображение.');return;}
    const {error:saveError}=await supabase.from('flamexbot_bot_banners').upsert({banner_key:key,image_url:image||null,caption:String(fd.get('caption')||''),enabled:fd.get('enabled')==='on',updated_by:state.session.user.id,updated_at:new Date().toISOString()},{onConflict:'banner_key'});
    if(saveError)toast(saveError.message);else toast('Баннер сохранён.');
  }));
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
      if(state.isAdmin&&n.type==='support_message')toast((n.title||'Новое сообщение в техподдержку')+(n.body?' · '+n.body:''));
      const {error}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',n.id).eq('user_id',uid);
      if(error)console.warn('Auto-read notification:',error.message);
    })
    .subscribe(status=>{if(status==='SUBSCRIBED')console.info('FLAMEXBOT notifications auto-read enabled');});
  state.notificationChannel=channel;
}


async function clearUserScopedState() {
  const channels=[
    state.businessChatChannel,state.businessListChannel,state.presenceChannel,
    state.notificationChannel,state.moderationChannel
  ].filter(Boolean);
  await Promise.all(channels.map(channel=>supabase.removeChannel(channel).catch(()=>null)));
  state.messageRefreshTimers.forEach(timer=>clearTimeout(timer));
  state.messageRefreshTimers.clear();
  if(state.businessListRefreshTimer)clearTimeout(state.businessListRefreshTimer);
  state.businessListRefreshTimer=null;
  state.businessChatChannel=null;
  state.businessListChannel=null;
  state.presenceChannel=null;
  state.notificationChannel=null;
  state.moderationChannel=null;
  state.messageRefreshInFlight.clear();
  state.messageRefreshPending.clear();
  state.businessMediaUrlCache.clear();
  state.avatarRefreshAttempted.clear();
  state.profile=null;
  state.profileBadges=[];
  state.subscription=null;
  state.businessConnection=null;
  state.businessRights=null;
  state.isAdmin=false;
  state.streaks=[];
  state.businessChats=[];
  state.activeBusinessChat=null;
  state.businessMessages=[];
  state.businessMessagesHasMore=false;
  state.businessMessagesLoadingOlder=false;
  state.businessMessagesInitialLoaded=false;
  state.businessMessagesOldestAt=null;
  state.onlineUserIds=[];
  state.notificationCount=0;
  state.session=null;
}

async function boot(session) {
  const nextUserId=session?.user?.id||null;
  const currentUserId=state.session?.user?.id||null;
  if(!session||(currentUserId&&nextUserId!==currentUserId))await clearUserScopedState();
  state.session=session;
  if(!session){
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
  state.profile={...(data||{username:session.user.email?.split('@')[0]||'Flame user'}),timezone_offset:preferencesResult.data?.timezone_offset??3};
  state.profileBadges=(badgesResult.data||[]).map(x=>x.badge_code);
  if(isFounderProfile(state.profile)&&!state.webhookSetupAttempted){
    state.webhookSetupAttempted=true;
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
