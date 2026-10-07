import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader: KEY=VALUE lines, existing env wins."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(Path(__file__).resolve().parent.parent / ".env")


@dataclass(frozen=True)
class Settings:
    firebase_project_id: str
    db_path: str
    # Fernet key that encrypts Garmin session tokens at rest.
    token_key: str
    cors_origins: list[str]


def load_settings() -> Settings:
    token_key = os.environ.get("TOKEN_KEY", "")
    if not token_key:
        raise RuntimeError(
            "TOKEN_KEY is not set. Generate one with: "
            "uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "")
    if not project_id:
        raise RuntimeError("FIREBASE_PROJECT_ID is not set.")
    # The Auth emulator accepts unsigned tokens. Firebase reserves "demo-" project
    # ids for emulator-only use, so the emulator is allowed only with such an id.
    if os.environ.get("FIREBASE_AUTH_EMULATOR_HOST") and not project_id.startswith("demo-"):
        raise RuntimeError(
            "FIREBASE_AUTH_EMULATOR_HOST is set for a real project; remove it, or it would accept forged tokens."
        )
    return Settings(
        firebase_project_id=project_id,
        db_path=os.environ.get("DB_PATH", str(Path(__file__).resolve().parent.parent / "data" / "my-garmin.sqlite")),
        token_key=token_key,
        cors_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5180").split(",") if o.strip()],
    )
