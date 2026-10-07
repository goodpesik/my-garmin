"""Fill the local database with synthetic runs and rides for one user (development only).

Usage: uv run python -m scripts.seed_demo <firebase-uid>
"""

import random
import sys
from datetime import date, timedelta

from app.config import load_settings
from app.db import Database
from app.garmin import activity_row


def main(uid: str) -> None:
    rng = random.Random(42)
    db = Database(load_settings().db_path)
    rows = []
    day = date.today() - timedelta(days=730)
    activity_id = 9_000_000_000
    while day <= date.today():
        if rng.random() < 0.45:
            km = rng.uniform(5, 21) if rng.random() < 0.8 else rng.uniform(21, 32)
            pace = rng.uniform(290, 360) + (km - 10) * 2
            hr = 135 + (360 - pace) * 0.25 + km * 0.6 + rng.uniform(-6, 6)
            type_key = "trail_running" if rng.random() < 0.15 else "running"
            run = _activity(activity_id, day, "Біг", type_key, km, pace * km, hr)
            # Slow upward drift with noise, like Garmin's estimate.
            run["vO2MaxValue"] = round(48 + (day - date.today()).days / -730 * -4 + rng.uniform(-1, 1))
            # Every fourth run or so is an interval workout from the watch.
            if rng.random() < 0.25:
                run["workoutId"] = 1000 + activity_id % 97
                run["splitSummaries"] = [{"splitType": "INTERVAL_WARMUP"}, {"splitType": "INTERVAL_ACTIVE"}]
            rows.append(run)
            activity_id += 1
        if rng.random() < 0.12:
            km = rng.uniform(25, 80)
            rows.append(_activity(activity_id, day, "Вело", "road_biking", km, km / rng.uniform(24, 31) * 3600, rng.uniform(118, 142)))
            activity_id += 1
        day += timedelta(days=1)
    stored = db.upsert_activities(uid, [activity_row(r) for r in rows])
    db.save_garmin_session(uid, "demo", "Demo", "demo")
    print(f"Seeded {stored} activities for {uid}")


def _activity(activity_id, day, name, type_key, km, seconds, hr):
    return {
        "activityId": activity_id,
        "activityName": name,
        "startTimeLocal": f"{day.isoformat()} 07:30:00",
        "activityType": {"typeKey": type_key},
        "distance": km * 1000,
        "duration": seconds,
        "movingDuration": seconds,
        "averageHR": round(hr),
        "maxHR": round(hr + 18),
        "elevationGain": 40.0,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
