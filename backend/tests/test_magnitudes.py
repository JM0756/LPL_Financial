"""Tests for editable scenario magnitudes (Milestone 3)."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.engine import analyze
from app.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Default magnitude reproduces baseline
# ---------------------------------------------------------------------------

def test_default_magnitude_market_crash():
    """Default magnitude (no override) must reproduce the locked baseline."""
    result = analyze("market_crash")
    assert result["scenario_value"] == Decimal("87050.00")


def test_default_magnitude_via_api():
    body = client.post("/api/analyze", json={"scenario_key": "market_crash"}).json()
    assert body["scenario_value"] == 87050.0


# ---------------------------------------------------------------------------
# Linear sensitivity scaling
# ---------------------------------------------------------------------------

def test_linear_scaling_doubles_impact():
    """Doubling the magnitude should roughly double the impact (linear)."""
    base = analyze("market_crash")
    scaled = analyze("market_crash", requested_magnitude=40.0)
    # At 40% (2x baseline 20%), impact should be ~2x
    assert scaled["impact_dollars"] < base["impact_dollars"]  # both negative
    ratio = float(scaled["impact_dollars"]) / float(base["impact_dollars"])
    assert 1.8 < ratio < 2.2, f"Expected ~2x scaling, got {ratio}"


def test_linear_scaling_zero_magnitude_is_flat():
    """0% magnitude (if allowed) would produce zero impact — but min is 1%."""
    # min_value for market_crash is 1.0, so 1% should produce small impact
    result = analyze("market_crash", requested_magnitude=1.0)
    # 1% / 20% = 5% of baseline impact
    base = analyze("market_crash")
    ratio = float(result["impact_dollars"]) / float(base["impact_dollars"])
    assert 0.03 < ratio < 0.07, f"Expected ~5% of baseline, got {ratio}"


def test_linear_scaling_holdings_reconcile():
    """Holdings must still sum to scenario_value after scaling."""
    result = analyze("market_crash", requested_magnitude=30.0)
    assert sum(h["scenario_value"] for h in result["holdings"]) == result["scenario_value"]
    assert sum(h["impact_dollars"] for h in result["holdings"]) == result["impact_dollars"]


def test_linear_scaling_attribution_reconciles():
    result = analyze("oil_shock", requested_magnitude=60.0)
    assert sum(a["impact_dollars"] for a in result["attribution"]) == result["impact_dollars"]


def test_linear_scaling_exceeds_100pct_rejected():
    """A magnitude that would cause a holding to lose >100% must be rejected."""
    with pytest.raises(ValueError, match="more than 100%"):
        analyze("market_crash", requested_magnitude=200.0)


def test_inflation_custom_rate():
    """Custom inflation rate changes purchasing power correctly."""
    result_10 = analyze("inflation", requested_magnitude=10.0)
    # 10% inflation: 100000 / 1.10 = 90909.09
    assert abs(float(result_10["scenario_value"]) - 90909.09) < 0.02


def test_inflation_zero_rate():
    """0% inflation: purchasing power equals nominal value."""
    result = analyze("inflation", requested_magnitude=0.0)
    assert result["scenario_value"] == result["nominal_value"]


def test_inflation_default_rate():
    """Default 5% inflation must still produce the locked baseline."""
    result = analyze("inflation")
    assert result["scenario_value"] == Decimal("95238.10")


# ---------------------------------------------------------------------------
# API validation
# ---------------------------------------------------------------------------

def test_api_rejects_out_of_range_magnitude():
    r = client.post("/api/analyze", json={
        "scenario_key": "market_crash",
        "requested_magnitude": 200.0,
    })
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "invalid_magnitude"


def test_api_accepts_valid_magnitude():
    r = client.post("/api/analyze", json={
        "scenario_key": "market_crash",
        "requested_magnitude": 30.0,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["assumptions"]["applied_magnitude"] == 30.0


def test_scenarios_endpoint_has_param_metadata():
    body = client.get("/api/scenarios").json()
    for s in body["scenarios"]:
        assert "param_label" in s
        assert "param_default" in s
        assert "param_min" in s
        assert "param_max" in s
        assert "param_step" in s
        assert "param_methodology" in s
