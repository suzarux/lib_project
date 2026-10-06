/* ============================================================
   Онлайн-библиотека — Школа №73
   by suzarux — demo v0.1.4 build 191906102026
   ============================================================ */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => (
  { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
));

function toast(m, kind){
  if(!state.data || !state.data.settings.toasts) return;
  const w = $('#toastWrap'), e = document.createElement('div');
  e.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  e.textContent = m;
  w.appendChild(e);
  setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 300); }, 2200);
}

async function api(path, opts = {}){
  const cfg = {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };
  if(opts.body !== undefined) cfg.body = JSON.stringify(opts.body);
  const res = await fetch(path, cfg);
  let data = {};
  try { data = await res.json(); } catch(e){}
  if(!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

/* ---------------- СОСТОЯНИЕ ---------------- */
const state = {
  user: null, role: 'user',
  books: [], users: [], tickets: [],
  chat: [],
  currentBook: null, currentText: '',
  data: null, tab: 'home', search: '', filter: 'all', sortBy: 'alpha',
  authMode: 'login', reportTarget: null,
};

const ADMIN_LOGIN = 'suzarux';

function defaultData(){
  return {
    favorites: [], notes: {}, highlights: {}, readScroll: {},
    settings: {
      theme: 'dark', fontSize: 17, fontFamily: 'Inter', fontReader: 'PT Serif',
      compact: false, anim: true, toasts: true, cols: 2,
      glow: true, accent: 'mono', radius: 1,
      logoutConfirm: false, hideRead: false,
      avatars: true, saveScroll: true,
    },
    profile: { bio: '', avatar: null, readBooks: [] },
    stats: { timeTotal: 0, lastOnline: 0 },
    role: 'user', banned: false, muted: false,
  };
}

let saveTimer = null;
function scheduleSave(){
  if(!state.user) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/data', { method: 'POST', body: state.data }).catch(() => {});
  }, 500);
}

/* ============================================================
   ТЕМА / ШРИФТЫ / НАСТРОЙКИ
   ============================================================ */
function applyTheme(t){
  const s = state.data.settings;
  s.theme = t;
  let real = t;
  if(t === 'auto'){
    real = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', real);
  $$('.theme-pill[data-theme-pick]').forEach(p => p.classList.toggle('active', p.dataset.themePick === t));
  scheduleSave();
}
function applyAccent(a){
  state.data.settings.accent = a;
  document.documentElement.setAttribute('data-accent', a);
  $$('.accent-swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === a));
  scheduleSave();
}
function applyRadius(r){
  state.data.settings.radius = r;
  document.documentElement.setAttribute('data-radius', String(r));
  $$('.theme-pill[data-radius]').forEach(b => b.classList.toggle('active', +b.dataset.radius === r));
  scheduleSave();
}
function applyFontFamily(family){
  state.data.settings.fontFamily = family;
  document.documentElement.style.setProperty('--font-ui', `'${family}','Inter',system-ui,sans-serif`);
  const sel = $('#fontFamilySelect'); if(sel) sel.value = family;
  const s = $('#fontSample'); if(s) s.style.fontFamily = `'${family}',sans-serif`;
  scheduleSave();
}
function applyFontReader(family){
  state.data.settings.fontReader = family;
  document.documentElement.style.setProperty('--font-read', `'${family}',Georgia,serif`);
  const sel = $('#fontReaderSelect'); if(sel) sel.value = family;
  scheduleSave();
}
function applyFont(s){
  s = Math.max(12, Math.min(34, s));
  state.data.settings.fontSize = s;
  const t = $('#readerText'); if(t) t.style.fontSize = s + 'px';
  const fv = $('#fontValue'); if(fv) fv.textContent = s;
  const lbl = $('#fontSizeLbl'); if(lbl) lbl.textContent = s + ' px';
  scheduleSave();
}
function applyCompact(v){
  state.data.settings.compact = v;
  document.documentElement.setAttribute('data-compact', v ? 'true' : 'false');
  const sw = $('#switchCompact'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
}
function applyAnim(v){
  state.data.settings.anim = v;
  document.documentElement.setAttribute('data-anim', v ? 'true' : 'false');
  const sw = $('#switchAnim'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
}
function applyToasts(v){
  state.data.settings.toasts = v;
  const sw = $('#switchToasts'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
}
function applyGlow(v){
  state.data.settings.glow = v;
  document.documentElement.setAttribute('data-glow', v ? 'true' : 'false');
  const sw = $('#switchGlow'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
}
function applyCols(n){
  state.data.settings.cols = n;
  document.documentElement.style.setProperty('--book-cols', String(n));
  $$('.theme-pill[data-cols]').forEach(b => b.classList.toggle('active', +b.dataset.cols === n));
  scheduleSave();
}
function applyLogoutConfirm(v){
  state.data.settings.logoutConfirm = v;
  const sw = $('#switchLogoutConfirm'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
}
function applyHideRead(v){
  state.data.settings.hideRead = v;
  const sw = $('#switchHideRead'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
  renderBooks();
}
function applyAvatars(v){
  state.data.settings.avatars = v;
  const sw = $('#switchAvatars'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
}
function applySaveScroll(v){
  state.data.settings.saveScroll = v;
  const sw = $('#switchSaveScroll'); if(sw) sw.classList.toggle('on', v);
  scheduleSave();
}
function syncAllUISettings(){
  const s = state.data.settings;
  applyTheme(s.theme); applyAccent(s.accent); applyRadius(s.radius);
  applyFontFamily(s.fontFamily); applyFontReader(s.fontReader); applyFont(s.fontSize);
  applyCompact(s.compact); applyAnim(s.anim); applyToasts(s.toasts); applyGlow(s.glow);
  applyCols(s.cols); applyLogoutConfirm(s.logoutConfirm); applyHideRead(s.hideRead);
  applyAvatars(s.avatars); applySaveScroll(s.saveScroll);
}

/* ============================================================
   ЛОАДЕР / ЧАСЫ
   ============================================================ */
function showLoader(ms = 1400){
  const l = $('#loader');
  l.classList.remove('gone');
  return new Promise(r => setTimeout(() => { l.classList.add('gone'); r(); }, ms));
}
function startClock(){
  const t = $('#clockTime'), d = $('#clockDate');
  if(!t || !d) return;
  const tick = () => {
    const n = new Date();
    t.textContent = n.toLocaleTimeString('ru-RU', { hour12: false });
    d.textContent = n.toLocaleDateString('ru-RU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  };
  tick();
  setInterval(tick, 1000);
}

/* ============================================================
   ВКЛАДКИ
   ============================================================ */
const CRUMBS = {
  home: 'Главная', books: 'Произведения', history: 'История школы',
  users: 'Пользователи', tickets: 'Заявки', chat: 'Чат администраторов',
  add: 'Добавить книгу', settings: 'Настройки'
};
function setTab(tab){
  state.tab = tab;
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.mnav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const cr = $('#crumbCurrent'); if(cr) cr.textContent = CRUMBS[tab] || '';
  const sw = $('#searchWrap'); if(sw) sw.classList.toggle('disabled', tab !== 'books');
  if(tab === 'books') setTimeout(() => $('#searchInput').focus(), 100);
  if(tab === 'users') renderUsers();
  if(tab === 'tickets') renderTickets();
  if(tab === 'chat') renderChat();
  if(tab === 'add') updateAddTab();
}

/* ============================================================
   AUTH
   ============================================================ */
function isAdmin(){ return state.role === 'admin'; }
function showAuthOverlay(){
  $('#authOverlay').classList.remove('hidden');
  $('#app').classList.add('blurred');
  setTimeout(() => $('#authLogin').focus(), 120);
}
function hideAuthOverlay(){
  $('#authOverlay').classList.add('hidden');
  $('#app').classList.remove('blurred');
}
function requireAuth(reason){
  if(state.user) return true;
  toast(reason || 'Требуется вход в аккаунт', 'err');
  showAuthOverlay();
  return false;
}
function setAuthMode(m){
  state.authMode = m;
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.auth === m));
  const btn = $('#authSubmit');
  if(btn) btn.textContent = m === 'login' ? 'Войти' : 'Создать аккаунт';
  const err = $('#authError'); if(err) err.textContent = '';
}

async function submitAuth(e){
  e.preventDefault();
  const login = $('#authLogin').value.trim();
  const password = $('#authPassword').value;
  const err = $('#authError'); err.textContent = '';
  if(!/^[A-Za-z0-9_.\-]{3,32}$/.test(login)){ err.textContent = 'Логин: 3–32 символа (латиница, цифры, _ . -)'; return; }
  if(password.length < 6){ err.textContent = 'Пароль не короче 6 символов'; return; }

  const btn = $('#authSubmit');
  const old = btn.textContent;
  btn.textContent = '…'; btn.disabled = true;

  try{
    const path = state.authMode === 'login' ? '/api/login' : '/api/register';
    const res = await api(path, { method: 'POST', body: { login, password } });
    state.user = res.user;
    state.role = res.role || 'user';
    localStorage.removeItem('lib73_skipped');

    const dr = await api('/api/data').catch(() => ({ data: defaultData() }));
    const kept = JSON.parse(JSON.stringify(state.data.settings || {}));
    state.data = Object.assign(defaultData(), dr.data || {});
    state.data.settings = Object.assign(state.data.settings, kept);
    await api('/api/data', { method: 'POST', body: state.data }).catch(() => {});

    renderUserSlot(); updateStats(); renderBooks();
    hideAuthOverlay(); syncAllUISettings(); updateAdminUI();
    toast(state.authMode === 'login' ? 'Добро пожаловать' : 'Аккаунт создан', 'ok');
    updateTimeStat();
    startSelfPolling();
  }catch(err2){
    err.textContent = err2.message;
    const card = document.querySelector('.auth-card');
    if(card) card.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' },
       { transform: 'translateX(9px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-in-out' }
    );
  }finally{
    btn.textContent = old; btn.disabled = false;
  }
}

function skipAuth(){
  localStorage.setItem('lib73_skipped', '1');
  hideAuthOverlay();
}

async function logout(){
  if(state.data.settings.logoutConfirm && !confirm('Выйти из аккаунта?')) return;
  stopSelfPolling();
  try { await api('/api/logout', { method: 'POST' }); } catch(e){}
  location.reload();
}

function renderUserSlot(){
  const slot = $('#userSlot');
  if(!slot) return;
  if(state.user){
    const av = state.data.profile.avatar;
    const letter = state.user.charAt(0).toUpperCase();
    const role = isAdmin() ? 'ADMIN' : '';
    slot.innerHTML = `
      <div class="user-chip" id="userChip">
        <div class="user-avatar ${av ? 'has-img' : ''}" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : letter}</div>
        <span class="user-name">${esc(state.user)}</span>
        ${role ? `<span class="user-role">${role}</span>` : ''}
      </div>
      <button class="btn btn-ghost btn-small btn-full" id="logoutBtn">Выйти</button>`;
    $('#logoutBtn').addEventListener('click', logout);
    $('#userChip').addEventListener('click', openProfileModal);
  }else{
    slot.innerHTML = `<button class="btn btn-primary btn-small btn-full" id="loginBtn">Войти в аккаунт</button>`;
    $('#loginBtn').addEventListener('click', showAuthOverlay);
  }
  const tb = $('#topbarLogin');
  if(tb) tb.classList.toggle('hidden', !!state.user);
}

function updateAdminUI(){
  const isAdm = isAdmin();
  const navChat = $('#navChat');
  const mnavChat = $('#mnavChat');
  if(navChat) navChat.classList.toggle('hidden', !isAdm);
  if(mnavChat) mnavChat.classList.toggle('hidden', !isAdm);
  if(state.tab === 'chat' && !isAdm) setTab('home');
  updateAddTab();
}

/* ============================================================
   КНИГИ
   ============================================================ */
function isFav(id){ return (state.data.favorites || []).includes(id); }

function renderBooks(){
  const wrap = $('#booksList'); if(!wrap) return;
  const q = state.search.trim().toLowerCase();
  let list = state.books.filter(b => !q || (b.title + ' ' + b.author + ' ' + b.year).toLowerCase().includes(q));
  if(state.filter === 'local')    list = list.filter(b => b.kind !== 'external' && b.kind !== 'pdf');
  if(state.filter === 'uploaded') list = list.filter(b => b.uploaded);
  if(state.filter === 'pdf')      list = list.filter(b => b.kind === 'pdf');
  if(state.filter === 'external') list = list.filter(b => b.kind === 'external');
  if(state.filter === 'fav')      list = list.filter(b => isFav(b.id));
  if(state.data.settings.hideRead && state.user){
    const rb = state.data.profile.readBooks || [];
    list = list.filter(b => !rb.includes(b.id));
  }

  wrap.innerHTML = '';
  $('#booksCount').textContent = list.length;
  $('#booksEmpty').classList.toggle('hidden', list.length > 0);

  list.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'book-card';
    el.style.animationDelay = Math.min(i * 18, 300) + 'ms';
    let tag = '';
    if(b.uploaded) tag = '<span class="book-tag uploaded">Загружено</span>';
    else if(b.kind === 'pdf') tag = '<span class="book-tag pdf">PDF</span>';
    else if(b.kind === 'external') tag = '<span class="book-tag external">Внешн.</span>';
    const fav = state.user ? isFav(b.id) : false;
    el.innerHTML = `
      <div class="book-badges">${tag}</div>
      <button class="book-fav ${fav ? 'on' : ''}" style="position:absolute;top:12px;right:12px;z-index:2;${tag ? 'display:none' : ''}">${fav ? '★' : '☆'}</button>
      <div class="book-title">${esc(b.title)}</div>
      <div class="book-meta"><span><b>${esc(b.author)}</b></span><span>·</span><span>${esc(String(b.year))}</span></div>`;
    el.addEventListener('click', e => { if(e.target.closest('.book-fav')) return; openBook(b.id); });
    const favBtn = el.querySelector('.book-fav');
    if(favBtn) favBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(!requireAuth('Войдите, чтобы добавить в избранное')) return;
      toggleFav(b.id);
      favBtn.classList.toggle('on', isFav(b.id));
      favBtn.textContent = isFav(b.id) ? '★' : '☆';
      updateStats();
    });
    wrap.appendChild(el);
  });
}

function toggleFav(id){
  const i = state.data.favorites.indexOf(id);
  if(i >= 0) state.data.favorites.splice(i, 1);
  else state.data.favorites.push(id);
  scheduleSave();
}

function updateStats(){
  const sb = $('#statBooks'); if(sb) sb.textContent = state.books.length;
  const su = $('#statUsers'); if(su) su.textContent = state.users.length || 0;
  const fv = $('#psFav'); if(fv) fv.textContent = state.user ? (state.data.favorites || []).length : 0;
}

/* ============================================================
   ПОЛЬЗОВАТЕЛИ
   ============================================================ */
function fmtTime(ms){
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if(h > 0) return h + 'ч';
  if(m > 0) return m + 'м';
  return '—';
}
function fmtLastOnline(ts){
  const diff = Date.now() - ts;
  if(diff < 60000) return 'сейчас';
  if(diff < 3600000) return Math.floor(diff / 60000) + 'м';
  if(diff < 86400000) return Math.floor(diff / 3600000) + 'ч';
  return Math.floor(diff / 86400000) + 'д';
}

async function loadUsers(){
  try{
    const r = await api('/api/users');
    state.users = (r.users || []).map(u => ({
      login: u.login, role: u.role, bio: u.bio, readBooks: u.readBooks,
      timeTotal: u.timeTotal, lastOnline: u.lastOnline,
      banned: u.banned, muted: u.muted, protected: u.protected,
      password: u.password,
    }));
  }catch(e){ state.users = []; }
}

function renderUsers(){
  const wrap = $('#usersList'); if(!wrap) return;
  const arr = [...state.users];
  if(state.sortBy === 'alpha')       arr.sort((a, b) => a.login.localeCompare(b.login, 'ru'));
  else if(state.sortBy === 'time')   arr.sort((a, b) => (b.timeTotal || 0) - (a.timeTotal || 0));
  else if(state.sortBy === 'online') arr.sort((a, b) => (b.lastOnline || 0) - (a.lastOnline || 0));

  $('#usersCount').textContent = arr.length;
  wrap.innerHTML = '';

  const isAdm = isAdmin();
  const canSeePasswords = state.user === ADMIN_LOGIN;

  arr.forEach(u => {
    const isSelf = state.user === u.login;
    const isProtected = u.login === ADMIN_LOGIN;
    const el = document.createElement('div');
    el.className = 'user-row' + (u.banned ? ' banned' : '') + (u.muted ? ' muted' : '');
    const letter = u.login.charAt(0).toUpperCase();
    const statusLabel = u.banned ? '<span class="ur-role banned">BAN</span>' :
                       u.muted  ? '<span class="ur-role muted">MUTE</span>' : '';
    const roleLabel = u.role === 'admin' ? '<span class="ur-role admin">ADMIN</span>' : '';
    const protLabel = isProtected ? '<span class="ur-role protected">ROOT</span>' : '';

    let pwdBlock = '';
    if(canSeePasswords){
      const pwd = u.password || '—';
      pwdBlock = `<div class="ur-password">
        <span>пароль:</span>
        <b class="pwd-hidden" data-pwd="${esc(pwd)}">••••••••</b>
        <button class="ur-action eye" data-act="revealPwd">👁</button>
      </div>`;
    }

    el.innerHTML = `
      <div class="ur-avatar">${letter}</div>
      <div class="ur-info">
        <div class="ur-name">${esc(u.login)} ${roleLabel} ${protLabel} ${statusLabel}</div>
        <div class="ur-bio">${esc(u.bio || 'Без описания')}</div>
        ${pwdBlock}
      </div>
      <div class="ur-stats">
        <div class="ur-stat"><b>${(u.readBooks || []).length}</b>книг</div>
        <div class="ur-stat"><b>${fmtTime(u.timeTotal || 0)}</b>на сайте</div>
        <div class="ur-stat"><b>${fmtLastOnline(u.lastOnline || 0)}</b>онлайн</div>
      </div>
      ${isAdm && !isSelf && !isProtected ? `
        <div class="ur-actions">
          <button class="ur-action" data-act="${u.muted ? 'unmute' : 'mute'}">${u.muted ? '▲' : '▼'}</button>
          <button class="ur-action ${u.banned ? '' : 'danger'}" data-act="${u.banned ? 'unban' : 'ban'}">${u.banned ? '✓' : '⊘'}</button>
          <button class="ur-action" data-act="${u.role === 'admin' ? 'demote' : 'promote'}">${u.role === 'admin' ? '★' : '☆'}</button>
          <button class="ur-action danger" data-act="delete">×</button>
        </div>` : ''}`;

    if(canSeePasswords){
      const b = el.querySelector('[data-act="revealPwd"]');
      if(b) b.addEventListener('click', e => {
        e.stopPropagation();
        const p = el.querySelector('.pwd-hidden');
        if(p.textContent.startsWith('•')){ p.textContent = p.dataset.pwd; p.style.color = 'var(--err)'; }
        else { p.textContent = '••••••••'; p.style.color = ''; }
      });
    }

    if(isAdm && !isSelf && !isProtected){
      el.querySelectorAll('.ur-action[data-act]:not([data-act="revealPwd"])').forEach(btn => {
        btn.addEventListener('click', async () => {
          const act = btn.dataset.act;
          if(act === 'delete' && !confirm(`Удалить ${u.login}?`)) return;
          try{
            await api('/api/user/' + encodeURIComponent(u.login) + '/action',
              { method: 'POST', body: { action: act } });
            toast('Готово', 'ok');
            await loadUsers(); renderUsers(); renderChatAdmins();
          }catch(e){ toast(e.message, 'err'); }
        });
      });
    }
    wrap.appendChild(el);
  });
}

/* ============================================================
   ЗАЯВКИ
   ============================================================ */
async function loadTickets(){
  try{ const r = await api('/api/tickets'); state.tickets = r.tickets || []; }
  catch(e){ state.tickets = []; }
}
function renderTickets(){
  const wrap = $('#ticketsList'); if(!wrap) return;
  const arr = [...(state.tickets || [])].sort((a, b) => b.ts - a.ts);
  $('#ticketsCount').textContent = arr.length;
  const unresolved = arr.filter(t => !t.resolved).length;
  const tb = $('#ticketsBadge'); if(tb){ tb.textContent = unresolved; tb.classList.toggle('new', unresolved > 0); }
  const md = $('#mTicketDot'); if(md) md.classList.toggle('hidden', unresolved === 0);
  wrap.innerHTML = '';
  if(!arr.length){
    wrap.innerHTML = '<div class="ticket-empty"><p>Заявок пока нет.</p></div>';
    return;
  }
  arr.forEach(t => {
    const el = document.createElement('div');
    el.className = 'ticket' + (t.resolved ? ' resolved' : '');
    el.innerHTML = `
      <div class="ticket-status"></div>
      <div class="ticket-body">
        <div class="ticket-title">${esc(t.title)}</div>
        <div class="ticket-meta">от ${esc(t.author)} · ${new Date(t.ts).toLocaleString('ru-RU')}</div>
        <div class="ticket-text">${esc(t.body)}</div>
      </div>`;
    wrap.appendChild(el);
  });
}

/* ============================================================
   ЧАТ АДМИНОВ
   ============================================================ */
async function loadChat(){
  try{ const r = await api('/api/chat'); state.chat = r.chat || []; }
  catch(e){ state.chat = []; }
}
function updateChatBadge(){
  const pending = (state.chat || []).filter(m => (m.kind === 'ticket' || m.kind === 'report') && !m.resolved).length;
  const b = $('#chatBadge'); if(b){ b.textContent = pending; b.classList.toggle('new', pending > 0); }
  const d = $('#mChatDot'); if(d) d.classList.toggle('hidden', pending === 0);
}
async function renderChat(){
  if(!isAdmin()) return;
  await loadChat();
  const wrap = $('#chatMessages');
  if(!wrap) return;
  const meta = $('#chatMeta'); if(meta) meta.textContent = `${(state.chat || []).length} / 100`;
  wrap.innerHTML = '';
  if(!(state.chat || []).length){
    wrap.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:40px 0">Чат пуст. Здесь появятся заявки и жалобы.</div>';
    renderChatAdmins(); updateChatBadge();
    return;
  }
  state.chat.forEach(msg => {
    const el = document.createElement('div');
    el.className = 'chat-msg' +
      (msg.author === state.user && msg.kind === 'msg' ? ' own' : '') +
      (msg.resolved ? ' resolved' : '');

    if(msg.kind === 'msg'){
      const av = msg.author === 'sys' ? 'S' : msg.author.charAt(0).toUpperCase();
      el.innerHTML = `
        <div class="chat-msg-avatar ${msg.author === 'sys' ? 'sys' : (msg.author === state.user ? 'own' : '')}">${esc(av)}</div>
        <div class="chat-msg-body">
          <div class="chat-msg-head">
            <span class="chat-msg-author">${esc(msg.author)}</span>
            <span>${new Date(msg.ts).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })}</span>
          </div>
          <div class="chat-msg-text">${esc(msg.text)}</div>
        </div>`;
    }else if(msg.kind === 'ticket'){
      const doneMark = msg.resolved ? ' · РЕШЕНО' : '';
      el.innerHTML = `
        <div class="chat-msg-avatar sys">S</div>
        <div class="chat-msg-body"><div class="chat-msg-sys">
          <div class="sys-head ${msg.resolved ? 'done' : 'ticket'}">✦ ЗАЯВКА${doneMark}</div>
          <div class="sys-body"><b>${esc(msg.meta.title)}</b>\n\n${esc(msg.meta.body)}\n\nот: @${esc(msg.meta.from)}</div>
          <div class="sys-actions">
            ${!msg.resolved ? `<button class="btn btn-ghost btn-tiny" data-act="resolve" data-id="${esc(msg.id)}">Решено ✓</button>` : ''}
            <button class="btn btn-ghost btn-tiny" data-act="delete" data-id="${esc(msg.id)}">Удалить</button>
          </div>
        </div></div>`;
    }else if(msg.kind === 'report'){
      const doneMark = msg.resolved ? ' · РЕШЕНО' : '';
      el.innerHTML = `
        <div class="chat-msg-avatar sys">S</div>
        <div class="chat-msg-body"><div class="chat-msg-sys">
          <div class="sys-head ${msg.resolved ? 'done' : 'report'}">⚠ ЖАЛОБА${doneMark}</div>
          <div class="sys-body">От: @${esc(msg.meta.reporter)}\nНа: @${esc(msg.meta.commentAuthor)}\nПричина: <b>${esc(msg.meta.reason)}</b>\n\n«${esc(msg.meta.commentText)}»</div>
          <div class="sys-actions">
            ${!msg.resolved ? `<button class="btn btn-ghost btn-tiny" data-act="resolve" data-id="${esc(msg.id)}">Решено ✓</button>` : ''}
            <button class="btn btn-ghost btn-tiny" data-act="delete" data-id="${esc(msg.id)}">Удалить</button>
          </div>
        </div></div>`;
    }
    wrap.appendChild(el);
  });

  wrap.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id, act = btn.dataset.act;
      try{
        if(act === 'resolve') await api('/api/chat/resolve', { method:'POST', body:{ id } });
        else if(act === 'delete') await api('/api/chat/delete', { method:'POST', body:{ id } });
        await renderChat();
        toast('Готово', 'ok');
      }catch(e){ toast(e.message, 'err'); }
    });
  });
  setTimeout(() => { wrap.scrollTop = wrap.scrollHeight; }, 20);
  renderChatAdmins();
  updateChatBadge();
}
function renderChatAdmins(){
  const wrap = $('#chatAdmins'); if(!wrap) return;
  const admins = state.users.filter(u => u.role === 'admin');
  wrap.innerHTML = '';
  admins.forEach(a => {
    const online = a.login === state.user || (a.lastOnline && Date.now() - a.lastOnline < 5 * 60 * 1000);
    const el = document.createElement('div');
    el.className = 'chat-admin';
    el.innerHTML = `
      <div class="chat-admin-av">${esc(a.login.charAt(0).toUpperCase())}</div>
      <div class="chat-admin-name">${esc(a.login)}${a.login === ADMIN_LOGIN ? ' <span style="font-size:9px;color:var(--accent);font-weight:700">ROOT</span>' : ''}</div>
      <div class="${online ? 'online' : 'offline'}"></div>`;
    wrap.appendChild(el);
  });
}

/* ============================================================
   ПРОФИЛЬ
   ============================================================ */
function openProfileModal(){
  if(!requireAuth('Войдите, чтобы открыть профиль')) return;
  const d = state.data;
  const av = d.profile.avatar;
  $('#profileAvatar').className = 'profile-avatar' + (av ? ' has-img' : '');
  $('#profileAvatar').style.backgroundImage = av ? `url('${av}')` : '';
  $('#profileAvatar').textContent = av ? '' : state.user.charAt(0).toUpperCase();
  $('#profileName').textContent = state.user;
  $('#profileRole').textContent = isAdmin() ? 'Администратор' : 'Читатель';
  $('#psRead').textContent = (d.profile.readBooks || []).length;
  $('#psFav').textContent = (d.favorites || []).length;
  $('#psTime').textContent = fmtTime(d.stats.timeTotal || 0);
  $('#profileBio').value = d.profile.bio || '';
  $('#oldPass').value = ''; $('#newPass').value = ''; $('#newPass2').value = '';
  $('#passError').textContent = '';
  renderReadBooks();
  $('#profileModal').classList.remove('hidden');
}
function renderReadBooks(){
  const list = state.data.profile.readBooks || [];
  const wrap = $('#readBooksList'); wrap.innerHTML = '';
  if(!list.length){
    wrap.innerHTML = '<div style="font-size:12px;color:var(--muted)">Пока ничего не отмечено</div>';
    return;
  }
  list.forEach(id => {
    const book = state.books.find(b => b.id === id);
    const title = book ? book.title : id;
    const el = document.createElement('div');
    el.className = 'rb-chip';
    el.innerHTML = `${esc(title)} <span class="rm">×</span>`;
    el.querySelector('.rm').addEventListener('click', () => {
      state.data.profile.readBooks = state.data.profile.readBooks.filter(x => x !== id);
      scheduleSave();
      renderReadBooks();
    });
    wrap.appendChild(el);
  });
}
function handleAvatarUpload(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('Только изображения', 'err'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
      state.data.profile.avatar = canvas.toDataURL('image/jpeg', 0.85);
      scheduleSave();
      openProfileModal();
      renderUserSlot();
      toast('Аватар обновлён', 'ok');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function changePassword(){
  const err = $('#passError'); err.textContent = '';
  const oldP = $('#oldPass').value;
  const n1 = $('#newPass').value;
  const n2 = $('#newPass2').value;
  if(!oldP || !n1 || !n2){ err.textContent = 'Заполните все поля'; return; }
  if(n1.length < 6){ err.textContent = 'Новый пароль не короче 6 символов'; return; }
  if(n1 !== n2){ err.textContent = 'Пароли не совпадают'; return; }
  try{
    await api('/api/change_password', { method:'POST', body: { old: oldP, new: n1 } });
    $('#oldPass').value = ''; $('#newPass').value = ''; $('#newPass2').value = '';
    toast('Пароль изменён', 'ok');
  }catch(e){ err.textContent = e.message; }
}

/* ============================================================
   ЧИТАЛКА
   ============================================================ */
function openBook(id){
  if(id.startsWith('wiki:')){ openExternalBook(id); return; }
  api('/api/book?id=' + encodeURIComponent(id)).then(r => {
    if(r.book) mountReader(r.book);
  }).catch(e => toast(e.message, 'err'));
}
async function openExternalBook(id){
  toast('Загрузка из Викитеки…');
  try{
    const r = await api('/api/book?id=' + encodeURIComponent(id));
    mountReader(r.book);
  }catch(e){ toast(e.message, 'err'); }
}
function mountReader(book){
  state.currentBook = book;
  state.currentText = book.text || '';
  $('#readerTitle').textContent = book.title;
  $('#readerSub').textContent = `${book.author} · ${book.year}`;
  const on = state.user && isFav(book.id);
  $('#readerFav').textContent = on ? '★' : '☆';
  $('#readerFav').classList.toggle('on', on);
  applyFont(state.data.settings.fontSize);
  renderText(); renderNotes(); renderLegend();
  $('#reader').classList.remove('hidden');
  $('#notesPanel').classList.add('collapsed');
  if(state.user && state.data.settings.saveScroll){
    const saved = state.data.readScroll[book.id] || 0;
    if(saved) setTimeout(() => { $('#readerText').scrollTop = saved; }, 80);
  }
}
function closeReader(){
  if(state.currentBook && state.user && state.data.settings.saveScroll){
    state.data.readScroll[state.currentBook.id] = $('#readerText').scrollTop;
    scheduleSave();
  }
  $('#reader').classList.add('hidden');
  state.currentBook = null;
  hideSel();
}
function renderText(){
  const el = $('#readerText'); if(!state.currentBook) return;
  const hls = state.user
    ? (state.data.highlights[state.currentBook.id] || []).slice().sort((a, b) => a.start - b.start)
    : [];
  let html = '', pos = 0;
  for(const h of hls){
    if(h.start < pos) continue;
    if(h.start >= state.currentText.length) break;
    const end = Math.min(h.end, state.currentText.length);
    html += esc(state.currentText.slice(pos, h.start));
    html += `<mark class="hl" data-color="${esc(h.color)}" data-start="${h.start}" data-end="${end}">${esc(state.currentText.slice(h.start, end))}</mark>`;
    pos = end;
  }
  html += esc(state.currentText.slice(pos));
  html += '<div class="comments-section" id="commentsSection"></div>';
  el.innerHTML = html;
  el.querySelectorAll('mark.hl').forEach(m => {
    m.addEventListener('click', () => {
      if(!requireAuth('Войдите, чтобы убрать выделение')) return;
      const s = +m.dataset.start, e = +m.dataset.end, bid = state.currentBook.id;
      state.data.highlights[bid] = (state.data.highlights[bid] || []).filter(h => !(h.start === s && h.end === e));
      scheduleSave(); renderText(); renderLegend();
    });
  });
  renderCommentsInPlace();
}
async function renderCommentsInPlace(){
  const wrap = $('#commentsSection'); if(!wrap) return;
  const bid = state.currentBook.id;
  let list = [];
  if(!bid.startsWith('wiki:')){
    try{ const r = await api('/api/comments?book=' + encodeURIComponent(bid)); list = r.comments || []; }
    catch(e){ list = []; }
  }
  const canComment = state.user && (state.data.profile.readBooks || []).includes(bid);
  const isAdm = isAdmin();
  const showAv = state.data.settings.avatars;

  wrap.innerHTML = `
    <div class="comments-head"><h4>Комментарии</h4><span class="comments-count">${list.length}</span></div>
    ${canComment ? `
      <div class="comment-form">
        <textarea id="commentInput" placeholder="Поделись впечатлением…" maxlength="800"></textarea>
        <button class="btn btn-primary btn-small" id="commentSubmit">Отправить</button>
      </div>` : state.user ? `
      <div class="comments-locked">Комментарии могут оставлять только те, кто отметил это произведение как прочитанное.</div>` : `
      <div class="comments-locked">Войдите и отметьте произведение как прочитанное, чтобы оставить комментарий.</div>`}
    <div class="comments-list" id="commentsList"></div>`;

  const listWrap = $('#commentsList');
  if(!list.length){
    listWrap.innerHTML = '<div style="font-size:12.5px;color:var(--muted);text-align:center;padding:14px 0">Комментариев пока нет</div>';
  }else{
    [...list].sort((a, b) => b.ts - a.ts).forEach(c => {
      const el = document.createElement('div');
      el.className = 'comment';
      const ownComment = c.author === state.user;
      const canDelete = isAdm || ownComment;
      const canReport = state.user && !ownComment && !isAdm;
      const av = showAv ? `<div class="comment-avatar">${esc(c.author.charAt(0).toUpperCase())}</div>` : '';
      el.innerHTML = `
        ${av}
        <div class="comment-body">
          <div class="comment-head">
            <span class="comment-author">${esc(c.author)}</span>
            <span class="comment-date">${new Date(c.ts).toLocaleString('ru-RU')}</span>
            <div class="comment-actions">
              ${canReport ? '<button class="comment-action report" data-act="report">пожаловаться</button>' : ''}
              ${canDelete ? '<button class="comment-action" data-act="delete">удалить</button>' : ''}
            </div>
          </div>
          <div class="comment-text">${esc(c.text)}</div>
        </div>`;
      const rb = el.querySelector('[data-act="report"]');
      const db = el.querySelector('[data-act="delete"]');
      if(rb) rb.addEventListener('click', () => openReportModal(c));
      if(db) db.addEventListener('click', async () => {
        try{
          await api('/api/comments/delete', { method:'POST', body: { book: bid, id: c.id } });
          renderCommentsInPlace();
          toast('Комментарий удалён');
        }catch(e){ toast(e.message, 'err'); }
      });
      listWrap.appendChild(el);
    });
  }

  const sub = $('#commentSubmit');
  if(sub) sub.addEventListener('click', async () => {
    const txt = $('#commentInput').value.trim(); if(!txt) return;
    try{
      await api('/api/comments', { method:'POST', body: { book: bid, text: txt } });
      renderCommentsInPlace();
      toast('Комментарий добавлен', 'ok');
    }catch(e){ toast(e.message, 'err'); }
  });
}
function openReportModal(comment){
  if(!requireAuth('Войдите, чтобы пожаловаться')) return;
  state.reportTarget = comment;
  $('#reportCommentPreview').textContent = `Автор: ${comment.author}\nКомментарий: «${comment.text}»`;
  $('#reportReason').value = '';
  $('#reportError').textContent = '';
  $('#reportModal').classList.remove('hidden');
}
async function submitReport(){
  const reason = $('#reportReason').value.trim();
  if(!reason){ $('#reportError').textContent = 'Укажите причину'; return; }
  const c = state.reportTarget;
  if(!c){ $('#reportModal').classList.add('hidden'); return; }
  try{
    await api('/api/report', { method:'POST', body: { book: state.currentBook.id, id: c.id, reason } });
    $('#reportModal').classList.add('hidden');
    toast('Жалоба отправлена администраторам', 'ok');
    state.reportTarget = null;
  }catch(e){ $('#reportError').textContent = e.message; }
}

/* ============================================================
   ЗАГРУЗКА КНИГ (АДМИН)
   ============================================================ */
function updateAddTab(){
  const isAdm = isAdmin();
  const panel = $('#adminUploadPanel');
  const userHint = $('#userUploadHint');
  const infoText = $('#addInfoText');
  if(!panel) return;
  if(isAdm){
    panel.classList.remove('hidden');
    userHint.classList.add('hidden');
    infoText.innerHTML = 'Загружайте файлы напрямую. Имя файла — <code>Автор - Название (год).txt</code>.';
  }else{
    panel.classList.add('hidden');
    userHint.classList.remove('hidden');
    infoText.innerHTML = 'Прямая загрузка на сайт доступна только администраторам. Остальные оставляют <b>заявку</b> во вкладке «Заявки».';
  }
}
async function uploadFile(file){
  const queue = $('#uploadQueue');
  const item = document.createElement('div');
  item.className = 'upload-item';
  const sizeKb = (file.size / 1024).toFixed(1);
  item.innerHTML = `
    <div class="ui-name">${esc(file.name)}</div>
    <div class="ui-size">${sizeKb} КБ</div>
    <div class="ui-status uploading" data-status>загрузка…</div>`;
  queue.appendChild(item);
  try{
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method:'POST', body: fd, credentials:'same-origin' });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Ошибка');
    item.classList.add('ok');
    const st = item.querySelector('[data-status]');
    st.textContent = 'ГОТОВО'; st.classList.remove('uploading'); st.classList.add('ok');
    setTimeout(() => { if(item.parentNode) item.parentNode.removeChild(item); }, 2000);
    await loadBooks();
    renderBooks(); updateStats();
  }catch(e){
    item.classList.add('err');
    const st = item.querySelector('[data-status]');
    st.textContent = 'ОШИБКА'; st.classList.remove('uploading'); st.classList.add('err');
    toast(e.message, 'err');
  }
}
function handleFileUpload(files){
  if(!isAdmin()){ toast('Только для администраторов', 'err'); return; }
  Array.from(files || []).forEach(uploadFile);
}

/* ============================================================
   ПАСХАЛКА
   ============================================================ */
let logoClicks = 0, logoResetTimer = null, easterTimer = null, faceTimer = null;
const EG_FACES = [':3', '>_<', 'o_o', '^_^', '-_-', ':D', ';3', '>_>', '<_<', 'Ò_Ó', '¬_¬', ':P'];
function triggerEaster(){
  const egg = $('#easter');
  if(egg.classList.contains('show')) return;
  egg.classList.add('show');
  let i = 0;
  $('#egBall').textContent = EG_FACES[0];
  faceTimer = setInterval(() => { i = (i + 1) % EG_FACES.length; $('#egBall').textContent = EG_FACES[i]; }, 550);
  setTimeout(() => egg.classList.add('dance'), 50);
  clearTimeout(easterTimer);
  easterTimer = setTimeout(() => {
    egg.classList.remove('dance');
    setTimeout(() => { egg.classList.remove('show'); clearInterval(faceTimer); }, 500);
  }, 10000);
}

/* ============================================================
   ЭКСПОРТ / ИМПОРТ / СБРОС
   ============================================================ */
function exportData(){
  if(!state.user){ toast('Войдите в аккаунт', 'err'); return; }
  const blob = new Blob(
    [JSON.stringify({ exported: new Date().toISOString(), login: state.user, data: state.data }, null, 2)],
    { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lib73_${state.user}_${Date.now()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Экспортировано', 'ok');
}
function importData(file){
  if(!file) return;
  const r = new FileReader();
  r.onload = async e => {
    try{
      const parsed = JSON.parse(e.target.result);
      if(!parsed.data){ toast('Неверный файл', 'err'); return; }
      if(!confirm('Заменить текущие данные профиля?')) return;
      const keep = state.data.settings;
      state.data = Object.assign(defaultData(), parsed.data);
      state.data.settings = Object.assign(state.data.settings, keep);
      await api('/api/data', { method:'POST', body: state.data });
      renderBooks(); updateStats();
      toast('Данные импортированы', 'ok');
    }catch(err){ toast('Ошибка чтения файла', 'err'); }
  };
  r.readAsText(file);
}
function resetUIPrefs(){
  const d = defaultData().settings;
  state.data.settings = Object.assign(state.data.settings, d);
  syncAllUISettings();
  scheduleSave();
  toast('Настройки интерфейса сброшены', 'ok');
}
async function resetAllData(){
  if(!state.user){ toast('Войдите в аккаунт', 'err'); return; }
  if(!confirm('Удалить ВСЕ данные профиля? Это необратимо.')) return;
  state.data = defaultData();
  state.data.role = state.role;
  await api('/api/data', { method:'POST', body: state.data });
  renderBooks(); updateStats();
  toast('Данные профиля удалены', 'ok');
}

/* ============================================================
   ПОЛЛИНГ СОСТОЯНИЯ (бан / мут / роль / сессия)
   ============================================================ */
let selfState = { user: null, role: null, banned: false, muted: false };
let pollTimer = null;
let banOverlayShown = false;

async function pollSelfState(){
  try{
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if(!r.ok) return;
    const me = await r.json();

    // 1. Сессия потеряна
    if(selfState.user && !me.user){
      toast('Сессия завершена. Перезагрузка…', 'err');
      setTimeout(() => location.reload(), 900);
      return;
    }

    // 2. Только что забанили
    if(me.user && me.banned && !selfState.banned){
      selfState.banned = true;
      if(state.data) state.data.banned = true;
      showBanOverlay();
      setTimeout(() => location.reload(), 2500);
      return;
    }

    // 3. Разбанили
    if(me.user && !me.banned && selfState.banned){
      toast('Аккаунт разблокирован', 'ok');
      setTimeout(() => location.reload(), 900);
      return;
    }

    // 4. Изменилась роль
    if(me.user && me.role !== selfState.role){
      const wasAdmin = selfState.role === 'admin';
      selfState.role = me.role;
      state.role = me.role;
      updateAdminUI();
      if(isAdmin()) renderChat();
      toast(wasAdmin ? 'Права администратора сняты' : 'Вы назначены администратором', 'ok');
    }

    // 5. Изменился мут
    if(me.user && !!me.muted !== selfState.muted){
      selfState.muted = !!me.muted;
      if(state.data) state.data.muted = selfState.muted;
      toast(selfState.muted ? 'Вам запрещено отправлять заявки' : 'Мут снят',
            selfState.muted ? 'err' : 'ok');
    }

    // 6. Подменили сессию
    if(me.user && selfState.user && me.user !== selfState.user){
      location.reload();
      return;
    }

    if(me.user){
      selfState.user = me.user;
      if(selfState.role === null) selfState.role = me.role;
      selfState.banned = !!me.banned;
      selfState.muted  = !!me.muted;
    }else{
      selfState.user = null;
      selfState.role = null;
    }
  }catch(e){ /* сеть недоступна — повторим на следующем цикле */ }
}

function startSelfPolling(){
  stopSelfPolling();
  selfState = {
    user: state.user,
    role: state.role || null,
    banned: !!(state.data && state.data.banned),
    muted:  !!(state.data && state.data.muted),
  };
  pollTimer = setInterval(pollSelfState, 15000);
  setTimeout(pollSelfState, 1500);
}
function stopSelfPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
}
function showBanOverlay(){
  if(banOverlayShown) return;
  banOverlayShown = true;
  const el = document.createElement('div');
  el.id = 'banOverlay';
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999',
    'display:flex', 'align-items:center', 'justify-content:center',
    'flex-direction:column', 'gap:16px',
    'background:rgba(10,10,10,.92)', 'backdrop-filter:blur(10px)',
    'color:#e07070', 'font-family:var(--font-ui,system-ui,sans-serif)',
    'text-align:center', 'padding:20px',
  ].join(';');
  el.innerHTML = `
    <div style="font-size:56px;line-height:1">⊘</div>
    <div style="font-size:22px;font-weight:700;letter-spacing:-.3px">Аккаунт заблокирован</div>
    <div style="font-size:14px;color:#aaa;max-width:420px;line-height:1.65">
      Ваш аккаунт заблокирован администратором.<br>
      Страница будет перезагружена автоматически.
    </div>
    <div style="font-size:12px;color:#666;margin-top:8px">Перезагрузка через пару секунд…</div>`;
  document.body.appendChild(el);
}

/* ============================================================
   INIT
   ============================================================ */
async function loadBooks(){
  try{ const r = await api('/api/books'); state.books = r.books || []; }
  catch(e){ state.books = []; }
}

let timeTick = null;
function updateTimeStat(){
  if(timeTick) clearInterval(timeTick);
  timeTick = setInterval(() => {
    if(state.user && document.visibilityState === 'visible'){
      state.data.stats.timeTotal = (state.data.stats.timeTotal || 0) + 1000;
      state.data.stats.lastOnline = Date.now();
      if(Math.random() < 0.05) scheduleSave();
    }
  }, 1000);
}

async function boot(){
  state.data = defaultData();
  startClock();
  setTab('home');
  setAuthMode('login');
  bindEvents();

  const loaderP = showLoader(1400);

  const [me, booksR, usersR, ticketsR] = await Promise.all([
    api('/api/me').catch(() => ({ user: null })),
    api('/api/books').catch(() => ({ books: [] })),
    api('/api/users').catch(() => ({ users: [] })),
    api('/api/tickets').catch(() => ({ tickets: [] })),
  ]);

  state.books = booksR.books || [];
  state.users = (usersR.users || []).map(u => ({
    login: u.login, role: u.role, bio: u.bio,
    readBooks: u.readBooks, timeTotal: u.timeTotal, lastOnline: u.lastOnline,
    banned: u.banned, muted: u.muted, protected: u.protected, password: u.password,
  }));
  state.tickets = ticketsR.tickets || [];

  if(me.user){
    state.user = me.user;
    state.role = me.role || 'user';
    const dr = await api('/api/data').catch(() => ({ data: defaultData() }));
    state.data = Object.assign(defaultData(), dr.data || {});
  }

  syncAllUISettings();
  renderUserSlot(); updateStats(); renderBooks();

  // ✅ Фикс: показываем/скрываем админ-элементы (чат, загрузку, бейджи)
  updateAdminUI();

  // ✅ Фикс: если гость — прячем вкладку чата принудительно
  if(!state.user){
    const navChat = $('#navChat');   if(navChat)   navChat.classList.add('hidden');
    const mnavChat = $('#mnavChat'); if(mnavChat)  mnavChat.classList.add('hidden');
  }

  if(isAdmin()) await renderChat();
  else updateChatBadge();

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if(state.data.settings.theme === 'auto') applyTheme('auto');
  });

  await loaderP;
  $('#app').classList.remove('hidden');

  // ✅ Запускаем поллинг состояния
  startSelfPolling();

  if(!state.user && !localStorage.getItem('lib73_skipped')){
    setTimeout(showAuthOverlay, 500);
  }
}

/* ============================================================
   СОБЫТИЯ
   ============================================================ */
function bindEvents(){
  $('#authForm').addEventListener('submit', submitAuth);
  $$('.auth-tab').forEach(t => t.addEventListener('click', () => setAuthMode(t.dataset.auth)));
  $('#authClose').addEventListener('click', hideAuthOverlay);
  $('#authSkip').addEventListener('click', skipAuth);
  $('#topbarLogin').addEventListener('click', showAuthOverlay);

  $$('.nav-item').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('.mnav-item[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  $$('.theme-pill[data-theme-pick]').forEach(p => p.addEventListener('click', () => applyTheme(p.dataset.themePick)));
  $$('.accent-swatch').forEach(s => s.addEventListener('click', () => applyAccent(s.dataset.accent)));
  $$('.theme-pill[data-radius]').forEach(b => b.addEventListener('click', () => applyRadius(+b.dataset.radius)));
  $$('.theme-pill[data-cols]').forEach(b => b.addEventListener('click', () => applyCols(+b.dataset.cols)));

  $('#fontFamilySelect').addEventListener('change', e => applyFontFamily(e.target.value));
  $('#fontReaderSelect').addEventListener('change', e => applyFontReader(e.target.value));
  $('#fontMinusSet').addEventListener('click', () => applyFont(state.data.settings.fontSize - 1));
  $('#fontPlusSet').addEventListener('click', () => applyFont(state.data.settings.fontSize + 1));

  $('#switchCompact').addEventListener('click', () => applyCompact(!state.data.settings.compact));
  $('#switchAnim').addEventListener('click', () => applyAnim(!state.data.settings.anim));
  $('#switchToasts').addEventListener('click', () => applyToasts(!state.data.settings.toasts));
  $('#switchGlow').addEventListener('click', () => applyGlow(!state.data.settings.glow));
  $('#switchLogoutConfirm').addEventListener('click', () => applyLogoutConfirm(!state.data.settings.logoutConfirm));
  $('#switchHideRead').addEventListener('click', () => applyHideRead(!state.data.settings.hideRead));
  $('#switchAvatars').addEventListener('click', () => applyAvatars(!state.data.settings.avatars));
  $('#switchSaveScroll').addEventListener('click', () => applySaveScroll(!state.data.settings.saveScroll));

  $('#exportData').addEventListener('click', exportData);
  $('#importDataBtn').addEventListener('click', () => $('#importDataInput').click());
  $('#importDataInput').addEventListener('change', e => { importData(e.target.files[0]); e.target.value = ''; });
  $('#resetUIPrefs').addEventListener('click', resetUIPrefs);
  $('#resetAllData').addEventListener('click', resetAllData);

  $$('.filter-chip').forEach(c => c.addEventListener('click', () => {
    $$('.filter-chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    state.filter = c.dataset.filter;
    renderBooks();
  }));
  $$('.sort-btn').forEach(b => b.addEventListener('click', () => {
    $$('.sort-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.sortBy = b.dataset.sort;
    renderUsers();
  }));

  $('#searchInput').addEventListener('input', e => { state.search = e.target.value; renderBooks(); });

  $('#readerFontMinus').addEventListener('click', () => applyFont(state.data.settings.fontSize - 1));
  $('#readerFontPlus').addEventListener('click', () => applyFont(state.data.settings.fontSize + 1));

  $('#readerClose').addEventListener('click', closeReader);
  $('#readerFav').addEventListener('click', () => {
    if(!state.currentBook) return;
    if(!requireAuth('Войдите, чтобы добавить в избранное')) return;
    toggleFav(state.currentBook.id);
    const on = isFav(state.currentBook.id);
    $('#readerFav').textContent = on ? '★' : '☆';
    $('#readerFav').classList.toggle('on', on);
    renderBooks(); updateStats();
  });
  $('#readerNotesBtn').addEventListener('click', () => {
    if(!requireAuth('Войдите, чтобы вести заметки')) return;
    $('#notesPanel').classList.toggle('collapsed');
  });
  $('#notesClose').addEventListener('click', () => $('#notesPanel').classList.add('collapsed'));

  $('#noteAdd').addEventListener('click', () => {
    if(!state.currentBook) return;
    if(!requireAuth('Войдите, чтобы добавлять заметки')) return;
    const text = $('#noteInput').value.trim(); if(!text) return;
    const bid = state.currentBook.id;
    (state.data.notes[bid] = state.data.notes[bid] || []).push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text, ts: Date.now()
    });
    $('#noteInput').value = '';
    scheduleSave();
    renderNotes();
    toast('Заметка добавлена', 'ok');
  });

  document.addEventListener('mouseup', e => {
    if($('#reader').classList.contains('hidden')) return;
    if(e.target.closest('.sel-toolbar') || e.target.closest('.notes-panel')) return;
    if(e.target.closest('.comments-section')) return;
    setTimeout(() => {
      const off = getSelOffsets($('#readerText'));
      if(!off){ hideSel(); return; }
      showSel(window.getSelection().getRangeAt(0).getBoundingClientRect());
    }, 10);
  });
  $('#selToolbar').addEventListener('mousedown', e => e.preventDefault());
  $$('.sel-color').forEach(b => b.addEventListener('click', () => {
    if(!state.currentBook) return;
    if(!requireAuth('Войдите, чтобы выделять текст')){ hideSel(); return; }
    const off = getSelOffsets($('#readerText')); if(!off){ hideSel(); return; }
    const bid = state.currentBook.id;
    state.data.highlights[bid] = (state.data.highlights[bid] || []).filter(h => h.end <= off.start || h.start >= off.end);
    state.data.highlights[bid].push({ start: off.start, end: off.end, color: b.dataset.color });
    scheduleSave();
    window.getSelection().removeAllRanges();
    hideSel();
    renderText(); renderLegend();
  }));
  document.addEventListener('mousedown', e => {
    if(!e.target.closest('.sel-toolbar') && !e.target.closest('#readerText')) hideSel();
  });
  $('#readerText').addEventListener('scroll', hideSel);

  $('#profileClose').addEventListener('click', () => $('#profileModal').classList.add('hidden'));
  $('#profileAvatarEdit').addEventListener('click', () => $('#avatarInput').click());
  $('#avatarInput').addEventListener('change', e => handleAvatarUpload(e.target.files[0]));
  $('#profileSave').addEventListener('click', () => {
    state.data.profile.bio = $('#profileBio').value.trim();
    scheduleSave();
    toast('Профиль сохранён', 'ok');
    $('#profileModal').classList.add('hidden');
  });
  $('#changePassBtn').addEventListener('click', changePassword);
  $('#profileLogout').addEventListener('click', logout);
  $('#addReadBtn').addEventListener('click', openAddReadModal);
  $('#addReadClose').addEventListener('click', () => $('#addReadModal').classList.add('hidden'));

  $('#reportClose').addEventListener('click', () => { $('#reportModal').classList.add('hidden'); state.reportTarget = null; });
  $('#reportSubmit').addEventListener('click', submitReport);

  $('#ticketSubmit').addEventListener('click', async () => {
    if(!requireAuth('Войдите, чтобы оставить заявку')) return;
    const title = $('#ticketTitle').value.trim();
    const body = $('#ticketBody').value.trim();
    if(!title || !body){ toast('Заполните тему и описание', 'err'); return; }
    try{
      await api('/api/tickets', { method:'POST', body: { title, body } });
      $('#ticketTitle').value = ''; $('#ticketBody').value = '';
      await loadTickets(); renderTickets();
      toast('Заявка отправлена администратору', 'ok');
    }catch(e){ toast(e.message, 'err'); }
  });

  $('#chatSend').addEventListener('click', sendChatMessage);
  $('#chatInput').addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendChatMessage(); }
  });

  const uz = $('#uploadZone'), ui = $('#uploadInput');
  if(uz){
    uz.addEventListener('click', () => ui.click());
    ui.addEventListener('change', e => { handleFileUpload(e.target.files); e.target.value = ''; });
    uz.addEventListener('dragover', e => { e.preventDefault(); uz.classList.add('drag'); });
    uz.addEventListener('dragleave', () => uz.classList.remove('drag'));
    uz.addEventListener('drop', e => {
      e.preventDefault();
      uz.classList.remove('drag');
      handleFileUpload(e.dataTransfer.files);
    });
  }

  $('#brandLogo').addEventListener('click', () => {
    logoClicks++;
    clearTimeout(logoResetTimer);
    logoResetTimer = setTimeout(() => { logoClicks = 0; }, 1500);
    if(logoClicks >= 7){ logoClicks = 0; triggerEaster(); }
  });

  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(!$('#reportModal').classList.contains('hidden')){ $('#reportModal').classList.add('hidden'); state.reportTarget = null; return; }
    if(!$('#profileModal').classList.contains('hidden')){ $('#profileModal').classList.add('hidden'); return; }
    if(!$('#addReadModal').classList.contains('hidden')){ $('#addReadModal').classList.add('hidden'); return; }
    if(!$('#authOverlay').classList.contains('hidden')){
      if(localStorage.getItem('lib73_skipped')) hideAuthOverlay(); else skipAuth();
      return;
    }
    if(!$('#reader').classList.contains('hidden')) closeReader();
  });

  // пауза поллинга при уходе с вкладки, возобновление при возврате
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && state.user){
      if(!pollTimer) startSelfPolling();
      else pollSelfState();
    }
  });
}

async function sendChatMessage(){
  if(!isAdmin()){ toast('Только для администраторов', 'err'); return; }
  const inp = $('#chatInput');
  const txt = inp.value.trim(); if(!txt) return;
  try{
    await api('/api/chat', { method:'POST', body: { text: txt } });
    inp.value = '';
    await renderChat();
  }catch(e){ toast(e.message, 'err'); }
}

function openAddReadModal(){
  const wrap = $('#addReadList'); wrap.innerHTML = '';
  const notRead = state.books.filter(b => !(state.data.profile.readBooks || []).includes(b.id));
  if(!notRead.length){
    wrap.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px">Все книги уже отмечены</div>';
  }else{
    notRead.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn btn-ghost';
      el.style.cssText = 'text-align:left;justify-content:flex-start;width:100%';
      el.textContent = `${b.title} — ${b.author}`;
      el.addEventListener('click', () => {
        state.data.profile.readBooks.push(b.id);
        scheduleSave();
        renderReadBooks();
        $('#addReadModal').classList.add('hidden');
        toast('Отмечено как прочитанное', 'ok');
      });
      wrap.appendChild(el);
    });
  }
  $('#addReadModal').classList.remove('hidden');
}

/* ============================================================
   ВЫДЕЛЕНИЕ ТЕКСТА (утилиты)
   ============================================================ */
function getSelOffsets(container){
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if(!container.contains(r.startContainer) || !container.contains(r.endContainer)) return null;
  const s = offsetOf(container, r.startContainer, r.startOffset);
  const e = offsetOf(container, r.endContainer, r.endOffset);
  if(s === null || e === null || s >= e) return null;
  return { start: s, end: e };
}
function offsetOf(root, node, offset){
  if(node.nodeType === 3){
    let total = 0;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while((n = w.nextNode())){ if(n === node) return total + offset; total += n.nodeValue.length; }
    return null;
  }
  if(node.nodeType === 1){
    const target = node.childNodes[offset] || null;
    let total = 0;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while((n = w.nextNode())){
      if(target && (target === n || (target.nodeType === 1 && target.contains(n)))) return total;
      total += n.nodeValue.length;
    }
    return total;
  }
  return null;
}
function showSel(rect){
  const tb = $('#selToolbar'); tb.classList.remove('hidden');
  tb.style.left = Math.max(110, Math.min(window.innerWidth - 110, rect.left + rect.width / 2)) + 'px';
  tb.style.top = Math.max(60, rect.top - 8) + 'px';
  requestAnimationFrame(() => tb.classList.add('show'));
}
function hideSel(){
  const tb = $('#selToolbar');
  tb.classList.remove('show');
  setTimeout(() => tb.classList.add('hidden'), 220);
}

/* ============================================================
   ЗАМЕТКИ / ЛЕГЕНДА ВЫДЕЛЕНИЙ
   ============================================================ */
function renderNotes(){
  if(!state.currentBook) return;
  const list = state.user ? (state.data.notes[state.currentBook.id] || []) : [];
  const wrap = $('#notesList');
  wrap.innerHTML = '';
  if(!list.length){
    wrap.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:12px 0">Заметок пока нет</div>';
    return;
  }
  [...list].reverse().forEach(n => {
    const el = document.createElement('div'); el.className = 'note-item';
    const d = n.ts ? new Date(n.ts).toLocaleString('ru-RU') : '';
    el.innerHTML = `<button class="note-del">×</button><div>${esc(n.text)}</div><div class="note-date">${esc(d)}</div>`;
    el.querySelector('.note-del').addEventListener('click', () => {
      const bid = state.currentBook.id;
      state.data.notes[bid] = (state.data.notes[bid] || []).filter(x => x.id !== n.id);
      scheduleSave(); renderNotes();
    });
    wrap.appendChild(el);
  });
}
function renderLegend(){
  if(!state.currentBook) return;
  const list = state.user ? (state.data.highlights[state.currentBook.id] || []) : [];
  const wrap = $('#hlLegend');
  wrap.innerHTML = '';
  if(!list.length){
    wrap.innerHTML = '<div style="font-size:11.5px;color:var(--muted)">Выделений пока нет</div>';
    return;
  }
  const C = { blue: '#6f9ce0', green: '#7ec87e', yellow: '#e0c878', pink: '#dc8cb4', violet: '#aa8cdc' };
  [...list].sort((a, b) => a.start - b.start).forEach(h => {
    const snip = state.currentText.slice(h.start, Math.min(h.end, h.start + 70));
    const el = document.createElement('div');
    el.className = 'hl-item';
    el.style.borderLeftColor = C[h.color] || '#6f9ce0';
    el.innerHTML = `<span class="hl-item-text">${esc(snip)}${h.end - h.start > 70 ? '…' : ''}</span><button class="hl-item-x">×</button>`;
    el.querySelector('.hl-item-x').addEventListener('click', () => {
      const bid = state.currentBook.id;
      state.data.highlights[bid] = (state.data.highlights[bid] || []).filter(x => !(x.start === h.start && x.end === h.end));
      scheduleSave(); renderText(); renderLegend();
    });
    wrap.appendChild(el);
  });
}

/* ============================================================
   СТАРТ
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await boot();
  updateTimeStat();
});

})();