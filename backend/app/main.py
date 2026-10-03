"""
ScenarioCraft API.

Contract notes:
  * Every number in every response comes from engine.py. Nothing numeric is
    accepted from the client.
  * /api/interpret never runs a scenario. It maps text to a preset, or offers a
    preset, or says unsupported. Running requires an explicit /api/analyze call.
  * No auth, no uploads, no live prices, no TTS. Synthetic data only.
"""

from __future__ import annotations

import logging

from fastapi import Body, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import __version__
from .auth import get_identity, require_advisor, VerifiedIdentity
from .bedrock_service import STATUS_MATCHED, get_bedrock_service
from .config import get_settings
from .engine import (
    EngineError,
    UnsupportedHorizonError,
    UnsupportedScenarioError,
    analyze as run_analysis,
    get_portfolio,
    get_scenario_catalog,
    to_jsonable,
)
from .scenarios import ASSUMPTIONS_VERSION, ENGINE_VERSION, SCENARIO_KEYS, SYNTHETIC_CLIENT_ID
from .storage import AnalysisNotFoundError, IdempotencyConflictError, VALID_STATUSES, get_storage, reset_memory_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
logger = logging.getLogger("scenariocraft")

settings = get_settings()

app = FastAPI(
    title="ScenarioCraft API",
    version=__version__,
    description=(
        "Deterministic scenario analysis on a synthetic $100,000 portfolio. "
        "All displayed figures are computed server-side; Bedrock supplies qualitative prose only."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Request models (note: no financial fields anywhere)
# --------------------------------------------------------------------------- #
class InterpretRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500,
                          examples=["What happens to my portfolio if the market crashes?"])


class AnalyzeRequest(BaseModel):
    scenario_key: str = Field(..., examples=list(SCENARIO_KEYS))
    horizon: str | None = Field(
        default=None,
        examples=["1Y", "12M", "24M"],
        description="Horizon string. For inflation: NM (1–60 months) or NY. For other scenarios: must match the preset (1Y)."
    )
    confirmed: bool = Field(default=True, description="Client must confirm the offered preset.")
    question: str | None = Field(default=None, max_length=500,
                                 description="Optional original question, stored for audit only.")
    custom_portfolio: list[dict] | None = Field(
        default=None,
        description="Optional custom holdings. Each item must have holding_id (str) and value (number >= 0)."
    )
    requested_magnitude: float | None = Field(
        default=None,
        description="Optional magnitude override. Must be within the scenario's supported range."
    )


class DiscussionRequest(BaseModel):
    analysis_id: str = Field(..., min_length=3, max_length=64)
    client_note: str | None = Field(default=None, max_length=1000)
    requested_by: str | None = Field(default=None, max_length=120)
    topic: str | None = Field(default=None, max_length=160)


class DiscussionStatusUpdate(BaseModel):
    status: str = Field(..., examples=list(VALID_STATUSES))


class AdvisorQuestionRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    client_note: str | None = Field(default=None, max_length=1000)
    idempotency_key: str | None = Field(default=None, max_length=128)


# --------------------------------------------------------------------------- #
# Meta
# --------------------------------------------------------------------------- #
@app.get("/api/health", tags=["meta"])
def health() -> dict:
    bedrock = get_bedrock_service()
    return {
        "status": "ok",
        "version": __version__,
        "engine_version": ENGINE_VERSION,
        "assumptions_version": ASSUMPTIONS_VERSION,
        "data_source": "synthetic",
        "supported_scenarios": list(SCENARIO_KEYS),
        "bedrock": {"enabled": bedrock.enabled, "model_id": settings.bedrock_model_id},
        "storage": get_storage().health(),
    }


@app.get("/api/scenarios", tags=["meta"])
def scenarios() -> dict:
    return {"assumptions_version": ASSUMPTIONS_VERSION, "scenarios": to_jsonable(get_scenario_catalog())}


# --------------------------------------------------------------------------- #
# 1) Portfolio
# --------------------------------------------------------------------------- #
@app.get("/api/portfolio", tags=["portfolio"])
def portfolio() -> dict:
    return to_jsonable(get_portfolio())


# --------------------------------------------------------------------------- #
# 2) Interpret
# --------------------------------------------------------------------------- #
@app.post("/api/interpret", tags=["analysis"])
def interpret(payload: InterpretRequest) -> dict:
    """
    Map free text onto a supported preset.

    status:
      matched         -> confirm, then POST /api/analyze
      preset_offered  -> the ask differs from our fixed assumptions; we offer the
                         closest preset instead of silently running a mismatch
      unsupported     -> not modelled in this version
    """
    result = get_bedrock_service().interpret(payload.question).to_dict()
    result["question"] = payload.question
    result["requires_confirmation"] = result["status"] != STATUS_MATCHED
    result["next_step"] = (
        "POST /api/analyze with the scenario_key to run the calculation"
        if result.get("scenario_key")
        else "Choose one of offered_presets"
    )
    return result


# --------------------------------------------------------------------------- #
# 3) Analyze
# --------------------------------------------------------------------------- #
@app.post("/api/analyze", tags=["analysis"])
def analyze(payload: AnalyzeRequest, identity: VerifiedIdentity = Depends(get_identity)) -> dict:
    if not payload.confirmed:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "not_confirmed",
                "message": "The preset must be confirmed before it is run.",
                "offered_presets": to_jsonable(get_scenario_catalog()),
            },
        )

    # Validate and parse custom portfolio if provided
    custom_holdings: dict | None = None
    if payload.custom_portfolio is not None:
        from .engine import validate_custom_portfolio
        try:
            custom_holdings = validate_custom_portfolio(payload.custom_portfolio)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": "invalid_portfolio", "message": str(exc)},
            ) from exc

    # Validate requested_magnitude if provided
    requested_magnitude: float | None = None
    if payload.requested_magnitude is not None:
        from .scenarios import _SCENARIO_PARAMS
        params = _SCENARIO_PARAMS.get(payload.scenario_key, {})
        mn = params.get("min_value", 0.0)
        mx = params.get("max_value", 100.0)
        val = payload.requested_magnitude
        if not (mn <= val <= mx):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_magnitude",
                    "message": f"requested_magnitude {val} is outside the supported range [{mn}, {mx}].",
                },
            )
        requested_magnitude = val

    try:
        analysis = run_analysis(
            payload.scenario_key,
            payload.horizon,
            custom_holdings=custom_holdings,
            requested_magnitude=requested_magnitude,
        )
    except UnsupportedScenarioError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unsupported_scenario",
                "message": str(exc),
                "supported_scenarios": list(SCENARIO_KEYS),
                "offered_presets": to_jsonable(get_scenario_catalog()),
            },
        ) from exc
    except UnsupportedHorizonError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unsupported_horizon",
                "message": str(exc),
                "scenario_key": exc.scenario_key,
                "supported_horizon": exc.supported,
                "offered_presets": to_jsonable(get_scenario_catalog()),
            },
        ) from exc
    except EngineError as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail={"error": "engine_error", "message": str(exc)}) from exc

    # Qualitative narrative only; numbers above are already final.
    explanation = get_bedrock_service().explain(analysis)
    analysis.update(explanation.to_dict())
    if payload.question:
        analysis["source_question"] = payload.question

    # Persist the server snapshot so later writes never need client numbers.
    storage = get_storage()
    try:
        storage.save_analysis(analysis)
    except Exception as exc:  # pragma: no cover - storage self-degrades
        logger.warning("Snapshot persistence failed: %s", exc)

    response = to_jsonable(analysis)
    response["storage_backend"] = storage.backend
    return response


@app.get("/api/analyses/{analysis_id}", tags=["analysis"])
def get_analysis(analysis_id: str) -> dict:
    record = get_storage().get_analysis(analysis_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"error": "analysis_not_found", "analysis_id": analysis_id})
    return to_jsonable(record)


# --------------------------------------------------------------------------- #
# 4) Discussions
# --------------------------------------------------------------------------- #
@app.post("/api/advisor-questions", status_code=201, tags=["discussions"])
def create_advisor_question(payload: AdvisorQuestionRequest) -> dict:
    """
    Save an unmodeled question for advisor review — no analysis_id required.
    Does not fabricate a financial result.
    """
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail={"error": "blank_question", "message": "question must not be blank"})

    storage = get_storage()
    try:
        record = storage.save_advisor_question(
            question,
            client_note=payload.client_note,
            idempotency_key=payload.idempotency_key,
        )
    except IdempotencyConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"error": "idempotency_conflict", "message": str(exc), "idempotency_key": exc.key},
        ) from exc

    return {
        "discussion_id": record["discussion_id"],
        "request_type": "unmodeled_question",
        "status": record["status"],
        "created_at": record["created_at"],
        "storage_backend": storage.backend,
        "storage_durable": storage.backend == "dynamodb",
        "message": "Question saved for advisor review. No financial analysis has been performed.",
        "record": to_jsonable(record),
    }


@app.post("/api/discussions", status_code=201, tags=["discussions"])
def create_discussion(payload: DiscussionRequest) -> dict:
    try:
        record = get_storage().save_discussion(
            payload.analysis_id,
            client_note=payload.client_note,
            requested_by=payload.requested_by,
            topic=payload.topic,
        )
    except AnalysisNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "analysis_not_found", "message": str(exc), "analysis_id": exc.analysis_id},
        ) from exc

    return {
        "discussion_id": record["discussion_id"],
        "analysis_id": record["analysis_id"],
        "request_type": "analysis_discussion",
        "status": record["status"],
        "created_at": record["created_at"],
        "storage_backend": get_storage().backend,
        "message": "Your advisor has been notified. The saved figures are the server-calculated snapshot.",
        "record": to_jsonable(record),
    }


@app.get("/api/discussions", tags=["discussions"])
def list_discussions(
    client_id: str = Query(default=SYNTHETIC_CLIENT_ID),
    limit: int = Query(default=50, ge=1, le=200),
    status: str | None = Query(default=None),
    identity: VerifiedIdentity = Depends(get_identity),
) -> dict:
    """Advisor View feed: requests plus the saved scenario details for each."""
    items = get_storage().list_discussions(client_id=client_id, limit=limit)
    if status:
        items = [i for i in items if i.get("status") == status]

    discussions = []
    for i in items:
        # Determine request_type: explicit field, or legacy inference
        rtype = i.get("request_type")
        if rtype is None:
            rtype = "analysis_discussion" if i.get("analysis_id") else "unmodeled_question"

        row: dict = {
            "discussion_id": i.get("discussion_id"),
            "request_type": rtype,
            "client_id": i.get("client_id"),
            "client_name": i.get("client_name"),
            "data_source": i.get("data_source", "synthetic"),
            "topic": i.get("topic"),
            "client_note": i.get("client_note"),
            "status": i.get("status"),
            "created_at": i.get("created_at"),
            "updated_at": i.get("updated_at"),
        }
        if rtype == "analysis_discussion":
            row.update({
                "analysis_id": i.get("analysis_id"),
                "scenario_key": i.get("scenario_key"),
                "scenario_label": i.get("scenario_label"),
                "horizon": i.get("horizon"),
                "assumptions_version": i.get("assumptions_version"),
                "result": i.get("result"),
                "scenario_details": i.get("scenario_details"),
                "requested_by": i.get("requested_by"),
                "source_question": i.get("source_question"),
            })
        else:  # unmodeled_question
            row.update({
                "question": i.get("question"),
                "result": None,
            })
        discussions.append(row)
    return to_jsonable(
        {
            "client_id": client_id,
            "count": len(discussions),
            "statuses": list(VALID_STATUSES),
            "storage_backend": get_storage().backend,
            "discussions": discussions,
        }
    )


@app.patch("/api/discussions/{discussion_id}", tags=["discussions"])
def update_discussion(discussion_id: str, payload: DiscussionStatusUpdate, identity: VerifiedIdentity = Depends(require_advisor)) -> dict:
    try:
        record = get_storage().update_discussion_status(discussion_id, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": "invalid_status", "message": str(exc)}) from exc
    if record is None:
        raise HTTPException(status_code=404, detail={"error": "discussion_not_found", "discussion_id": discussion_id})
    return to_jsonable(record)


@app.delete("/api/discussions", tags=["discussions"])
def reset_discussions() -> dict:
    """
    Clear all in-memory discussion and analysis records.
    Only affects the memory backend — safe to call when DynamoDB is not configured.
    Returns a count of cleared records.
    """
    storage = get_storage()
    if storage.backend == "dynamodb":
        raise HTTPException(
            status_code=403,
            detail={"error": "not_allowed", "message": "Reset is only available in memory mode."},
        )
    result = reset_memory_store()
    return {"status": "cleared", **result, "storage_backend": storage.backend}


@app.on_event("startup")
def _startup() -> None:
    storage = get_storage()
    storage.ensure_table()  # no-op unless DYNAMODB_ENDPOINT_URL (local) is set
    logger.info(
        "ScenarioCraft up | engine=%s assumptions=%s storage=%s bedrock=%s",
        ENGINE_VERSION, ASSUMPTIONS_VERSION, storage.backend, get_bedrock_service().enabled,
    )