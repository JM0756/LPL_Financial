"""Tests for time horizon with explicit method (Milestone 4)."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.engine import analyze, _parse_horizon_months
from app.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# _parse_horizon_months
# ---------------------------------------------------------------------------

def test_parse_1y():
    assert _parse_horizon_months("1Y") == 12

def test_parse_12m():
    assert _parse_horizon_months("12M") == 12

def test_parse_6m():
    assert _parse_horizon_months("6M") == 6

def test_parse_24m():
    assert _parse_horizon_months("24M") == 24

def test_parse_invalid():
    assert _parse_horizon_months("5Y3M") is None


# ---------------------------------------------------------------------------
# Inflation horizon calculations
# ---------------------------------------------------------------------------

def test_inflation_12m_baseline():
    """12M horizon with 5% rate must reproduce the locked baseline."""
    result = analyze("inflation", horizon="12M")
    assert result["scenario_value"] == Decimal("95238.10")


def test_inflation_1y_equals_12m():
    """1Y and 12M must produce identical results."""
    r1 = analyze("inflation", horizon="1Y")
    r2 = analyze("inflation", horizon="12M")
    assert r1["scenario_value"] == r2["scenario_value"]


def test_inflation_24m_deeper_loss():
    """24M horizon should produce a larger purchasing-power loss than 12M."""
    r12 = analyze("inflation", horizon="12M")
    r24 = analyze("inflation", horizon="24M")
    assert r24["scenario_value"] < r12["scenario_value"]


def test_inflation_24m_calculation():
    """24M at 5%: 100000 / 1.05^2 = 90702.95 (approx)."""
    result = analyze("inflation", horizon="24M")
    expected = 100000 / (1.05 ** 2)
    assert abs(float(result["scenario_value"]) - expected) < 0.02


def test_inflation_zero_rate_any_horizon():
    """0% inflation: purchasing power equals nominal regardless of horizon."""
    for horizon in ["1M", "12M", "24M", "60M"]:
        result = analyze("inflation", horizon=horizon, requested_magnitude=0.0)
        assert result["scenario_value"] == result["nominal_value"], f"Failed for {horizon}"


def test_inflation_holdings_reconcile_24m():
    result = analyze("inflation", horizon="24M")
    assert sum(h["scenario_value"] for h in result["holdings"]) == result["scenario_value"]


def test_inflation_horizon_out_of_range():
    from app.engine import UnsupportedHorizonError
    with pytest.raises(UnsupportedHorizonError):
        analyze("inflation", horizon="61M")


def test_inflation_horizon_zero_rejected():
    from app.engine import UnsupportedHorizonError
    with pytest.raises(UnsupportedHorizonError):
        analyze("inflation", horizon="0M")


# ---------------------------------------------------------------------------
# Asset shock horizon type
# ---------------------------------------------------------------------------

def test_asset_shock_horizon_type():
    result = analyze("market_crash")
    assert result["horizon_type"] == "immediate_shock"


def test_inflation_horizon_type():
    result = analyze("inflation")
    assert result["horizon_type"] == "purchasing_power_illustration"


def test_asset_shock_rejects_non_1y():
    r = client.post("/api/analyze", json={"scenario_key": "market_crash", "horizon": "24M"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "unsupported_horizon"


def test_inflation_accepts_variable_horizon_via_api():
    r = client.post("/api/analyze", json={"scenario_key": "inflation", "horizon": "24M"})
    assert r.status_code == 200
    body = r.json()
    assert body["horizon"] == "24M"
    assert body["horizon_type"] == "purchasing_power_illustration"
