from __future__ import annotations

import json
import mimetypes
import sqlite3
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from scripts.init_normalized_db import build_database


ROOT = Path(__file__).resolve().parent
MAIN_FILE = ROOT / "index.html"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "budget_mockup.db"
NORMALIZED_DB_PATH = DATA_DIR / "budget_wingest.db"
SCHEMA_PATH = ROOT / "schema.sql"
HOST = "127.0.0.1"
PORT = 8793
MAX_BODY_BYTES = 2 * 1024 * 1024


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize_database() -> None:
    with closing(connect()) as connection:
        with connection:
            connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    if read_state():
        sync_normalized_database()


def sync_normalized_database() -> None:
    """Rigenera il database interrogabile dopo ogni salvataggio della pagina."""
    build_database(DB_PATH, NORMALIZED_DB_PATH, replace=True)


def read_state() -> dict:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT payload_json FROM mockup_state WHERE id = 1"
        ).fetchone()
    if row is None:
        return {}
    return json.loads(row["payload_json"])


def read_analysis_summary(budget_key: str) -> dict:
    """Legge i riepiloghi calcolati dalle viste del database relazionale."""
    if not NORMALIZED_DB_PATH.is_file():
        return {"levels": [], "items": []}
    with closing(sqlite3.connect(NORMALIZED_DB_PATH)) as connection:
        connection.row_factory = sqlite3.Row
        levels = connection.execute(
            """
            SELECT source_key, level_code, level_name, funding_source,
                   revenue_cents, cost_cents
            FROM v_budget_level_summary
            WHERE budget_source_key = ?
            ORDER BY budget_level_id
            """,
            (budget_key,),
        ).fetchall()
        items = connection.execute(
            """
            SELECT totals.source_key, totals.level_code, totals.voice,
                   totals.nature, totals.updated_amount_cents
            FROM v_budget_item_totals AS totals
            JOIN budget_level AS level ON level.id = totals.budget_level_id
            JOIN budget ON budget.id = level.budget_id
            WHERE budget.source_key = ?
            ORDER BY totals.budget_item_id
            """,
            (budget_key,),
        ).fetchall()
    return {"levels": [dict(row) for row in levels], "items": [dict(row) for row in items]}


def write_state(payload: dict) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with closing(connect()) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO mockup_state (id, payload_json, updated_at)
                VALUES (1, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (encoded,),
            )
    sync_normalized_database()


def reset_state() -> None:
    with closing(connect()) as connection:
        with connection:
            connection.execute("DELETE FROM mockup_state WHERE id = 1")


class BudgetHandler(BaseHTTPRequestHandler):
    server_version = "WingestBudgetMockup/1.0"

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/state":
            self.send_json(200, read_state())
            return
        if path == "/api/analysis":
            budget_key = parse_qs(parsed.query).get("budgetId", [""])[0]
            if not budget_key:
                self.send_json(400, {"error": "budgetId obbligatorio"})
                return
            self.send_json(200, read_analysis_summary(budget_key))
            return
        if path == "/api/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "stateDatabase": DB_PATH.name,
                    "queryDatabase": NORMALIZED_DB_PATH.name,
                },
            )
            return
        self.serve_file(path)

    def do_PUT(self) -> None:
        if urlparse(self.path).path != "/api/state":
            self.send_json(404, {"error": "Risorsa non trovata"})
            return
        payload = self.read_json_body()
        if payload is None:
            return
        required = {"budgets", "adjustments", "capexComponents", "ordinaryRows", "investmentRows"}
        if not required.issubset(payload):
            self.send_json(400, {"error": "Stato incompleto", "required": sorted(required)})
            return
        write_state(payload)
        self.send_json(200, {"ok": True})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/reset":
            self.send_json(404, {"error": "Risorsa non trovata"})
            return
        reset_state()
        self.send_json(200, {"ok": True})

    def read_json_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Content-Length non valido"})
            return None
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "Payload assente o troppo grande"})
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "JSON non valido"})
            return None
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "Il payload deve essere un oggetto JSON"})
            return None
        return payload

    def serve_file(self, request_path: str) -> None:
        if request_path in {"", "/"}:
            target = MAIN_FILE
        else:
            relative = Path(unquote(request_path.lstrip("/")))
            target = (ROOT / relative).resolve()
            if ROOT not in target.parents and target != ROOT:
                self.send_error(403, "Percorso non consentito")
                return
        if not target.is_file():
            self.send_error(404, "File non trovato")
            return
        body = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), BudgetHandler)
    print("Mockup Budget Analitico Wingest")
    print(f"Apri nel browser: http://{HOST}:{PORT}")
    print(f"Database SQLite: {DB_PATH}")
    print(f"Database SQL interrogabile: {NORMALIZED_DB_PATH}")
    print("Premi CTRL+C per fermare il server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("Server arrestato.")


if __name__ == "__main__":
    main()
