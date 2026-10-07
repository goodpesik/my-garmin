import logging
import os
import re
from collections.abc import Callable
from datetime import date
from typing import Any

import firebase_admin
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import auth as firebase_auth
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from .config import load_settings
from .db import Database
from .garmin import GarminLoginError, GarminNotConnected, GarminService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("my_garmin.api")


def make_token_verifier(project_id: str, request: Callable[..., Any] | None = None) -> Callable[[str], str]:
    """Returns a function that maps a Firebase ID token to its uid or raises.

    Production tokens are checked against Google's public certs with google-auth:
    firebase_admin.verify_id_token would demand service-account credentials it
    does not need, and without them it stalls on the GCE metadata probe and fails.
    The Auth emulator issues unsigned tokens, which only firebase_admin accepts.
    """
    if os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        if not firebase_admin._apps:
            firebase_admin.initialize_app(options={"projectId": project_id})
        return lambda token: firebase_auth.verify_id_token(token)["uid"]

    http = request or google_requests.Request()
    issuer = f"https://securetoken.google.com/{project_id}"

    def verify(token: str) -> str:
        claims = google_id_token.verify_firebase_token(token, http, audience=project_id, clock_skew_in_seconds=10)
        if claims.get("iss") != issuer:
            raise ValueError(f"unexpected issuer {claims.get('iss')!r}")
        uid = claims.get("sub")
        if not isinstance(uid, str) or not uid:
            raise ValueError("token has no subject")
        return uid

    return verify


def create_app(db: Database | None = None, garmin: GarminService | None = None, verify_token=None) -> FastAPI:
    settings = load_settings()
    if verify_token is None:
        verify_token = make_token_verifier(settings.firebase_project_id)
    db = db or Database(settings.db_path)
    garmin = garmin or GarminService(db, settings.token_key)

    app = FastAPI(title="My Garmin")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def current_uid(authorization: str = Header(default="")) -> str:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(401, "Потрібен вхід.")
        try:
            return verify_token(token)
        except Exception as e:
            # The message names the reason (expired, wrong audience, certs unreachable); it holds no token.
            logger.warning("Rejected Firebase token: %s: %s", type(e).__name__, str(e)[:300])
            raise HTTPException(401, "Сесія недійсна. Увійди ще раз.") from e

    class GarminLogin(BaseModel):
        email: str = Field(min_length=3, max_length=200)
        password: str = Field(min_length=1, max_length=200)

    class GarminMfa(BaseModel):
        code: str = Field(min_length=4, max_length=12)

    @app.get("/api/me")
    def me(uid: str = Depends(current_uid)):
        user = db.get_user(uid)
        connected = bool(user and user["garmin_tokens"])
        return {
            "garminConnected": connected,
            "garminName": user["garmin_name"] if connected else None,
            "lastSyncAt": user["last_sync_at"] if user else None,
            "lastSyncError": user["last_sync_error"] if user else None,
            "syncing": garmin.is_syncing(uid),
            "activityCount": db.count_activities(uid),
        }

    @app.post("/api/garmin/login")
    def garmin_login(body: GarminLogin, uid: str = Depends(current_uid)):
        try:
            status = garmin.start_login(uid, body.email.strip(), body.password)
        except GarminLoginError as e:
            raise HTTPException(400, str(e)) from e
        if status == "connected":
            garmin.start_sync(uid)
        return {"status": status}

    @app.post("/api/garmin/mfa")
    def garmin_mfa(body: GarminMfa, uid: str = Depends(current_uid)):
        try:
            garmin.finish_mfa(uid, body.code.strip())
        except GarminLoginError as e:
            raise HTTPException(400, str(e)) from e
        garmin.start_sync(uid)
        return {"status": "connected"}

    @app.delete("/api/garmin")
    def garmin_disconnect(uid: str = Depends(current_uid)):
        garmin.disconnect(uid)
        return {"status": "disconnected"}

    @app.post("/api/sync")
    def sync(uid: str = Depends(current_uid)):
        try:
            started = garmin.start_sync(uid)
        except GarminNotConnected as e:
            raise HTTPException(409, "Спершу підключи Garmin.") from e
        return {"started": started}

    date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")

    @app.get("/api/activities")
    def activities(
        date_from: str = Query(alias="from"),
        date_to: str = Query(alias="to"),
        uid: str = Depends(current_uid),
    ):
        for value in (date_from, date_to):
            if not date_pattern.match(value):
                raise HTTPException(422, "Дата має бути у форматі РРРР-ММ-ДД.")
            try:
                date.fromisoformat(value)
            except ValueError as e:
                raise HTTPException(422, "Неіснуюча дата.") from e
        if date_from > date_to:
            raise HTTPException(422, "Початок періоду пізніше за кінець.")
        return {"activities": db.list_activities(uid, date_from, date_to)}

    return app
