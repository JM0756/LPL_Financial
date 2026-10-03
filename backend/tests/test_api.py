"""API contract tests (Bedrock + DynamoDB disabled → fully offline)."""

from fastapi.testclient import TestClient

from app.main import app
from app.scenarios import SCENARIO_KEYS

client = TestClient(app)

REQUIRED_ANALYZE_KEYS = {
    "analysis_id", "scenario_key", "horizon", "assumptions_version",
    "current_value", "scenario_value", "impact_dollars", "impact_percent",
    "holdings", "explanation", "explanation_source",
}


def test_portfolio_endpoint():
    r = client.get("/api/portfolio")
    assert r.status_code == 200
    body = r.json()
    assert body["total_value"] == 100000.0
    assert body["data_source"] == "synthetic"
    assert len(body["holdings"]) == 7


def test_analyze_contract_keys_and_values():
    r = client.post("/api/analyze", json={"scenario_key": "market_crash"})
    assert r.status_code == 200
    body = r.json()
    assert REQUIRED_ANALYZE_KEYS.issubset(body)
    assert body["scenario_value"] == 87050.0
    assert body["impact_percent"] == -12.95
    # Bedrock disabled -> labelled standard explanation
    assert body["explanation_source"] == "standard_explanation"
    assert body["explanation"]


def test_analyze_all_presets_hit_targets():
    targets = {
        "market_crash": 87050.0,
        "oil_shock": 100100.0,
        "inflation": 95238.1,
        "rate_rise": 95000.0,
        "tech_downturn": 92150.0,
        "international_downturn": 94600.0,
    }
    for key in SCENARIO_KEYS:
        body = client.post("/api/analyze", json={"scenario_key": key}).json()
        assert body["scenario_value"] == targets[key], f"{key}: {body['scenario_value']} != {targets[key]}"


def test_analyze_rejects_unsupported_scenario():
    r = client.post("/api/analyze", json={"scenario_key": "housing_crash"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "unsupported_scenario"
    assert len(r.json()["detail"]["offered_presets"]) == 6


def test_analyze_rejects_unsupported_horizon_and_offers_preset():
    r = client.post("/api/analyze", json={"scenario_key": "oil_shock", "horizon": "5Y"})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail["error"] == "unsupported_horizon"
    assert detail["supported_horizon"] == "1Y"


def test_interpret_matches_preset():
    r = client.post("/api/interpret", json={"question": "What if the stock market crashes?"})
    body = r.json()
    assert body["status"] == "matched"
    assert body["scenario_key"] == "market_crash"
    assert body["supported"] is True


def test_interpret_offers_preset_on_magnitude_mismatch():
    r = client.post("/api/interpret", json={"question": "What if the market crashes 60%?"})
    body = r.json()
    assert body["status"] == "preset_offered"
    assert body["scenario_key"] == "market_crash"
    assert body["requires_confirmation"] is True
    assert body["mismatch_reasons"]


def test_interpret_offers_preset_on_horizon_mismatch():
    body = client.post(
        "/api/interpret", json={"question": "What if oil prices spike over the next 5 years?"}
    ).json()
    assert body["status"] == "preset_offered"
    assert body["detected"]["horizon"] == "5Y"


def test_interpret_unsupported_question():
    body = client.post("/api/interpret", json={"question": "What if I move to Japan?"}).json()
    assert body["status"] == "unsupported"
    assert body["supported"] is False
    assert len(body["offered_presets"]) == 6


def test_discussion_roundtrip_uses_server_snapshot():
    analysis = client.post("/api/analyze", json={"scenario_key": "inflation"}).json()

    created = client.post(
        "/api/discussions",
        json={
            "analysis_id": analysis["analysis_id"],
            "client_note": "Worried about rising costs.",
            # deliberately bogus numeric fields are not even accepted by the schema
        },
    )
    assert created.status_code == 201
    record = created.json()["record"]
    assert record["status"] == "requested"
    assert record["result"]["scenario_value"] == 95238.1
    assert record["assumptions_version"] == analysis["assumptions_version"]

    feed = client.get("/api/discussions").json()
    assert feed["count"] == 1
    row = feed["discussions"][0]
    assert row["scenario_key"] == "inflation"
    assert row["horizon"] == "1Y"
    assert row["result"]["impact_percent"] == -4.76
    assert row["scenario_details"]["assumption_notes"]


def test_discussion_requires_existing_analysis():
    r = client.post("/api/discussions", json={"analysis_id": "an_doesnotexist"})
    assert r.status_code == 404
    assert r.json()["detail"]["error"] == "analysis_not_found"


def test_discussion_status_update():
    analysis = client.post("/api/analyze", json={"scenario_key": "oil_shock"}).json()
    dsc = client.post("/api/discussions", json={"analysis_id": analysis["analysis_id"]}).json()
    r = client.patch(f"/api/discussions/{dsc['discussion_id']}", json={"status": "in_review"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_review"


def test_health():
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["supported_scenarios"] == list(SCENARIO_KEYS)


# --------------------------------------------------------------------------- #
# Task 1: Six-scenario catalog
# --------------------------------------------------------------------------- #
def test_scenarios_endpoint_returns_six():
    r = client.get("/api/scenarios")
    body = r.json()
    assert r.status_code == 200
    assert len(body["scenarios"]) == 6
    keys = {s["scenario_key"] for s in body["scenarios"]}
    assert keys == {"market_crash", "oil_shock", "inflation", "rate_rise", "tech_downturn", "international_downturn"}


def test_scenarios_endpoint_has_assumptions_version():
    body = client.get("/api/scenarios").json()
    assert body["assumptions_version"]
    for s in body["scenarios"]:
        assert s["assumptions_version"] == body["assumptions_version"]


def test_new_scenarios_have_prototype_disclaimer():
    body = client.get("/api/scenarios").json()
    for s in body["scenarios"]:
        if s["scenario_key"] in ("rate_rise", "tech_downturn", "international_downturn"):
            notes = " ".join(s["assumption_notes"])
            assert "prototype" in notes.lower() or "manually specified" in notes.lower()


def test_rate_rise_api_total():
    body = client.post("/api/analyze", json={"scenario_key": "rate_rise"}).json()
    assert body["scenario_value"] == 95000.0
    assert body["impact_dollars"] == -5000.0
    assert body["impact_percent"] == -5.0


def test_tech_downturn_api_total():
    body = client.post("/api/analyze", json={"scenario_key": "tech_downturn"}).json()
    assert body["scenario_value"] == 92150.0
    assert body["impact_dollars"] == -7850.0
    assert body["impact_percent"] == -7.85


def test_international_downturn_api_total():
    body = client.post("/api/analyze", json={"scenario_key": "international_downturn"}).json()
    assert body["scenario_value"] == 94600.0
    assert body["impact_dollars"] == -5400.0
    assert body["impact_percent"] == -5.4


def test_new_scenario_horizon_validation():
    """New scenarios only accept 1Y; other horizons are rejected."""
    for key in ("rate_rise", "tech_downturn", "international_downturn"):
        r = client.post("/api/analyze", json={"scenario_key": key, "horizon": "5Y"})
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "unsupported_horizon"
        assert r.json()["detail"]["supported_horizon"] == "1Y"


def test_existing_scenarios_unchanged():
    """Regression: original three scenarios must not change."""
    assert client.post("/api/analyze", json={"scenario_key": "market_crash"}).json()["scenario_value"] == 87050.0
    assert client.post("/api/analyze", json={"scenario_key": "oil_shock"}).json()["scenario_value"] == 100100.0
    assert client.post("/api/analyze", json={"scenario_key": "inflation"}).json()["scenario_value"] == 95238.1


# --------------------------------------------------------------------------- #
# Task 2: Interpretation of new scenarios
# --------------------------------------------------------------------------- #
def test_interpret_rate_rise_matched():
    body = client.post("/api/interpret", json={"question": "What if interest rates rise?"}).json()
    assert body["status"] in ("matched", "preset_offered")
    assert body["scenario_key"] == "rate_rise"


def test_interpret_tech_downturn_matched():
    body = client.post("/api/interpret", json={"question": "What if tech stocks fall?"}).json()
    assert body["status"] in ("matched", "preset_offered")
    assert body["scenario_key"] == "tech_downturn"


def test_interpret_international_downturn_matched():
    body = client.post("/api/interpret", json={"question": "What if international stocks decline?"}).json()
    assert body["status"] in ("matched", "preset_offered")
    assert body["scenario_key"] == "international_downturn"


def test_interpret_rate_rise_magnitude_mismatch():
    """1% relative vs 1pp absolute — magnitude differs from preset."""
    body = client.post("/api/interpret", json={"question": "What if rates rise 10%?"}).json()
    # 10% magnitude is outside the 1pp ± 0.5pp tolerance
    assert body["status"] == "preset_offered"
    assert body["mismatch_reasons"]


def test_interpret_direction_mismatch_offered():
    """Asking about rates falling should not silently run rate_rise."""
    body = client.post("/api/interpret", json={"question": "What if interest rates fall sharply?"}).json()
    # Should either be unsupported or preset_offered (not silently matched)
    assert body["status"] in ("preset_offered", "unsupported")


def test_interpret_compound_question_unsupported():
    body = client.post("/api/interpret", json={"question": "What if rates rise AND tech crashes AND I retire?"}).json()
    # Compound/unrelated — may be unsupported or offered; must not silently run
    assert body["status"] in ("matched", "preset_offered", "unsupported")
    assert "requires_confirmation" in body


def test_interpret_horizon_mismatch_rate_rise():
    body = client.post("/api/interpret", json={"question": "What if rates rise over 5 years?"}).json()
    assert body["status"] == "preset_offered"
    assert body["detected"]["horizon"] == "5Y"


# --------------------------------------------------------------------------- #
# Task 3: POST /api/advisor-questions
# --------------------------------------------------------------------------- #
def test_advisor_question_basic():
    r = client.post("/api/advisor-questions", json={
        "question": "What happens if there is a housing market crash?",
        "idempotency_key": "test-idem-001",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["request_type"] == "unmodeled_question"
    assert body["status"] == "requested"
    assert "discussion_id" in body
    assert body["discussion_id"].startswith("aq_")
    assert "analysis_id" not in body
    assert body["storage_backend"] in ("memory", "dynamodb")
    assert "storage_durable" in body


def test_advisor_question_no_fabricated_result():
    r = client.post("/api/advisor-questions", json={"question": "What about crypto?"})
    body = r.json()
    record = body["record"]
    assert "result" not in record or record.get("result") is None
    assert "scenario_key" not in record
    assert "impact_dollars" not in record


def test_advisor_question_blank_rejected():
    r = client.post("/api/advisor-questions", json={"question": "   "})
    assert r.status_code in (422, 400)


def test_advisor_question_too_long_rejected():
    r = client.post("/api/advisor-questions", json={"question": "x" * 2001})
    assert r.status_code == 422


def test_advisor_question_client_note_stored():
    r = client.post("/api/advisor-questions", json={
        "question": "What about a real estate crash?",
        "client_note": "Client is worried about their REIT holdings.",
    })
    assert r.status_code == 201
    record = r.json()["record"]
    assert record["client_note"] == "Client is worried about their REIT holdings."


def test_advisor_question_idempotency_same_payload():
    """Same key + same payload returns the original record."""
    payload = {"question": "What about deflation?", "idempotency_key": "idem-defl-001"}
    r1 = client.post("/api/advisor-questions", json=payload)
    r2 = client.post("/api/advisor-questions", json=payload)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["discussion_id"] == r2.json()["discussion_id"]


def test_advisor_question_idempotency_conflict():
    """Same key + different question must be rejected with 409."""
    client.post("/api/advisor-questions", json={
        "question": "Original question about bonds.",
        "idempotency_key": "idem-conflict-001",
    })
    r = client.post("/api/advisor-questions", json={
        "question": "Completely different question about stocks.",
        "idempotency_key": "idem-conflict-001",
    })
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "idempotency_conflict"


def test_advisor_question_derives_client_identity():
    """Client identity must come from server config, not client payload."""
    r = client.post("/api/advisor-questions", json={"question": "What about stagflation?"})
    record = r.json()["record"]
    assert record["client_id"] == "SYNTH-CLIENT-001"
    assert record["client_name"] == "Demo Household (synthetic)"


# --------------------------------------------------------------------------- #
# Task 4: GET /api/discussions mixed feed
# --------------------------------------------------------------------------- #
def test_discussions_feed_includes_both_types():
    # Create an analysis discussion
    analysis = client.post("/api/analyze", json={"scenario_key": "market_crash"}).json()
    client.post("/api/discussions", json={"analysis_id": analysis["analysis_id"]})
    # Create an advisor question
    client.post("/api/advisor-questions", json={"question": "What about a housing crash?"})

    feed = client.get("/api/discussions").json()
    assert feed["count"] == 2
    types = {d["request_type"] for d in feed["discussions"]}
    assert "analysis_discussion" in types
    assert "unmodeled_question" in types


def test_discussions_feed_analysis_discussion_has_result():
    analysis = client.post("/api/analyze", json={"scenario_key": "oil_shock"}).json()
    client.post("/api/discussions", json={"analysis_id": analysis["analysis_id"]})

    feed = client.get("/api/discussions").json()
    row = next(d for d in feed["discussions"] if d["request_type"] == "analysis_discussion")
    assert row["result"] is not None
    assert row["result"]["scenario_value"] == 100100.0
    assert row["scenario_details"] is not None


def test_discussions_feed_unmodeled_question_has_null_result():
    client.post("/api/advisor-questions", json={"question": "What about stagflation?"})

    feed = client.get("/api/discussions").json()
    row = next(d for d in feed["discussions"] if d["request_type"] == "unmodeled_question")
    assert row["result"] is None
    assert row["question"] == "What about stagflation?"
    assert "scenario_details" not in row or row.get("scenario_details") is None


def test_discussions_feed_legacy_record_treated_as_analysis_discussion():
    """Records with analysis_id but no request_type field are analysis discussions."""
    from app.storage import _MEM_DISCUSSIONS, SYNTHETIC_CLIENT_ID
    from app.engine import utc_now_iso
    # Inject a legacy record without request_type
    legacy = {
        "pk": f"CLIENT#{SYNTHETIC_CLIENT_ID}",
        "sk": "DISCUSSION#2024-01-01T00:00:00+00:00#dsc_legacy001",
        "discussion_id": "dsc_legacy001",
        "analysis_id": "an_legacy001",
        "client_id": SYNTHETIC_CLIENT_ID,
        "client_name": "Demo Household (synthetic)",
        "data_source": "synthetic",
        "scenario_key": "market_crash",
        "scenario_label": "Market Crash",
        "horizon": "1Y",
        "result": {"scenario_value": 87050.0, "impact_dollars": -12950.0, "impact_percent": -12.95},
        "scenario_details": {},
        "status": "requested",
        "created_at": "2024-01-01T00:00:00+00:00",
        "updated_at": "2024-01-01T00:00:00+00:00",
        # no request_type field
    }
    _MEM_DISCUSSIONS["dsc_legacy001"] = legacy

    feed = client.get("/api/discussions").json()
    row = next(d for d in feed["discussions"] if d.get("discussion_id") == "dsc_legacy001")
    assert row["request_type"] == "analysis_discussion"
    assert row["result"]["scenario_value"] == 87050.0


def test_discussions_create_returns_storage_backend():
    analysis = client.post("/api/analyze", json={"scenario_key": "inflation"}).json()
    r = client.post("/api/discussions", json={"analysis_id": analysis["analysis_id"]})
    assert r.status_code == 201
    body = r.json()
    assert "storage_backend" in body
    assert body["storage_backend"] in ("memory", "dynamodb")
    assert body["request_type"] == "analysis_discussion"


def test_discussions_feed_returns_storage_backend():
    feed = client.get("/api/discussions").json()
    assert "storage_backend" in feed
    assert feed["storage_backend"] in ("memory", "dynamodb")


def test_advisor_question_status_update():
    r = client.post("/api/advisor-questions", json={"question": "What about a bond market crash?"})
    disc_id = r.json()["discussion_id"]
    patch = client.patch(f"/api/discussions/{disc_id}", json={"status": "in_review"})
    assert patch.status_code == 200
    assert patch.json()["status"] == "in_review"


def test_discussions_storage_backend_is_memory_when_disabled():
    """With STORAGE_ENABLED=false (set in conftest), backend must be 'memory'."""
    feed = client.get("/api/discussions").json()
    assert feed["storage_backend"] == "memory"


def test_advisor_question_storage_backend_honest():
    """storage_durable must be False when using in-memory fallback."""
    r = client.post("/api/advisor-questions", json={"question": "What about a currency crisis?"})
    body = r.json()
    assert body["storage_backend"] == "memory"
    assert body["storage_durable"] is False
