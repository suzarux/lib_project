# -*- coding: utf-8 -*-
"""
admin_console.py — приватная консоль suzarux.
by suzarux — demo v0.1.4 build 191906102026

Подключение (одна строка в server.py):
    from admin_console import console_bp
    app.register_blueprint(console_bp)

Доступ: только пользователь с логином ADMIN_LOGIN.
URL:    /console
"""
import io
import json
import os
import re
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

from flask import (Blueprint, jsonify, render_template, request, session,
                   send_file, abort)

# ---------------------------------------------------------------------------
ADMIN_LOGIN   = 'suzarux'
BASE_DIR      = Path(__file__).resolve().parent
BACKUPS_DIR   = BASE_DIR / 'backups'
BACKUPS_DIR.mkdir(exist_ok=True)

# Файлы/папки, которые бэкапит консоль (те же, что и deploy.py)
STATE_ITEMS = ['users.txt', '.secret_key', 'userdata']

# Сколько последних бэкапов хранить
KEEP_BACKUPS = 20

# Таймаут команды (секунды)
CMD_TIMEOUT = 20

# Белый список безопасных команд (regex)
SAFE_COMMANDS = [
    r'^ls(\s|$)',
    r'^cat\s[\w./\-]+$',
    r'^head(\s|$)',
    r'^tail(\s|$)',
    r'^wc(\s|$)',
    r'^du(\s|$)',
    r'^df(\s|$)',
    r'^free(\s|$)',
    r'^uptime$',
    r'^date$',
    r'^whoami$',
    r'^pwd$',
    r'^echo\s',
    r'^find\s[\w./\-]+(\s|$)',
    r'^grep\s',
    r'^git\s(status|log|pull|fetch|branch|diff|remote)(\s|$)',
    r'^pip\s(list|show|freeze)(\s|$)',
    r'^python3?\s--version$',
    r'^pip\s--version$',
    r'^python3?\s-m\s--version$',
    r'^python3?\s-c\s[\'"].+[\'"]$',
    r'^sqlite3\s',
    r'^curl\s',
    r'^df\s',
]

# Команды, которые запрещены всегда (дополнительная защита)
FORBIDDEN = re.compile(
    r'(rm\s+-rf|mkfs|dd\s+if|:\(\)\s*\{|shutdown|reboot|init\s+0|'
    r'chmod\s+777\s+/|chown\s+.*\s+/|>\s*/dev/|/etc/passwd|'
    r'wget\s+.*\|\s*sh|curl\s+.*\|\s*sh)', re.IGNORECASE
)

console_bp = Blueprint('console', __name__, static_folder=None)

# ---------------------------------------------------------------------------
# Guard
# ---------------------------------------------------------------------------
@console_bp.before_request
def _guard():
    if session.get('user') != ADMIN_LOGIN:
        abort(403)

# ---------------------------------------------------------------------------
# Утилиты
# ---------------------------------------------------------------------------
def _ts() -> str:
    return time.strftime('%Y-%m-%d_%H-%M-%S')

def _dir_size(p: Path) -> int:
    total = 0
    for f in p.rglob('*'):
        if f.is_file():
            try: total += f.stat().st_size
            except OSError: pass
    return total

def _list_backups():
    if not BACKUPS_DIR.exists(): return []
    out = []
    for d in sorted(BACKUPS_DIR.iterdir(), key=lambda x: x.name, reverse=True):
        if d.is_dir() and d.name != 'archive':
            out.append({
                'name': d.name,
                'size': _dir_size(d),
                'files': sum(1 for _ in d.rglob('*') if _.is_file()),
            })
    return out

def _make_backup() -> Path:
    ts = _ts()
    dest = BACKUPS_DIR / ts
    dest.mkdir(parents=True, exist_ok=True)
    for item in STATE_ITEMS:
        src = BASE_DIR / item
        if not src.exists(): continue
        dst = dest / item
        if src.is_dir():
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    # архив
    arch_dir = BACKUPS_DIR / 'archive'
    arch_dir.mkdir(exist_ok=True)
    arch = arch_dir / f'{ts}.zip'
    with zipfile.ZipFile(arch, 'w', zipfile.ZIP_DEFLATED) as zf:
        for p in dest.rglob('*'):
            if p.is_file():
                zf.write(p, p.relative_to(dest).as_posix())
    _prune()
    return dest

def _restore_backup(name: str) -> int:
    src = BACKUPS_DIR / name
    if not src.is_dir() or name == 'archive':
        raise FileNotFoundError(name)
    count = 0
    for item in STATE_ITEMS:
        s = src / item
        if not s.exists(): continue
        d = BASE_DIR / item
        if s.is_dir():
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)
            shutil.copytree(s, d)
            count += sum(1 for _ in d.rglob('*') if _.is_file())
        else:
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)
            count += 1
    return count

def _delete_backup(name: str):
    if name in ('archive', '', '.', '..'): return
    d = BACKUPS_DIR / name
    if d.is_dir(): shutil.rmtree(d, ignore_errors=True)
    z = BACKUPS_DIR / 'archive' / f'{name}.zip'
    if z.is_file(): z.unlink()

def _prune():
    dirs = sorted([d for d in BACKUPS_DIR.iterdir()
                   if d.is_dir() and d.name != 'archive'],
                  key=lambda d: d.name, reverse=True)
    for d in dirs[KEEP_BACKUPS:]: shutil.rmtree(d, ignore_errors=True)
    arch = BACKUPS_DIR / 'archive'
    if arch.exists():
        zips = sorted([z for z in arch.iterdir() if z.suffix == '.zip'],
                      key=lambda z: z.name, reverse=True)
        for z in zips[KEEP_BACKUPS:]:
            try: z.unlink()
            except OSError: pass

def _backup_zip(name: str) -> bytes:
    src = BACKUPS_DIR / name
    if not src.is_dir() or name == 'archive':
        raise FileNotFoundError(name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for p in src.rglob('*'):
            if p.is_file():
                zf.write(p, p.relative_to(src).as_posix())
    buf.seek(0)
    return buf.read()

def _command_allowed(cmd: str) -> bool:
    cmd = cmd.strip()
    if not cmd: return False
    if FORBIDDEN.search(cmd): return False
    for pat in SAFE_COMMANDS:
        if re.match(pat, cmd, re.IGNORECASE):
            return True
    return False

def _run_command(cmd: str) -> dict:
    if not _command_allowed(cmd):
        return {'error': 'Команда не в белом списке. Разрешены: ls, cat, head, tail, '
                          'wc, du, df, grep, find, git status/log/pull, pip list, '
                          'uptime, date, whoami, pwd, echo и т.п.'}
    try:
        proc = subprocess.run(
            cmd, shell=True, cwd=str(BASE_DIR),
            capture_output=True, text=True, timeout=CMD_TIMEOUT
        )
        return {
            'stdout': (proc.stdout or '')[-8000:],
            'stderr': (proc.stderr or '')[-4000:],
            'code': proc.returncode,
        }
    except subprocess.TimeoutExpired:
        return {'error': f'Таймаут {CMD_TIMEOUT} с'}
    except Exception as e:
        return {'error': str(e)}

# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------
@console_bp.route('/console')
def page():
    return render_template('console.html')

# ---------------------------------------------------------------------------
# API: бэкапы
# ---------------------------------------------------------------------------
@console_bp.route('/console/api/backups')
def api_list():
    return jsonify(backups=_list_backups(),
                   keep=KEEP_BACKUPS,
                   state=STATE_ITEMS,
                   base=str(BASE_DIR))

@console_bp.route('/console/api/backups/create', methods=['POST'])
def api_create():
    try:
        p = _make_backup()
        return jsonify(ok=True, name=p.name, size=_dir_size(p))
    except Exception as e:
        return jsonify(error=str(e)), 500

@console_bp.route('/console/api/backups/restore', methods=['POST'])
def api_restore():
    body = request.get_json(silent=True) or {}
    name = str(body.get('name', ''))
    if not name:
        return jsonify(error='Не указано имя бэкапа'), 400
    try:
        n = _restore_backup(name)
        return jsonify(ok=True, files=n)
    except FileNotFoundError:
        return jsonify(error='Бэкап не найден'), 404
    except Exception as e:
        return jsonify(error=str(e)), 500

@console_bp.route('/console/api/backups/delete', methods=['POST'])
def api_delete():
    body = request.get_json(silent=True) or {}
    name = str(body.get('name', ''))
    if not name:
        return jsonify(error='Не указано имя'), 400
    _delete_backup(name)
    return jsonify(ok=True)

@console_bp.route('/console/api/backups/download/<name>')
def api_download(name):
    try:
        data = _backup_zip(name)
    except FileNotFoundError:
        return jsonify(error='Бэкап не найден'), 404
    return send_file(
        io.BytesIO(data),
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'backup_{name}.zip'
    )

# ---------------------------------------------------------------------------
# API: команды и система
# ---------------------------------------------------------------------------
@console_bp.route('/console/api/exec', methods=['POST'])
def api_exec():
    body = request.get_json(silent=True) or {}
    cmd = str(body.get('cmd', '')).strip()
    if not cmd:
        return jsonify(error='Пустая команда'), 400
    return jsonify(cmd=cmd, **_run_command(cmd))

@console_bp.route('/console/api/system')
def api_system():
    import platform, sys
    try:
        disk = shutil.disk_usage(BASE_DIR)
        disk_info = {'total': disk.total, 'used': disk.used, 'free': disk.free}
    except Exception:
        disk_info = {}
    try:
        import resource
        mem_used = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    except Exception:
        mem_used = 0

    userdata = BASE_DIR / 'userdata'
    return jsonify(
        time=time.strftime('%Y-%m-%d %H:%M:%S'),
        python=sys.version.split()[0],
        platform=platform.platform(),
        base=str(BASE_DIR),
        userdata_files=sum(1 for _ in userdata.rglob('*') if _.is_file()) if userdata.exists() else 0,
        backups_count=len(_list_backups()),
        disk=disk_info,
        mem_used_kb=mem_used,
    )

@console_bp.route('/console/api/commands')
def api_commands():
    return jsonify(allowed=[p for p in SAFE_COMMANDS])