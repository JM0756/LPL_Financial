"""
Amazon DynamoDB integration.

Trust model: the browser may send an `analysis_id` and free-text notes. It may
NOT send financial numbers. Every persisted record is built from the server's
own analysis snapshot, which is written at /api/analyze time and re-read here.

Single-table design (pk/sk):
    ANALYSIS#<analysis_id>      | SNAPSHOT                             -> server snapshot
    CLIENT#<client_id>          | DISCUSSION#<created_at>#<disc_id>     -> advisor queue

Advisor View is therefore one Query (no Scan), already sorted by time.

If DynamoDB is disabled or unreachable, the service degrades to an in-process
store so the MVP demo and the test suite never break.
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from typing import Any

from .config import get_settings
from .engine import to_decimal_safe, to_jsonable, utc_now_iso
from .scenarios import ASSUMPTIONS_VERSION, SYNTHETIC_CLIENT_ID, SYNTHETIC_CLIENT_NAME

logger = logging.getLogger(__name__)

BACKEND_DYNAMODB = "dynamodb"
BACKEND_MEMORY = "memory"

STATUS_REQUESTED = "requested"
STATUS_IN_REVIEW = "in_review"
STATUS_CLOSED = "closed"
VALID_STATUSES = (STATUS_REQUESTED, STATUS_IN_REVIEW, STATUS_CLOSED)

SK_SNAPSHOT = "SNAPSHOT"
SK_DISCUSSION_PREFIX = "DISCUSSION#"
SK_ADVISOR_Q_PREFIX = "ADVISORQ#"

# Process-local fallback store (survives service re-instantiation).
_MEM_ANALYSES: dict[str, dict] = {}
_MEM_DISCUSSIONS: dict[str, dict] = {}
_MEM_ADVISOR_QUESTIONS: dict[str, dict] = {}
# idempotency_key -> discussion_id (for advisor questions)
_MEM_IDEMPOTENCY: dict[str, str] = {}


class AnalysisNotFoundError(Exception):
    def __init__(self, analysis_id: str):
        self.analysis_id = analysis_id
        super().__init__(
            f"No server-side analysis snapshot found for {analysis_id!r}. "
            f"Run POST /api/analyze first — the backend will not accept client-supplied figures."
        )


def _analysis_pk(analysis_id: str) -> str:
    return f"ANALYSIS#{analysis_id}"


def _client_pk(client_id: str) -> str:
    return f"CLIENT#{client_id}"


class StorageService:
    def __init__(self, settings=None) -> None:
        self.settings = settings or get_settings()
        self._table = None
        self._backend = BACKEND_MEMORY
        self._degraded_reason: str | None = None
        if self.settings.storage_enabled:
            self._connect()
        else:
            self._degraded_reason = "storage_disabled_by_config"

    # ---- plumbing --------------------------------------------------------- #
    @property
    def backend(self) -> str:
        return self._backend

    @property
    def degraded_reason(self) -> str | None:
        return self._degraded_reason

    def _connect(self) -> None:
        try:
            import boto3

            kwargs: dict[str, Any] = {"region_name": self.settings.aws_region}
            if self.settings.dynamodb_endpoint_url:
                kwargs["endpoint_url"] = self.settings.dynamodb_endpoint_url

            resource = boto3.resource("dynamodb", **kwargs)
            table = resource.Table(self.settings.dynamodb_table)
            table.load()  # raises if the table does not exist / no perms
            self._table = table
            self._backend = BACKEND_DYNAMODB
            self._degraded_reason = None
            logger.info("DynamoDB storage ready (table=%s)", self.settings.dynamodb_table)
        except Exception as exc:
            self._degrade(f"{type(exc).__name__}: {exc}")

    def _degrade(self, reason: str) -> None:
        self._table = None
        self._backend = BACKEND_MEMORY
        self._degraded_reason = reason
        logger.warning("DynamoDB unavailable, using in-memory store: %s", reason)

    def health(self) -> dict:
        return {
            "backend": self._backend,
            "table": self.settings.dynamodb_table if self._backend == BACKEND_DYNAMODB else None,
            "degraded_reason": self._degraded_reason,
        }

    def ensure_table(self) -> None:
        """Convenience table creation — only for DynamoDB Local."""
        if not self.settings.dynamodb_endpoint_url:
            return
        try:
            import boto3

            resource = boto3.resource(
                "dynamodb",
                region_name=self.settings.aws_region,
                endpoint_url=self.settings.dynamodb_endpoint_url,
            )
            existing = [t.name for t in resource.tables.all()]
            if self.settings.dynamodb_table in existing:
                self._connect()
                return
            table = resource.create_table(
                TableName=self.settings.dynamodb_table,
                KeySchema=[
                    {"AttributeName": "pk", "KeyType": "HASH"},
                    {"AttributeName": "sk", "KeyType": "RANGE"},
                ],
                AttributeDefinitions=[
                    {"AttributeName": "pk", "AttributeType": "S"},
                    {"AttributeName": "sk", "AttributeType": "S"},
                ],
                BillingMode="PAY_PER_REQUEST",
            )
            table.wait_until_exists()
            logger.info("Created local DynamoDB table %s", self.settings.dynamodb_table)
            self._connect()
        except Exception as exc:  # pragma: no cover
            self._degrade(f"ensure_table failed: {type(exc).__name__}: {exc}")

    # ---- 1) server analysis snapshots ------------------------------------- #
    def save_analysis(self, analysis: dict) -> dict:
        """
        Persist the authoritative server snapshot of an analysis. This is the
        ONLY source of financial numbers used by any later write.
        """
        analysis_id = analysis["analysis_id"]
        item = {
            "pk": _analysis_pk(analysis_id),
            "sk": SK_SNAPSHOT,
            "record_type": "analysis_snapshot",
            "analysis_id": analysis_id,
            "client_id": analysis.get("client_id", SYNTHETIC_CLIENT_ID),
            "client_name": SYNTHETIC_CLIENT_NAME,
            "data_source": "synthetic",
            "scenario_key": analysis["scenario_key"],
            "scenario_label": analysis.get("scenario_label"),
            "horizon": analysis["horizon"],
            "assumptions_version": analysis.get("assumptions_version", ASSUMPTIONS_VERSION),
            "engine_version": analysis.get("engine_version"),
            "snapshot": analysis,  # full, server-computed result
            "created_at": analysis.get("generated_at") or utc_now_iso(),
        }
        self._put(item)
        _MEM_ANALYSES[analysis_id] = to_jsonable(item)
        return to_jsonable(item)

    def get_analysis(self, analysis_id: str) -> dict | None:
        if self._table is not None:
            try:
                response = self._table.get_item(
                    Key={"pk": _analysis_pk(analysis_id), "sk": SK_SNAPSHOT}
                )
                item = response.get("Item")
                if item:
                    return to_jsonable(item)
            except Exception as exc:
                self._degrade(f"get_analysis failed: {type(exc).__name__}: {exc}")
        return _MEM_ANALYSES.get(analysis_id)

    # ---- 2) discussion requests ------------------------------------------- #
    def save_discussion(
        self,
        analysis_id: str,
        *,
        client_note: str | None = None,
        requested_by: str | None = None,
        topic: str | None = None,
        source_question: str | None = None,
        status: str = STATUS_REQUESTED,
    ) -> dict:
        """
        Save a 'discuss with my advisor' request against an EXISTING analysis.

        Financial values are copied from the stored server snapshot; anything
        numeric in the client payload is ignored by construction.
        """
        record = self.get_analysis(analysis_id)
        if record is None:
            raise AnalysisNotFoundError(analysis_id)
        if status not in VALID_STATUSES:
            status = STATUS_REQUESTED

        snapshot = record.get("snapshot", {})
        discussion_id = f"dsc_{uuid.uuid4().hex[:16]}"
        created_at = utc_now_iso()
        client_id = record.get("client_id", SYNTHETIC_CLIENT_ID)

        item = {
            "pk": _client_pk(client_id),
            "sk": f"{SK_DISCUSSION_PREFIX}{created_at}#{discussion_id}",
            "record_type": "discussion_request",
            # identity (synthetic only — no auth in this MVP)
            "discussion_id": discussion_id,
            "analysis_id": analysis_id,
            "client_id": client_id,
            "client_name": record.get("client_name", SYNTHETIC_CLIENT_NAME),
            "data_source": "synthetic",
            # scenario + horizon
            "scenario_key": record["scenario_key"],
            "scenario_label": record.get("scenario_label"),
            "horizon": record["horizon"],
            # calculated result — straight from the server snapshot
            "result": {
                "current_value": snapshot.get("current_value"),
                "scenario_value": snapshot.get("scenario_value"),
                "impact_dollars": snapshot.get("impact_dollars"),
                "impact_percent": snapshot.get("impact_percent"),
                "valuation_basis": snapshot.get("valuation_basis"),
            },
            "scenario_details": {
                "summary": snapshot.get("scenario_summary"),
                "magnitude_label": snapshot.get("assumptions", {}).get("magnitude_label"),
                "assumption_notes": snapshot.get("assumptions", {}).get("notes", []),
                "attribution": snapshot.get("attribution", []),
                "top_detractors": snapshot.get("top_detractors", []),
                "top_contributors": snapshot.get("top_contributors", []),
                "explanation": snapshot.get("explanation"),
                "explanation_source": snapshot.get("explanation_source"),
            },
            # provenance
            "assumptions_version": record.get("assumptions_version", ASSUMPTIONS_VERSION),
            "engine_version": record.get("engine_version"),
            # client-supplied text only
            "topic": (topic or snapshot.get("scenario_label") or "").strip() or None,
            "client_note": (client_note or "").strip()[:1000] or None,
            "requested_by": (requested_by or SYNTHETIC_CLIENT_NAME).strip()[:120],
            "source_question": (source_question or "").strip()[:500] or None,
            # workflow
            "status": status,
            "created_at": created_at,
            "updated_at": created_at,
        }

        self._put(item)
        _MEM_DISCUSSIONS[discussion_id] = to_jsonable(item)
        return to_jsonable(item)

    # ---- 3) advisor questions (no analysis required) ---------------------- #
    def save_advisor_question(
        self,
        question: str,
        *,
        client_note: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        """
        Persist an unmodeled question for advisor review.

        Idempotency: if the same idempotency_key is reused with the same
        question/client_note, the original record is returned. If the payload
        differs, IdempotencyConflictError is raised.

        IAM note: requires dynamodb:PutItem with a ConditionExpression
        (attribute_not_exists) on the table, plus dynamodb:GetItem.
        """
        client_id = SYNTHETIC_CLIENT_ID

        # --- idempotency check (memory) ---
        if idempotency_key:
            existing_id = _MEM_IDEMPOTENCY.get(idempotency_key)
            if existing_id:
                existing = _MEM_ADVISOR_QUESTIONS.get(existing_id)
                if existing:
                    incoming_note = (client_note or "").strip()[:1000] or None
                    if (
                        existing.get("question") != question
                        or existing.get("client_note") != incoming_note
                    ):
                        raise IdempotencyConflictError(idempotency_key)
                    return existing

        discussion_id = f"aq_{uuid.uuid4().hex[:16]}"
        created_at = utc_now_iso()

        item = {
            "pk": _client_pk(client_id),
            "sk": f"{SK_ADVISOR_Q_PREFIX}{created_at}#{discussion_id}",
            "record_type": "advisor_question",
            "request_type": "unmodeled_question",
            "discussion_id": discussion_id,
            "client_id": client_id,
            "client_name": SYNTHETIC_CLIENT_NAME,
            "data_source": "synthetic",
            "question": question,
            "client_note": (client_note or "").strip()[:1000] or None,
            "idempotency_key": idempotency_key,
            "status": STATUS_REQUESTED,
            "created_at": created_at,
            "updated_at": created_at,
        }

        # --- DynamoDB conditional write ---
        if self._table is not None and idempotency_key:
            try:
                from boto3.dynamodb.conditions import Attr
                # Use a separate idempotency item keyed by the token
                idem_pk = f"IDEMPOTENCY#{idempotency_key}"
                idem_item = {
                    "pk": idem_pk,
                    "sk": "TOKEN",
                    "discussion_id": discussion_id,
                    "question": question,
                    "client_note": item["client_note"],
                }
                try:
                    self._table.put_item(
                        Item=to_decimal_safe(idem_item),
                        ConditionExpression=Attr("pk").not_exists(),
                    )
                except Exception as cond_exc:
                    # Conditional check failed = duplicate key
                    if "ConditionalCheckFailed" in str(cond_exc):
                        existing_resp = self._table.get_item(
                            Key={"pk": idem_pk, "sk": "TOKEN"}
                        )
                        existing_idem = existing_resp.get("Item", {})
                        if (
                            existing_idem.get("question") != question
                            or existing_idem.get("client_note") != item["client_note"]
                        ):
                            raise IdempotencyConflictError(idempotency_key)
                        # Same payload — fetch and return original
                        orig_id = existing_idem.get("discussion_id", "")
                        orig = _MEM_ADVISOR_QUESTIONS.get(orig_id)
                        if orig:
                            return orig
                        # Fall through to write new record (memory may have been cleared)
                    else:
                        self._degrade(f"idempotency put failed: {cond_exc}")
            except IdempotencyConflictError:
                raise
            except Exception as exc:
                self._degrade(f"save_advisor_question failed: {type(exc).__name__}: {exc}")

        self._put(item)
        _MEM_ADVISOR_QUESTIONS[discussion_id] = to_jsonable(item)
        if idempotency_key:
            _MEM_IDEMPOTENCY[idempotency_key] = discussion_id
        return to_jsonable(item)

    def list_discussions(self, client_id: str | None = None, limit: int = 100) -> list[dict]:
        """Advisor View feed: newest first. Returns both analysis discussions and advisor questions."""
        client_id = client_id or SYNTHETIC_CLIENT_ID
        items: list[dict] = []

        if self._table is not None:
            try:
                from boto3.dynamodb.conditions import Key

                # Query DISCUSSION# prefix
                resp1 = self._table.query(
                    KeyConditionExpression=(
                        Key("pk").eq(_client_pk(client_id))
                        & Key("sk").begins_with(SK_DISCUSSION_PREFIX)
                    ),
                    ScanIndexForward=False,
                    Limit=limit,
                )
                # Query ADVISORQ# prefix
                resp2 = self._table.query(
                    KeyConditionExpression=(
                        Key("pk").eq(_client_pk(client_id))
                        & Key("sk").begins_with(SK_ADVISOR_Q_PREFIX)
                    ),
                    ScanIndexForward=False,
                    Limit=limit,
                )
                items = [
                    to_jsonable(i)
                    for i in resp1.get("Items", []) + resp2.get("Items", [])
                ]
            except Exception as exc:
                self._degrade(f"list_discussions failed: {type(exc).__name__}: {exc}")

        if not items:
            disc = [d for d in _MEM_DISCUSSIONS.values() if d.get("client_id") == client_id]
            qs = [q for q in _MEM_ADVISOR_QUESTIONS.values() if q.get("client_id") == client_id]
            items = disc + qs
            items.sort(key=lambda d: d.get("created_at", ""), reverse=True)
            items = items[:limit]

        return items

    def update_discussion_status(self, discussion_id: str, status: str) -> dict | None:
        if status not in VALID_STATUSES:
            raise ValueError(f"status must be one of {VALID_STATUSES}")

        existing = _MEM_DISCUSSIONS.get(discussion_id) or _MEM_ADVISOR_QUESTIONS.get(discussion_id)
        if existing is None:
            for item in self.list_discussions():
                if item.get("discussion_id") == discussion_id:
                    existing = item
                    break
        if existing is None:
            return None

        now = utc_now_iso()
        if self._table is not None:
            try:
                self._table.update_item(
                    Key={"pk": existing["pk"], "sk": existing["sk"]},
                    UpdateExpression="SET #s = :s, updated_at = :u",
                    ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={":s": status, ":u": now},
                )
            except Exception as exc:
                self._degrade(f"update_discussion_status failed: {type(exc).__name__}: {exc}")

        existing = {**existing, "status": status, "updated_at": now}
        if discussion_id in _MEM_ADVISOR_QUESTIONS:
            _MEM_ADVISOR_QUESTIONS[discussion_id] = existing
        else:
            _MEM_DISCUSSIONS[discussion_id] = existing
        return existing

    # ---- low-level write -------------------------------------------------- #
    def _put(self, item: dict) -> None:
        if self._table is None:
            return
        try:
            # DynamoDB rejects floats; Decimal everywhere.
            self._table.put_item(Item=to_decimal_safe(item))
        except Exception as exc:
            self._degrade(f"put_item failed: {type(exc).__name__}: {exc}")


# --------------------------------------------------------------------------- #
# Singleton accessor
# --------------------------------------------------------------------------- #
_storage: StorageService | None = None


def get_storage() -> StorageService:
    global _storage
    if _storage is None:
        _storage = StorageService()
    return _storage


class IdempotencyConflictError(Exception):
    def __init__(self, key: str):
        self.key = key
        super().__init__(f"Idempotency key {key!r} was already used with a different payload.")


def reset_storage_for_tests() -> None:
    """Clear the in-process store (test helper only)."""
    _MEM_ANALYSES.clear()
    _MEM_DISCUSSIONS.clear()
    _MEM_ADVISOR_QUESTIONS.clear()
    _MEM_IDEMPOTENCY.clear()

