import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    garmin_tokens TEXT,
    garmin_name TEXT,
    -- Survives disconnect, so a different account on reconnect is detected.
    garmin_account TEXT,
    last_sync_at TEXT,
    last_sync_error TEXT
);
CREATE TABLE IF NOT EXISTS activities (
    uid TEXT NOT NULL,
    activity_id INTEGER NOT NULL,
    name TEXT,
    type_key TEXT NOT NULL,
    start_local TEXT NOT NULL,
    distance_m REAL,
    duration_s REAL,
    moving_s REAL,
    avg_hr REAL,
    max_hr REAL,
    elevation_gain_m REAL,
    raw TEXT NOT NULL,
    PRIMARY KEY (uid, activity_id)
);
CREATE INDEX IF NOT EXISTS activities_uid_start ON activities (uid, start_local);
"""

ACTIVITY_COLUMNS = (
    "activity_id",
    "name",
    "type_key",
    "start_local",
    "distance_m",
    "duration_s",
    "moving_s",
    "avg_hr",
    "max_hr",
    "elevation_gain_m",
)


class Database:
    def __init__(self, path: str) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            columns = {r["name"] for r in self._conn.execute("PRAGMA table_info(users)")}
            if "garmin_account" not in columns:
                self._conn.execute("ALTER TABLE users ADD COLUMN garmin_account TEXT")

    def get_user(self, uid: str) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute("SELECT * FROM users WHERE uid = ?", (uid,)).fetchone()

    def save_garmin_session(
        self, uid: str, encrypted_tokens: str, garmin_name: str | None, garmin_account: str | None
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT INTO users (uid, garmin_tokens, garmin_name, garmin_account) VALUES (?, ?, ?, ?)
                   ON CONFLICT(uid) DO UPDATE SET garmin_tokens = excluded.garmin_tokens,
                                                  garmin_name = excluded.garmin_name,
                                                  garmin_account = excluded.garmin_account""",
                (uid, encrypted_tokens, garmin_name, garmin_account),
            )

    def garmin_account(self, uid: str) -> str | None:
        user = self.get_user(uid)
        return user["garmin_account"] if user else None

    def update_garmin_tokens(self, uid: str, encrypted_tokens: str) -> None:
        """Replace refreshed tokens; a disconnect that happened meanwhile wins."""
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE users SET garmin_tokens = ? WHERE uid = ? AND garmin_tokens IS NOT NULL",
                (encrypted_tokens, uid),
            )

    def clear_garmin_session(self, uid: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE users SET garmin_tokens = NULL, garmin_name = NULL WHERE uid = ?", (uid,))

    def set_sync_result(self, uid: str, finished_at: str, error: str | None) -> None:
        with self._lock, self._conn:
            if error is None:
                self._conn.execute(
                    "UPDATE users SET last_sync_at = ?, last_sync_error = NULL WHERE uid = ?", (finished_at, uid)
                )
            else:
                self._conn.execute("UPDATE users SET last_sync_error = ? WHERE uid = ?", (error, uid))

    def upsert_activities(self, uid: str, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        with self._lock, self._conn:
            self._conn.executemany(
                f"""INSERT INTO activities (uid, {", ".join(ACTIVITY_COLUMNS)}, raw)
                    VALUES (?, {", ".join("?" for _ in ACTIVITY_COLUMNS)}, ?)
                    ON CONFLICT(uid, activity_id) DO UPDATE SET
                    {", ".join(f"{c} = excluded.{c}" for c in ACTIVITY_COLUMNS[1:])}, raw = excluded.raw""",
                [(uid, *(r[c] for c in ACTIVITY_COLUMNS), json.dumps(r["raw"])) for r in rows],
            )
        return len(rows)

    def delete_activities(self, uid: str) -> int:
        with self._lock, self._conn:
            return self._conn.execute("DELETE FROM activities WHERE uid = ?", (uid,)).rowcount

    def delete_activities_missing(self, uid: str, date_from: str, date_to: str, keep_ids: list[int]) -> int:
        """Delete activities dated in [date_from, date_to] whose ids are not in keep_ids."""
        with self._lock, self._conn:
            self._conn.execute("CREATE TEMP TABLE IF NOT EXISTS keep_ids (id INTEGER PRIMARY KEY)")
            self._conn.execute("DELETE FROM keep_ids")
            self._conn.executemany("INSERT OR IGNORE INTO keep_ids (id) VALUES (?)", [(i,) for i in keep_ids])
            removed = self._conn.execute(
                """DELETE FROM activities
                   WHERE uid = ? AND substr(start_local, 1, 10) BETWEEN ? AND ?
                     AND activity_id NOT IN (SELECT id FROM keep_ids)""",
                (uid, date_from, date_to),
            ).rowcount
            self._conn.execute("DELETE FROM keep_ids")
        return removed

    def latest_activity_start(self, uid: str) -> str | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT MAX(start_local) AS m FROM activities WHERE uid = ?", (uid,)
            ).fetchone()
        return row["m"] if row else None

    def list_activities(self, uid: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
        """Activities whose local start date falls in [date_from, date_to] (YYYY-MM-DD, inclusive)."""
        with self._lock:
            rows = self._conn.execute(
                f"""SELECT {", ".join(ACTIVITY_COLUMNS)},
                           -- Garmin's VO2max estimate recorded with the activity, when it made one.
                           json_extract(raw, '$.vO2MaxValue') AS vo2max
                    FROM activities
                    WHERE uid = ? AND substr(start_local, 1, 10) BETWEEN ? AND ?
                    ORDER BY start_local""",
                (uid, date_from, date_to),
            ).fetchall()
        return [dict(r) for r in rows]

    def count_activities(self, uid: str) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM activities WHERE uid = ?", (uid,)).fetchone()[0]
