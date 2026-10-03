"""
Deterministic scenario engine.

Design rules:
  * Decimal end-to-end — no floats, no float drift.
  * The portfolio total is the authoritative number; holding-level values are
    reconciled (largest-remainder) so they sum to it to the penny.
  * Zero I/O, zero randomness, zero clocks in the math. Same input -> same
    output, forever. The LLM never touches these numbers.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from typing import Any, Sequence

from .scenarios import (
    ASSUMPTIONS_VERSION,
    DEFAULT_HORIZON,
    ENGINE_VERSION,
    MODE_PURCHASING_POWER,
    PORTFOLIO,
    PORTFOLIO_TOTAL,
    SCENARIO_KEYS,
    SUPPORTED_HORIZONS,
    SYNTHETIC_CLIENT_ID,
    Scenario,
    get_scenario,
    portfolio_payload,
    resolve_scenario_key,
    scenario_catalog,
)

MONEY = Decimal("0.01")
PCT2 = Decimal("0.01")
PCT4 = Decimal("0.0001")

MAX_HOLDING_VALUE = Decimal("10000000")   # $10M per holding
MAX_PORTFOLIO_TOTAL = Decimal("50000000")  # $50M total


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #
class EngineError(Exception):
    """Base class for engine errors."""


class UnsupportedScenarioError(EngineError):
    def __init__(self, requested: str | None):
        self.requested = requested
        super().__init__(
            f"Scenario {requested!r} is not supported. "
            f"Supported presets: {', '.join(SCENARIO_KEYS)}."
        )


class UnsupportedHorizonError(EngineError):
    def __init__(self, requested: str, scenario_key: str, supported: str):
        self.requested = requested
        self.scenario_key = scenario_key
        self.supported = supported
        super().__init__(
            f"Horizon {requested!r} is not modelled for preset {scenario_key!r}. "
            f"The available preset uses a {supported} horizon."
        )


# --------------------------------------------------------------------------- #
# Numeric helpers
# --------------------------------------------------------------------------- #
def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def pct(value: Decimal, places: Decimal = PCT2) -> Decimal:
    return Decimal(value).quantize(places, rounding=ROUND_HALF_UP)


def _reconcile_to_total(raw_values: Sequence[Decimal], target_total: Decimal) -> list[Decimal]:
    """
    Round `raw_values` to cents such that they sum *exactly* to `target_total`
    (largest-remainder / Hamilton apportionment on pennies).

    This is what keeps "sum of holdings == portfolio total" true even when the
    portfolio total is derived from a division (e.g. 100,000 / 1.05).
    """
    if not raw_values:
        return []

    target_cents = int((Decimal(target_total) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    scaled = [Decimal(v) * 100 for v in raw_values]
    floors = [int(s.to_integral_value(rounding=ROUND_FLOOR)) for s in scaled]
    remainders = [scaled[i] - floors[i] for i in range(len(scaled))]

    cents = list(floors)
    diff = target_cents - sum(floors)

    if diff > 0:
        order = sorted(range(len(cents)), key=lambda i: (-remainders[i], i))
        for k in range(diff):
            cents[order[k % len(order)]] += 1
    elif diff < 0:
        order = sorted(range(len(cents)), key=lambda i: (remainders[i], i))
        for k in range(-diff):
            cents[order[k % len(order)]] -= 1

    return [money(Decimal(c) / Decimal(100)) for c in cents]


def to_jsonable(obj: Any) -> Any:
    """Recursively convert Decimals to floats for JSON/HTTP responses."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    return obj


def to_decimal_safe(obj: Any) -> Any:
    """Recursively convert floats to Decimal (DynamoDB cannot store floats)."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: to_decimal_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_decimal_safe(v) for v in obj]
    return obj


def new_analysis_id() -> str:
    return f"an_{uuid.uuid4().hex[:16]}"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Custom portfolio validation
# --------------------------------------------------------------------------- #
def validate_custom_portfolio(raw: list[dict]) -> dict:
    """
    Validate a client-supplied custom portfolio.
    Returns a dict mapping holding_id -> Decimal value.
    Raises ValueError with a descriptive message on any problem.
    The backend calculates all totals — client-supplied aggregates are ignored.
    """
    from .scenarios import PORTFOLIO_BY_ID

    if not raw:
        raise ValueError("custom_portfolio must contain at least one holding.")
    if len(raw) > len(PORTFOLIO_BY_ID):
        raise ValueError(f"custom_portfolio may contain at most {len(PORTFOLIO_BY_ID)} holdings.")

    seen: set[str] = set()
    result: dict[str, Decimal] = {}
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Each custom_portfolio item must be an object.")
        holding_id = item.get("holding_id")
        value_raw = item.get("value")
        if not isinstance(holding_id, str) or holding_id not in PORTFOLIO_BY_ID:
            raise ValueError(
                f"Unknown holding_id {holding_id!r}. "
                f"Supported: {', '.join(PORTFOLIO_BY_ID.keys())}."
            )
        if holding_id in seen:
            raise ValueError(f"Duplicate holding_id: {holding_id!r}.")
        seen.add(holding_id)
        try:
            value = Decimal(str(value_raw))
        except Exception:
            raise ValueError(f"Invalid value for {holding_id!r}: {value_raw!r}.")
        if not value.is_finite() or value < 0:
            raise ValueError(f"Value for {holding_id!r} must be a non-negative finite number.")
        if value > MAX_HOLDING_VALUE:
            raise ValueError(
                f"Value for {holding_id!r} exceeds maximum of "
                f"${MAX_HOLDING_VALUE:,.0f}."
            )
        result[holding_id] = money(value)

    total = sum(result.values(), Decimal("0"))
    if total <= 0:
        raise ValueError("custom_portfolio total must be greater than zero.")
    if total > MAX_PORTFOLIO_TOTAL:
        raise ValueError(
            f"custom_portfolio total ${total:,.2f} exceeds maximum of "
            f"${MAX_PORTFOLIO_TOTAL:,.0f}."
        )
    return result


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def get_portfolio() -> dict:
    """The synthetic $100,000 portfolio."""
    return portfolio_payload()


def get_scenario_catalog() -> list[dict]:
    return scenario_catalog()


def validate_request(scenario_key: str | None, horizon: str | None = None) -> tuple[Scenario, str]:
    """Resolve + validate a scenario/horizon pair. Raises on mismatch."""
    from .scenarios import INFLATION_MAX_MONTHS, INFLATION_MIN_MONTHS, MODE_PURCHASING_POWER

    resolved = resolve_scenario_key(scenario_key)
    scenario = get_scenario(resolved) if resolved else None
    if scenario is None:
        raise UnsupportedScenarioError(scenario_key)

    requested_horizon = (horizon or scenario.horizon or DEFAULT_HORIZON).strip().upper()

    # Inflation supports variable horizons expressed as NM (e.g. "12M", "24M")
    if scenario.mode == MODE_PURCHASING_POWER:
        months = _parse_horizon_months(requested_horizon)
        if months is None or not (INFLATION_MIN_MONTHS <= months <= INFLATION_MAX_MONTHS):
            raise UnsupportedHorizonError(
                requested_horizon, scenario.key,
                f"1M–60M (got {requested_horizon!r})"
            )
        return scenario, requested_horizon

    # All other scenarios: only the fixed horizon is supported
    if requested_horizon != scenario.horizon or requested_horizon not in SUPPORTED_HORIZONS:
        raise UnsupportedHorizonError(requested_horizon, scenario.key, scenario.horizon)

    return scenario, requested_horizon


def _parse_horizon_months(horizon: str) -> int | None:
    """Parse a horizon string like '1Y', '12M', '6M' into months. Returns None on failure."""
    h = horizon.strip().upper()
    if h.endswith("Y"):
        try:
            return int(h[:-1]) * 12
        except ValueError:
            return None
    if h.endswith("M"):
        try:
            return int(h[:-1])
        except ValueError:
            return None
    return None


def analyze(
    scenario_key: str,
    horizon: str | None = None,
    *,
    analysis_id: str | None = None,
    generated_at: str | None = None,
    custom_holdings: dict | None = None,
    requested_magnitude: float | None = None,
) -> dict:
    """
    Run a preset scenario against the synthetic portfolio (or a custom portfolio).

    custom_holdings: dict mapping holding_id -> Decimal value, as returned by
    validate_custom_portfolio(). When None, the default synthetic portfolio is used.

    requested_magnitude: optional float override (same units as param_default in
    scenario_catalog). When provided, holding shocks are scaled linearly:
        shock = baseline_shock * (requested_magnitude / baseline_magnitude)
    This is an illustrative linear sensitivity assumption, not a validated model.
    Rejected if it would cause any holding to lose more than 100% of its value.

    Returns a fully self-describing snapshot: totals, per-holding attribution,
    asset-class attribution, the assumption set, and the version stamps.
    All numeric values are Decimal.
    """
    from .scenarios import PORTFOLIO_BY_ID, Holding

    scenario, resolved_horizon = validate_request(scenario_key, horizon)

    # Compute effective shocks (with optional linear scaling)
    if requested_magnitude is not None and scenario.mode != MODE_PURCHASING_POWER:
        scale = Decimal(str(requested_magnitude)) / (scenario.headline_magnitude * Decimal("100"))
        effective_shocks: dict[str, Decimal] = {
            hid: scenario.shock_for(hid) * scale
            for hid in (PORTFOLIO_BY_ID.keys())
        }
        # Validate: no holding can lose more than 100%
        for hid, shock in effective_shocks.items():
            if shock < Decimal("-1"):
                raise ValueError(
                    f"requested_magnitude {requested_magnitude} would cause {hid} to lose "
                    f"more than 100% of its value (shock={float(shock)*100:.1f}%). "
                    f"Reduce the magnitude."
                )
        effective_inflation_rate = scenario.inflation_rate
        applied_magnitude = Decimal(str(requested_magnitude))
    elif requested_magnitude is not None and scenario.mode == MODE_PURCHASING_POWER:
        # For inflation: requested_magnitude IS the annual inflation rate in percent
        effective_shocks = {hid: Decimal("0") for hid in PORTFOLIO_BY_ID.keys()}
        effective_inflation_rate = Decimal(str(requested_magnitude)) / Decimal("100")
        applied_magnitude = Decimal(str(requested_magnitude))
    else:
        effective_shocks = None  # use scenario defaults
        effective_inflation_rate = scenario.inflation_rate
        applied_magnitude = scenario.headline_magnitude * Decimal("100")

    def get_shock(holding_id: str) -> Decimal:
        if effective_shocks is not None:
            return effective_shocks.get(holding_id, Decimal("0"))
        return scenario.shock_for(holding_id)

    # Build the effective portfolio
    if custom_holdings:
        effective_portfolio = [
            Holding(
                holding_id=h.holding_id,
                name=h.name,
                asset_class=h.asset_class,
                sector=h.sector,
                value=custom_holdings[h.holding_id],
            )
            for h in PORTFOLIO
            if h.holding_id in custom_holdings
        ]
        current_total = money(sum(custom_holdings.values(), Decimal("0")))
        data_source = "custom"
    else:
        effective_portfolio = list(PORTFOLIO)
        current_total = PORTFOLIO_TOTAL
        data_source = "synthetic"

    deflator = Decimal("1") + (effective_inflation_rate or Decimal("0"))
    is_purchasing_power = scenario.mode == MODE_PURCHASING_POWER

    # For purchasing-power scenarios, compute deflator using actual horizon
    if is_purchasing_power:
        months = _parse_horizon_months(resolved_horizon) or 12
        # real_value = nominal / (1 + annual_rate)^(months/12)
        annual_rate = effective_inflation_rate or Decimal("0")
        exponent = Decimal(str(months)) / Decimal("12")
        # Use Python's float for the power, then convert back to Decimal
        import math
        deflator = Decimal(str((1 + float(annual_rate)) ** float(exponent)))

    # --- 1) nominal leg (exact, per holding) ---------------------------------
    nominal_values: list[Decimal] = []
    for h in effective_portfolio:
        nominal_values.append(money(h.value * (Decimal("1") + get_shock(h.holding_id))))
    nominal_total = money(sum(nominal_values, Decimal("0")))

    # --- 2) scenario leg (real terms if purchasing-power illustration) -------
    if is_purchasing_power:
        raw_scenario_values = [v / deflator for v in nominal_values]
        scenario_total = money(nominal_total / deflator)
    else:
        raw_scenario_values = [Decimal(v) for v in nominal_values]
        scenario_total = nominal_total

    # Penny-reconcile holdings so they sum exactly to the authoritative total.
    scenario_values = _reconcile_to_total(raw_scenario_values, scenario_total)

    impact_dollars = money(scenario_total - current_total)
    impact_percent = pct(impact_dollars / current_total * Decimal("100"))
    nominal_impact_dollars = money(nominal_total - current_total)
    nominal_impact_percent = pct(nominal_impact_dollars / current_total * Decimal("100"))

    # --- 3) per-holding attribution -----------------------------------------
    holdings: list[dict] = []
    for idx, h in enumerate(effective_portfolio):
        current = money(h.value)
        nominal = nominal_values[idx]
        scen = scenario_values[idx]
        impact = money(scen - current)
        holdings.append(
            {
                "holding_id": h.holding_id,
                "name": h.name,
                "asset_class": h.asset_class,
                "sector": h.sector,
                "current_value": current,
                "shock_percent": pct(get_shock(h.holding_id) * Decimal("100")),
                "nominal_value": nominal,
                "scenario_value": scen,
                "impact_dollars": impact,
                "impact_percent": pct(impact / current * Decimal("100")) if current else Decimal("0.00"),
                # Contribution to the total portfolio impact percent.
                "contribution_percent": pct(impact / current_total * Decimal("100"), PCT4),
            }
        )

    # --- 4) asset-class attribution (exact by construction) ------------------
    buckets: dict[str, dict] = {}
    for row in holdings:
        b = buckets.setdefault(
            row["asset_class"],
            {
                "asset_class": row["asset_class"],
                "current_value": Decimal("0.00"),
                "scenario_value": Decimal("0.00"),
                "impact_dollars": Decimal("0.00"),
            },
        )
        b["current_value"] += row["current_value"]
        b["scenario_value"] += row["scenario_value"]
        b["impact_dollars"] += row["impact_dollars"]

    attribution: list[dict] = []
    for b in buckets.values():
        attribution.append(
            {
                **b,
                "impact_percent": pct(b["impact_dollars"] / b["current_value"] * Decimal("100")),
                "contribution_percent": pct(
                    b["impact_dollars"] / current_total * Decimal("100"), PCT4
                ),
                "role": "contributor" if b["impact_dollars"] > 0 else (
                    "detractor" if b["impact_dollars"] < 0 else "neutral"
                ),
            }
        )
    attribution.sort(key=lambda r: r["impact_dollars"])

    top_detractors = [r for r in sorted(holdings, key=lambda x: x["impact_dollars"]) if r["impact_dollars"] < 0][:3]
    top_contributors = [r for r in sorted(holdings, key=lambda x: -x["impact_dollars"]) if r["impact_dollars"] > 0][:3]

    result = {
        "analysis_id": analysis_id or new_analysis_id(),
        "client_id": SYNTHETIC_CLIENT_ID,
        "data_source": data_source,
        "currency": "USD",
        "scenario_key": scenario.key,
        "scenario_label": scenario.label,
        "scenario_summary": scenario.summary,
        "horizon": resolved_horizon,
        "horizon_type": "purchasing_power_illustration" if is_purchasing_power else "immediate_shock",
        "assumptions_version": ASSUMPTIONS_VERSION,
        "engine_version": ENGINE_VERSION,
        "valuation_basis": scenario.valuation_basis,
        "current_value": current_total,
        "scenario_value": scenario_total,
        "impact_dollars": impact_dollars,
        "impact_percent": impact_percent,
        "nominal_value": nominal_total,
        "nominal_impact_dollars": nominal_impact_dollars,
        "nominal_impact_percent": nominal_impact_percent,
        "inflation_rate_percent": (
            pct(effective_inflation_rate * Decimal("100")) if effective_inflation_rate else None
        ),
        "holdings": holdings,
        "attribution": attribution,
        "drivers": list(scenario.drivers),
        "assumptions": {
            "version": ASSUMPTIONS_VERSION,
            "mode": scenario.mode,
            "horizon": scenario.horizon,
            "direction": scenario.direction,
            "magnitude_label": scenario.magnitude_label,
            "applied_magnitude": float(applied_magnitude),
            "baseline_magnitude": float(scenario.headline_magnitude * Decimal("100")),
            "sensitivity_methodology": (
                "Linear sensitivity scaling applied."
                if requested_magnitude is not None and scenario.mode != MODE_PURCHASING_POWER
                else "Default baseline assumptions."
            ),
            "inflation_rate_percent": (
                pct(effective_inflation_rate * Decimal("100")) if effective_inflation_rate else None
            ),
            "notes": list(scenario.assumption_notes),
            "excluded": ["trading", "rebalancing", "taxes", "fees", "live market prices"],
        },
        "top_detractors": [
            {"name": r["name"], "impact_dollars": r["impact_dollars"]} for r in top_detractors
        ],
        "top_contributors": [
            {"name": r["name"], "impact_dollars": r["impact_dollars"]} for r in top_contributors
        ],
        "generated_at": generated_at or utc_now_iso(),
    }
    return result


def result_summary(analysis: dict) -> dict:
    """Compact, advisor-facing summary of a stored snapshot."""
    return {
        "current_value": analysis["current_value"],
        "scenario_value": analysis["scenario_value"],
        "impact_dollars": analysis["impact_dollars"],
        "impact_percent": analysis["impact_percent"],
        "valuation_basis": analysis.get("valuation_basis"),
    }
