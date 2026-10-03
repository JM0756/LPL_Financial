"""
AWS Bedrock integration.

Two narrow jobs — the LLM is never allowed to produce a number that reaches the
user, and is never allowed to silently run a scenario we did not model:

  1. interpret(question)  -> which preset (if any) the user means, PLUS an
     explicit direction / magnitude / horizon comparison against the hardcoded
     assumptions. If the ask differs from the preset, we return
     status="preset_offered" and surface the preset for confirmation.

  2. explain(analysis)    -> qualitative driver narrative only. We send the
     structured calculation results + assumption descriptions; the model is
     instructed to emit no digits, currency symbols or percent signs because
     the backend renders every displayed number.

Resilience: hard wall-clock deadline (thread), botocore connect/read timeouts,
output validation, and a deterministic template fallback labelled
`standard_explanation`.
"""

from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Any

from .config import get_settings
from .engine import to_jsonable
from .scenarios import (
    ASSUMPTIONS_VERSION,
    SCENARIOS,
    Scenario,
    get_scenario,
    scenario_catalog,
)

logger = logging.getLogger(__name__)

STATUS_MATCHED = "matched"
STATUS_PRESET_OFFERED = "preset_offered"
STATUS_UNSUPPORTED = "unsupported"

SOURCE_BEDROCK = "bedrock"
SOURCE_RULES = "rules_fallback"
SOURCE_TEMPLATE = "standard_explanation"

_NUMERIC_OUTPUT = re.compile(r"[\d$%]")
_HORIZON_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[- ]?(year|yr|yrs|years|month|months|mo|quarter|quarters)", re.I)
_MAGNITUDE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|percent|pct)", re.I)


# --------------------------------------------------------------------------- #
# Result types
# --------------------------------------------------------------------------- #
@dataclass
class Interpretation:
    status: str
    scenario_key: str | None = None
    scenario_label: str | None = None
    horizon: str | None = None
    assumptions_version: str = ASSUMPTIONS_VERSION
    confidence: float = 0.0
    message: str = ""
    mismatch_reasons: list[str] = field(default_factory=list)
    detected: dict[str, Any] = field(default_factory=dict)
    offered_presets: list[dict] = field(default_factory=list)
    interpretation_source: str = SOURCE_RULES

    @property
    def supported(self) -> bool:
        return self.status == STATUS_MATCHED

    def to_dict(self) -> dict:
        d = asdict(self)
        d["supported"] = self.supported
        return to_jsonable(d)


@dataclass
class Explanation:
    text: str
    source: str  # SOURCE_BEDROCK | SOURCE_TEMPLATE
    notes: str = ""

    def to_dict(self) -> dict:
        return {"explanation": self.text, "explanation_source": self.source, "explanation_notes": self.notes}


# --------------------------------------------------------------------------- #
# Prompts
# --------------------------------------------------------------------------- #
_INTERPRET_SYSTEM = """You are the intent router for ScenarioCraft, a financial scenario tool.

You do NOT perform calculations and you do NOT invent scenarios. You only map a
user's question onto one of a small set of PRESET scenarios, each of which has a
FIXED direction, FIXED magnitude and FIXED horizon.

Rules:
- Choose at most one preset_key from the supplied list, or null if none fits.
- Separately report what the USER asked for (direction, magnitude, horizon),
  using null when the user did not specify it.
- Set "magnitude_matches" to false if the user named a magnitude that is clearly
  different from the preset's magnitude. Set "horizon_matches" to false if the
  user named a different horizon. Use true only when it genuinely matches or the
  user did not specify.
- Never claim a preset can model something it cannot.
- Reply with STRICT JSON only. No prose, no markdown, no code fences.

JSON shape:
{
  "preset_key": string|null,
  "confidence": number,                       // 0..1
  "requested_direction": "down"|"up"|"flat_nominal"|null,
  "requested_magnitude_percent": number|null,
  "requested_horizon": string|null,           // e.g. "1Y", "5Y", "6M"
  "horizon_matches": boolean,
  "magnitude_matches": boolean,
  "topic": string,                            // short topic label
  "reasoning_summary": string                 // one short sentence, no numbers needed
}"""

_EXPLAIN_SYSTEM = """You are the explanation writer for ScenarioCraft, a financial scenario tool.

The backend has ALREADY performed every calculation and will render every number
in the user interface itself.

Your job: explain, qualitatively, WHY the portfolio moved the way it did under
the stated assumptions, and what the main drivers and offsets were.

Hard rules:
- Write 3 to 5 short sentences of plain language, suitable for a retail client.
- Do NOT output any digits, currency symbols, or percent signs. Never restate
  dollar amounts or percentages. Refer to size in words ("the largest
  detractor", "a modest offset", "roughly flat").
- Only use the drivers and assumptions provided. Do not introduce new
  assumptions, forecasts, probabilities or recommendations.
- Do not give investment advice and do not predict the future.
- Make clear this is a hypothetical illustration based on fixed assumptions.
- Reply with the explanation text only. No preamble, no bullet points, no headings."""


def _preset_brief() -> list[dict]:
    return [
        {
            "preset_key": s.key,
            "label": s.label,
            "direction": s.direction,
            "magnitude": s.magnitude_label,
            "magnitude_percent": float(s.headline_magnitude * 100),
            "horizon": s.horizon,
            "what_it_models": s.summary,
        }
        for s in SCENARIOS.values()
    ]


def _interpret_user_prompt(question: str) -> str:
    return json.dumps(
        {"available_presets": _preset_brief(), "user_question": question.strip()},
        indent=2,
    )


def _explain_user_prompt(analysis: dict) -> str:
    """Only structured results + assumption descriptions leave the backend."""
    payload = {
        "scenario": analysis.get("scenario_label"),
        "what_the_scenario_models": analysis.get("scenario_summary"),
        "horizon": analysis.get("horizon"),
        "assumptions_version": analysis.get("assumptions_version"),
        "valuation_basis": analysis.get("valuation_basis"),
        "assumption_descriptions": analysis.get("assumptions", {}).get("notes", []),
        "qualitative_drivers": analysis.get("drivers", []),
        "total_impact_direction": (
            "negative" if Decimal(str(analysis.get("impact_dollars", 0))) < 0
            else "positive" if Decimal(str(analysis.get("impact_dollars", 0))) > 0
            else "flat"
        ),
        "computed_results": {
            "current_value": analysis.get("current_value"),
            "scenario_value": analysis.get("scenario_value"),
            "impact_dollars": analysis.get("impact_dollars"),
            "impact_percent": analysis.get("impact_percent"),
        },
        "ranked_asset_class_attribution": [
            {
                "asset_class": row.get("asset_class"),
                "role": row.get("role"),
                "impact_dollars": row.get("impact_dollars"),
            }
            for row in analysis.get("attribution", [])
        ],
        "largest_detractors": [d.get("name") for d in analysis.get("top_detractors", [])],
        "largest_contributors": [c.get("name") for c in analysis.get("top_contributors", [])],
        "instruction": (
            "Explain the drivers qualitatively. The interface already shows all "
            "numbers, so do not write any digits, currency symbols or percent signs."
        ),
    }
    return json.dumps(to_jsonable(payload), indent=2)


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #
class BedrockService:
    def __init__(self, settings=None) -> None:
        self.settings = settings or get_settings()
        self._client = None
        self._client_error: str | None = None
        self._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bedrock")

    # ---- plumbing --------------------------------------------------------- #
    @property
    def enabled(self) -> bool:
        return bool(self.settings.bedrock_enabled)

    def _get_client(self):
        if self._client is not None or self._client_error is not None:
            return self._client
        try:
            import boto3
            from botocore.config import Config

            cfg = Config(
                region_name=self.settings.aws_region,
                connect_timeout=self.settings.bedrock_connect_timeout_seconds,
                read_timeout=self.settings.bedrock_timeout_seconds,
                retries={"max_attempts": 1, "mode": "standard"},
            )
            self._client = boto3.client("bedrock-runtime", config=cfg)
        except Exception as exc:  # pragma: no cover - env dependent
            self._client_error = f"{type(exc).__name__}: {exc}"
            logger.warning("Bedrock client unavailable: %s", self._client_error)
        return self._client

    def _invoke(self, system_prompt: str, user_prompt: str, max_tokens: int | None = None) -> str:
        """Single Bedrock Converse call behind a hard wall-clock deadline."""
        if not self.enabled:
            raise RuntimeError("bedrock_disabled")
        client = self._get_client()
        if client is None:
            raise RuntimeError(f"bedrock_unavailable:{self._client_error}")

        def _call() -> str:
            response = client.converse(
                modelId=self.settings.bedrock_model_id,
                system=[{"text": system_prompt}],
                messages=[{"role": "user", "content": [{"text": user_prompt}]}],
                inferenceConfig={
                    "maxTokens": max_tokens or self.settings.bedrock_max_tokens,
                    "temperature": 0.0,
                    "topP": 0.9,
                },
            )
            return response["output"]["message"]["content"][0]["text"]

        future = self._executor.submit(_call)
        try:
            return future.result(timeout=self.settings.bedrock_timeout_seconds)
        except FutureTimeout as exc:
            future.cancel()
            raise TimeoutError("bedrock_timeout") from exc

    @staticmethod
    def _parse_json(text: str) -> dict:
        cleaned = text.strip()
        cleaned = re.sub(r"^```(?:json)?|```$", "", cleaned, flags=re.M).strip()
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("no_json_object_in_output")
        parsed = json.loads(cleaned[start : end + 1])
        if not isinstance(parsed, dict):
            raise ValueError("json_not_object")
        return parsed

    # ---- 1) intent mapping ------------------------------------------------ #
    def interpret(self, question: str) -> Interpretation:
        question = (question or "").strip()
        if not question:
            return self._unsupported("Please describe the scenario you would like to explore.", {}, SOURCE_RULES)

        raw: dict | None = None
        source = SOURCE_RULES
        if self.enabled:
            try:
                raw = self._parse_json(self._invoke(_INTERPRET_SYSTEM, _interpret_user_prompt(question), 500))
                source = SOURCE_BEDROCK
            except Exception as exc:
                logger.warning("Bedrock interpret failed (%s); using deterministic rules.", exc)
                raw = None

        if raw is None:
            raw = self._heuristic_signals(question)

        return self._decide(question, raw, source)

    # The decision itself is deterministic backend logic; the model only
    # supplies signals. This is what prevents a mismatched silent run.
    def _decide(self, question: str, signals: dict, source: str) -> Interpretation:
        heuristics = self._heuristic_signals(question)

        key = signals.get("preset_key") or None
        scenario = get_scenario(key) if key else None
        if scenario is None and heuristics.get("preset_key"):
            scenario = get_scenario(heuristics["preset_key"])
            source = source if source == SOURCE_BEDROCK else SOURCE_RULES

        detected = {
            "topic": signals.get("topic") or heuristics.get("topic"),
            "direction": signals.get("requested_direction") or heuristics.get("requested_direction"),
            "magnitude_percent": (
                signals.get("requested_magnitude_percent")
                if signals.get("requested_magnitude_percent") is not None
                else heuristics.get("requested_magnitude_percent")
            ),
            "horizon": signals.get("requested_horizon") or heuristics.get("requested_horizon"),
            "model_summary": signals.get("reasoning_summary") or heuristics.get("reasoning_summary"),
        }

        if scenario is None:
            return self._unsupported(
                "That scenario is not supported in this version. ScenarioCraft can run "
                "the presets listed below — pick one to continue.",
                detected,
                source,
            )

        reasons = self._mismatch_reasons(scenario, detected, signals)
        confidence = self._clamp(signals.get("confidence", heuristics.get("confidence", 0.6)))

        if reasons:
            return Interpretation(
                status=STATUS_PRESET_OFFERED,
                scenario_key=scenario.key,
                scenario_label=scenario.label,
                horizon=scenario.horizon,
                confidence=confidence,
                message=(
                    f"ScenarioCraft does not model exactly what you asked. "
                    f"{' '.join(reasons)} "
                    f"The closest available preset is “{scenario.label}” "
                    f"({scenario.magnitude_label}, {scenario.horizon} horizon). "
                    f"Run that preset instead?"
                ),
                mismatch_reasons=reasons,
                detected=detected,
                offered_presets=[self._preset_offer(scenario)],
                interpretation_source=source,
            )

        return Interpretation(
            status=STATUS_MATCHED,
            scenario_key=scenario.key,
            scenario_label=scenario.label,
            horizon=scenario.horizon,
            confidence=confidence,
            message=(
                f"Matched to the “{scenario.label}” preset "
                f"({scenario.magnitude_label}, {scenario.horizon} horizon). "
                f"Confirm to run the analysis."
            ),
            detected=detected,
            offered_presets=[self._preset_offer(scenario)],
            interpretation_source=source,
        )

    @staticmethod
    def _mismatch_reasons(scenario: Scenario, detected: dict, signals: dict) -> list[str]:
        reasons: list[str] = []

        requested_horizon = (detected.get("horizon") or "").upper() or None
        if requested_horizon and requested_horizon != scenario.horizon:
            reasons.append(
                f"You asked about a {requested_horizon} horizon, but this preset is fixed at "
                f"{scenario.horizon}."
            )
        elif signals.get("horizon_matches") is False and not requested_horizon:
            reasons.append(f"This preset only models a {scenario.horizon} horizon.")

        requested_mag = detected.get("magnitude_percent")
        if requested_mag is not None:
            try:
                requested = Decimal(str(requested_mag)) / Decimal("100")
                low = scenario.headline_magnitude - scenario.magnitude_tolerance
                high = scenario.headline_magnitude + scenario.magnitude_tolerance
                if not (low <= abs(requested) <= high):
                    reasons.append(
                        f"You asked about a different magnitude; this preset assumes "
                        f"{scenario.magnitude_label}."
                    )
            except Exception:
                pass
        elif signals.get("magnitude_matches") is False:
            reasons.append(f"This preset assumes {scenario.magnitude_label}.")

        direction = detected.get("direction")
        if direction and direction != scenario.direction and scenario.direction != "flat_nominal":
            reasons.append(
                f"The direction you described differs from this preset, which models a "
                f"'{scenario.direction}' move."
            )

        # de-duplicate, preserve order
        return list(dict.fromkeys(reasons))

    @staticmethod
    def _preset_offer(scenario: Scenario) -> dict:
        return {
            "scenario_key": scenario.key,
            "label": scenario.label,
            "horizon": scenario.horizon,
            "direction": scenario.direction,
            "magnitude_label": scenario.magnitude_label,
            "summary": scenario.summary,
            "assumptions_version": ASSUMPTIONS_VERSION,
            "assumption_notes": list(scenario.assumption_notes),
        }

    @staticmethod
    def _clamp(value: Any) -> float:
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return 0.5

    def _unsupported(self, message: str, detected: dict, source: str) -> Interpretation:
        return Interpretation(
            status=STATUS_UNSUPPORTED,
            message=message,
            detected=detected,
            offered_presets=scenario_catalog(),
            interpretation_source=source,
            confidence=0.0,
        )

    # ---- deterministic signal extraction (no LLM required) ---------------- #
    _DOWN_WORDS = (
        "crash", "crashes", "fall", "falls", "drop", "drops", "decline", "sell off",
        "selloff", "bear", "recession", "plunge", "tank", "downturn", "correction",
        "collapse", "slump", "lose", "loss", "down",
    )
    _UP_WORDS = (
        "spike", "spikes", "surge", "surges", "rise", "rises", "rally", "jump",
        "soar", "increase", "increases", "climb", "double", "doubles", "up",
        "higher", "elevated",
    )
    _WORD_NUMBERS = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    }

    @classmethod
    def _detect_horizon(cls, text: str) -> str | None:
        lowered = text.lower()
        if "next year" in lowered or "one-year" in lowered or "one year" in lowered:
            return "1Y"

        match = _HORIZON_RE.search(lowered)
        if match is None:
            word_match = re.search(
                r"\b(" + "|".join(cls._WORD_NUMBERS) + r")[- ](year|month|quarter)s?\b", lowered
            )
            if word_match is None:
                return None
            number = Decimal(cls._WORD_NUMBERS[word_match.group(1)])
            unit = word_match.group(2)
        else:
            number = Decimal(match.group(1))
            unit = match.group(2)

        unit = unit.lower()
        if unit.startswith(("year", "yr")):
            months = int(number * 12)
        elif unit.startswith(("month", "mo")):
            months = int(number)
        else:  # quarter(s)
            months = int(number * 3)

        if months <= 0:
            return None
        if months % 12 == 0:
            return f"{months // 12}Y"
        return f"{months}M"

    @classmethod
    def _heuristic_signals(cls, question: str) -> dict:
        """
        Pure-Python intent signals. Used when Bedrock is disabled, timing out,
        or returning junk — so /api/interpret never hard-fails.
        """
        lowered = (question or "").lower()

        best_key: str | None = None
        best_score = 0
        for scenario in SCENARIOS.values():
            score = sum(len(kw) for kw in scenario.keywords if kw in lowered)
            if score > best_score:
                best_key, best_score = scenario.key, score

        direction: str | None = None
        down_hits = sum(1 for w in cls._DOWN_WORDS if w in lowered)
        up_hits = sum(1 for w in cls._UP_WORDS if w in lowered)
        if down_hits > up_hits:
            direction = "down"
        elif up_hits > down_hits:
            direction = "up"

        magnitude: float | None = None
        mag_match = _MAGNITUDE_RE.search(lowered)
        if mag_match:
            magnitude = float(mag_match.group(1))

        hits = 0 if best_key is None else max(1, best_score // 6)
        return {
            "preset_key": best_key,
            "confidence": min(0.5 + 0.1 * hits, 0.9) if best_key else 0.0,
            "requested_direction": direction,
            "requested_magnitude_percent": magnitude,
            "requested_horizon": cls._detect_horizon(lowered),
            "horizon_matches": True,
            "magnitude_matches": True,
            "topic": best_key or "unknown",
            "reasoning_summary": "Matched deterministically on scenario keywords.",
        }

    # ---- 2) qualitative explanation --------------------------------------- #
    def explain(self, analysis: dict) -> Explanation:
        """
        Produce the narrative. Only structured results + assumption text are
        sent to Bedrock. On timeout, client failure, or invalid output we return
        the deterministic template labelled `standard_explanation`.
        """
        if not self.enabled:
            return self.template_explanation(analysis, notes="Bedrock disabled; standard explanation used.")

        try:
            raw = self._invoke(_EXPLAIN_SYSTEM, _explain_user_prompt(analysis))
            return Explanation(text=self._validate_explanation(raw), source=SOURCE_BEDROCK)
        except TimeoutError:
            logger.warning("Bedrock explain timed out after %ss; using standard explanation.",
                           self.settings.bedrock_timeout_seconds)
            return self.template_explanation(analysis, notes="Model timed out; standard explanation used.")
        except Exception as exc:
            logger.warning("Bedrock explain failed (%s); using standard explanation.", exc)
            return self.template_explanation(analysis, notes="Model unavailable or invalid output; "
                                                             "standard explanation used.")

    def _validate_explanation(self, text: str) -> str:
        cleaned = re.sub(r"^```(?:\w+)?|```$", "", (text or "").strip(), flags=re.M).strip()
        cleaned = re.sub(r"\s*\n\s*", " ", cleaned)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()

        if len(cleaned) < 80:
            raise ValueError("explanation_too_short")
        if len(cleaned) > 1600:
            raise ValueError("explanation_too_long")
        if self.settings.bedrock_reject_numeric_output and _NUMERIC_OUTPUT.search(cleaned):
            # The backend owns every displayed number. A numeric answer from the
            # model is treated as invalid output, not as something to reconcile.
            raise ValueError("explanation_contains_numerics")

        banned = ("you should", "we recommend", "i recommend", "guaranteed", "will definitely",
                  "buy ", "sell ", "financial advice")
        low = cleaned.lower()
        for phrase in banned:
            if phrase in low:
                raise ValueError(f"explanation_contains_banned_phrase:{phrase.strip()}")
        return cleaned

    # ---- deterministic fallback template ---------------------------------- #
    @staticmethod
    def template_explanation(analysis: dict, notes: str = "") -> Explanation:
        """
        Hardcoded, number-free template explanation. Always available, always
        labelled `standard_explanation` so the UI can badge it honestly.
        """
        label = analysis.get("scenario_label", "this scenario")
        horizon_words = "one-year" if analysis.get("horizon") == "1Y" else "stated"
        drivers = list(analysis.get("drivers") or [])

        detractors = [d.get("name") for d in analysis.get("top_detractors", []) if d.get("name")]
        contributors = [c.get("name") for c in analysis.get("top_contributors", []) if c.get("name")]

        openers = {
            "market_crash": (
                f"This is a standard explanation of the {label} preset over a {horizon_words} horizon. "
                f"Under these fixed assumptions the portfolio falls, because the equity sleeves carry "
                f"most of the risk and they are assumed to sell off together."
            ),
            "oil_shock": (
                f"This is a standard explanation of the {label} preset over a {horizon_words} horizon. "
                f"Under these fixed assumptions the portfolio ends roughly flat, because the gain in the "
                f"energy sleeve is assumed to offset modest losses across the rest of the book."
            ),
            "inflation": (
                f"This is a standard explanation of the {label} preset over a {horizon_words} horizon. "
                f"Nominal value is deliberately held flat, so the change you see comes entirely from the "
                f"assumed rise in the price level rather than from any market move."
            ),
        }
        opener = openers.get(
            analysis.get("scenario_key", ""),
            f"This is a standard explanation of the {label} preset over a {horizon_words} horizon.",
        )

        parts = [opener]
        if detractors:
            parts.append(
                "The largest drag comes from "
                + _join_words(detractors)
                + "."
            )
        if contributors:
            parts.append(
                _join_words(contributors).capitalize()
                + (" acts" if len(contributors) == 1 else " act")
                + " as the main offset."
            )
        if drivers:
            parts.append("In short, " + _join_words(drivers[:3]) + ".")
        parts.append(
            "These figures are a hypothetical illustration produced from a fixed assumption set, "
            "not a forecast, and they exclude trading, rebalancing, taxes and fees."
        )
        return Explanation(text=" ".join(parts), source=SOURCE_TEMPLATE, notes=notes)


def _join_words(items: list[str]) -> str:
    items = [str(i) for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


# --------------------------------------------------------------------------- #
# Singleton accessor
# --------------------------------------------------------------------------- #
_service: BedrockService | None = None


def get_bedrock_service() -> BedrockService:
    global _service
    if _service is None:
        _service = BedrockService()
    return _service
