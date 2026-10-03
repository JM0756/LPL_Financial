"""
Synthetic portfolio + hardcoded scenario assumptions.

NOTHING here is live market data. The portfolio is a fixed $100,000 synthetic
book, and each scenario is a hardcoded, versioned assumption set. The version
string (`ASSUMPTIONS_VERSION`) is stamped onto every analysis and every saved
record so an advisor can always tell which assumption set produced a number.

Target totals (locked by tests/test_engine.py):
    market_crash          : 100,000.00 -> 87,050.00   (-12.95%)
    oil_shock             : 100,000.00 -> 100,100.00  (+0.10%)
    inflation             : 100,000.00 -> 95,238.10   (-4.76% purchasing power)
    rate_rise             : 100,000.00 -> 95,000.00   (-5.00%)
    tech_downturn         : 100,000.00 -> 92,150.00   (-7.85%)
    international_downturn: 100,000.00 -> 94,600.00   (-5.40%)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Mapping

ASSUMPTIONS_VERSION = "assumptions-2025.02-mvp"
ENGINE_VERSION = "engine-1.0.0"

#: Synthetic (fake) client the MVP always operates on. No auth, no real people.
SYNTHETIC_CLIENT_ID = "SYNTH-CLIENT-001"
SYNTHETIC_CLIENT_NAME = "Demo Household (synthetic)"

#: The only horizon supported by the MVP assumption sets.
SUPPORTED_HORIZONS: tuple[str, ...] = ("1Y",)
DEFAULT_HORIZON = "1Y"

# Inflation scenario supports variable horizons (1–60 months)
INFLATION_MIN_MONTHS = 1
INFLATION_MAX_MONTHS = 60


# --------------------------------------------------------------------------- #
# Portfolio
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Holding:
    holding_id: str
    name: str
    asset_class: str
    sector: str
    value: Decimal  # synthetic market value in USD


PORTFOLIO: tuple[Holding, ...] = (
    Holding("US_LARGE_CAP", "US Large-Cap Equity Index", "Equity", "Broad US Equity", Decimal("35000.00")),
    Holding("INTL_DEV_EQUITY", "International Developed Equity", "Equity", "Broad Intl Equity", Decimal("15000.00")),
    Holding("ENERGY_EQUITY", "Energy Sector Equity", "Equity", "Energy", Decimal("10000.00")),
    Holding("TECH_EQUITY", "Technology Sector Equity", "Equity", "Information Technology", Decimal("10000.00")),
    Holding("US_AGG_BONDS", "US Aggregate Bond Fund", "Fixed Income", "Investment Grade", Decimal("20000.00")),
    Holding("TIPS", "Treasury Inflation-Protected Securities", "Fixed Income", "Inflation-Linked", Decimal("5000.00")),
    Holding("CASH", "Cash & Money Market", "Cash", "Cash", Decimal("5000.00")),
)

PORTFOLIO_TOTAL: Decimal = sum((h.value for h in PORTFOLIO), Decimal("0.00"))  # 100000.00
PORTFOLIO_BY_ID: Mapping[str, Holding] = {h.holding_id: h for h in PORTFOLIO}


# --------------------------------------------------------------------------- #
# Scenarios
# --------------------------------------------------------------------------- #
MODE_ASSET_SHOCK = "asset_shock"
MODE_PURCHASING_POWER = "purchasing_power"


@dataclass(frozen=True)
class Scenario:
    key: str
    label: str
    summary: str
    horizon: str
    mode: str

    #: Per-holding nominal shocks as decimal fractions (e.g. Decimal("-0.20")).
    shocks: Mapping[str, Decimal]

    #: Direction of the *headline* stress, used for intent-matching checks.
    direction: str  # "down" | "up" | "flat_nominal"

    #: Headline magnitude the preset actually assumes (fraction), + tolerance
    #: band. Used to detect "user asked for something we do not model".
    headline_magnitude: Decimal
    magnitude_tolerance: Decimal
    magnitude_label: str

    #: Inflation rate used only by MODE_PURCHASING_POWER.
    inflation_rate: Decimal | None = None

    #: Human-readable assumption bullets. These (and only these) are shipped to
    #: Bedrock alongside the computed results.
    assumption_notes: tuple[str, ...] = ()

    #: Qualitative driver bullets used by the LLM prompt and by the
    #: deterministic fallback template.
    drivers: tuple[str, ...] = ()

    #: Keywords for the deterministic (non-LLM) intent fallback.
    keywords: tuple[str, ...] = ()

    aliases: tuple[str, ...] = ()
    valuation_basis: str = "nominal_market_value"
    

    def shock_for(self, holding_id: str) -> Decimal:
        return self.shocks.get(holding_id, Decimal("0"))


MARKET_CRASH = Scenario(
    key="market_crash",
    label="Market Crash",
    summary=(
        "A broad equity market crash over one year: global equities sell off hard, "
        "high-growth sectors fall the most, and high-quality bonds rally as "
        "investors move to safety."
    ),
    horizon="1Y",
    mode=MODE_ASSET_SHOCK,
    direction="down",
    headline_magnitude=Decimal("0.20"),  # -20% broad US equity drawdown
    magnitude_tolerance=Decimal("0.05"),
    magnitude_label="roughly a 20% broad equity drawdown",
    shocks={
        "US_LARGE_CAP": Decimal("-0.20"),
        "INTL_DEV_EQUITY": Decimal("-0.18"),
        "ENERGY_EQUITY": Decimal("-0.15"),
        "TECH_EQUITY": Decimal("-0.28"),
        "US_AGG_BONDS": Decimal("0.05"),
        "TIPS": Decimal("0.01"),
        "CASH": Decimal("0.00"),
    },
    assumption_notes=(
        "Broad US large-cap equity falls 20% over the one-year horizon.",
        "International developed equity falls 18%; energy equity falls 15%.",
        "Technology equity falls 28% as the highest-beta sleeve.",
        "US aggregate bonds gain 5% and TIPS gain 1% on a flight to quality.",
        "Cash is held flat; no trading, rebalancing, taxes, or fees are modelled.",
    ),
    drivers=(
        "equity beta is the dominant detractor, led by the technology sleeve",
        "international equity adds to the drawdown alongside US equity",
        "investment-grade bonds act as the main shock absorber",
        "cash and inflation-linked bonds contribute stability rather than return",
    ),
    keywords=(
        "crash", "market crash", "bear market", "sell off", "selloff", "correction",
        "drawdown", "equities fall", "stocks fall", "stock market drop", "recession",
        "meltdown", "market collapse", "equity shock",
    ),
    aliases=("crash", "market_crash", "equity_crash", "bear_market"),
)

OIL_SHOCK = Scenario(
    key="oil_shock",
    label="Oil Shock",
    summary=(
        "A sustained crude oil price spike over one year: energy holdings rally "
        "strongly while higher input costs weigh modestly on the rest of the "
        "portfolio, leaving the total essentially flat."
    ),
    horizon="1Y",
    mode=MODE_ASSET_SHOCK,
    direction="up",
    headline_magnitude=Decimal("0.40"),  # +40% crude oil price move
    magnitude_tolerance=Decimal("0.15"),
    magnitude_label="roughly a 40% sustained rise in crude oil prices",
    shocks={
        "US_LARGE_CAP": Decimal("-0.03"),
        "INTL_DEV_EQUITY": Decimal("-0.04"),
        "ENERGY_EQUITY": Decimal("0.25"),
        "TECH_EQUITY": Decimal("-0.05"),
        "US_AGG_BONDS": Decimal("-0.015"),
        "TIPS": Decimal("0.01"),
        "CASH": Decimal("0.00"),
    },
    assumption_notes=(
        "Crude oil rises roughly 40% and stays elevated for the one-year horizon.",
        "Energy sector equity gains 25% on higher realised prices and margins.",
        "US large-cap equity falls 3%, international developed equity falls 4%.",
        "Technology equity falls 5% on margin pressure and rate sensitivity.",
        "Aggregate bonds fall 1.5% on inflation pass-through; TIPS gain 1%.",
        "Cash is held flat; no trading, rebalancing, taxes, or fees are modelled.",
    ),
    drivers=(
        "the energy sleeve is the dominant contributor and offsets the rest of the book",
        "broad US and international equity are modest detractors on higher input costs",
        "technology equity lags as margins compress",
        "nominal bonds give back a little to inflation pass-through while TIPS help",
    ),
    keywords=(
        "oil", "crude", "opec", "brent", "wti", "gas price", "gasoline",
        "petrol", "energy spike", "energy prices", "fuel", "barrel",
    ),
    aliases=("oil", "oil_shock", "energy_shock", "crude_shock"),
)

INFLATION = Scenario(
    key="inflation",
    label="Inflation (Purchasing-Power Illustration)",
    summary=(
        "A purchasing-power illustration, not a market forecast: nominal portfolio "
        "value is deliberately held flat at 0% for one year while prices rise 5%, "
        "showing what the same balance would buy a year later."
    ),
    horizon="1Y",
    mode=MODE_PURCHASING_POWER,
    direction="flat_nominal",
    headline_magnitude=Decimal("0.05"),  # 5% inflation
    magnitude_tolerance=Decimal("0.01"),
    magnitude_label="5% inflation over one year with a flat 0% nominal return",
    shocks={h.holding_id: Decimal("0.00") for h in PORTFOLIO},
    inflation_rate=Decimal("0.05"),
    valuation_basis="real_purchasing_power",
    assumption_notes=(
        "Nominal return is held flat at 0% for every holding over one year.",
        "Inflation is assumed to be 5% over the same one-year horizon.",
        "Purchasing power is computed as nominal value divided by 1.05.",
        "This is an illustration of real value, not a market return forecast.",
        "No trading, rebalancing, taxes, or fees are modelled.",
    ),
    drivers=(
        "every holding is held flat in nominal terms by construction",
        "the entire change comes from the price level, not from markets",
        "the same balance simply buys less after a year of rising prices",
        "inflation-linked holdings are the natural place to look for a hedge",
    ),
    keywords=(
        "inflation", "cpi", "purchasing power", "cost of living", "prices rise",
        "prices go up", "real return", "real value", "money worth", "deflate",
    ),
    aliases=("inflation", "purchasing_power", "cpi"),
)

RATE_RISE = Scenario(
    key="rate_rise",
    label="Interest Rate Rise",
    summary=(
        "A hypothetical immediate repricing shock in which interest rates rise by one "
        "percentage point: fixed-income holdings fall as yields move up, technology "
        "equity is hit hardest among equities, and cash is unaffected."
    ),
    horizon="1Y",
    mode=MODE_ASSET_SHOCK,
    direction="up",
    headline_magnitude=Decimal("0.01"),  # 1 percentage-point rate rise
    magnitude_tolerance=Decimal("0.005"),
    magnitude_label="a 1 percentage-point rise in interest rates",
    shocks={
        "US_LARGE_CAP":    Decimal("-0.05"),
        "INTL_DEV_EQUITY": Decimal("-0.05"),
        "ENERGY_EQUITY":   Decimal("-0.03"),
        "TECH_EQUITY":     Decimal("-0.08"),
        "US_AGG_BONDS":    Decimal("-0.06"),
        "TIPS":            Decimal("-0.04"),
        "CASH":            Decimal("0.00"),
    },
    assumption_notes=(
        "These are manually specified prototype assumptions, not estimates from research, "
        "forecasts, or validated models.",
        "Rates rise by 1 percentage point as an immediate repricing shock.",
        "US large-cap and international developed equity each fall 5%.",
        "Technology equity falls 8% as the most rate-sensitive equity sleeve.",
        "Energy equity falls 3%; US aggregate bonds fall 6%; TIPS fall 4%.",
        "Cash is held flat; no trading, rebalancing, taxes, or fees are modelled.",
    ),
    drivers=(
        "rising rates reprice fixed-income holdings downward across the board",
        "technology equity is the most rate-sensitive equity sleeve",
        "cash is the only holding unaffected by the rate move",
        "TIPS fall less than nominal bonds but are not immune to rate rises",
    ),
    keywords=(
        "interest rate", "interest rates", "rate rise", "rate hike", "rates rise",
        "rates increase", "fed hike", "federal reserve hike", "yield rise",
        "yields rise", "tightening", "monetary tightening", "rate increase",
        "basis points", "bps",
    ),
    aliases=("rate_rise", "rate_hike", "interest_rate_rise", "rates_rise"),
)

TECH_DOWNTURN = Scenario(
    key="tech_downturn",
    label="Technology Downturn",
    summary=(
        "A hypothetical immediate repricing shock in which technology stocks fall 30%: "
        "the technology sleeve is the dominant detractor, broad equities fall modestly, "
        "and high-quality bonds provide a partial offset."
    ),
    horizon="1Y",
    mode=MODE_ASSET_SHOCK,
    direction="down",
    headline_magnitude=Decimal("0.30"),  # -30% technology equity
    magnitude_tolerance=Decimal("0.05"),
    magnitude_label="a 30% fall in technology stocks",
    shocks={
        "US_LARGE_CAP":    Decimal("-0.12"),
        "INTL_DEV_EQUITY": Decimal("-0.06"),
        "ENERGY_EQUITY":   Decimal("-0.02"),
        "TECH_EQUITY":     Decimal("-0.30"),
        "US_AGG_BONDS":    Decimal("0.02"),
        "TIPS":            Decimal("0.01"),
        "CASH":            Decimal("0.00"),
    },
    assumption_notes=(
        "These are manually specified prototype assumptions, not estimates from research, "
        "forecasts, or validated models.",
        "Technology equity falls 30% as an immediate repricing shock.",
        "US large-cap equity falls 12% on technology sector spillover.",
        "International developed equity falls 6%; energy equity falls 2%.",
        "US aggregate bonds gain 2% and TIPS gain 1% on a flight to quality.",
        "Cash is held flat; no trading, rebalancing, taxes, or fees are modelled.",
    ),
    drivers=(
        "the technology sleeve is the dominant detractor by a wide margin",
        "US large-cap equity falls on technology sector spillover",
        "investment-grade bonds and TIPS provide a partial offset",
        "energy equity is largely insulated from the technology sell-off",
    ),
    keywords=(
        "tech", "technology", "tech stocks", "technology stocks", "tech sector",
        "nasdaq", "tech crash", "tech sell off", "tech selloff", "tech downturn",
        "tech decline", "tech fall", "growth stocks", "growth sell off",
    ),
    aliases=("tech_downturn", "tech_crash", "technology_downturn", "tech_selloff"),
)

INTERNATIONAL_DOWNTURN = Scenario(
    key="international_downturn",
    label="International Downturn",
    summary=(
        "A hypothetical immediate repricing shock in which international stocks fall 20%: "
        "the international developed equity sleeve is the dominant detractor, "
        "US equities fall modestly, and bonds provide a small offset."
    ),
    horizon="1Y",
    mode=MODE_ASSET_SHOCK,
    direction="down",
    headline_magnitude=Decimal("0.20"),  # -20% international developed equity
    magnitude_tolerance=Decimal("0.05"),
    magnitude_label="a 20% fall in international developed stocks",
    shocks={
        "US_LARGE_CAP":    Decimal("-0.05"),
        "INTL_DEV_EQUITY": Decimal("-0.20"),
        "ENERGY_EQUITY":   Decimal("-0.05"),
        "TECH_EQUITY":     Decimal("-0.06"),
        "US_AGG_BONDS":    Decimal("0.02"),
        "TIPS":            Decimal("0.01"),
        "CASH":            Decimal("0.00"),
    },
    assumption_notes=(
        "These are manually specified prototype assumptions, not estimates from research, "
        "forecasts, or validated models.",
        "International developed equity falls 20% as an immediate repricing shock.",
        "US large-cap equity falls 5%; technology equity falls 6%; energy equity falls 5%.",
        "US aggregate bonds gain 2% and TIPS gain 1% on a flight to quality.",
        "Cash is held flat; no trading, rebalancing, taxes, or fees are modelled.",
    ),
    drivers=(
        "the international developed equity sleeve is the dominant detractor",
        "US equities fall modestly on global contagion",
        "investment-grade bonds and TIPS provide a small offset",
        "cash is unaffected",
    ),
    keywords=(
        "international", "international stocks", "international equity",
        "global stocks", "global equity", "emerging markets", "foreign stocks",
        "europe", "european stocks", "asia", "asian stocks", "developed markets",
        "intl", "overseas", "foreign markets",
    ),
    aliases=(
        "international_downturn", "intl_downturn", "global_downturn",
        "international_crash", "global_crash",
    ),
)

SCENARIOS: Mapping[str, Scenario] = {
    MARKET_CRASH.key: MARKET_CRASH,
    OIL_SHOCK.key: OIL_SHOCK,
    INFLATION.key: INFLATION,
    RATE_RISE.key: RATE_RISE,
    TECH_DOWNTURN.key: TECH_DOWNTURN,
    INTERNATIONAL_DOWNTURN.key: INTERNATIONAL_DOWNTURN,
}

SCENARIO_KEYS: tuple[str, ...] = tuple(SCENARIOS.keys())

#: alias -> canonical key (used by the deterministic interpreter + API input)
ALIAS_TO_KEY: Mapping[str, str] = {
    alias.lower(): s.key for s in SCENARIOS.values() for alias in (*s.aliases, s.key)
}


def resolve_scenario_key(raw: str | None) -> str | None:
    """Normalise a client-supplied scenario identifier to a canonical key."""
    if not raw:
        return None
    return ALIAS_TO_KEY.get(raw.strip().lower().replace(" ", "_").replace("-", "_"))


def get_scenario(key: str) -> Scenario | None:
    resolved = resolve_scenario_key(key)
    return SCENARIOS.get(resolved) if resolved else None


def portfolio_payload() -> dict:
    """Serialisable synthetic portfolio (numbers stay Decimal; API layer casts)."""
    holdings = []
    for h in PORTFOLIO:
        weight = (h.value / PORTFOLIO_TOTAL * Decimal("100")).quantize(Decimal("0.01"))
        holdings.append(
            {
                "holding_id": h.holding_id,
                "name": h.name,
                "asset_class": h.asset_class,
                "sector": h.sector,
                "value": h.value,
                "weight_percent": weight,
            }
        )
    return {
        "client_id": SYNTHETIC_CLIENT_ID,
        "client_name": SYNTHETIC_CLIENT_NAME,
        "data_source": "synthetic",
        "currency": "USD",
        "total_value": PORTFOLIO_TOTAL,
        "as_of": "2025-01-01",
        "assumptions_version": ASSUMPTIONS_VERSION,
        "holdings": holdings,
    }


# ---------------------------------------------------------------------------
# Parameter metadata for editable magnitudes
# ---------------------------------------------------------------------------

# Per-scenario parameter definitions for the UI
_SCENARIO_PARAMS: dict[str, dict] = {
    "market_crash": {
        "param_label": "Market decline (%)",
        "param_unit": "percent",
        "default_value": 20.0,
        "min_value": 1.0,
        "max_value": 60.0,
        "step": 1.0,
        "direction": "down",
        "methodology": (
            "Illustrative linear sensitivity: each holding's return is scaled proportionally "
            "to the requested magnitude relative to the baseline magnitude. "
            "This is a prototype assumption, not a validated market model."
        ),
    },
    "oil_shock": {
        "param_label": "Crude oil price increase (%)",
        "param_unit": "percent",
        "default_value": 40.0,
        "min_value": 5.0,
        "max_value": 150.0,
        "step": 5.0,
        "direction": "up",
        "methodology": (
            "Illustrative linear sensitivity: each holding's return is scaled proportionally "
            "to the requested crude oil price increase relative to the baseline 40% increase. "
            "This is a prototype assumption, not a validated market model."
        ),
    },
    "inflation": {
        "param_label": "Annual inflation rate (%)",
        "param_unit": "percent",
        "default_value": 5.0,
        "min_value": 0.0,
        "max_value": 15.0,
        "step": 0.5,
        "direction": "flat_nominal",
        "methodology": (
            "Purchasing-power illustration: nominal portfolio value is held flat at 0% return. "
            "Real value = nominal / (1 + annual_rate). "
            "This is not an asset-return forecast."
        ),
    },
    "rate_rise": {
        "param_label": "Rate increase (percentage points)",
        "param_unit": "percentage_points",
        "default_value": 1.0,
        "min_value": 0.25,
        "max_value": 5.0,
        "step": 0.25,
        "direction": "up",
        "methodology": (
            "Illustrative linear sensitivity: each holding's return is scaled proportionally "
            "to the requested rate increase (in percentage points) relative to the baseline 1pp. "
            "This is a prototype assumption, not a validated market model."
        ),
    },
    "tech_downturn": {
        "param_label": "Technology sector decline (%)",
        "param_unit": "percent",
        "default_value": 30.0,
        "min_value": 5.0,
        "max_value": 80.0,
        "step": 5.0,
        "direction": "down",
        "methodology": (
            "Illustrative linear sensitivity: each holding's return is scaled proportionally "
            "to the requested technology sector decline relative to the baseline 30% decline. "
            "This is a prototype assumption, not a validated market model."
        ),
    },
    "international_downturn": {
        "param_label": "International equity decline (%)",
        "param_unit": "percent",
        "default_value": 20.0,
        "min_value": 5.0,
        "max_value": 60.0,
        "step": 5.0,
        "direction": "down",
        "methodology": (
            "Illustrative linear sensitivity: each holding's return is scaled proportionally "
            "to the requested international equity decline relative to the baseline 20% decline. "
            "This is a prototype assumption, not a validated market model."
        ),
    },
}


def scenario_catalog() -> list[dict]:
    """Preset catalogue — also used to 'offer the available preset' on mismatch."""
    out = []
    for s in SCENARIOS.values():
        params = _SCENARIO_PARAMS.get(s.key, {})
        out.append(
            {
                "scenario_key": s.key,
                "label": s.label,
                "summary": s.summary,
                "horizon": s.horizon,
                "direction": s.direction,
                "magnitude_label": s.magnitude_label,
                "valuation_basis": s.valuation_basis,
                "assumptions_version": ASSUMPTIONS_VERSION,
                "assumption_notes": list(s.assumption_notes),
                # Editable parameter metadata
                "param_label": params.get("param_label", ""),
                "param_unit": params.get("param_unit", "percent"),
                "param_default": params.get("default_value", float(s.headline_magnitude * 100)),
                "param_min": params.get("min_value", 0.0),
                "param_max": params.get("max_value", 100.0),
                "param_step": params.get("step", 1.0),
                "param_methodology": params.get("methodology", ""),
                "baseline_magnitude": float(s.headline_magnitude),
            }
        )
    return out