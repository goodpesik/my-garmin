"""Garmin Connect access through the unofficial `garminconnect` client.

The Garmin password is used once to obtain session tokens and is never stored.
Tokens are kept encrypted in the database and refreshed by the client itself.
"""

import logging
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from .db import Database

logger = logging.getLogger("my_garmin.garmin")

MFA_TTL_SECONDS = 300
# The first sync pulls the whole history; Garmin Connect has no data before this.
HISTORY_START = date(2000, 1, 1)
# Re-read a few days before the newest stored activity: edits made in Garmin
# Connect after the previous sync (renamed, trimmed) replace the stored copy.
RESYNC_OVERLAP_DAYS = 3


class GarminLoginError(Exception):
    """Login failed for a reason the user can act on; message is shown to them."""


class GarminNotConnected(Exception):
    pass


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:2]}…@{domain}" if domain else "…"


def activity_row(a: dict[str, Any]) -> dict[str, Any] | None:
    """Map a Garmin activity summary to a stored row; None when it lacks the identity fields."""
    activity_id = a.get("activityId")
    start = a.get("startTimeLocal")
    type_key = (a.get("activityType") or {}).get("typeKey")
    if activity_id is None or not start or not type_key:
        return None
    return {
        "activity_id": int(activity_id),
        "name": a.get("activityName"),
        "type_key": type_key,
        "start_local": start,
        "distance_m": a.get("distance"),
        "duration_s": a.get("duration"),
        "moving_s": a.get("movingDuration"),
        "avg_hr": a.get("averageHR"),
        "max_hr": a.get("maxHR"),
        "elevation_gain_m": a.get("elevationGain"),
        "raw": a,
    }


@dataclass
class _PendingMfa:
    client: Garmin
    email: str
    expires_at: float


class GarminService:
    def __init__(self, db: Database, token_key: str) -> None:
        self._db = db
        self._fernet = Fernet(token_key.encode())
        self._pending: dict[str, _PendingMfa] = {}
        self._pending_lock = threading.Lock()
        self._sync_lock = threading.Lock()
        self._syncing: set[str] = set()

    # ---- login -------------------------------------------------------------

    def start_login(self, uid: str, email: str, password: str) -> str:
        """Returns "connected" or "mfa_required"."""
        client = Garmin(email=email, password=password, return_on_mfa=True)
        try:
            status, _ = client.login()
        except GarminConnectAuthenticationError as e:
            logger.warning("Garmin login rejected uid=%s email=%s: %s", uid, mask_email(email), e)
            raise GarminLoginError("Garmin не прийняв пошту або пароль.") from e
        except GarminConnectTooManyRequestsError as e:
            logger.warning("Garmin login rate limited uid=%s email=%s", uid, mask_email(email))
            raise GarminLoginError("Garmin тимчасово обмежив вхід. Спробуй за кілька хвилин.") from e
        except GarminConnectConnectionError as e:
            logger.warning("Garmin login connection error uid=%s email=%s: %s", uid, mask_email(email), e)
            raise GarminLoginError("Не вдалося зʼєднатися з Garmin. Спробуй ще раз.") from e
        except Exception as e:
            logger.exception("Garmin login failed unexpectedly uid=%s email=%s", uid, mask_email(email))
            raise GarminLoginError("Не вдалося підключити Garmin. Спробуй ще раз.") from e

        if status == "needs_mfa":
            with self._pending_lock:
                self._drop_expired_locked()
                self._pending[uid] = _PendingMfa(client, email, time.monotonic() + MFA_TTL_SECONDS)
            logger.info("Garmin login needs MFA uid=%s email=%s", uid, mask_email(email))
            return "mfa_required"

        # With return_on_mfa the library returns before loading the profile.
        try:
            client._load_profile_and_settings()
        except Exception as e:
            logger.warning("Garmin profile not loaded after login uid=%s: %s", uid, e)
        self._store_session(uid, client, email)
        return "connected"

    def finish_mfa(self, uid: str, code: str) -> None:
        with self._pending_lock:
            self._drop_expired_locked()
            pending = self._pending.get(uid)
        if pending is None:
            logger.warning("Garmin MFA code without a pending login uid=%s", uid)
            raise GarminLoginError("Сесія входу минула. Введи пошту й пароль ще раз.")
        try:
            pending.client.resume_login(None, code)
        except Exception as e:
            # A wrong or rate-limited code leaves the client's MFA session open,
            # so the same code step can be retried. Any later failure has already
            # consumed it: only a fresh login can succeed then.
            if pending.client.client._mfa_pending:
                logger.warning("Garmin MFA not accepted uid=%s email=%s: %s", uid, mask_email(pending.email), e)
                if isinstance(e, GarminConnectTooManyRequestsError):
                    raise GarminLoginError("Garmin тимчасово обмежив вхід. Спробуй за кілька хвилин.") from e
                raise GarminLoginError("Код не підійшов. Перевір і введи ще раз.") from e
            with self._pending_lock:
                self._pending.pop(uid, None)
            logger.warning("Garmin login failed after MFA uid=%s email=%s: %s", uid, mask_email(pending.email), e)
            raise GarminLoginError("Сесія входу минула. Введи пошту й пароль ще раз.") from e
        with self._pending_lock:
            self._pending.pop(uid, None)
        self._store_session(uid, pending.client, pending.email)

    def disconnect(self, uid: str) -> None:
        self._db.clear_garmin_session(uid)
        logger.info("Garmin disconnected uid=%s", uid)

    def _drop_expired_locked(self) -> None:
        now = time.monotonic()
        for key in [k for k, p in self._pending.items() if p.expires_at < now]:
            del self._pending[key]

    def _store_session(self, uid: str, client: Garmin, email: str) -> None:
        name = client.get_full_name() or None
        # Garmin's display name identifies the account; fall back to the login email.
        account = client.display_name or email.lower()
        previous = self._db.garmin_account(uid)
        if previous and previous != account:
            removed = self._db.delete_activities(uid)
            logger.info("Garmin account changed uid=%s; removed %d activities of the previous account", uid, removed)
        self._db.save_garmin_session(uid, self._encrypt(client.client.dumps()), name, account)
        logger.info("Garmin connected uid=%s email=%s", uid, mask_email(email))

    # ---- tokens ------------------------------------------------------------

    def _encrypt(self, tokens: str) -> str:
        return self._fernet.encrypt(tokens.encode()).decode()

    def _client_for(self, uid: str) -> Garmin:
        user = self._db.get_user(uid)
        if user is None or not user["garmin_tokens"]:
            raise GarminNotConnected()
        try:
            tokens = self._fernet.decrypt(user["garmin_tokens"].encode()).decode()
        except InvalidToken as e:
            # TOKEN_KEY changed since the tokens were written; they are unusable.
            logger.warning("Garmin tokens cannot be decrypted uid=%s; clearing session", uid)
            self._db.clear_garmin_session(uid)
            raise GarminNotConnected() from e
        client = Garmin()
        client.login(tokenstore=tokens)
        return client

    # ---- sync --------------------------------------------------------------

    def is_syncing(self, uid: str) -> bool:
        with self._sync_lock:
            return uid in self._syncing

    def start_sync(self, uid: str) -> bool:
        """Starts a background sync; False when one is already running for this user."""
        user = self._db.get_user(uid)
        if user is None or not user["garmin_tokens"]:
            raise GarminNotConnected()
        with self._sync_lock:
            if uid in self._syncing:
                return False
            self._syncing.add(uid)
        threading.Thread(target=self._sync_worker, args=(uid,), daemon=True, name=f"sync-{uid}").start()
        return True

    def _sync_worker(self, uid: str) -> None:
        started = time.monotonic()
        try:
            stored, skipped, since = self.sync(uid)
            self._db.set_sync_result(uid, datetime.now(timezone.utc).isoformat(timespec="seconds"), None)
            logger.info(
                "Sync done uid=%s since=%s stored=%d skipped=%d in %.1fs",
                uid, since, stored, skipped, time.monotonic() - started,
            )
        except GarminNotConnected:
            self._db.set_sync_result(uid, "", "Garmin не підключено.")
            logger.warning("Sync aborted uid=%s: Garmin not connected", uid)
        except GarminConnectAuthenticationError:
            # Refresh token is no longer accepted: the user must log in to Garmin again.
            self._db.clear_garmin_session(uid)
            self._db.set_sync_result(uid, "", "Сесія Garmin завершилась. Підключи Garmin ще раз.")
            logger.warning("Sync aborted uid=%s: Garmin rejected stored tokens", uid)
        except Exception as e:
            self._db.set_sync_result(uid, "", "Не вдалося отримати дані з Garmin. Спробуй пізніше.")
            logger.exception("Sync failed uid=%s: %s", uid, e)
        finally:
            with self._sync_lock:
                self._syncing.discard(uid)

    def sync(self, uid: str, today: date | None = None) -> tuple[int, int, str]:
        client = self._client_for(uid)
        latest = self._db.latest_activity_start(uid)
        since = HISTORY_START
        if latest:
            since = date.fromisoformat(latest[:10]) - timedelta(days=RESYNC_OVERLAP_DAYS)
        until = (today or date.today()) + timedelta(days=1)

        try:
            raw = client.get_activities_by_date(since.isoformat(), until.isoformat())
        finally:
            # Garmin may rotate the refresh token during the requests; keep the
            # new one even when the fetch fails, or the next sync is locked out.
            self._db.update_garmin_tokens(uid, self._encrypt(client.client.dumps()))
        rows = []
        skipped = 0
        for a in raw:
            row = activity_row(a)
            if row is None:
                skipped += 1
                logger.warning("Sync uid=%s skipped activity without id/start/type: id=%s", uid, a.get("activityId"))
                continue
            rows.append(row)
        stored = self._db.upsert_activities(uid, rows)
        # The response is the complete list for [since, until]: anything stored
        # in that window and missing from it was deleted in Garmin Connect.
        removed = self._db.delete_activities_missing(
            uid, since.isoformat(), until.isoformat(), [r["activity_id"] for r in rows]
        )
        if removed:
            logger.info("Sync uid=%s removed %d activities deleted in Garmin", uid, removed)
        return stored, skipped, since.isoformat()
