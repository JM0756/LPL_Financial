"""Tests for custom portfolio support (Milestone 2)."""

from decimal import Decimal

import pytest

from app.engine import analyze, validate_custom_portfolio


# ---------------------------------------------------------------------------
# validate_custom_portfolio
# ---------------------------------------------------------------------------

def test_validate_custom_portfolio_valid():
    result = validate_custom_portfolio([
        {"holding_id": "US_LARGE_CAP", "value": 50000},
        {"holding_id": "CASH", "value": 50000},
    ])
    assert result["US_LARGE_CAP"] == Decimal("50000.00")
    assert result["CASH"] == Decimal("50000.00")


def test_validate_custom_portfolio_empty():
    with pytest.raises(ValueError, match="at least one"):
        validate_custom_portfolio([])


def test_validate_custom_portfolio_unknown_holding():
    with pytest.raises(ValueError, match="Unknown holding_id"):
        validate_custom_portfolio([{"holding_id": "BITCOIN", "value": 1000}])


def test_validate_custom_portfolio_duplicate():
    with pytest.raises(ValueError, match="Duplicate"):
        validate_custom_portfolio([
            {"holding_id": "CASH", "value": 1000},
            {"holding_id": "CASH", "value": 2000},
        ])


def test_validate_custom_portfolio_negative():
    with pytest.raises(ValueError, match="non-negative"):
        validate_custom_portfolio([{"holding_id": "CASH", "value": -100}])


def test_validate_custom_portfolio_zero_total():
    with pytest.raises(ValueError, match="greater than zero"):
        validate_custom_portfolio([{"holding_id": "CASH", "value": 0}])


def test_validate_custom_portfolio_exceeds_max_holding():
    with pytest.raises(ValueError, match="exceeds maximum"):
        validate_custom_portfolio([{"holding_id": "CASH", "value": 20_000_000}])


def test_validate_custom_portfolio_exceeds_max_total():
    with pytest.raises(ValueError, match="exceeds maximum"):
        validate_custom_portfolio([
            {"holding_id": "US_LARGE_CAP", "value": 30_000_000},
            {"holding_id": "CASH", "value": 30_000_000},
        ])


# ---------------------------------------------------------------------------
# analyze with custom_holdings
# ---------------------------------------------------------------------------

def test_analyze_custom_portfolio_totals_reconcile():
    custom = validate_custom_portfolio([
        {"holding_id": "US_LARGE_CAP", "value": 60000},
        {"holding_id": "CASH", "value": 40000},
    ])
    result = analyze("market_crash", custom_holdings=custom)
    assert result["current_value"] == Decimal("100000.00")
    # Holdings sum to scenario_value exactly
    assert sum(h["scenario_value"] for h in result["holdings"]) == result["scenario_value"]
    assert sum(h["impact_dollars"] for h in result["holdings"]) == result["impact_dollars"]


def test_analyze_custom_portfolio_attribution_reconciles():
    custom = validate_custom_portfolio([
        {"holding_id": "US_LARGE_CAP", "value": 50000},
        {"holding_id": "US_AGG_BONDS", "value": 50000},
    ])
    result = analyze("market_crash", custom_holdings=custom)
    assert sum(a["impact_dollars"] for a in result["attribution"]) == result["impact_dollars"]
    assert sum(a["current_value"] for a in result["attribution"]) == result["current_value"]


def test_analyze_custom_portfolio_data_source():
    custom = validate_custom_portfolio([{"holding_id": "CASH", "value": 10000}])
    result = analyze("oil_shock", custom_holdings=custom)
    assert result["data_source"] == "custom"


def test_analyze_default_portfolio_data_source():
    result = analyze("market_crash")
    assert result["data_source"] == "synthetic"


def test_analyze_custom_portfolio_default_still_works():
    """Default scenarios must not change when custom_holdings=None."""
    result = analyze("market_crash")
    assert result["scenario_value"] == Decimal("87050.00")


def test_analyze_custom_portfolio_inflation():
    """Inflation scenario with custom portfolio: purchasing power calculation."""
    custom = validate_custom_portfolio([
        {"holding_id": "US_LARGE_CAP", "value": 100000},
    ])
    result = analyze("inflation", custom_holdings=custom)
    # nominal_value == current_value (0% nominal return)
    assert result["nominal_value"] == Decimal("100000.00")
    # scenario_value = 100000 / 1.05 = 95238.10
    assert result["scenario_value"] == Decimal("95238.10")
    assert sum(h["scenario_value"] for h in result["holdings"]) == result["scenario_value"]
