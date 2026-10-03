"""
Runtime configuration.

Everything degrades gracefully: if Bedrock or DynamoDB are unavailable or
disabled, the API still serves fully deterministic results (template
explanations + in-memory persistence). This keeps the MVP demo-safe.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

try:  # optional convenience, never required
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _csv(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [part.strip() for part in raw.split(",") if part.strip()]


@dataclass(frozen=True)
class Settings:
    # AWS
    aws_region: str = field(default_factory=lambda: os.getenv("AWS_REGION", "us-east-1"))

    # Bedrock
    bedrock_enabled: bool = field(default_factory=lambda: _bool("BEDROCK_ENABLED", True))
    bedrock_model_id: str = field(
        default_factory=lambda: os.getenv(
            "BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20240620-v1:0"
        )
    )
    bedrock_timeout_seconds: float = field(
        default_factory=lambda: _float("BEDROCK_TIMEOUT_SECONDS", 6.0)
    )
    bedrock_connect_timeout_seconds: float = field(
        default_factory=lambda: _float("BEDROCK_CONNECT_TIMEOUT_SECONDS", 2.0)
    )
    bedrock_max_tokens: int = field(default_factory=lambda: _int("BEDROCK_MAX_TOKENS", 400))
    bedrock_reject_numeric_output: bool = field(
        default_factory=lambda: _bool("BEDROCK_REJECT_NUMERIC_OUTPUT", True)
    )

    # DynamoDB
    storage_enabled: bool = field(default_factory=lambda: _bool("STORAGE_ENABLED", True))
    dynamodb_table: str = field(
        default_factory=lambda: os.getenv("DYNAMODB_TABLE", "scenariocraft-mvp")
    )
    dynamodb_endpoint_url: str | None = field(
        default_factory=lambda: os.getenv("DYNAMODB_ENDPOINT_URL") or None
    )

    # API
    allowed_origins: list[str] = field(
        default_factory=lambda: _csv(
            "ALLOWED_ORIGINS",
            [
                "http://localhost:3000",
                "http://localhost:5173",
                "http://localhost:5176",
                "https://dh133zzs2y30r.cloudfront.net",
            ],
        )
    )

    # Cognito auth (optional — when not set, demo mode is preserved)
    auth_enabled: bool = field(default_factory=lambda: _bool("AUTH_ENABLED", False))
    cognito_region: str = field(
        default_factory=lambda: os.getenv("COGNITO_REGION", os.getenv("AWS_REGION", "us-east-1"))
    )
    cognito_user_pool_id: str | None = field(
        default_factory=lambda: os.getenv("COGNITO_USER_POOL_ID") or None
    )
    cognito_client_id: str | None = field(
        default_factory=lambda: os.getenv("COGNITO_CLIENT_ID") or None
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()