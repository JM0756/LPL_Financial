"""
Engine tests — these lock the mandated totals. If a shock in scenarios.py
changes, these fail loudly.

    market_crash          : 100,000.00 -> 87,050.00   (-12.95%)
    oil_shock             : 100,000.00 -> 100,100.00  (+0.10%)
    inflation             : 100,000.00 -> 95,238.10   ( -4.76%)
    rate_rise             : 100,000.00 -> 95,000.00   ( -5.00%)
    tech_downturn         : 100,000.00 -> 92,150.00   ( -7.85%)
    international_downturn: 100,000.00 -> 94,600.00   ( -5.40%)
"""

from decimal import Decimal

import pytest

from app.engine import (
    UnsupportedHorizonError,
    UnsupportedScenarioError,
    _reconcile_to_total,
    analyze,
    get_portfolio,
)
from app.scenarios import ASSUMPTIONS_VERSION, PORTFOLIO, PORTFOLIO_TOTAL, SCENARIO_KEYS

D = Decimal
BASE = D("100000.00")


# --------------------------------------------------------------------------- #
# Portfolio
# --------------------------------------------------------------------------- #
def test_portfolio_totals_100k():
    assert PORTFOLIO_TOTAL == BASE
    assert sum((h.value for h in PORTFOLIO), D("0")) == BASE


def test_portfolio_payload_weights_sum_to_100():
    payload = get_portfolio()
    assert payload["total_value"] == BASE
    assert payload["data_source"] == "synthetic"
    assert sum(h["weight_percent"] for h in payload["holdings"]) == D("100.00")


# --------------------------------------------------------------------------- #
# Mandated totals
# --------------------------------------------------------------------------- #
def test_market_crash_totals():
    r = analyze("market_crash")
    assert r["current_value"] == BASE
    assert r["scenario_value"] == D("87050.00")
    assert r["impact_dollars"] == D("-12950.00")
    assert r["impact_percent"] == D("-12.95")
    assert r["horizon"] == "1Y"
    assert r["assumptions_version"] == ASSUMPTIONS_VERSION


def test_oil_shock_totals():
    r = analyze("oil_shock")
    assert r["current_value"] == BASE
    assert r["scenario_value"] == D("100100.00")
    assert r["impact_dollars"] == D("100.00")
    assert r["impact_percent"] == D("0.10")


def test_inflation_purchasing_power_totals():
    r = analyze("inflation")
    # Nominal return is held flat at 0% ...
    assert r["nominal_value"] == BASE
    assert r["nominal_impact_dollars"] == D("0.00")
    assert r["nominal_impact_percent"] == D("0.00")
    # ... and the change is purely purchasing power: 100,000 / 1.05
    assert r["scenario_value"] == D("95238.10")
    assert r["impact_dollars"] == D("-4761.90")
    assert r["impact_percent"] == D("-4.76")
    assert r["inflation_rate_percent"] == D("5.00")
    assert r["valuation_basis"] == "real_purchasing_power"
    assert all(h["shock_percent"] == D("0.00") for h in r["holdings"])


@pytest.mark.parametrize(
    "key,expected",
    [
        ("market_crash",           D("87050.00")),
        ("oil_shock",              D("100100.00")),
        ("inflation",              D("95238.10")),
        ("rate_rise",              D("95000.00")),
        ("tech_downturn",          D("92150.00")),
        ("international_downturn", D("94600.00")),
    ],
)
def test_all_targets_table(key, expected):
    assert analyze(key)["scenario_value"] == expected


# --------------------------------------------------------------------------- #
# Attribution integrity
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("key", SCENARIO_KEYS)
def test_holding_values_sum_to_total_exactly(key):
    r = analyze(key)
    assert sum(h["scenario_value"] for h in r["holdings"]) == r["scenario_value"]
    assert sum(h["current_value"] for h in r["holdings"]) == r["current_value"]


@pytest.mark.parametrize("key", SCENARIO_KEYS)
def test_holding_impacts_sum_to_total_impact(key):
    r = analyze(key)
    assert sum(h["impact_dollars"] for h in r["holdings"]) == r["impact_dollars"]


@pytest.mark.parametrize("key", SCENARIO_KEYS)
def test_asset_class_attribution_reconciles(key):
    r = analyze(key)
    assert sum(a["current_value"] for a in r["attribution"]) == r["current_value"]
    assert sum(a["scenario_value"] for a in r["attribution"]) == r["scenario_value"]
    assert sum(a["impact_dollars"] for a in r["attribution"]) == r["impact_dollars"]


def test_market_crash_attribution_detail():
    r = analyze("market_crash")
    by_id = {h["holding_id"]: h for h in r["holdings"]}
    assert by_id["US_LARGE_CAP"]["impact_dollars"] == D("-7000.00")
    assert by_id["TECH_EQUITY"]["impact_dollars"] == D("-2800.00")
    assert by_id["US_AGG_BONDS"]["impact_dollars"] == D("1000.00")
    assert by_id["CASH"]["impact_dollars"] == D("0.00")

    equity = next(a for a in r["attribution"] if a["asset_class"] == "Equity")
    assert equity["impact_dollars"] == D("-14000.00")
    assert equity["role"] == "detractor"
    assert r["top_detractors"][0]["name"] == "US Large-Cap Equity Index"


def test_oil_shock_energy_offsets_the_rest():
    r = analyze("oil_shock")
    by_id = {h["holding_id"]: h for h in r["holdings"]}
    energy_gain = by_id["ENERGY_EQUITY"]["impact_dollars"]
    others = sum(h["impact_dollars"] for h in r["holdings"] if h["holding_id"] != "ENERGY_EQUITY")
    assert energy_gain == D("2500.00")
    assert others == D("-2400.00")
    assert energy_gain + others == D("100.00")
    assert r["top_contributors"][0]["name"] == "Energy Sector Equity"


def test_inflation_holding_real_values_reconcile():
    r = analyze("inflation")
    by_id = {h["holding_id"]: h for h in r["holdings"]}
    assert by_id["US_LARGE_CAP"]["nominal_value"] == D("35000.00")
    assert by_id["US_LARGE_CAP"]["scenario_value"] == D("33333.33")
    assert sum(h["scenario_value"] for h in r["holdings"]) == D("95238.10")


# --------------------------------------------------------------------------- #
# Determinism & validation
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("key", SCENARIO_KEYS)
def test_deterministic_repeat_runs(key):
    a = analyze(key, analysis_id="fixed", generated_at="2025-01-01T00:00:00+00:00")
    b = analyze(key, analysis_id="fixed", generated_at="2025-01-01T00:00:00+00:00")
    assert a == b


def test_aliases_resolve():
    assert analyze("CRASH")["scenario_key"] == "market_crash"
    assert analyze("oil")["scenario_key"] == "oil_shock"
    assert analyze("purchasing-power")["scenario_key"] == "inflation"


def test_unsupported_scenario_raises():
    with pytest.raises(UnsupportedScenarioError):
        analyze("crypto_winter")


def test_unsupported_horizon_raises():
    with pytest.raises(UnsupportedHorizonError) as exc:
        analyze("market_crash", "5Y")
    assert exc.value.supported == "1Y"


def test_reconcile_to_total_penny_exact():
    raw = [D("33333.333333"), D("14285.714286"), D("9523.809524"), D("9523.809524"),
           D("19047.619048"), D("4761.904762"), D("4761.904762")]
    out = _reconcile_to_total(raw, D("95238.10"))
    assert sum(out) == D("95238.10")
    assert all(abs(o - r) < D("0.02") for o, r in zip(out, raw))


# --------------------------------------------------------------------------- #
# New scenario totals
# --------------------------------------------------------------------------- #
def test_rate_rise_totals():
    r = analyze("rate_rise")
    assert r["current_value"] == BASE
    assert r["scenario_value"] == D("95000.00")
    assert r["impact_dollars"] == D("-5000.00")
    assert r["impact_percent"] == D("-5.00")
    assert r["horizon"] == "1Y"
    assert r["assumptions_version"] == ASSUMPTIONS_VERSION


def test_rate_rise_holding_detail():
    r = analyze("rate_rise")
    by_id = {h["holding_id"]: h for h in r["holdings"]}
    assert by_id["US_LARGE_CAP"]["impact_dollars"]    == D("-1750.00")
    assert by_id["INTL_DEV_EQUITY"]["impact_dollars"] == D("-750.00")
    assert by_id["ENERGY_EQUITY"]["impact_dollars"]   == D("-300.00")
    assert by_id["TECH_EQUITY"]["impact_dollars"]     == D("-800.00")
    assert by_id["US_AGG_BONDS"]["impact_dollars"]    == D("-1200.00")
    assert by_id["TIPS"]["impact_dollars"]            == D("-200.00")
    assert by_id["CASH"]["impact_dollars"]            == D("0.00")
    # Contributions must sum to total impact
    total = sum(h["impact_dollars"] for h in r["holdings"])
    assert total == D("-5000.00")


def test_tech_downturn_totals():
    r = analyze("tech_downturn")
    assert r["current_value"] == BASE
    assert r["scenario_value"] == D("92150.00")
    assert r["impact_dollars"] == D("-7850.00")
    assert r["impact_percent"] == D("-7.85")
    assert r["horizon"] == "1Y"


def test_tech_downturn_holding_detail():
    r = analyze("tech_downturn")
    by_id = {h["holding_id"]: h for h in r["holdings"]}
    assert by_id["US_LARGE_CAP"]["impact_dollars"]    == D("-4200.00")
    assert by_id["INTL_DEV_EQUITY"]["impact_dollars"] == D("-900.00")
    assert by_id["ENERGY_EQUITY"]["impact_dollars"]   == D("-200.00")
    assert by_id["TECH_EQUITY"]["impact_dollars"]     == D("-3000.00")
    assert by_id["US_AGG_BONDS"]["impact_dollars"]    == D("400.00")
    assert by_id["TIPS"]["impact_dollars"]            == D("50.00")
    assert by_id["CASH"]["impact_dollars"]            == D("0.00")
    total = sum(h["impact_dollars"] for h in r["holdings"])
    assert total == D("-7850.00")


def test_international_downturn_totals():
    r = analyze("international_downturn")
    assert r["current_value"] == BASE
    assert r["scenario_value"] == D("94600.00")
    assert r["impact_dollars"] == D("-5400.00")
    assert r["impact_percent"] == D("-5.40")
    assert r["horizon"] == "1Y"


def test_international_downturn_holding_detail():
    r = analyze("international_downturn")
    by_id = {h["holding_id"]: h for h in r["holdings"]}
    assert by_id["US_LARGE_CAP"]["impact_dollars"]    == D("-1750.00")
    assert by_id["INTL_DEV_EQUITY"]["impact_dollars"] == D("-3000.00")
    assert by_id["ENERGY_EQUITY"]["impact_dollars"]   == D("-500.00")
    assert by_id["TECH_EQUITY"]["impact_dollars"]     == D("-600.00")
    assert by_id["US_AGG_BONDS"]["impact_dollars"]    == D("400.00")
    assert by_id["TIPS"]["impact_dollars"]            == D("50.00")
    assert by_id["CASH"]["impact_dollars"]            == D("0.00")
    total = sum(h["impact_dollars"] for h in r["holdings"])
    assert total == D("-5400.00")


def test_new_scenario_aliases_resolve():
    assert analyze("rate_hike")["scenario_key"] == "rate_rise"
    assert analyze("tech_crash")["scenario_key"] == "tech_downturn"
    assert analyze("intl_downturn")["scenario_key"] == "international_downturn"


def test_new_scenarios_attribution_reconciles():
    for key in ("rate_rise", "tech_downturn", "international_downturn"):
        r = analyze(key)
        assert sum(a["impact_dollars"] for a in r["attribution"]) == r["impact_dollars"]
        assert sum(a["current_value"] for a in r["attribution"]) == r["current_value"]
        assert sum(a["scenario_value"] for a in r["attribution"]) == r["scenario_value"]
