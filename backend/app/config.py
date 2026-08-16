"""Application configuration.

Everything is driven by environment variables with the ``TGV_`` prefix, loaded
from the project-root ``.env`` file (see ``docs/CONTRACT.md`` §7).
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/app -> backend -> <project root>
APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
ROOT_DIR = BACKEND_DIR.parent

__version__ = "1.0.0"


class Settings(BaseSettings):
    """Runtime settings. Field names map to ``TGV_<UPPER_NAME>`` env vars."""

    model_config = SettingsConfigDict(
        env_prefix="TGV_",
        env_file=(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- App ------------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8077
    log_level: str = "INFO"
    data_dir: str = "./data"
    secret_key: str = ""
    serve_frontend: bool = True
    open_browser: bool = False

    # --- MySQL ----------------------------------------------------------
    mysql_host: str = "127.0.0.1"
    mysql_port: int = 13306
    mysql_user: str = "tgvault"
    mysql_password: str = "tgvault"
    mysql_db: str = "tgvault"
    db_echo: bool = False
    db_pool_size: int = 10
    db_max_overflow: int = 20
    # Optional full override, e.g. "sqlite+aiosqlite:///./data/tgvault.db"
    database_url: str = ""

    # --- Redis ----------------------------------------------------------
    redis_url: str = "redis://127.0.0.1:16379/0"
    redis_enabled: bool = True

    # --- Telegram defaults ---------------------------------------------
    default_api_id: str = ""
    default_api_hash: str = ""

    # --- Export ---------------------------------------------------------
    download_concurrency: int = 4
    max_retries: int = 5
    flood_sleep_threshold: int = 60
    request_retries: int = 5
    connection_retries: int = 5

    # --- Frontend -------------------------------------------------------
    frontend_port: int = 5177

    @field_validator("log_level")
    @classmethod
    def _upper_level(cls, value: str) -> str:
        return value.upper()

    # -- derived paths ---------------------------------------------------
    @property
    def data_path(self) -> Path:
        raw = Path(self.data_dir).expanduser()
        return raw if raw.is_absolute() else (ROOT_DIR / raw).resolve()

    @property
    def logs_path(self) -> Path:
        return self.data_path / "logs"

    @property
    def exports_path(self) -> Path:
        return self.data_path / "exports"

    @property
    def avatars_path(self) -> Path:
        return self.data_path / "avatars"

    @property
    def run_path(self) -> Path:
        return self.data_path / "run"

    @property
    def frontend_dist(self) -> Path:
        return ROOT_DIR / "frontend" / "dist"

    @property
    def sqlalchemy_url(self) -> str:
        """Async SQLAlchemy DSN."""
        if self.database_url:
            return self.database_url
        return (
            f"mysql+aiomysql://{quote_plus(self.mysql_user)}:{quote_plus(self.mysql_password)}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_db}?charset=utf8mb4"
        )

    @property
    def is_mysql(self) -> bool:
        return self.sqlalchemy_url.startswith("mysql")

    @property
    def cors_origins(self) -> list[str]:
        return [
            f"http://127.0.0.1:{self.frontend_port}",
            f"http://localhost:{self.frontend_port}",
            f"http://127.0.0.1:{self.port}",
            f"http://localhost:{self.port}",
        ]

    def ensure_dirs(self) -> None:
        for path in (
            self.data_path,
            self.logs_path,
            self.exports_path,
            self.avatars_path,
            self.run_path,
        ):
            path.mkdir(parents=True, exist_ok=True)

    def resolve_secret_key(self) -> str:
        """Return the master secret, generating and persisting one if needed.

        The key encrypts Telegram session strings at rest, so it must survive
        restarts: it lives in ``data/secret.key`` (mode 0600 where supported).
        """
        if self.secret_key:
            return self.secret_key
        self.ensure_dirs()
        key_file = self.data_path / "secret.key"
        if key_file.exists():
            existing = key_file.read_text(encoding="utf-8").strip()
            if existing:
                self.secret_key = existing
                return existing
        generated = secrets.token_urlsafe(48)
        key_file.write_text(generated, encoding="utf-8")
        try:
            key_file.chmod(0o600)
        except OSError:  # pragma: no cover - Windows / exotic filesystems
            pass
        self.secret_key = generated
        return generated


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    settings.resolve_secret_key()
    return settings


settings: Settings = get_settings()
