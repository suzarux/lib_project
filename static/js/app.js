/* ============================================================
   Онлайн-библиотека — Школа №73
   by suzarux — demo v0.1.3 build 154304102026
   ============================================================ */
(() => {
'use strict';

/* ---------------- Утилиты ---------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
));

function toast(msg) {
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, 2200);
}

async function api(path, opts = {}) {
  const cfg = {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };
  if (opts.body !== undefined) cfg.body = JSON.stringify(opts.body);
  const res = await fetch(path, cfg);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

/* ---------------- Состояние ---------------- */
const state = {
  user: null,                 // null = гость
  books: [],
  backgrounds: [],
  bgBag: [],
  bgCurrent: null,
  bgToggle: false,
  currentBook: null,
  data: { favorites: [], notes: {}, highlights: {}, settings: { theme: 'dark', fontSize: 18 } },
  tab: 'home',
  search: '',
  authMode: 'login',
};

const LS = {
  theme:   'lib73_theme',
  font:    'lib73_font',
  skipped: 'lib73_skipped_auth',
};

/* ---- Глобальные настройки UI (тема/шрифт) — работают и для гостя ---- */
function loadUIPrefs() {
  const t = localStorage.getItem(LS.theme);
  const f = parseInt(localStorage.getItem(LS.font), 10);
  if (t === 'light' || t === 'dark') state.data.settings.theme = t;
  if (Number.isFinite(f) && f >= 12 && f <= 34) state.data.settings.fontSize = f;
}
function saveUIPrefs() {
  localStorage.setItem(LS.theme, state.data.settings.theme);
  localStorage.setItem(LS.font, String(state.data.settings.fontSize));
}

/* ---- Сохранение данных авторизованного пользователя ---- */
let saveTimer = null;
function scheduleSave() {
  if (!state.user) return;    // гость ничего не отправляет
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/data', { method: 'POST', body: state.data }).catch(() => {});
  }, 420);
}

/* ============================================================
   ТЕМА / ШРИФТ
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.data.settings.theme = theme;
  saveUIPrefs();
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (state.user) scheduleSave();
}
function applyFontSize(size) {
  size = Math.max(12, Math.min(34, size));
  state.data.settings.fontSize = size;
  const t = $('#readerText');
  if (t) t.style.fontSize = size + 'px';
  $('#fontValue').textContent = size;
  saveUIPrefs();
  if (state.user) scheduleSave();
}

/* ============================================================
   LOADER / 3D CUBE
   ============================================================ */
function showLoader(minMs = 1800) {
  const loader = $('#loader');
  loader.classList.remove('gone');
  return new Promise(resolve => {
    setTimeout(() => {
      loader.classList.add('gone');
      resolve();
    }, minMs);
  });
}

/* ============================================================
   ФОНЫ
   ============================================================ */
function refillBag() {
  const arr = [...state.backgrounds];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  state.bgBag = arr;
}
function nextBackground() {
  if (!state.backgrounds.length) return;
  if (!state.bgBag.length) refillBag();
  let url = state.bgBag.pop();
  if (url === state.bgCurrent && state.bgBag.length) {
    state.bgBag.unshift(url);
    url = state.bgBag.pop();
  }
  state.bgCurrent = url;
  const a = $('#bgA'), b = $('#bgB');
  const incoming = state.bgToggle ? a : b;
  const outgoing = state.bgToggle ? b : a;
  incoming.style.backgroundImage = `url("${url}")`;
  incoming.classList.add('show');
  outgoing.classList.remove('show');
  state.bgToggle = !state.bgToggle;
}
function startBackgrounds(list) {
  state.backgrounds = list || [];
  if (!state.backgrounds.length) return;
  refillBag();
  nextBackground();
  setInterval(nextBackground, 30000);
}

/* ============================================================
   ЧАСЫ
   ============================================================ */
function startClock() {
  const timeEl = $('#clockTime'), dateEl = $('#clockDate');
  const tick = () => {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('ru-RU', { hour12: false });
    dateEl.textContent = now.toLocaleDateString('ru-RU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  };
  tick();
  setInterval(tick, 1000);
}

/* ============================================================
   ВКЛАДКИ
   ============================================================ */
const CRUMBS = { home: 'Главная', books: 'Произведения', add: 'Добавить произведение' };

function setTab(tab) {
  state.tab = tab;
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.mnav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#crumbCurrent').textContent = CRUMBS[tab] || '';
  const sw = $('#searchWrap');
  sw.classList.toggle('disabled', tab !== 'books');
  if (tab === 'books') setTimeout(() => $('#searchInput').focus(), 120);
}

/* ============================================================
   ТРЕБУЕТСЯ ВХОД
   ============================================================ */
function requireAuth(reason) {
  if (state.user) return true;
  toast(reason || 'Требуется вход в аккаунт');
  showAuthOverlay();
  return false;
}

/* ============================================================
   AUTH OVERLAY
   ============================================================ */
function showAuthOverlay() {
  const ov = $('#authOverlay');
  ov.classList.remove('hidden');
  $('#app').classList.add('blurred');
  setTimeout(() => $('#authLogin').focus(), 150);
}
function hideAuthOverlay() {
  const ov = $('#authOverlay');
  ov.classList.add('hidden');
  $('#app').classList.remove('blurred');
}
function setAuthMode(mode) {
  state.authMode = mode;
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.auth === mode));
  $('#authSubmit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  $('#authError').textContent = '';
}

async function submitAuth(e) {
  e.preventDefault();
  const login = $('#authLogin').value.trim();
  const password = $('#authPassword').value;
  const errEl = $('#authError');
  errEl.textContent = '';
  const btn = $('#authSubmit');
  const old = btn.textContent;
  btn.textContent = '…';
  btn.disabled = true;
  try {
    const path = state.authMode === 'login' ? '/api/login' : '/api/register';
    const res = await api(path, { method: 'POST', body: { login, password } });
    state.user = res.user;
    localStorage.removeItem(LS.skipped);

    const { data } = await api('/api/data').catch(() => ({ data: state.data }));
    // сохраняем локальные UI-настройки поверх серверных
    const localTheme = state.data.settings.theme;
    const localFont  = state.data.settings.fontSize;
    state.data = Object.assign(
      { favorites: [], notes: {}, highlights: {}, settings: { theme: localTheme, fontSize: localFont } },
      data
    );
    state.data.settings.theme = localTheme || state.data.settings.theme;
    state.data.settings.fontSize = localFont || state.data.settings.fontSize;

    renderUserSlot();
    updateStats();
    renderBooks();
    hideAuthOverlay();
    toast(state.authMode === 'login' ? 'Добро пожаловать' : 'Аккаунт создан');
  } catch (err) {
    errEl.textContent = err.message;
    const card = document.querySelector('.auth-card');
    card.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' },
       { transform: 'translateX(9px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-in-out' }
    );
  } finally {
    btn.textContent = old;
    btn.disabled = false;
  }
}

function skipAuth() {
  localStorage.setItem(LS.skipped, '1');
  hideAuthOverlay();
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  location.reload();
}

/* ---- Сайдбар: слот пользователя ---- */
function renderUserSlot() {
  const slot = $('#userSlot');
  if (state.user) {
    slot.innerHTML = `
      <div class="user-chip">
        <span class="user-avatar">${escapeHtml(state.user.charAt(0).toUpperCase())}</span>
        <span class="user-name">${escapeHtml(state.user)}</span>
      </div>
      <button class="btn btn-ghost btn-small btn-full" id="logoutBtn">Выйти</button>`;
    $('#logoutBtn').addEventListener('click', logout);
  } else {
    slot.innerHTML = `
      <button class="btn btn-primary btn-small btn-full" id="loginBtn">Войти</button>`;
    $('#loginBtn').addEventListener('click', showAuthOverlay);
  }
}

/* ============================================================
   КНИГИ
   ============================================================ */
function isFav(id) { return state.data.favorites.includes(id); }

function renderBooks() {
  const q = state.search.trim().toLowerCase();
  const list = state.books.filter(b => {
    if (!q) return true;
    return (b.title + ' ' + b.author + ' ' + b.year).toLowerCase().includes(q);
  });

  const wrap = $('#booksList');
  const empty = $('#booksEmpty');
  wrap.innerHTML = '';
  $('#booksCount').textContent = list.length;

  if (!list.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'book-card';
    el.style.animationDelay = Math.min(i * 22, 400) + 'ms';
    el.innerHTML = `
      <button class="book-fav ${isFav(b.id) ? 'on' : ''}" title="В избранное">${isFav(b.id) ? '★' : '☆'}</button>
      <div class="book-title">${escapeHtml(b.title)}</div>
      <div class="book-meta">
        <span><b>${escapeHtml(b.author)}</b></span>
        <span>·</span>
        <span>${escapeHtml(String(b.year))}</span>
      </div>`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.book-fav')) return;
      openBook(b.id);
    });
    el.querySelector('.book-fav').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!requireAuth('Войдите, чтобы добавить в избранное')) return;
      toggleFavorite(b.id);
      const btn = e.currentTarget;
      btn.classList.toggle('on', isFav(b.id));
      btn.textContent = isFav(b.id) ? '★' : '☆';
      updateStats();
    });
    wrap.appendChild(el);
  });
}

function toggleFavorite(id) {
  const idx = state.data.favorites.indexOf(id);
  if (idx >= 0) state.data.favorites.splice(idx, 1);
  else state.data.favorites.push(id);
  scheduleSave();
}

function updateStats() {
  $('#statBooks').textContent = state.books.length;
  $('#statFav').textContent = state.user ? state.data.favorites.length : 0;
}

/* ============================================================
   ЧИТАЛКА
   ============================================================ */
let currentText = '';

async function openBook(id) {
  try {
    const { book } = await api('/api/book?id=' + encodeURIComponent(id));
    state.currentBook = book;
    currentText = book.text || '';

    $('#readerTitle').textContent = book.title;
    $('#readerSub').textContent = `${book.author} · ${book.year}`;
    const on = state.user && isFav(book.id);
    $('#readerFav').textContent = on ? '★' : '☆';
    $('#readerFav').classList.toggle('on', on);

    applyFontSize(state.data.settings.fontSize);
    renderReaderText();
    renderNotes();
    renderHighlightsLegend();

    $('#reader').classList.remove('hidden');
    $('#notesPanel').classList.add('collapsed');
  } catch (e) {
    toast(e.message);
  }
}

function closeReader() {
  $('#reader').classList.add('hidden');
  state.currentBook = null;
  hideSelToolbar();
}

/* --- Отрисовка текста с выделениями --- */
function renderReaderText() {
  const el = $('#readerText');
  if (!state.currentBook) return;
  const hls = state.user
    ? (state.data.highlights[state.currentBook.id] || []).slice().sort((a, b) => a.start - b.start)
    : [];

  let html = '';
  let pos = 0;
  for (const h of hls) {
    if (h.start < pos) continue;
    if (h.start >= currentText.length) break;
    const end = Math.min(h.end, currentText.length);
    html += escapeHtml(currentText.slice(pos, h.start));
    html += `<mark class="hl" data-color="${escapeHtml(h.color)}" data-start="${h.start}" data-end="${end}">`
          + escapeHtml(currentText.slice(h.start, end)) + '</mark>';
    pos = end;
  }
  html += escapeHtml(currentText.slice(pos));
  el.innerHTML = html;

  el.querySelectorAll('mark.hl').forEach(m => {
    m.addEventListener('click', () => {
      const s = +m.dataset.start, e = +m.dataset.end;
      const arr = state.data.highlights[state.currentBook.id] || [];
      state.data.highlights[state.currentBook.id] =
        arr.filter(h => !(h.start === s && h.end === e));
      scheduleSave();
      renderReaderText();
      renderHighlightsLegend();
    });
  });
}

/* --- Определение offset'ов выделения --- */
function offsetOf(root, node, offset) {
  if (node.nodeType === 3) {
    let total = 0;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n === node) return total + offset;
      total += n.nodeValue.length;
    }
    return null;
  }
  if (node.nodeType === 1) {
    const children = node.childNodes;
    const target = children[offset] || null;
    let total = 0;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (target && (target === n || (target.nodeType === 1 && target.contains(n)))) return total;
      total += n.nodeValue.length;
    }
    return total;
  }
  return null;
}

function getSelectionOffsets(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const start = offsetOf(container, range.startContainer, range.startOffset);
  const end = offsetOf(container, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return null;
  return { start, end };
}

/* --- Плавающий тулбар выделения --- */
function showSelToolbar(rect) {
  const tb = $('#selToolbar');
  tb.classList.remove('hidden');
  const x = Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2));
  const y = Math.max(70, rect.top - 10);
  tb.style.left = x + 'px';
  tb.style.top = y + 'px';
  requestAnimationFrame(() => tb.classList.add('show'));
}
function hideSelToolbar() {
  const tb = $('#selToolbar');
  tb.classList.remove('show');
  setTimeout(() => tb.classList.add('hidden'), 260);
}

/* ============================================================
   ЗАМЕТКИ
   ============================================================ */
function renderNotes() {
  if (!state.currentBook) return;
  const list = state.user ? (state.data.notes[state.currentBook.id] || []) : [];
  const wrap = $('#notesList');
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = '<div style="font-size:12.5px;color:var(--muted);text-align:center;padding:14px 0">Заметок пока нет</div>';
    return;
  }
  [...list].reverse().forEach(n => {
    const el = document.createElement('div');
    el.className = 'note-item';
    const d = n.ts ? new Date(n.ts).toLocaleString('ru-RU') : '';
    el.innerHTML = `<button class="note-del" title="Удалить">×</button>
      <div>${escapeHtml(n.text)}</div>
      <div class="note-date">${escapeHtml(d)}</div>`;
    el.querySelector('.note-del').addEventListener('click', () => {
      const bid = state.currentBook.id;
      state.data.notes[bid] = (state.data.notes[bid] || []).filter(x => x.id !== n.id);
      scheduleSave();
      renderNotes();
    });
    wrap.appendChild(el);
  });
}

function renderHighlightsLegend() {
  if (!state.currentBook) return;
  const list = state.user ? (state.data.highlights[state.currentBook.id] || []) : [];
  const wrap = $('#hlLegend');
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--muted)">Выделений пока нет</div>';
    return;
  }
  const COLORS = { blue: '#4da3ff', green: '#48d597', yellow: '#ffd166', pink: '#ff7eb6', violet: '#a98bff' };
  [...list].sort((a, b) => a.start - b.start).forEach(h => {
    const snippet = currentText.slice(h.start, Math.min(h.end, h.start + 70));
    const el = document.createElement('div');
    el.className = 'hl-item';
    el.style.borderLeftColor = COLORS[h.color] || '#4da3ff';
    el.innerHTML = `<span class="hl-item-text">${escapeHtml(snippet)}${h.end - h.start > 70 ? '…' : ''}</span>
      <button class="hl-item-x">×</button>`;
    el.querySelector('.hl-item-x').addEventListener('click', () => {
      const bid = state.currentBook.id;
      state.data.highlights[bid] = (state.data.highlights[bid] || [])
        .filter(x => !(x.start === h.start && x.end === h.end));
      scheduleSave();
      renderReaderText();
      renderHighlightsLegend();
    });
    wrap.appendChild(el);
  });
}

/* ============================================================
   ЗАПУСК
   ============================================================ */
async function boot() {
  loadUIPrefs();
  applyTheme(state.data.settings.theme);
  applyFontSize(state.data.settings.fontSize);
  startClock();
  setTab('home');
  setAuthMode('login');
  bindEvents();

  // Параллельно: лоадер + сетевые запросы
  const loaderPromise = showLoader(1900);

  const [booksRes, bgRes, meRes] = await Promise.all([
    api('/api/books').catch(() => ({ books: [] })),
    api('/api/backgrounds').catch(() => ({ backgrounds: [] })),
    api('/api/me').catch(() => ({ user: null })),
  ]);

  state.books = booksRes.books || [];

  if (meRes.user) {
    state.user = meRes.user;
    const { data } = await api('/api/data').catch(() => ({ data: state.data }));
    const localTheme = state.data.settings.theme;
    const localFont  = state.data.settings.fontSize;
    state.data = Object.assign(
      { favorites: [], notes: {}, highlights: {}, settings: { theme: localTheme, fontSize: localFont } },
      data
    );
    state.data.settings.theme = localTheme || state.data.settings.theme;
    state.data.settings.fontSize = localFont || state.data.settings.fontSize;
  }

  // Отрисовка интерфейса
  renderUserSlot();
  updateStats();
  renderBooks();
  applyTheme(state.data.settings.theme);
  applyFontSize(state.data.settings.fontSize);

  await loaderPromise;
  $('#app').classList.remove('hidden');

  // Фоны запускаем чуть позже, чтобы они появились «за» интерфейсом
  setTimeout(() => startBackgrounds(bgRes.backgrounds || []), 250);

  // Показываем модалку авторизации, если нет сессии и не было skip
  if (!state.user && !localStorage.getItem(LS.skipped)) {
    setTimeout(showAuthOverlay, 700);
  }
}

/* ---------------- Event binding ---------------- */
function bindEvents() {
  // Auth
  $('#authForm').addEventListener('submit', submitAuth);
  $$('.auth-tab').forEach(t => t.addEventListener('click', () => setAuthMode(t.dataset.auth)));
  $('#authClose').addEventListener('click', hideAuthOverlay);
  $('#authSkip').addEventListener('click', skipAuth);

  // Nav
  $$('.nav-item').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('.mnav-item[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // Theme / Auth (мобильные)
  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#mobileTheme').addEventListener('click', toggleTheme);
  $('#mobileAuth').addEventListener('click', () => {
    if (state.user) logout();
    else showAuthOverlay();
  });

  // Search
  $('#searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderBooks();
  });

  // Font controls
  $('#fontMinus').addEventListener('click', () => applyFontSize(state.data.settings.fontSize - 1));
  $('#fontPlus').addEventListener('click', () => applyFontSize(state.data.settings.fontSize + 1));

  // Reader
  $('#readerClose').addEventListener('click', closeReader);
  $('#readerFav').addEventListener('click', () => {
    if (!state.currentBook) return;
    if (!requireAuth('Войдите, чтобы добавить в избранное')) return;
    toggleFavorite(state.currentBook.id);
    const on = isFav(state.currentBook.id);
    $('#readerFav').textContent = on ? '★' : '☆';
    $('#readerFav').classList.toggle('on', on);
    renderBooks();
    updateStats();
  });
  $('#readerFontMinus').addEventListener('click', () => applyFontSize(state.data.settings.fontSize - 1));
  $('#readerFontPlus').addEventListener('click', () => applyFontSize(state.data.settings.fontSize + 1));
  $('#readerNotesBtn').addEventListener('click', () => {
    if (!requireAuth('Войдите, чтобы вести заметки')) return;
    $('#notesPanel').classList.toggle('collapsed');
  });
  $('#notesClose').addEventListener('click', () => $('#notesPanel').classList.add('collapsed'));

  $('#noteAdd').addEventListener('click', () => {
    if (!state.currentBook) return;
    if (!requireAuth('Войдите, чтобы добавлять заметки')) return;
    const text = $('#noteInput').value.trim();
    if (!text) return;
    const bid = state.currentBook.id;
    if (!state.data.notes[bid]) state.data.notes[bid] = [];
    state.data.notes[bid].push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text,
      ts: Date.now(),
    });
    $('#noteInput').value = '';
    scheduleSave();
    renderNotes();
    toast('Заметка добавлена');
  });

  // Выделение текста
  document.addEventListener('mouseup', (e) => {
    if ($('#reader').classList.contains('hidden')) return;
    if (e.target.closest('.sel-toolbar') || e.target.closest('.notes-panel')) return;
    setTimeout(() => {
      const container = $('#readerText');
      const off = getSelectionOffsets(container);
      if (!off) { hideSelToolbar(); return; }
      // Если гость — показываем тулбар, но при клике по цвету попросим вход
      const sel = window.getSelection();
      showSelToolbar(sel.getRangeAt(0).getBoundingClientRect());
    }, 10);
  });

  $('#selToolbar').addEventListener('mousedown', (e) => e.preventDefault());
  $$('.sel-color').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.currentBook) return;
      if (!requireAuth('Войдите, чтобы выделять текст')) { hideSelToolbar(); return; }
      const container = $('#readerText');
      const off = getSelectionOffsets(container);
      if (!off) { hideSelToolbar(); return; }
      const bid = state.currentBook.id;
      if (!state.data.highlights[bid]) state.data.highlights[bid] = [];
      state.data.highlights[bid] = state.data.highlights[bid]
        .filter(h => h.end <= off.start || h.start >= off.end);
      state.data.highlights[bid].push({ start: off.start, end: off.end, color: btn.dataset.color });
      scheduleSave();
      window.getSelection().removeAllRanges();
      hideSelToolbar();
      renderReaderText();
      renderHighlightsLegend();
    });
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.sel-toolbar') && !e.target.closest('#readerText')) hideSelToolbar();
  });
  $('#readerText').addEventListener('scroll', hideSelToolbar);

  // ESC закрывает оверлеи
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#authOverlay').classList.contains('hidden')) {
      if (localStorage.getItem(LS.skipped)) hideAuthOverlay();
      else skipAuth();
    } else if (!$('#reader').classList.contains('hidden')) {
      closeReader();
    }
  });
}

document.addEventListener('DOMContentLoaded', boot);
})();