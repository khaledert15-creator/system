#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
خادم تطوير محلي لنظام مكتبة دوت كوم (نسخة Python للماك/لينكس).
يطابق سلوك server.ps1 الأصلي: نفس الـ API، الجلسات، النسخ الاحتياطي، وفحص التعارض.

التشغيل:  python3 server.py
ثم افتح:  http://127.0.0.1:8765/
"""
import hashlib
import json
import os
import shutil
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.join(PROJECT_ROOT, "app")
DATA_ROOT = os.path.join(PROJECT_ROOT, "data")
BACKUP_ROOT = os.path.join(DATA_ROOT, "backups")
LOG_ROOT = os.path.join(PROJECT_ROOT, "logs")
DATABASE_PATH = os.path.join(DATA_ROOT, "database.json")
LOG_PATH = os.path.join(LOG_ROOT, "server.log")
PORT = 8765
SESSION_HOURS = 12

for path in (DATA_ROOT, BACKUP_ROOT, LOG_ROOT):
    os.makedirs(path, exist_ok=True)

# جلسات في الذاكرة: token -> { "user": {...}, "expires": datetime }
SESSIONS = {}
SESSIONS_LOCK = threading.Lock()
SAVE_LOCK = threading.Lock()
LAST_DAILY_BACKUP_DATE = None

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

DEFAULT_USERS = [
    {"id": "U001", "username": "owner", "name": "System Owner", "role": "owner", "salt": "s01", "passwordHash": "2dbab9e2692dc22862154db758fd08face95e6d15b5fb2390995dad66bd0452c", "active": True},
    {"id": "U002", "username": "manager", "name": "System Manager", "role": "manager", "salt": "s02", "passwordHash": "a29c2fcb2de4e5175719cb5dfed4043da44b9baa5a87430eba6d1223e488d563", "active": True},
    {"id": "U003", "username": "accountant", "name": "Accountant", "role": "accountant", "salt": "s03", "passwordHash": "6b44de984c5a4ce8691a0bef70b679e88135ad7f4d05a11ffef3cc04e8c76a85", "active": True},
    {"id": "U004", "username": "cashier", "name": "Cashier", "role": "cashier", "salt": "s04", "passwordHash": "440aade91695513e752ac4ce674d1639c3ed697d0c4d2806edc15bd073e0aa61", "active": True},
    {"id": "U005", "username": "warehouse", "name": "Warehouse", "role": "warehouse", "salt": "s05", "passwordHash": "5c37d675c0fffbedd0f6acd3d75d409ee5c3a336574a058b575de03aeda5e9fd", "active": True},
    {"id": "U006", "username": "shipping", "name": "Shipping", "role": "shipping", "salt": "s06", "passwordHash": "7a53924916afbcba18d1f58c093f7fe110f88539803186401fdb2f280a769000", "active": True},
]


def write_log(message):
    line = "{0}  {1}\n".format(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), message)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as handle:
            handle.write(line)
    except OSError:
        pass


def password_hash(salt, password):
    return hashlib.sha256("{0}:{1}".format(salt, password).encode("utf-8")).hexdigest()


def get_users():
    if os.path.exists(DATABASE_PATH):
        try:
            with open(DATABASE_PATH, "r", encoding="utf-8") as handle:
                db = json.load(handle)
            if isinstance(db.get("users"), list) and db["users"]:
                return db["users"]
        except (OSError, ValueError):
            pass
    return DEFAULT_USERS


def database_revision():
    if not os.path.exists(DATABASE_PATH):
        return "0"
    stat = os.stat(DATABASE_PATH)
    return "{0}-{1}".format(stat.st_mtime_ns, stat.st_size)


def new_backup():
    """ينشئ نسخة احتياطية ويحتفظ بأحدث 30 نسخة. يرجع مسار النسخة أو None."""
    if not os.path.exists(DATABASE_PATH):
        return None
    name = "database-{0}.json".format(datetime.now().strftime("%Y%m%d-%H%M%S-") + "%03d" % (datetime.now().microsecond // 1000))
    destination = os.path.join(BACKUP_ROOT, name)
    shutil.copy2(DATABASE_PATH, destination)
    backups = sorted(
        (entry for entry in os.scandir(BACKUP_ROOT) if entry.name.startswith("database-") and entry.name.endswith(".json")),
        key=lambda e: e.stat().st_mtime,
        reverse=True,
    )
    for stale in backups[30:]:
        try:
            os.remove(stale.path)
        except OSError:
            pass
    return destination


def save_database(body_text):
    """يتحقق من صحة البنية قبل الاستبدال، ثم يكتب بشكل ذرّي."""
    parsed = json.loads(body_text)
    if parsed.get("books") is None or parsed.get("sales") is None or parsed.get("settings") is None:
        raise ValueError("Invalid database structure.")
    temp_path = DATABASE_PATH + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        handle.write(body_text)
    os.replace(temp_path, DATABASE_PATH)


def session_user(headers):
    token = headers.get("X-Session-Token")
    if not token:
        return None
    with SESSIONS_LOCK:
        session = SESSIONS.get(token)
        if session is None:
            return None
        if session["expires"] < datetime.now():
            SESSIONS.pop(token, None)
            return None
        session["expires"] = datetime.now() + timedelta(hours=SESSION_HOURS)
        return session["user"]


class Handler(BaseHTTPRequestHandler):
    server_version = "DotComLibrary/py"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # كتم سجل http.server الافتراضي
        pass

    # ---- أدوات الرد ----
    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._extra_headers()
        self.end_headers()
        self.wfile.write(payload)

    def send_text(self, status, text, content_type="text/plain; charset=utf-8", extra=None):
        payload = text.encode("utf-8") if isinstance(text, str) else text
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        if extra:
            for key, value in extra.items():
                self.send_header(key, value)
        self._extra_headers()
        self.end_headers()
        self.wfile.write(payload)

    def _extra_headers(self):
        pass

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return ""
        return self.rfile.read(length).decode("utf-8")

    def require_auth(self, roles=None):
        """يرجع المستخدم أو None (ويرسل 401/403 تلقائيًا)."""
        user = session_user(self.headers)
        if user is None:
            self.send_json(401, {"ok": False, "message": "Authentication required."})
            return None
        if roles and user.get("username") not in roles:
            self.send_json(403, {"ok": False, "message": "Permission denied."})
            return None
        return user

    def maybe_daily_backup(self):
        global LAST_DAILY_BACKUP_DATE
        today = datetime.now().date()
        if LAST_DAILY_BACKUP_DATE is None or LAST_DAILY_BACKUP_DATE < today:
            with SAVE_LOCK:
                new_backup()
            LAST_DAILY_BACKUP_DATE = today

    # ---- التوجيه ----
    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def route(self, method):
        try:
            path = unquote(urlparse(self.path).path)
            self.maybe_daily_backup()

            if path == "/api/health" and method == "GET":
                self.send_json(200, {"ok": True, "database": os.path.exists(DATABASE_PATH), "time": datetime.now(timezone.utc).isoformat()})
                return

            if path == "/api/login" and method == "POST":
                self.handle_login()
                return

            if path == "/api/session" and method == "GET":
                user = session_user(self.headers)
                if user is None:
                    self.send_json(401, {"ok": False})
                else:
                    self.send_json(200, {"ok": True, "user": user})
                return

            if path == "/api/logout" and method == "POST":
                token = self.headers.get("X-Session-Token")
                if token:
                    with SESSIONS_LOCK:
                        SESSIONS.pop(token, None)
                self.send_json(200, {"ok": True})
                return

            if path == "/api/db" and method == "GET":
                self.handle_db_get()
                return

            if path == "/api/db" and method == "PUT":
                self.handle_db_put()
                return

            if path == "/api/backup" and method == "POST":
                self.handle_backup()
                return

            if path == "/api/backups" and method == "GET":
                self.handle_backups_list()
                return

            if path == "/api/restore" and method == "POST":
                self.handle_restore()
                return

            if path == "/api/reset" and method == "POST":
                self.send_json(403, {"ok": False, "message": "Database reset is disabled."})
                return

            if path.startswith("/api/"):
                self.send_json(404, {"ok": False, "message": "API route not found."})
                return

            self.serve_static(path)
        except Exception as error:  # noqa: BLE001 — مطابقة سلوك الخادم الأصلي
            write_log("Request error: {0}".format(error))
            try:
                self.send_json(500, {"ok": False, "message": "Internal server error.", "detail": str(error)})
            except OSError:
                pass

    # ---- معالجات الـ API ----
    def handle_login(self):
        payload = json.loads(self.read_body() or "{}")
        username = payload.get("username")
        password = payload.get("password", "")
        user = next((u for u in get_users() if u.get("username") == username and u.get("active") is not False), None)
        if user is None or password_hash(user.get("salt", ""), password) != user.get("passwordHash"):
            time.sleep(0.35)
            self.send_json(401, {"ok": False, "message": "Invalid username or password."})
            return
        token = uuid.uuid4().hex
        safe_user = {"id": user["id"], "username": user["username"], "name": user["name"], "role": user["role"]}
        with SESSIONS_LOCK:
            SESSIONS[token] = {"user": safe_user, "expires": datetime.now() + timedelta(hours=SESSION_HOURS)}
        self.send_json(200, {"ok": True, "token": token, "user": safe_user})
        write_log("Login: {0}".format(user["username"]))

    def handle_db_get(self):
        if self.require_auth() is None:
            return
        if not os.path.exists(DATABASE_PATH):
            self.send_json(404, {"ok": False, "message": "Database has not been initialized."})
            return
        with open(DATABASE_PATH, "r", encoding="utf-8") as handle:
            body = handle.read()
        self.send_text(200, body, "application/json; charset=utf-8", extra={"X-DB-Revision": database_revision()})

    def handle_db_put(self):
        if self.require_auth() is None:
            return
        expected_revision = self.headers.get("If-Match")
        current_revision = database_revision()
        if expected_revision and expected_revision != current_revision:
            self.send_json(409, {"ok": False, "message": "Data was modified in another window. Reload before saving.", "revision": current_revision})
            return
        body = self.read_body()
        with SAVE_LOCK:
            if os.path.exists(DATABASE_PATH):
                new_backup()
            try:
                save_database(body)
            except ValueError as error:
                self.send_json(500, {"ok": False, "message": "Internal server error.", "detail": str(error)})
                return
            revision = database_revision()
        self.send_text(200, json.dumps({"ok": True, "message": "Database saved successfully.", "revision": revision}, ensure_ascii=False),
                       "application/json; charset=utf-8", extra={"X-DB-Revision": revision})

    def handle_backup(self):
        if self.require_auth(roles=("owner", "manager", "accountant")) is None:
            return
        with SAVE_LOCK:
            backup = new_backup()
        if backup is None:
            self.send_json(404, {"ok": False, "message": "There is no database to back up."})
        else:
            self.send_json(200, {"ok": True, "file": os.path.basename(backup)})

    def handle_backups_list(self):
        if self.require_auth(roles=("owner", "manager")) is None:
            return
        entries = sorted(
            (e for e in os.scandir(BACKUP_ROOT) if e.name.startswith("database-") and e.name.endswith(".json")),
            key=lambda e: e.stat().st_mtime,
            reverse=True,
        )[:30]
        files = [
            {"name": e.name, "date": datetime.fromtimestamp(e.stat().st_mtime).astimezone().isoformat(), "size": e.stat().st_size}
            for e in entries
        ]
        self.send_json(200, {"ok": True, "backups": files})

    def handle_restore(self):
        user = self.require_auth(roles=("owner", "manager"))
        if user is None:
            return
        payload = json.loads(self.read_body() or "{}")
        file_name = os.path.basename(str(payload.get("file", "")))
        source = os.path.join(BACKUP_ROOT, file_name)
        if not file_name or not os.path.exists(source):
            self.send_json(404, {"ok": False, "message": "Backup not found."})
            return
        with SAVE_LOCK:
            new_backup()
            shutil.copy2(source, DATABASE_PATH)
            revision = database_revision()
        self.send_json(200, {"ok": True, "revision": revision})
        write_log("Database restored by {0}: {1}".format(user["username"], file_name))

    # ---- الملفات الثابتة ----
    def serve_static(self, path):
        relative = "index.html" if path == "/" else path.lstrip("/")
        candidate = os.path.join(APP_ROOT, relative.replace("/", os.sep))
        resolved = os.path.abspath(candidate)
        app_resolved = os.path.abspath(APP_ROOT)
        if not (resolved == app_resolved or resolved.startswith(app_resolved + os.sep)):
            self.send_text(403, "Forbidden")
            return
        if not os.path.isfile(resolved):
            self.send_text(404, "Not found")
            return
        with open(resolved, "rb") as handle:
            payload = handle.read()
        ext = os.path.splitext(resolved)[1].lower()
        self.send_text(200, payload, CONTENT_TYPES.get(ext, "application/octet-stream"), extra={"Cache-Control": "no-cache"})


def main():
    global LAST_DAILY_BACKUP_DATE
    if os.path.exists(DATABASE_PATH):
        new_backup()
        LAST_DAILY_BACKUP_DATE = datetime.now().date()
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    write_log("Server started on http://127.0.0.1:{0}/".format(PORT))
    print("نظام مكتبة دوت كوم يعمل الآن على:  http://127.0.0.1:{0}/".format(PORT))
    print("اضغط Ctrl+C لإيقاف الخادم.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        write_log("Server stopped.")
        print("\nتم إيقاف الخادم.")


if __name__ == "__main__":
    main()
