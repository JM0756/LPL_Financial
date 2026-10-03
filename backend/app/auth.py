"""
auth.py — Cognito JWT validation for WealthLens backend.

Validates access tokens using Cognito's published JWKS:
  - Signature and RS256 algorithm
  - Expected issuer (Cognito user pool URL)
  - Expiration
  - token_use == "access"
  - Expected app client ID (aud / client_id claim)

JWKS are cached in-process for 1 hour to avoid per-request network calls.
Key rotation is handled by re-fetching on unknown kid.

When AUTH_ENABLED is False (env var not set), all endpoints are unprotected
and return a synthetic identity — preserving the existing demo behaviour.
"""

from __future__ import annotations

import logging
import os
import time
from functools import lru_cache
from typing import Any

import urllib.request
import json

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("scenariocraft.auth")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
AUTH_ENABLED: bool = os.getenv("AUTH_ENABLED", "false").strip().lower() in {"1", "true", "yes"}
COGNITO_REGION: str = os.getenv("COGNITO_REGION", os.getenv("AWS_REGION", "us-east-1"))
COGNITO_USER_POOL_ID: str | None = os.getenv("COGNITO_USER_POOL_ID")
COGNITO_CLIENT_ID: str | None = os.getenv("COGNITO_CLIENT_ID")

_ISSUER: str | None = (
    f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
    if COGNITO_USER_POOL_ID
    else None
)
_JWKS_URL: str | None = f"{_ISSUER}/.well-known/jwks.json" if _ISSUER else None

# ---------------------------------------------------------------------------
# JWKS cache — refreshed at most once per hour
# ---------------------------------------------------------------------------
_jwks_cache: dict[str, Any] = {}
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600.0  # seconds


def _fetch_jwks() -> dict[str, Any]:
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_cache and (now - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache
    if not _JWKS_URL:
        raise RuntimeError("COGNITO_USER_POOL_ID is not configured.")
    try:
        with urllib.request.urlopen(_JWKS_URL, timeout=5) as resp:
            data = json.load(resp)
        _jwks_cache = {k["kid"]: k for k in data.get("keys", [])}
        _jwks_fetched_at = now
        logger.info("JWKS refreshed: %d keys", len(_jwks_cache))
        return _jwks_cache
    except Exception as exc:
        logger.error("Failed to fetch JWKS: %s", exc)
        raise


def _get_key(kid: str) -> dict[str, Any]:
    keys = _fetch_jwks()
    if kid not in keys:
        # Force refresh once on unknown kid (key rotation)
        global _jwks_fetched_at
        _jwks_fetched_at = 0.0
        keys = _fetch_jwks()
    if kid not in keys:
        raise HTTPException(status_code=401, detail="Unknown signing key.")
    return keys[kid]


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------

def _validate_token(token: str, expected_use: str = "access") -> dict[str, Any]:
    """Validate a Cognito token. Returns the verified claims."""
    try:
        from jose import jwt, JWTError, ExpiredSignatureError
    except ImportError:
        raise HTTPException(status_code=500, detail="JWT library not installed.")

    try:
        header = jwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token format.")

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token missing kid.")

    key = _get_key(kid)

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=_ISSUER,
            options={"verify_aud": False},  # Cognito tokens use client_id, not aud
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired.")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {exc}")

    # Validate token_use
    if claims.get("token_use") != expected_use:
        raise HTTPException(status_code=401, detail=f"Invalid token_use claim (expected {expected_use}).")

    # For access tokens, client_id must match; for ID tokens, aud must match
    if expected_use == "access":
        if COGNITO_CLIENT_ID and claims.get("client_id") != COGNITO_CLIENT_ID:
            raise HTTPException(status_code=401, detail="Token client_id mismatch.")
    else:  # id token
        if COGNITO_CLIENT_ID and claims.get("aud") != COGNITO_CLIENT_ID:
            raise HTTPException(status_code=401, detail="Token aud mismatch.")

    return claims


# ---------------------------------------------------------------------------
# Verified identity
# ---------------------------------------------------------------------------

class VerifiedIdentity:
    """Carries the verified user identity derived from the access token."""

    def __init__(self, sub: str, email: str | None, groups: list[str], claims: dict[str, Any]):
        self.sub = sub
        self.email = email
        self.groups = groups
        self.claims = claims

    @property
    def is_advisor(self) -> bool:
        return "advisors" in self.groups

    def __repr__(self) -> str:
        return f"<VerifiedIdentity sub={self.sub!r} groups={self.groups}>"


# Synthetic identity used in demo/unauthenticated mode
_DEMO_IDENTITY = VerifiedIdentity(
    sub="SYNTH-CLIENT-001",
    email=None,
    groups=[],
    claims={},
)

_bearer = HTTPBearer(auto_error=False)


def _extract_id_token(request: Request) -> str | None:
    """Extract ID token from X-Id-Token header if present."""
    return request.headers.get("X-Id-Token")


async def get_identity(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> VerifiedIdentity:
    """
    FastAPI dependency. Returns a VerifiedIdentity.

    When AUTH_ENABLED=False, returns the synthetic demo identity without
    checking any token — preserving existing demo behaviour.

    When AUTH_ENABLED=True, requires a valid Bearer token (access token).
    Groups are extracted from the ID token (X-Id-Token header) since Cognito
    access tokens do not contain cognito:groups.
    """
    if not AUTH_ENABLED:
        return _DEMO_IDENTITY

    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate access token
    access_claims = _validate_token(credentials.credentials, expected_use="access")
    sub = access_claims.get("sub", "")
    email = access_claims.get("email") or access_claims.get("username")
    
    # Extract groups from ID token (cognito:groups is only in ID tokens)
    groups: list[str] = []
    id_token = _extract_id_token(request)
    if id_token:
        try:
            id_claims = _validate_token(id_token, expected_use="id")
            groups = id_claims.get("cognito:groups", [])
            # Also get email from ID token if not in access token
            if not email:
                email = id_claims.get("email")
        except HTTPException:
            # ID token validation failed — continue without groups
            logger.warning("ID token validation failed, proceeding without groups")

    return VerifiedIdentity(sub=sub, email=email, groups=groups, claims=access_claims)


def require_advisor(identity: VerifiedIdentity = Depends(get_identity)) -> VerifiedIdentity:
    """Dependency that additionally requires the advisor group."""
    if AUTH_ENABLED and not identity.is_advisor:
        raise HTTPException(status_code=403, detail="Advisor access required.")
    return identity
