from datetime import date

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import garmin as garmin_module
from app.db import Database
from app.garmin import HISTORY_START, GarminService, activity_row
from app.main import create_app


def garmin_activity(activity_id, start, type_key="running", distance=5000.0, duration=1500.0, hr=150.0):
    return {
        "activityId": activity_id,
        "activityName": f"Run {activity_id}",
        "startTimeLocal": start,
        "activityType": {"typeKey": type_key},
        "distance": distance,
        "duration": duration,
        "movingDuration": duration,
        "averageHR": hr,
        "maxHR": hr + 20,
        "elevationGain": 10.0,
    }


class FakeTokens:
    def __init__(self, payload):
        self.payload = payload

    def dumps(self):
        return self.payload


class FakeGarmin:
    """Stands in for the network client: records the requested window."""

    def __init__(self, activities, tokens='{"di_token": "refreshed"}'):
        self.activities = activities
        self.calls = []
        self.client = FakeTokens(tokens)

    def get_activities_by_date(self, start, end):
        self.calls.append((start, end))
        if isinstance(self.activities, Exception):
            raise self.activities
        return self.activities


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("TOKEN_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-test")
    db = Database(":memory:")
    service = GarminService(db, __import__("os").environ["TOKEN_KEY"])
    db.save_garmin_session("u1", service._encrypt('{"di_token": "old"}'), "Max", "max-garmin")
    return db, service


def test_activity_row_rejects_rows_without_identity():
    assert activity_row({"startTimeLocal": "2026-01-01 07:00:00", "activityType": {"typeKey": "running"}}) is None
    assert activity_row({"activityId": 1, "activityType": {"typeKey": "running"}}) is None
    assert activity_row({"activityId": 1, "startTimeLocal": "2026-01-01 07:00:00"}) is None
    assert activity_row(garmin_activity(1, "2026-01-01 07:00:00"))["type_key"] == "running"


def test_first_sync_reads_whole_history_then_overlaps_newest(env, monkeypatch):
    db, service = env
    fake = FakeGarmin([garmin_activity(1, "2026-03-10 07:00:00"), {"activityId": 2}])
    monkeypatch.setattr(service, "_client_for", lambda uid: fake)

    stored, skipped, _ = service.sync("u1", today=date(2026, 3, 20))
    assert (stored, skipped) == (1, 1)
    assert fake.calls[0] == (HISTORY_START.isoformat(), "2026-03-21")

    fake.activities = [garmin_activity(1, "2026-03-10 07:00:00", distance=6000.0)]
    service.sync("u1", today=date(2026, 3, 20))
    assert fake.calls[1] == ("2026-03-07", "2026-03-21")
    # The re-read copy replaces the stored one instead of duplicating it.
    rows = db.list_activities("u1", "2026-01-01", "2026-12-31")
    assert [(r["activity_id"], r["distance_m"]) for r in rows] == [(1, 6000.0)]


def test_sync_stores_refreshed_tokens_encrypted(env, monkeypatch):
    db, service = env
    monkeypatch.setattr(service, "_client_for", lambda uid: FakeGarmin([]))
    service.sync("u1", today=date(2026, 3, 20))
    stored = db.get_user("u1")["garmin_tokens"]
    assert "refreshed" not in stored
    assert service._fernet.decrypt(stored.encode()).decode() == '{"di_token": "refreshed"}'


def test_rejected_tokens_disconnect_garmin(env, monkeypatch):
    db, service = env

    def rejected(uid):
        raise garmin_module.GarminConnectAuthenticationError("401")

    monkeypatch.setattr(service, "_client_for", rejected)
    service._syncing.add("u1")
    service._sync_worker("u1")
    user = db.get_user("u1")
    assert user["garmin_tokens"] is None
    assert user["last_sync_error"]
    assert not service.is_syncing("u1")


def test_list_activities_filters_by_local_date_inclusive(env):
    db, _ = env
    db.upsert_activities(
        "u1",
        [
            activity_row(garmin_activity(1, "2026-02-28 23:30:00")),
            activity_row(garmin_activity(2, "2026-03-01 06:00:00")),
            activity_row(garmin_activity(3, "2026-03-31 23:59:00")),
            activity_row(garmin_activity(4, "2026-04-01 00:10:00")),
        ],
    )
    ids = [r["activity_id"] for r in db.list_activities("u1", "2026-03-01", "2026-03-31")]
    assert ids == [2, 3]


def test_api_requires_token_and_scopes_activities_by_user(env):
    db, service = env
    db.upsert_activities("u1", [activity_row(garmin_activity(1, "2026-03-10 07:00:00"))])
    db.upsert_activities("u2", [activity_row(garmin_activity(2, "2026-03-11 07:00:00"))])
    tokens = {"token-u1": "u1", "token-u2": "u2"}

    def verify(token):
        return tokens[token]

    client = TestClient(create_app(db=db, garmin=service, verify_token=verify))
    params = {"from": "2026-03-01", "to": "2026-03-31"}

    assert client.get("/api/activities", params=params).status_code == 401
    assert client.get("/api/activities", params=params, headers={"Authorization": "Bearer nope"}).status_code == 401

    r = client.get("/api/activities", params=params, headers={"Authorization": "Bearer token-u2"})
    assert [a["activity_id"] for a in r.json()["activities"]] == [2]

    bad = client.get("/api/activities", params={"from": "2026-02-30", "to": "2026-03-31"},
                     headers={"Authorization": "Bearer token-u1"})
    assert bad.status_code == 422


def test_sync_drops_activities_deleted_in_garmin_only_inside_window(env, monkeypatch):
    db, service = env
    db.upsert_activities("u1", [activity_row(garmin_activity(i, f"2026-03-{d:02d} 07:00:00")) for i, d in [(1, 1), (2, 9), (3, 10)]])
    fake = FakeGarmin([garmin_activity(3, "2026-03-10 07:00:00")])
    monkeypatch.setattr(service, "_client_for", lambda uid: fake)
    service.sync("u1", today=date(2026, 3, 12))
    # Window is 2026-03-07..2026-03-13: id 2 vanished from Garmin, id 1 is outside the window.
    assert [r["activity_id"] for r in db.list_activities("u1", "2026-01-01", "2026-12-31")] == [1, 3]


def test_tokens_refreshed_before_a_failed_fetch_are_kept(env, monkeypatch):
    db, service = env
    monkeypatch.setattr(service, "_client_for", lambda uid: FakeGarmin(RuntimeError("5xx")))
    with pytest.raises(RuntimeError):
        service.sync("u1", today=date(2026, 3, 20))
    stored = db.get_user("u1")["garmin_tokens"]
    assert service._fernet.decrypt(stored.encode()).decode() == '{"di_token": "refreshed"}'


def test_disconnect_during_sync_is_not_undone(env, monkeypatch):
    db, service = env
    fake = FakeGarmin([])

    def fetch_then_disconnect(start, end):
        service.disconnect("u1")
        return []

    fake.get_activities_by_date = fetch_then_disconnect
    monkeypatch.setattr(service, "_client_for", lambda uid: fake)
    service.sync("u1", today=date(2026, 3, 20))
    assert db.get_user("u1")["garmin_tokens"] is None


class FakeLoggedIn:
    def __init__(self, display_name):
        self.display_name = display_name
        self.client = FakeTokens('{"di_token": "new"}')

    def get_full_name(self):
        return "Someone"


def test_reconnecting_another_garmin_account_drops_old_activities(env):
    db, service = env
    db.upsert_activities("u1", [activity_row(garmin_activity(1, "2026-03-10 07:00:00"))])
    service._store_session("u1", FakeLoggedIn("max-garmin"), "max@example.com")
    assert db.count_activities("u1") == 1
    service._store_session("u1", FakeLoggedIn("other-person"), "other@example.com")
    assert db.count_activities("u1") == 0


def test_emulator_is_refused_for_a_real_project(monkeypatch):
    from app.config import load_settings

    monkeypatch.setenv("TOKEN_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "my-garmin-prod")
    with pytest.raises(RuntimeError):
        load_settings()
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-my-garmin")
    assert load_settings().firebase_project_id == "demo-my-garmin"
