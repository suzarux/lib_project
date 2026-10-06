#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deploy.py — деплой + бэкап библиотеки на PythonAnywhere без git.
by suzarux — demo v0.1.4 build 191906102026

Новое:
  ▸ перед заливкой скачивает состояние (users.txt, .secret_key, userdata/)
  ▸ после заливки восстанавливает состояние обратно
  ▸ сохраняет копию в backups/<ts>/ и архив в backups/archive/<ts>.zip
  ▸ можно пушить бэкапы и на сервер (для консоли)

Использование:
    python deploy.py                    # бэкап → залить → восстановить
    python deploy.py --reload           # то же + перезапуск сайта
    python deploy.py --backup-only      # только скачать бэкап
    python deploy.py --restore          # восстановить из последнего
    python deploy.py --list-backups     # показать бэкапы
    python deploy.py --no-backup        # пропустить бэкап
    python deploy.py --dry-run
    python deploy.py --init             # создать .deploy_config.json
"""

import argparse
import hashlib
import json
import os
import secrets
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# ---------------------------------------------------------------------------
API_BASE     = 'https://www.pythonanywhere.com/api/v0/user'
SCRIPT_DIR   = Path(__file__).resolve().parent
CONFIG_PATH  = SCRIPT_DIR / '.deploy_config.json'
HTTP_TIMEOUT = 60

# ---------------------------------------------------------------------------
_COLOR = sys.stdout.isatty() and os.name != 'nt'
def _c(code, s): return f'\033[{code}m{s}\033[0m' if _COLOR else s
GREEN  = lambda s: _c('32', s)
RED    = lambda s: _c('31', s)
YELLOW = lambda s: _c('33', s)
CYAN   = lambda s: _c('36', s)
DIM    = lambda s: _c('2',  s)
BOLD   = lambda s: _c('1',  s)

def log(m):  print(m)
def ok(m):   print(GREEN ('  ✓ ') + m)
def err(m):  print(RED   ('  ✗ ') + m)
def warn(m): print(YELLOW('  ! ') + m)
def info(m): print(CYAN  ('  · ') + m)
def step(m): print(BOLD  ('▸ ') + m)

# ---------------------------------------------------------------------------
DEFAULT_CONFIG = {
    "username": "suzarux",
    "token": "",
    "domain": "suzarux.pythonanywhere.com",
    "remote_base": "/home/suzarux/lib_project",
    "local_base": ".",

    # Код, который заливаем
    "files": [
        "server.py",
        "requirements.txt",
        "templates",
        "static",
        "admin_console.py"
    ],

    # Состояние, которое бэкапим и восстанавливаем
    "state_files": [
        "users.txt",
        "userdata",
        ".secret_key"
    ],

    # Что не трогаем при заливке кода
    "exclude_names": [
        ".git", ".github", "venv", ".venv", "__pycache__",
        ".idea", ".vscode", "node_modules",
        "userdata", "lib", "background", "backups",
        "standalone.html", "deploy.py",
        ".deploy_config.json", ".deploy_cache.json",
        ".secret_key", "users.txt"
    ],
    "exclude_exts": [
        ".pyc", ".pyo", ".log", ".tmp", ".bak",
        ".DS_Store", ".jpg", ".jpeg", ".png", ".webp",
        ".gif", ".bmp", ".avif", ".zip"
    ],

    "backup_dir": "backups",
    "backup_keep": 20,
    "push_backups_to_remote": True
}

def load_config():
    if not CONFIG_PATH.exists():
        err(f'Не найден {CONFIG_PATH.name}')
        info('Создай: python deploy.py --init')
        sys.exit(1)
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        err(f'Некорректный JSON: {e}'); sys.exit(1)
    merged = dict(DEFAULT_CONFIG); merged.update(cfg)
    return merged

def write_default_config():
    if CONFIG_PATH.exists():
        warn(f'{CONFIG_PATH.name} уже существует'); return
    CONFIG_PATH.write_text(
        json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2),
        encoding='utf-8')
    ok(f'Создан {CONFIG_PATH.name}')
    info('Открой, вставь API token (Account → API token) и запусти снова')

# ---------------------------------------------------------------------------
# Утилиты
# ---------------------------------------------------------------------------
def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def is_excluded(rel_parts, name, ext, cfg) -> bool:
    if name in cfg['exclude_names']: return True
    for part in rel_parts:
        if part in cfg['exclude_names']: return True
        if part.startswith('.') and part != '.well-known':
            return True
    if ext.lower() in [e.lower() for e in cfg['exclude_exts']]:
        return True
    return False

def iter_local_files(cfg):
    base = (SCRIPT_DIR / cfg['local_base']).resolve()
    if not base.is_dir():
        err(f'local_base не найден: {base}'); sys.exit(1)
    seen, out = set(), []
    for entry in cfg['files']:
        p = base / entry
        if p.is_file():
            rel = p.relative_to(base).as_posix()
            if rel not in seen:
                seen.add(rel); out.append((rel, p.resolve()))
        elif p.is_dir():
            for f in sorted(p.rglob('*')):
                if not f.is_file(): continue
                rel = f.relative_to(base)
                if is_excluded(rel.parts[:-1], rel.name, f.suffix, cfg):
                    continue
                rs = rel.as_posix()
                if rs not in seen:
                    seen.add(rs); out.append((rs, f.resolve()))
        else:
            warn(f'в files указано несуществующее: {entry}')
    return out

def to_api_path(abs_remote: str) -> str:
    return abs_remote.lstrip('/')

def ts_name() -> str:
    return time.strftime('%Y-%m-%d_%H-%M-%S')

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def http(method, url, token, data=None, headers=None, timeout=HTTP_TIMEOUT):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', f'Token {token}')
    if headers:
        for k, v in headers.items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        raise RuntimeError(f'сеть: {e.reason}')
    except TimeoutError:
        raise RuntimeError('таймаут')

def build_multipart(field, filename, content):
    boundary = '----PA' + secrets.token_hex(12)
    parts = [
        f'--{boundary}'.encode(),
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"'.encode(),
        b'Content-Type: application/octet-stream',
        b'',
        content,
        f'--{boundary}--'.encode(),
        b'',
    ]
    return b'\r\n'.join(parts), boundary

# ---------------------------------------------------------------------------
# PA API
# ---------------------------------------------------------------------------
def pa_get_file(username, token, api_path):
    url = f'{API_BASE}/{username}/files/path/{api_path}'
    status, body = http('GET', url, token)
    if status == 200: return body
    if status in (404, 403): return None
    raise RuntimeError(f'GET {api_path} → {status}')

def pa_listdir(username, token, api_path):
    url = f'{API_BASE}/{username}/files/tree/?path={api_path}'
    status, body = http('GET', url, token)
    if status != 200:
        raise RuntimeError(f'LIST {api_path} → {status}')
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []
    # PythonAnywhere возвращает либо {'files': [...]}, либо список
    if isinstance(data, list): return data
    return data.get('files', []) or []

def pa_upload(username, token, api_path, filename, content):
    body, boundary = build_multipart('content', filename, content)
    url = f'{API_BASE}/{username}/files/path/{api_path}'
    status, resp = http(
        'POST', url, token, data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}
    )
    if status not in (200, 201):
        try: detail = json.loads(resp).get('detail')
        except Exception: detail = resp.decode('utf-8', 'replace')[:300]
        raise RuntimeError(f'{status} {detail}')

def pa_reload(username, token, domain):
    url = f'{API_BASE}/{username}/webapps/{domain}/reload/'
    status, resp = http('POST', url, token)
    if status not in (200, 201):
        raise RuntimeError(f'{status} {resp.decode("utf-8","replace")[:300]}')

# ---------------------------------------------------------------------------
# Бэкап / восстановление состояния
# ---------------------------------------------------------------------------
def download_remote_state(cfg, token, dest_dir: Path):
    """
    Скачивает с сервера state_files (users.txt, userdata/, .secret_key)
    в dest_dir, сохраняя относительную структуру.
    Возвращает список успешно скачанных (rel, size).
    """
    username = cfg['username']
    remote_base = cfg['remote_base'].rstrip('/')
    dest_dir.mkdir(parents=True, exist_ok=True)
    downloaded = []

    def fetch_file(rel_path: str):
        remote = f'{remote_base}/{rel_path}'
        api = to_api_path(remote)
        data = pa_get_file(username, token, api)
        if data is None:
            return None
        out = dest_dir / rel_path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        return len(data)

    for entry in cfg['state_files']:
        remote = f'{remote_base}/{entry}'
        api = to_api_path(remote)

        # пробуем как файл
        try:
            data = pa_get_file(username, token, api)
        except RuntimeError as e:
            warn(f'{entry}: {e}')
            continue

        if data is not None:
            (dest_dir / entry).parent.mkdir(parents=True, exist_ok=True)
            (dest_dir / entry).write_bytes(data)
            downloaded.append((entry, len(data)))
            continue

        # возможно это папка — пробуем рекурсивно через listdir
        try:
            listing = pa_listdir(username, token, api)
        except RuntimeError:
            continue

        def walk(items, prefix):
            for it in items:
                name = it.get('name') or it.get('path', '').split('/')[-1]
                if not name: continue
                full_api = f'{api.rstrip("/")}/{name}'
                rel = f'{prefix}/{name}'
                if it.get('type') == 'directory':
                    try:
                        sub = pa_listdir(username, token, full_api)
                    except RuntimeError:
                        sub = []
                    walk(sub, rel)
                else:
                    try:
                        d = pa_get_file(username, token, full_api)
                        if d is not None:
                            p = dest_dir / rel
                            p.parent.mkdir(parents=True, exist_ok=True)
                            p.write_bytes(d)
                            downloaded.append((rel.lstrip('/'), len(d)))
                    except RuntimeError as e:
                        warn(f'{rel}: {e}')
        walk(listing, entry)

    return downloaded

def upload_state(cfg, token, src_dir: Path):
    """
    Загружает файлы из src_dir обратно на сервер (state_files).
    """
    username = cfg['username']
    remote_base = cfg['remote_base'].rstrip('/')
    uploaded = []

    if not src_dir.exists():
        return uploaded

    for p in sorted(src_dir.rglob('*')):
        if not p.is_file(): continue
        rel = p.relative_to(src_dir).as_posix()
        # загружаем только то, что относится к state
        if not any(rel == s or rel.startswith(s + '/') for s in cfg['state_files']):
            continue
        remote = f'{remote_base}/{rel}'
        try:
            pa_upload(username, token, to_api_path(remote), p.name, p.read_bytes())
            uploaded.append(rel)
        except RuntimeError as e:
            warn(f'{rel}: {e}')
    return uploaded

def make_archive(backup_src: Path, archive_path: Path):
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(backup_src.rglob('*')):
            if p.is_file():
                zf.write(p, p.relative_to(backup_src).as_posix())
    return archive_path

def prune_backups(backups_root: Path, keep: int):
    if not backups_root.exists(): return
    dirs = sorted(
        [d for d in backups_root.iterdir() if d.is_dir() and d.name != 'archive'],
        key=lambda d: d.name, reverse=True
    )
    for d in dirs[keep:]:
        shutil.rmtree(d, ignore_errors=True)
    arch = backups_root / 'archive'
    if arch.exists():
        zips = sorted([z for z in arch.iterdir() if z.suffix == '.zip'],
                      key=lambda z: z.name, reverse=True)
        for z in zips[keep:]:
            try: z.unlink()
            except OSError: pass

def list_backups(backups_root: Path):
    if not backups_root.exists(): return []
    out = []
    for d in sorted(backups_root.iterdir(), key=lambda x: x.name, reverse=True):
        if d.is_dir() and d.name != 'archive':
            total = sum(f.stat().st_size for f in d.rglob('*') if f.is_file())
            out.append((d.name, total, d))
    return out

# ---------------------------------------------------------------------------
# Команды
# ---------------------------------------------------------------------------
def cmd_backup(cfg, token, push_remote: bool):
    if not token:
        err('Не указан API token'); sys.exit(1)
    backups_root = SCRIPT_DIR / cfg['backup_dir']
    backups_root.mkdir(exist_ok=True)
    ts = ts_name()
    dest = backups_root / ts

    step(f'Бэкап состояния → {BOLD(str(dest.relative_to(SCRIPT_DIR)))}')
    try:
        downloaded = download_remote_state(cfg, token, dest)
    except RuntimeError as e:
        err(f'Не удалось скачать состояние: {e}'); sys.exit(1)

    if not downloaded:
        warn('Нечего скачивать (нет users.txt / userdata / .secret_key)')
        shutil.rmtree(dest, ignore_errors=True)
        return None

    total = sum(sz for _, sz in downloaded)
    log(f'  скачано: {len(downloaded)} файлов, {total/1024:.1f} КБ')

    # архив
    arch = backups_root / 'archive' / f'{ts}.zip'
    make_archive(dest, arch)
    ok(f'архив: {arch.relative_to(SCRIPT_DIR)}')

    # пуш архивов на сервер для консоли
    if push_remote and cfg.get('push_backups_to_remote'):
        try:
            remote_backups = f"{cfg['remote_base'].rstrip('/')}/backups/archive"
            pa_upload(cfg['username'], token,
                      to_api_path(f'{remote_backups}/{ts}.zip'),
                      f'{ts}.zip', arch.read_bytes())
            ok('архив залит на сервер (доступен в консоли)')
        except RuntimeError as e:
            warn(f'не удалось залить архив: {e}')

    prune_backups(backups_root, cfg.get('backup_keep', 20))
    return dest

def cmd_restore(cfg, token, name: str = None):
    if not token:
        err('Не указан API token'); sys.exit(1)
    backups_root = SCRIPT_DIR / cfg['backup_dir']
    backups = list_backups(backups_root)
    if not backups:
        err('Локальных бэкапов нет'); sys.exit(1)

    if name:
        match = [b for b in backups if b[0] == name]
        if not match:
            err(f'Бэкап «{name}» не найден'); sys.exit(1)
        target = match[0]
    else:
        target = backups[0]

    src = target[2]
    step(f'Восстановление из {BOLD(src.name)} на сервер')
    uploaded = upload_state(cfg, token, src)
    ok(f'залито: {len(uploaded)} файлов')
    for rel in uploaded[:10]:
        log(DIM(f'    · {rel}'))
    if len(uploaded) > 10:
        log(DIM(f'    · … и ещё {len(uploaded)-10}'))
    return uploaded

# ---------------------------------------------------------------------------
# Основной деплой
# ---------------------------------------------------------------------------
def cmd_deploy(cfg, token, args):
    if not cfg['username'] or not cfg['domain'] or not token:
        err('Проверь username / domain / token в конфиге'); sys.exit(1)

    remote_base = cfg['remote_base'].rstrip('/')
    local_files = iter_local_files(cfg)
    if not local_files:
        warn('Файлов для заливки нет'); return

    # ---- 1. БЭКАП ----
    backup_dir = None
    if not args.no_backup:
        backup_dir = cmd_backup(cfg, token, push_remote=True)
        log('')

    # ---- 2. ЗАЛИВКА КОДА ----
    step(f'Заливка кода: {BOLD(str(len(local_files)))} файлов')
    info(f'Локально : {SCRIPT_DIR / cfg["local_base"]}')
    info(f'Удалённо : {cfg["username"]}@{cfg["domain"]} → {remote_base}')
    if args.dry_run: warn('DRY-RUN: ничего не заливается')
    log('')

    uploaded, skipped, failed = [], [], []
    for rel, local_path in local_files:
        remote = f'{remote_base}/{rel}'
        api = to_api_path(remote)
        data = local_path.read_bytes()
        lh = sha256(data)
        size_kb = len(data) / 1024

        try:
            rh = None
            if not args.all and not args.dry_run:
                remote_bytes = pa_get_file(cfg['username'], token, api)
                if remote_bytes is not None:
                    rh = sha256(remote_bytes)

            if rh == lh and not args.all:
                skipped.append(rel)
                print(DIM(f'  ·  {rel}  (без изменений)')); continue

            tag = GREEN('NEW') if rh is None else YELLOW('UPDATE')
            print(f'  {tag:>18}  {rel}  {DIM(f"({size_kb:.1f} КБ)")}')
            if args.dry_run:
                uploaded.append(rel); continue
            pa_upload(cfg['username'], token, api, local_path.name, data)
            uploaded.append(rel)
        except RuntimeError as e:
            failed.append((rel, str(e)))
            print(f'  {RED("FAIL"):>18}  {rel}  {DIM(str(e))}')

    # ---- 3. ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ ----
    if backup_dir and not args.dry_run:
        log('')
        step('Восстановление состояния из бэкапа')
        restored = upload_state(cfg, token, backup_dir)
        ok(f'восстановлено: {len(restored)} файлов')

    # ---- 4. RELOAD ----
    if args.reload and not args.dry_run:
        log('')
        step('Перезапуск веб-приложения…')
        try:
            pa_reload(cfg['username'], token, cfg['domain'])
            ok('Сайт перезапущен — изменения в проде')
        except RuntimeError as e:
            err(f'Не удалось перезапустить: {e}')

    # ---- Итог ----
    log('')
    log(BOLD('— Итог —'))
    log(f'  {GREEN("залито")}    : {len(uploaded)}')
    log(f'  {DIM("пропущено")}  : {len(skipped)}')
    if failed:
        log(f'  {RED("ошибок")}    : {len(failed)}')
        for rel, m in failed: err(f'{rel}: {m}')
    if backup_dir:
        log(f'  {CYAN("бэкап")}     : {backup_dir.relative_to(SCRIPT_DIR)}')
    log('')
    if failed: sys.exit(2)

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(prog='deploy',
        description='Деплой + бэкап библиотеки на PythonAnywhere')
    p.add_argument('--init',          action='store_true', help='создать .deploy_config.json')
    p.add_argument('--all',           action='store_true', help='залить все файлы кода')
    p.add_argument('--dry-run',       action='store_true', help='показать план без действий')
    p.add_argument('--reload',        action='store_true', help='перезапустить сайт после заливки')
    p.add_argument('--reload-only',   action='store_true', help='только перезапустить')
    p.add_argument('--no-backup',     action='store_true', help='не делать бэкап')
    p.add_argument('--backup-only',   action='store_true', help='только бэкап, без деплоя')
    p.add_argument('--restore',       action='store_true', help='восстановить из последнего бэкапа')
    p.add_argument('--restore-name',  type=str,            help='имя бэкапа для восстановления')
    p.add_argument('--list-backups',  action='store_true', help='показать список бэкапов')
    p.add_argument('--token',         type=str,            help='API token (иначе env PA_TOKEN / конфиг)')
    a = p.parse_args()

    if a.init:
        write_default_config(); return

    cfg = load_config()
    token = a.token or os.environ.get('PA_TOKEN') or cfg.get('token') or ''

    if a.list_backups:
        backups_root = SCRIPT_DIR / cfg['backup_dir']
        bl = list_backups(backups_root)
        if not bl:
            warn('Бэкапов нет'); return
        step(f'Локальные бэкапы ({len(bl)}):')
        for name, size, _ in bl:
            log(f'  {name}   {DIM(f"{size/1024:.1f} КБ")}')
        return

    if a.backup_only:
        cmd_backup(cfg, token, push_remote=True); return

    if a.restore or a.restore_name:
        cmd_restore(cfg, token, a.restore_name); return

    if a.reload_only:
        step('Перезапуск…')
        pa_reload(cfg['username'], token, cfg['domain'])
        ok('Готово'); return

    cmd_deploy(cfg, token, a)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print(); err('Прервано'); sys.exit(130)