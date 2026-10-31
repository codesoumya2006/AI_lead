from functools import lru_cache
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    app_name: str = "Lead-to-Order Agent"
    environment: str = "local"
    api_prefix: str = "/v1"
    data_dir: str = str(BACKEND_DIR / ".local-data")
    auth_mode: str = "dev"  # dev is local-only; production must use OIDC
    oidc_audience: str | None = None
    google_cloud_project: str | None = None
    gcs_state_bucket: str | None = None
    bigquery_dataset: str | None = None
    bigquery_usage_dataset: str | None = None
    cloud_tasks_queue: str | None = None
    cloud_tasks_events_queue: str | None = None
    cloud_tasks_location: str = "europe-west2"
    worker_url: str | None = None
    worker_service_account: str | None = None
    google_api_key: str | None = None
    gemini_model: str = "gemini-3.1-flash-lite"
    gemini_input_usd_per_million: float | None = 0.25
    gemini_output_usd_per_million: float | None = 1.50
    gemini_timeout_seconds: float = 8.0
    gemini_max_retries: int = 1
    gemini_retry_delay_seconds: float = 1.0
    enable_whatsapp: bool = False
    whatsapp_app_secret: str | None = None
    whatsapp_verify_token: str | None = None
    default_vat_rate: float = 0.20
    default_currency: str = "GBP"
    max_request_bytes: int = 200_000
    rate_limit_per_minute: int = 120
    log_level: str = "INFO"
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    model_config = SettingsConfigDict(
        env_file=[".env", str(BACKEND_DIR / ".env")],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("data_dir", mode="after")
    @classmethod
    def resolve_data_dir(cls, v: str) -> str:
        p = Path(v)
        if not p.is_absolute():
            return str((BACKEND_DIR / p).resolve())
        return str(p.resolve())

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
