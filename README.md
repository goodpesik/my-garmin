# My Garmin

Personal training reports from Garmin Connect: pick a period and a sport, group by
workout, week or month, and see total distance, average distance per workout,
average pace (or speed), average heart rate, a combined chart and correlations.

- `web/` — Vue 3 + PrimeVue + Chart.js, Google sign-in through Firebase Auth.
- `server/` — FastAPI + SQLite. Talks to Garmin Connect through the unofficial
  [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) client.
  The Garmin password is used once to get session tokens and is never stored;
  tokens are kept encrypted (Fernet, `TOKEN_KEY`).

Garmin has no official API for personal use, so the Garmin side may break when
Garmin changes its login. Activities already synced stay in the local database.

## Run locally

Requirements: Node 22+, Python 3.13 with [uv](https://docs.astral.sh/uv/), Java (for the Firebase emulator), Firebase CLI.

```sh
# 1. Auth emulator (Google sign-in without a real Firebase project)
firebase emulators:start --only auth --project demo-my-garmin

# 2. API on :8010
cd server
cp .env.example .env   # then put a generated key into TOKEN_KEY
uv run uvicorn app.main:create_app --factory --port 8010

# 3. Web on :5180
cd web
npm install
npm run dev
```

Synthetic data for a signed-in emulator user (no Garmin needed):

```sh
cd server && uv run python -m scripts.seed_demo <firebase-uid>
```

## Tests

```sh
cd server && uv run pytest -q
cd web && npx vitest run
```

## Production

- Web: Firebase Hosting, project `my-garmin-fh` → https://garmin.fitshandler.com (also https://my-garmin-fh.web.app).
  Deployed by GitHub Actions on every push to `main` (`.github/workflows/ci.yml`); the web env
  values and the deploy service account are repository secrets.
- API: Raspberry Pi → https://garmin-api.fitshandler.com (systemd + uvicorn, SQLite on the Pi).
  `server/.env` there sets `TOKEN_KEY`, `FIREBASE_PROJECT_ID=my-garmin-fh`, `CORS_ORIGINS`; never the emulator host.
