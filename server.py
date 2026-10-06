# -*- coding: utf-8 -*-
"""
Онлайн-библиотека МБОУ «Школа №73 г.о. Самара»
Серверная часть (Flask).
"""
import os
import re
import json
import time
import secrets
import hashlib
import threading
import zipfile
import xml.etree.ElementTree as ET

from flask import (Flask, request, session, jsonify, send_from_directory,
                   render_template, make_response)

# --------------------------------------------------------------------------
# Пути
# --------------------------------------------------------------------------
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
LIB_DIR    = os.path.join(BASE_DIR, 'lib')
BG_DIR     = os.path.join(BASE_DIR, 'background')
DATA_DIR   = os.path.join(BASE_DIR, 'userdata')
USERS_FILE = os.path.join(BASE_DIR, 'users.txt')
SECRET_FILE = os.path.join(BASE_DIR, '.secret_key')

ALLOWED_BOOK_EXT = {'.txt', '.md', '.docx'}
ALLOWED_IMG_EXT  = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'}
LOGIN_RE = re.compile(r'^[A-Za-z0-9_.\-]{3,32}$')

for _d in (LIB_DIR, BG_DIR, DATA_DIR):
    os.makedirs(_d, exist_ok=True)

# --------------------------------------------------------------------------
# Приложение и ключ сессий
# --------------------------------------------------------------------------
def _load_secret_key():
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, 'rb') as f:
            return f.read()
    key = secrets.token_bytes(48)
    with open(SECRET_FILE, 'wb') as f:
        f.write(key)
    try:
        os.chmod(SECRET_FILE, 0o600)
    except OSError:
        pass
    return key

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = _load_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_NAME='lib_session',
    MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    JSON_AS_ASCII=False,
)

# --------------------------------------------------------------------------
# Утилиты безопасности
# --------------------------------------------------------------------------
_users_lock = threading.Lock()
_attempts_lock = threading.Lock()
_attempts = {}          # ip -> [timestamps]

def hash_password(password: str, salt: str = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                             salt.encode('utf-8'), 150_000)
    return f"pbkdf2_sha256${salt}${dk.hex()}"

def verify_password(stored: str, password: str):
    """Возвращает (ok: bool, needs_upgrade: bool)"""
    try:
        algo, salt, digest = stored.split('$')
    except ValueError:
        # старый plain-текст пароль → сверяем и просим апгрейд
        return (secrets.compare_digest(stored, password), True)
    if algo != 'pbkdf2_sha256':
        return (False, False)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                             salt.encode('utf-8'), 150_000)
    return (secrets.compare_digest(dk.hex(), digest), False)

def read_users():
    users = {}
    if not os.path.exists(USERS_FILE):
        return users
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or ' - ' not in line:
                continue
            login, pwd = line.split(' - ', 1)
            users[login.strip()] = pwd.strip()
    return users

def write_users(users: dict):
    tmp = USERS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        for login, pwd in users.items():
            f.write(f"{login} - {pwd}\n")
    os.replace(tmp, USERS_FILE)

def rate_limit_ok(ip: str, limit: int = 8, window: int = 300) -> bool:
    now = time.time()
    with _attempts_lock:
        arr = [t for t in _attempts.get(ip, []) if now - t < window]
        _attempts[ip] = arr
        return len(arr) < limit

def rate_limit_hit(ip: str):
    with _attempts_lock:
        _attempts.setdefault(ip, []).append(time.time())

def login_required(fn):
    from functools import wraps
    @wraps(fn)
    def wrapper(*a, **kw):
        if not session.get('user'):
            return jsonify(error='Требуется вход в аккаунт'), 401
        return fn(*a, **kw)
    return wrapper

# --------------------------------------------------------------------------
# Чтение книг
# --------------------------------------------------------------------------
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
    except Exception:
        return ''
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return ''
    paras = []
    for p in root.iter(W_NS + 'p'):
        buf = [t.text or '' for t in p.iter(W_NS + 't')]
        paras.append(''.join(buf))
    return '\n'.join(paras).strip()

def read_book_text(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext == '.docx':
        return read_docx(path)
    return read_text_file(path)

def build_meta(filename: str, text: str) -> dict:
    base = os.path.splitext(filename)[0]
    author, year, title = None, None, None

    # 1. Метаданные внутри файла (первые 15 строк)
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

    # 2. Разбор имени файла
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
    }

_books_cache = {}
_books_lock = threading.Lock()

def get_books() -> list:
    books = []
    if not os.path.isdir(LIB_DIR):
        return books
    for fn in sorted(os.listdir(LIB_DIR), key=lambda s: s.lower()):
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
            if cached and cached['mtime'] == st.st_mtime and cached['size'] == st.st_size:
                books.append(cached['meta'])
                continue
        try:
            text = read_book_text(path)
        except Exception:
            text = ''
        meta = build_meta(fn, text)
        with _books_lock:
            _books_cache[fn] = {'mtime': st.st_mtime, 'size': st.st_size, 'meta': meta}
        books.append(meta)
    return books

# --------------------------------------------------------------------------
# Данные пользователя
# --------------------------------------------------------------------------
def _safe_login(login: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.\-]', '_', login)[:48]

def data_path(login: str) -> str:
    return os.path.join(DATA_DIR, _safe_login(login) + '.json')

def default_data() -> dict:
    return {'favorites': [], 'notes': {}, 'highlights': {},
            'settings': {'theme': 'dark', 'fontSize': 18}}

def load_user_data(login: str) -> dict:
    p = data_path(login)
    if not os.path.exists(p):
        return default_data()
    try:
        with open(p, 'r', encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        return default_data()
    base = default_data()
    base.update({k: v for k, v in d.items() if k in base})
    if not isinstance(base['settings'], dict):
        base['settings'] = {'theme': 'dark', 'fontSize': 18}
    return base

def sanitize_data(d: dict) -> dict:
    out = default_data()
    if isinstance(d.get('favorites'), list):
        out['favorites'] = [str(x)[:260] for x in d['favorites'][:1000]]
    if isinstance(d.get('notes'), dict):
        for k, v in list(d['notes'].items())[:1000]:
            if isinstance(v, list):
                clean = []
                for n in v[:300]:
                    if isinstance(n, dict):
                        clean.append({
                            'id': str(n.get('id', ''))[:40],
                            'text': str(n.get('text', ''))[:5000],
                            'ts': int(n.get('ts', 0)) if str(n.get('ts', 0)).isdigit() else 0,
                        })
                out['notes'][str(k)[:260]] = clean
    if isinstance(d.get('highlights'), dict):
        for k, v in list(d['highlights'].items())[:1000]:
            if isinstance(v, list):
                clean = []
                for h in v[:800]:
                    if isinstance(h, dict):
                        try:
                            s, e = int(h.get('start')), int(h.get('end'))
                        except (TypeError, ValueError):
                            continue
                        if 0 <= s < e:
                            clean.append({'start': s, 'end': e,
                                          'color': str(h.get('color', 'blue'))[:16]})
                out['highlights'][str(k)[:260]] = clean
    if isinstance(d.get('settings'), dict):
        s = d['settings']
        out['settings']['theme'] = 'light' if s.get('theme') == 'light' else 'dark'
        try:
            fs = int(s.get('fontSize', 18))
        except (TypeError, ValueError):
            fs = 18
        out['settings']['fontSize'] = max(12, min(34, fs))
    return out

def save_user_data(login: str, data: dict):
    p = data_path(login)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)

# --------------------------------------------------------------------------
# Хуки
# --------------------------------------------------------------------------
@app.after_request
def _headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'SAMEORIGIN'
    resp.headers['Referrer-Policy'] = 'same-origin'
    if request.path.startswith('/api/'):
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

# --------------------------------------------------------------------------
# Страницы
# --------------------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/background/<path:name>')
def background_file(name):
    safe = os.path.basename(name)
    return send_from_directory(BG_DIR, safe, max_age=86400)

# --------------------------------------------------------------------------
# API: авторизация
# --------------------------------------------------------------------------
@app.route('/api/register', methods=['POST'])
def api_register():
    ip = request.remote_addr or '?'
    if not rate_limit_ok(ip, limit=5, window=600):
        return jsonify(error='Слишком много попыток. Подождите.'), 429

    body = request.get_json(silent=True) or {}
    login = str(body.get('login', '')).strip()
    password = str(body.get('password', ''))

    if not LOGIN_RE.match(login):
        return jsonify(error='Логин: 3–32 символа, латиница, цифры, _ . -'), 400
    if len(password) < 6:
        return jsonify(error='Пароль должен быть не короче 6 символов'), 400

    rate_limit_hit(ip)
    with _users_lock:
        users = read_users()
        if login in users:
            return jsonify(error='Такой логин уже занят'), 409
        users[login] = hash_password(password)
        write_users(users)

    session.clear()
    session['user'] = login
    session.permanent = False
    save_user_data(login, default_data())
    return jsonify(ok=True, user=login)

@app.route('/api/login', methods=['POST'])
def api_login():
    ip = request.remote_addr or '?'
    if not rate_limit_ok(ip, limit=10, window=300):
        return jsonify(error='Слишком много попыток входа. Подождите 5 минут.'), 429

    body = request.get_json(silent=True) or {}
    login = str(body.get('login', '')).strip()
    password = str(body.get('password', ''))

    rate_limit_hit(ip)
    with _users_lock:
        users = read_users()
        stored = users.get(login)
        if stored is None:
            time.sleep(0.25)
            return jsonify(error='Неверный логин или пароль'), 401
        ok, needs_upgrade = verify_password(stored, password)
        if not ok:
            time.sleep(0.25)
            return jsonify(error='Неверный логин или пароль'), 401
        if needs_upgrade:
            users[login] = hash_password(password)
            write_users(users)

    session.clear()
    session['user'] = login
    return jsonify(ok=True, user=login)

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify(ok=True)

@app.route('/api/me')
def api_me():
    u = session.get('user')
    return jsonify(user=u)

# --------------------------------------------------------------------------
# API: книги / фоны
# --------------------------------------------------------------------------
@app.route('/api/books')
def api_books():
    return jsonify(books=get_books())

@app.route('/api/book')
def api_book():
    bid = request.args.get('id', '')
    valid = {b['id'] for b in get_books()}
    if bid not in valid:
        return jsonify(error='Произведение не найдено'), 404
    path = os.path.join(LIB_DIR, bid)
    if not os.path.isfile(path):
        return jsonify(error='Файл не найден'), 404
    text = read_book_text(path)
    meta = build_meta(bid, text)
    meta['text'] = text
    return jsonify(book=meta)

@app.route('/api/backgrounds')
def api_backgrounds():
    items = []
    if os.path.isdir(BG_DIR):
        for fn in sorted(os.listdir(BG_DIR)):
            if os.path.splitext(fn)[1].lower() in ALLOWED_IMG_EXT:
                items.append('/background/' + fn)
    return jsonify(backgrounds=items)

# --------------------------------------------------------------------------
# API: данные пользователя
# --------------------------------------------------------------------------
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
    clean = sanitize_data(body)
    save_user_data(session['user'], clean)
    return jsonify(ok=True)

# --------------------------------------------------------------------------
if __name__ == '__main__':
    print('=' * 62)
    print('  Онлайн-библиотека МБОУ «Школа №73 г.о. Самара»')
    print('  Книги кладите в  :', LIB_DIR)
    print('  Фоны кладите в   :', BG_DIR)
    print('  Аккаунты         :', USERS_FILE)
    print('  Открой в браузере: http://127.0.0.1:5000')
    print('=' * 62)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)