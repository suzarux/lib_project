# -*- coding: utf-8 -*-
"""
Онлайн-библиотека МБОУ «Школа №73 г.о. Самара»
by suzarux — demo v0.1.4 build 191906102026
"""
import os
import re
import io
import json
import time
import secrets
import hashlib
import threading
import zipfile
import mimetypes
import xml.etree.ElementTree as ET
from functools import wraps
from urllib.parse import urlencode
from urllib.request import urlopen, Request
from urllib.error import URLError

from flask import (Flask, request, session, jsonify, send_from_directory,
                   render_template, abort, send_file)

# ============================================================================
# КОНСТАНТЫ И ПУТИ
# ============================================================================
BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
LIB_DIR      = os.path.join(BASE_DIR, 'lib')
BG_DIR       = os.path.join(BASE_DIR, 'background')
USERDATA_DIR = os.path.join(BASE_DIR, 'userdata')
USERS_FILE   = os.path.join(BASE_DIR, 'users.txt')
SECRET_FILE  = os.path.join(BASE_DIR, '.secret_key')

CHAT_FILE     = os.path.join(USERDATA_DIR, 'chat.json')
TICKETS_FILE  = os.path.join(USERDATA_DIR, 'tickets.json')
COMMENTS_FILE = os.path.join(USERDATA_DIR, 'comments.json')

ALLOWED_BOOK_EXT = {'.txt', '.md', '.docx', '.pdf'}
ALLOWED_IMG_EXT  = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'}
LOGIN_RE         = re.compile(r'^[A-Za-z0-9_.\-]{3,32}$')

ADMIN_LOGIN = 'suzarux'          # вечный админ
CHAT_LIMIT  = 100                # максимальное количество сообщений в чате
WIKI_API    = 'https://ru.wikisource.org/w/api.php'
WIKI_TTL    = 3600               # кеш вики-запросов (сек)
BOOK_META_CACHE_TTL = 5          # кеш метаданных книг (сек)

for _d in (LIB_DIR, BG_DIR, USERDATA_DIR):
    os.makedirs(_d, exist_ok=True)

# ============================================================================
# ПРИЛОЖЕНИЕ
# ============================================================================
def _load_secret_key():
    if os.path.exists(SECRET_FILE):
        try:
            with open(SECRET_FILE, 'rb') as f:
                k = f.read()
            if len(k) >= 32:
                return k
        except OSError:
            pass
    key = secrets.token_bytes(48)
    try:
        with open(SECRET_FILE, 'wb') as f:
            f.write(key)
        try:
            os.chmod(SECRET_FILE, 0o600)
        except OSError:
            pass
    except OSError:
        pass
    return key


app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = _load_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_NAME='lib73_session',
    MAX_CONTENT_LENGTH=16 * 1024 * 1024,   # 16 МБ — с запасом под PDF
    JSON_AS_ASCII=False,
)

# ============================================================================
# УТИЛИТЫ БЕЗОПАСНОСТИ
# ============================================================================
_users_lock    = threading.RLock()
_chat_lock     = threading.RLock()
_tickets_lock  = threading.RLock()
_comments_lock = threading.RLock()
_attempts_lock = threading.Lock()
_attempts = {}     # ip -> [timestamps]

PBKDF2_ITERS = 120_000


def hash_password(password: str, salt: str = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                             salt.encode('utf-8'), PBKDF2_ITERS)
    return f"pbkdf2_sha256${salt}${dk.hex()}"


def verify_password(stored: str, password: str):
    """Возвращает (ok, needs_upgrade)."""
    try:
        algo, salt, digest = stored.split('$')
    except ValueError:
        return (secrets.compare_digest(stored, password), True)
    if algo != 'pbkdf2_sha256':
        return (False, False)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                             salt.encode('utf-8'), PBKDF2_ITERS)
    return (secrets.compare_digest(dk.hex(), digest), False)


def rate_limit_ok(ip: str, limit: int = 10, window: int = 300) -> bool:
    now = time.time()
    with _attempts_lock:
        arr = [t for t in _attempts.get(ip, []) if now - t < window]
        _attempts[ip] = arr
        return len(arr) < limit


def rate_limit_hit(ip: str):
    with _attempts_lock:
        _attempts.setdefault(ip, []).append(time.time())


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not session.get('user'):
            return jsonify(error='Требуется вход в аккаунт'), 401
        return fn(*a, **kw)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        u = session.get('user')
        if not u:
            return jsonify(error='Требуется вход в аккаунт'), 401
        if not is_admin(u):
            return jsonify(error='Только для администраторов'), 403
        return fn(*a, **kw)
    return wrapper


# ============================================================================
# USERS.TXT
# ============================================================================
def read_users():
    """
    Возвращает: {login: {'plain': str|None, 'hash': str, 'role': str|None}}
    Форматы строк:
        login - plain
        login - plain - hash
        login - plain - hash - role
    """
    users = {}
    if not os.path.exists(USERS_FILE):
        return users
    try:
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or ' - ' not in line:
                    continue
                parts = line.split(' - ', 3)
                login = parts[0].strip()
                plain = parts[1].strip() if len(parts) > 1 else None
                hsh   = parts[2].strip() if len(parts) > 2 else None
                role  = parts[3].strip() if len(parts) > 3 else None
                users[login] = {'plain': plain, 'hash': hsh, 'role': role}
    except OSError:
        pass
    return users


def write_users(users: dict):
    tmp = USERS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        for login, rec in users.items():
            plain = rec.get('plain')
            hsh = rec.get('hash')
            role = rec.get('role')
            parts = [login]
            if plain is not None:
                parts.append(plain)
            if hsh:
                if plain is None:
                    parts.append('')
                parts.append(hsh)
            if role:
                if len(parts) < 3:
                    parts.append('')
                parts.append(role)
            f.write(' - '.join(parts) + '\n')
    os.replace(tmp, USERS_FILE)


def ensure_hashed(login: str, plain: str):
    """При первом входе дописывает хеш пароля в users.txt."""
    with _users_lock:
        users = read_users()
        if login not in users:
            return
        if users[login].get('hash'):
            return
        users[login]['plain'] = users[login].get('plain') or plain
        users[login]['hash'] = hash_password(plain)
        write_users(users)


def authenticate(login: str, password: str):
    """Возвращает роль или None."""
    with _users_lock:
        users = read_users()
    rec = users.get(login)
    if not rec:
        return None
    if rec.get('hash'):
        ok, upgrade = verify_password(rec['hash'], password)
        if not ok:
            return None
        if upgrade:
            ensure_hashed(login, password)
    else:
        if not secrets.compare_digest(rec.get('plain') or '', password):
            return None
        ensure_hashed(login, password)

    if login == ADMIN_LOGIN:
        return 'admin'
    if rec.get('role') == 'admin':
        return 'admin'
    d = load_user_data(login)
    if d.get('role') == 'admin':
        return 'admin'
    return 'user'


def is_admin(login: str) -> bool:
    if login == ADMIN_LOGIN:
        return True
    if not login:
        return False
    with _users_lock:
        users = read_users()
    rec = users.get(login) or {}
    if rec.get('role') == 'admin':
        return True
    d = load_user_data(login)
    return d.get('role') == 'admin'


def set_user_role(login: str, role: str):
    """role: 'admin' | 'user'"""
    with _users_lock:
        users = read_users()
        if login not in users:
            return False
        users[login]['role'] = role
        write_users(users)
    d = load_user_data(login)
    d['role'] = role
    save_user_data(login, d)
    return True


def set_user_ban(login: str, banned: bool):
    d = load_user_data(login)
    d['banned'] = bool(banned)
    save_user_data(login, d)


def set_user_mute(login: str, muted: bool):
    d = load_user_data(login)
    d['muted'] = bool(muted)
    save_user_data(login, d)


def delete_user(login: str):
    with _users_lock:
        users = read_users()
        if login in users and login != ADMIN_LOGIN:
            del users[login]
            write_users(users)
    p = data_path(login)
    if os.path.exists(p):
        try:
            os.remove(p)
        except OSError:
            pass


# ============================================================================
# USERDATA
# ============================================================================
def _safe_login(login: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.\-]', '_', login)[:48]


def data_path(login: str) -> str:
    return os.path.join(USERDATA_DIR, _safe_login(login) + '.json')


def default_user_data() -> dict:
    return {
        'favorites': [], 'notes': {}, 'highlights': {}, 'readScroll': {},
        'settings': {
            'theme': 'dark', 'fontSize': 17, 'fontFamily': 'Inter',
            'fontReader': 'PT Serif',
            'compact': False, 'anim': True, 'toasts': True, 'cols': 2,
            'glow': True, 'accent': 'mono', 'radius': 1,
            'logoutConfirm': False, 'hideRead': False,
            'avatars': True, 'saveScroll': True,
        },
        'profile': {'bio': '', 'avatar': None, 'readBooks': []},
        'stats': {'timeTotal': 0, 'lastOnline': 0},
        'role': 'user', 'banned': False, 'muted': False,
    }


def load_user_data(login: str) -> dict:
    p = data_path(login)
    base = default_user_data()
    if not os.path.exists(p):
        return base
    try:
        with open(p, 'r', encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, json.JSONDecodeError):
        return base
    if not isinstance(d, dict):
        return base
    base.update({k: v for k, v in d.items() if k in base})
    if not isinstance(base['settings'], dict):
        base['settings'] = default_user_data()['settings']
    for k, v in default_user_data()['settings'].items():
        base['settings'].setdefault(k, v)
    return base


def _sanitize_settings(s: dict, base: dict) -> dict:
    out = dict(base)
    if not isinstance(s, dict):
        return out
    for k, default in base.items():
        v = s.get(k, default)
        if k == 'theme' and v in ('dark', 'light', 'auto'):
            out[k] = v
        elif k == 'fontSize':
            try:
                out[k] = max(12, min(34, int(v)))
            except (TypeError, ValueError):
                pass
        elif k in ('fontFamily', 'fontReader') and isinstance(v, str) and len(v) < 40:
            out[k] = v
        elif k in ('compact', 'anim', 'toasts', 'glow', 'logoutConfirm',
                   'hideRead', 'avatars', 'saveScroll'):
            out[k] = bool(v)
        elif k == 'cols':
            try:
                out[k] = max(1, min(3, int(v)))
            except (TypeError, ValueError):
                pass
        elif k == 'accent' and v in ('mono', 'blue', 'green', 'violet', 'pink'):
            out[k] = v
        elif k == 'radius':
            try:
                out[k] = max(0, min(2, int(v)))
            except (TypeError, ValueError):
                pass
    return out


def sanitize_user_data(d: dict) -> dict:
    out = default_user_data()
    if not isinstance(d, dict):
        return out

    if isinstance(d.get('favorites'), list):
        out['favorites'] = [str(x)[:260] for x in d['favorites'][:1000]]

    if isinstance(d.get('notes'), dict):
        for k, v in list(d['notes'].items())[:1500]:
            if isinstance(v, list):
                out['notes'][str(k)[:260]] = [
                    {
                        'id': str(n.get('id', ''))[:40],
                        'text': str(n.get('text', ''))[:5000],
                        'ts': int(n.get('ts', 0)) if str(n.get('ts', 0)).isdigit() else 0,
                    }
                    for n in v[:300] if isinstance(n, dict)
                ]

    if isinstance(d.get('highlights'), dict):
        for k, v in list(d['highlights'].items())[:1500]:
            if isinstance(v, list):
                clean = []
                for h in v[:800]:
                    if not isinstance(h, dict):
                        continue
                    try:
                        s, e = int(h.get('start')), int(h.get('end'))
                    except (TypeError, ValueError):
                        continue
                    if 0 <= s < e:
                        clean.append({'start': s, 'end': e,
                                      'color': str(h.get('color', 'blue'))[:16]})
                out['highlights'][str(k)[:260]] = clean

    if isinstance(d.get('readScroll'), dict):
        for k, v in list(d['readScroll'].items())[:1500]:
            try:
                out['readScroll'][str(k)[:260]] = max(0, int(v))
            except (TypeError, ValueError):
                pass

    out['settings'] = _sanitize_settings(d.get('settings'), out['settings'])

    prof = d.get('profile')
    if isinstance(prof, dict):
        out['profile']['bio'] = str(prof.get('bio', ''))[:300]
        av = prof.get('avatar')
        if isinstance(av, str) and av.startswith('data:image/') and len(av) < 400_000:
            out['profile']['avatar'] = av
        rb = prof.get('readBooks')
        if isinstance(rb, list):
            out['profile']['readBooks'] = [str(x)[:260] for x in rb[:2000]]

    st = d.get('stats')
    if isinstance(st, dict):
        try:
            out['stats']['timeTotal'] = max(0, int(st.get('timeTotal', 0)))
        except (TypeError, ValueError):
            pass
        try:
            out['stats']['lastOnline'] = max(0, int(st.get('lastOnline', 0)))
        except (TypeError, ValueError):
            pass

    out['banned'] = bool(d.get('banned'))
    out['muted'] = bool(d.get('muted'))
    out['role'] = 'admin' if d.get('role') == 'admin' else 'user'
    return out


def save_user_data(login: str, data: dict):
    p = data_path(login)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


# ============================================================================
# ЧАТ
# ============================================================================
def load_chat() -> list:
    if not os.path.exists(CHAT_FILE):
        return []
    try:
        with open(CHAT_FILE, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_chat(chat: list):
    with _chat_lock:
        chat = chat[-CHAT_LIMIT:]
        tmp = CHAT_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(chat, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CHAT_FILE)


# ============================================================================
# ЗАЯВКИ / ЖАЛОБЫ / КОММЕНТАРИИ
# ============================================================================
def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, type(default)) else default
    except (OSError, json.JSONDecodeError):
        return default


def save_json_file(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ============================================================================
# КНИГИ
# ============================================================================
W_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def read_text_file(path: str) -> str:
    with open(path, 'rb') as f:
        raw = f.read()
    for enc in ('utf-8-sig', 'utf-8', 'cp1251'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def read_docx(path: str) -> str:
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read('word/document.xml')
    except (zipfile.BadZipFile, KeyError, OSError):
        return '[Не удалось прочитать DOCX]'
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return '[Ошибка разбора DOCX]'
    paras = []
    for p in root.iter(W_NS + 'p'):
        buf = [t.text or '' for t in p.iter(W_NS + 't')]
        paras.append(''.join(buf))
    return '\n'.join(paras).strip()


def read_pdf(path: str) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return '[Модуль pypdf не установлен. Установите: pip install pypdf]'
    try:
        reader = PdfReader(path)
    except Exception as e:
        return f'[Ошибка чтения PDF: {e}]'
    out = []
    for i, page in enumerate(reader.pages):
        if i > 500:
            break
        try:
            out.append(page.extract_text() or '')
        except Exception:
            out.append('')
    return '\n\n'.join(out).strip()


def read_book_text(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext == '.docx':
        return read_docx(path)
    if ext == '.pdf':
        return read_pdf(path)
    return read_text_file(path)


def build_book_meta(filename: str, text: str) -> dict:
    base = os.path.splitext(filename)[0]
    author, year, title = None, None, None

    for line in text.split('\n')[:15]:
        m = re.match(r'^\s*(Автор|Название|Год)\s*[:\-–—]\s*(.+?)\s*$',
                     line, re.IGNORECASE)
        if not m:
            continue
        key, val = m.group(1).lower(), m.group(2).strip()
        if key == 'автор' and not author:
            author = val
        elif key == 'название' and not title:
            title = val
        elif key == 'год' and not year:
            year = val

    work = base.strip()
    ym = re.search(r'\((\d{3,4})\)\s*$', work)
    if ym:
        year = year or ym.group(1)
        work = work[:ym.start()].strip()

    parts = re.split(r'\s+[-–—]\s+', work, maxsplit=1)
    if len(parts) == 2:
        author = author or parts[0].strip()
        title = title or parts[1].strip()
    else:
        title = title or work

    return {
        'id': filename,
        'title': title or base,
        'author': author or 'Неизвестный автор',
        'year': year or '—',
        'ext': os.path.splitext(filename)[1].lower().lstrip('.'),
        'kind': 'pdf' if filename.lower().endswith('.pdf') else 'local',
        'uploaded': True,
    }


_books_cache = {}
_books_lock = threading.RLock()


def get_books() -> list:
    books = []
    if not os.path.isdir(LIB_DIR):
        return books
    now = time.time()
    try:
        entries = sorted(os.listdir(LIB_DIR), key=lambda s: s.lower())
    except OSError:
        return books

    for fn in entries:
        path = os.path.join(LIB_DIR, fn)
        if not os.path.isfile(path):
            continue
        if os.path.splitext(fn)[1].lower() not in ALLOWED_BOOK_EXT:
            continue
        try:
            st = os.stat(path)
        except OSError:
            continue
        with _books_lock:
            cached = _books_cache.get(fn)
            if cached and cached['mtime'] == st.st_mtime and now - cached['ts'] < BOOK_META_CACHE_TTL:
                books.append(cached['meta'])
                continue
        try:
            head = ''
            if fn.lower().endswith(('.txt', '.md')):
                with open(path, 'rb') as f:
                    raw = f.read(3072)
                for enc in ('utf-8-sig', 'utf-8', 'cp1251'):
                    try:
                        head = raw.decode(enc)
                        break
                    except UnicodeDecodeError:
                        continue
                if not head:
                    head = raw.decode('utf-8', errors='replace')
        except OSError:
            head = ''
        meta = build_book_meta(fn, head)
        with _books_lock:
            _books_cache[fn] = {'mtime': st.st_mtime, 'ts': now, 'meta': meta}
        books.append(meta)
    return books


# ============================================================================
# ВНЕШНЯЯ БИБЛИОТЕКА (ВИКИТЕКА)
# ============================================================================
_wiki_cache = {}
_wiki_lock = threading.RLock()


def _wiki_fetch(params: dict, ttl: int = WIKI_TTL):
    key = json.dumps(params, sort_keys=True, ensure_ascii=False)
    with _wiki_lock:
        c = _wiki_cache.get(key)
        if c and time.time() - c['ts'] < ttl:
            return c['data']
    url = WIKI_API + '?' + urlencode(params)
    req = Request(url, headers={'User-Agent': 'SchoolLib/0.1.4 (educational)'})
    try:
        with urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
    except (URLError, TimeoutError, json.JSONDecodeError, OSError):
        data = None
    with _wiki_lock:
        if len(_wiki_cache) > 500:
            _wiki_cache.clear()
        _wiki_cache[key] = {'ts': time.time(), 'data': data}
    return data


def wiki_search(query: str, limit: int = 20) -> list:
    data = _wiki_fetch({
        'action': 'query', 'list': 'search', 'srsearch': query,
        'srlimit': limit, 'format': 'json',
    })
    if not data:
        return []
    results = data.get('query', {}).get('search', []) or []
    out = []
    for r in results:
        out.append({
            'id': 'wiki:' + r.get('title', ''),
            'title': r.get('title', '—'),
            'author': 'Викитека',
            'year': '—',
            'kind': 'external',
            'snippet': re.sub(r'<[^>]+>', '', r.get('snippet', ''))[:200],
        })
    return out


def wiki_get_text(title: str) -> str:
    data = _wiki_fetch({
        'action': 'query', 'titles': title,
        'prop': 'extracts', 'explaintext': 1,
        'format': 'json',
    })
    if not data:
        return '[Не удалось загрузить из Викитеки]'
    pages = data.get('query', {}).get('pages', {}) or {}
    for _, p in pages.items():
        if 'extract' in p:
            return p['extract']
    return '[Текст не найден]'


# ============================================================================
# ХУКИ
# ============================================================================
@app.after_request
def _headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'SAMEORIGIN'
    resp.headers['Referrer-Policy'] = 'same-origin'
    if request.path.startswith('/api/') or request.path.startswith('/console'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.before_request
def _csrf_origin_check():
    if request.method in ('POST', 'PUT', 'DELETE') and request.path.startswith('/api/'):
        if request.path in ('/api/login', '/api/register'):
            return None
        origin = request.headers.get('Origin')
        if origin:
            host = request.host_url.rstrip('/')
            if origin.rstrip('/') != host:
                return jsonify(error='Запрос отклонён (CSRF)'), 403
    return None


# ============================================================================
# СТРАНИЦЫ
# ============================================================================
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/background/<path:name>')
def background_file(name):
    safe = os.path.basename(name)
    return send_from_directory(BG_DIR, safe, max_age=86400)


# ============================================================================
# AUTH API
# ============================================================================
@app.route('/api/register', methods=['POST'])
def api_register():
    ip = request.remote_addr or '?'
    if not rate_limit_ok(ip, limit=5, window=600):
        return jsonify(error='Слишком много попыток. Подождите.'), 429
    body = request.get_json(silent=True) or {}
    login = str(body.get('login', '')).strip()
    password = str(body.get('password', ''))
    if not LOGIN_RE.match(login):
        return jsonify(error='Логин: 3–32 символа (латиница, цифры, _ . -)'), 400
    if len(password) < 6:
        return jsonify(error='Пароль не короче 6 символов'), 400
    rate_limit_hit(ip)

    with _users_lock:
        users = read_users()
        if login in users:
            return jsonify(error='Такой логин уже занят'), 409
        users[login] = {
            'plain': password,
            'hash': hash_password(password),
            'role': 'admin' if login == ADMIN_LOGIN else 'user',
        }
        write_users(users)

    session.clear()
    session['user'] = login
    save_user_data(login, default_user_data())
    return jsonify(ok=True, user=login,
                   role='admin' if login == ADMIN_LOGIN else 'user')


@app.route('/api/login', methods=['POST'])
def api_login():
    ip = request.remote_addr or '?'
    if not rate_limit_ok(ip, limit=12, window=300):
        return jsonify(error='Слишком много попыток входа. Подождите 5 минут.'), 429
    body = request.get_json(silent=True) or {}
    login = str(body.get('login', '')).strip()
    password = str(body.get('password', ''))
    rate_limit_hit(ip)

    role = authenticate(login, password)
    if not role:
        time.sleep(0.2)
        return jsonify(error='Неверный логин или пароль'), 401

    d = load_user_data(login)
    if d.get('banned'):
        return jsonify(error='Аккаунт заблокирован'), 403

    session.clear()
    session['user'] = login
    d['stats']['lastOnline'] = int(time.time() * 1000)
    save_user_data(login, d)
    return jsonify(ok=True, user=login, role='admin' if is_admin(login) else 'user')


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify(ok=True)


@app.route('/api/me')
def api_me():
    u = session.get('user')
    if not u:
        return jsonify(user=None)
    d = load_user_data(u)
    return jsonify(user=u, role='admin' if is_admin(u) else 'user',
                   banned=bool(d.get('banned')), muted=bool(d.get('muted')))


@app.route('/api/change_password', methods=['POST'])
@login_required
def api_change_password():
    login = session['user']
    body = request.get_json(silent=True) or {}
    old = str(body.get('old', ''))
    new = str(body.get('new', ''))
    if len(new) < 6:
        return jsonify(error='Новый пароль не короче 6 символов'), 400
    if not authenticate(login, old):
        return jsonify(error='Старый пароль неверный'), 401
    with _users_lock:
        users = read_users()
        if login in users:
            users[login]['plain'] = new
            users[login]['hash'] = hash_password(new)
            write_users(users)
    return jsonify(ok=True)


# ============================================================================
# BOOKS API
# ============================================================================
@app.route('/api/books')
def api_books():
    return jsonify(books=get_books())


@app.route('/api/book')
def api_book():
    bid = request.args.get('id', '')
    if bid.startswith('wiki:'):
        title = bid[5:]
        text = wiki_get_text(title)
        return jsonify(book={
            'id': bid, 'title': title, 'author': 'Викитека', 'year': '—',
            'kind': 'external', 'text': text,
        })
    valid = {b['id'] for b in get_books()}
    if bid not in valid:
        return jsonify(error='Произведение не найдено'), 404
    path = os.path.join(LIB_DIR, bid)
    if not os.path.isfile(path):
        return jsonify(error='Файл не найден'), 404
    text = read_book_text(path)
    meta = build_book_meta(bid, text)
    meta['text'] = text
    return jsonify(book=meta)


@app.route('/api/upload', methods=['POST'])
@admin_required
def api_upload():
    if 'file' not in request.files:
        return jsonify(error='Файл не передан'), 400
    f = request.files['file']
    if not f or not f.filename:
        return jsonify(error='Пустое имя файла'), 400
    fn = os.path.basename(f.filename)
    ext = os.path.splitext(fn)[1].lower()
    if ext not in ALLOWED_BOOK_EXT:
        return jsonify(error=f'Недопустимый формат: {ext}'), 400
    target = os.path.join(LIB_DIR, fn)
    if os.path.exists(target):
        base, e = os.path.splitext(fn)
        fn = f'{base}_{int(time.time())}{e}'
        target = os.path.join(LIB_DIR, fn)
    f.save(target)
    with _books_lock:
        _books_cache.pop(fn, None)
    return jsonify(ok=True, id=fn)


@app.route('/api/external_search')
def api_external_search():
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify(results=[])
    return jsonify(results=wiki_search(q))


# ============================================================================
# USER DATA API
# ============================================================================
@app.route('/api/data', methods=['GET'])
@login_required
def api_get_data():
    return jsonify(data=load_user_data(session['user']))


@app.route('/api/data', methods=['POST'])
@login_required
def api_post_data():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error='Некорректные данные'), 400
    login = session['user']
    old = load_user_data(login)
    clean = sanitize_user_data(body)
    clean['role'] = old.get('role', 'user')
    clean['banned'] = old.get('banned', False)
    clean['muted'] = old.get('muted', False)
    save_user_data(login, clean)
    return jsonify(ok=True)


@app.route('/api/users')
@login_required
def api_users():
    with _users_lock:
        users = read_users()
    cur = session['user']
    can_see_passwords = (cur == ADMIN_LOGIN)
    out = []
    for login in users.keys():
        d = load_user_data(login)
        if login == cur:
            d['stats']['lastOnline'] = int(time.time() * 1000)
            save_user_data(login, d)
        rec = {
            'login': login,
            'role': 'admin' if is_admin(login) else 'user',
            'bio': d.get('profile', {}).get('bio', ''),
            'readBooks': d.get('profile', {}).get('readBooks', []),
            'timeTotal': d.get('stats', {}).get('timeTotal', 0),
            'lastOnline': d.get('stats', {}).get('lastOnline', 0),
            'banned': bool(d.get('banned')),
            'muted': bool(d.get('muted')),
            'protected': login == ADMIN_LOGIN,
        }
        if can_see_passwords:
            rec['password'] = users[login].get('plain') or '—'
        out.append(rec)
    return jsonify(users=out)


@app.route('/api/user/<login>/action', methods=['POST'])
@admin_required
def api_user_action(login):
    if login == ADMIN_LOGIN:
        return jsonify(error='Нельзя изменять ROOT-аккаунт'), 403
    body = request.get_json(silent=True) or {}
    act = body.get('action')
    if act == 'mute':
        set_user_mute(login, True)
    elif act == 'unmute':
        set_user_mute(login, False)
    elif act == 'ban':
        set_user_ban(login, True)
    elif act == 'unban':
        set_user_ban(login, False)
    elif act == 'promote':
        set_user_role(login, 'admin')
    elif act == 'demote':
        if login == session['user']:
            return jsonify(error='Нельзя снять права с себя'), 400
        set_user_role(login, 'user')
    elif act == 'delete':
        delete_user(login)
    else:
        return jsonify(error='Неизвестное действие'), 400
    return jsonify(ok=True)


# ============================================================================
# TICKETS / COMMENTS / REPORTS
# ============================================================================
@app.route('/api/tickets', methods=['GET'])
def api_tickets_get():
    tickets = load_json_file(TICKETS_FILE, [])
    return jsonify(tickets=tickets)


@app.route('/api/tickets', methods=['POST'])
@login_required
def api_tickets_post():
    login = session['user']
    d = load_user_data(login)
    if d.get('muted'):
        return jsonify(error='Вы замучены и не можете отправлять заявки'), 403
    body = request.get_json(silent=True) or {}
    title = str(body.get('title', '')).strip()[:200]
    text = str(body.get('body', '')).strip()[:4000]
    if not title or not text:
        return jsonify(error='Заполните тему и описание'), 400
    tickets = load_json_file(TICKETS_FILE, [])
    t = {
        'id': 't' + str(int(time.time() * 1000)),
        'author': login, 'title': title, 'body': text,
        'resolved': False, 'ts': int(time.time() * 1000),
    }
    tickets.append(t)
    save_json_file(TICKETS_FILE, tickets[-500:])

    chat = load_chat()
    chat.append({
        'id': 'sys_' + t['id'], 'author': 'sys', 'kind': 'ticket',
        'ref': t['id'], 'text': '',
        'meta': {'title': title, 'body': text, 'from': login, 'ts': t['ts']},
        'ts': t['ts'], 'resolved': False,
    })
    save_chat(chat)
    return jsonify(ok=True, ticket=t)


@app.route('/api/comments')
def api_comments():
    bid = request.args.get('book', '')
    comments = load_json_file(COMMENTS_FILE, {})
    return jsonify(comments=comments.get(bid, []))


@app.route('/api/comments', methods=['POST'])
@login_required
def api_comments_post():
    login = session['user']
    d = load_user_data(login)
    body = request.get_json(silent=True) or {}
    bid = str(body.get('book', ''))[:260]
    text = str(body.get('text', '')).strip()[:1500]
    if not bid or not text:
        return jsonify(error='Пустой комментарий'), 400
    if bid not in d.get('profile', {}).get('readBooks', []):
        return jsonify(error='Сначала отметьте произведение прочитанным'), 403
    comments = load_json_file(COMMENTS_FILE, {})
    arr = comments.setdefault(bid, [])
    c = {'id': 'c' + str(int(time.time() * 1000)),
         'author': login, 'text': text, 'ts': int(time.time() * 1000)}
    arr.append(c)
    comments[bid] = arr[-300:]
    save_json_file(COMMENTS_FILE, comments)
    return jsonify(ok=True, comment=c)


@app.route('/api/comments/delete', methods=['POST'])
@login_required
def api_comments_delete():
    login = session['user']
    body = request.get_json(silent=True) or {}
    bid = str(body.get('book', ''))[:260]
    cid = str(body.get('id', ''))[:40]
    comments = load_json_file(COMMENTS_FILE, {})
    arr = comments.get(bid, [])
    target = next((c for c in arr if c['id'] == cid), None)
    if not target:
        return jsonify(error='Комментарий не найден'), 404
    if not (target['author'] == login or is_admin(login)):
        return jsonify(error='Нет прав'), 403
    comments[bid] = [c for c in arr if c['id'] != cid]
    save_json_file(COMMENTS_FILE, comments)
    return jsonify(ok=True)


@app.route('/api/report', methods=['POST'])
@login_required
def api_report():
    login = session['user']
    body = request.get_json(silent=True) or {}
    bid = str(body.get('book', ''))[:260]
    cid = str(body.get('id', ''))[:40]
    reason = str(body.get('reason', '')).strip()[:500]
    if not bid or not cid or not reason:
        return jsonify(error='Недостаточно данных'), 400
    comments = load_json_file(COMMENTS_FILE, {})
    target = next((c for c in comments.get(bid, []) if c['id'] == cid), None)
    if not target:
        return jsonify(error='Комментарий не найден'), 404
    if target['author'] == login:
        return jsonify(error='Нельзя пожаловаться на свой комментарий'), 400
    chat = load_chat()
    rid = 'rep_' + str(int(time.time() * 1000))
    chat.append({
        'id': rid, 'author': 'sys', 'kind': 'report', 'ref': rid, 'text': '',
        'meta': {'commentAuthor': target['author'], 'commentText': target['text'],
                 'reporter': login, 'reason': reason,
                 'bookId': bid, 'commentId': cid},
        'ts': int(time.time() * 1000), 'resolved': False,
    })
    save_chat(chat)
    return jsonify(ok=True)


# ============================================================================
# CHAT API
# ============================================================================
@app.route('/api/chat', methods=['GET'])
@admin_required
def api_chat_get():
    return jsonify(chat=load_chat())


@app.route('/api/chat', methods=['POST'])
@admin_required
def api_chat_post():
    body = request.get_json(silent=True) or {}
    text = str(body.get('text', '')).strip()[:800]
    if not text:
        return jsonify(error='Пустое сообщение'), 400
    chat = load_chat()
    chat.append({
        'id': 'msg_' + str(int(time.time() * 1000)),
        'author': session['user'], 'kind': 'msg', 'text': text,
        'ts': int(time.time() * 1000), 'resolved': False, 'ref': None,
    })
    save_chat(chat)
    return jsonify(ok=True)


@app.route('/api/chat/resolve', methods=['POST'])
@admin_required
def api_chat_resolve():
    body = request.get_json(silent=True) or {}
    mid = str(body.get('id', ''))[:60]
    chat = load_chat()
    for m in chat:
        if m['id'] == mid:
            m['resolved'] = True
            if m.get('kind') == 'ticket' and m.get('ref'):
                tickets = load_json_file(TICKETS_FILE, [])
                for t in tickets:
                    if t['id'] == m['ref']:
                        t['resolved'] = True
                save_json_file(TICKETS_FILE, tickets)
            break
    save_chat(chat)
    return jsonify(ok=True)


@app.route('/api/chat/delete', methods=['POST'])
@admin_required
def api_chat_delete():
    body = request.get_json(silent=True) or {}
    mid = str(body.get('id', ''))[:60]
    chat = [m for m in load_chat() if m['id'] != mid]
    save_chat(chat)
    return jsonify(ok=True)


# ============================================================================
# ПРИВАТНАЯ КОНСОЛЬ suzarux  (/console)
# ============================================================================
try:
    from admin_console import console_bp
    app.register_blueprint(console_bp)
    print('[i] Консоль suzarux подключена: /console')
except ImportError as e:
    print(f'[!] admin_console.py не найден — консоль отключена ({e})')
except Exception as e:
    print(f'[!] Ошибка подключения консоли: {e}')


# ============================================================================
if __name__ == '__main__':
    print('=' * 62)
    print('  Онлайн-библиотека МБОУ «Школа №73 г.о. Самара»')
    print('  by suzarux — demo v0.1.4 build 191906102026')
    print('  Книги кладите в  :', LIB_DIR)
    print('  Фоны кладите в   :', BG_DIR)
    print('  Аккаунты         :', USERS_FILE)
    print('  Консоль          : http://127.0.0.1:5000/console')
    print('  Открой в браузере: http://127.0.0.1:5000')
    print('=' * 62)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)