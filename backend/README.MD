# ScenarioCraft — Backend

Deterministic scenario engine + FastAPI + AWS Bedrock (prose only) + DynamoDB (audit).

**Scope:** synthetic data only. No auth, no portfolio upload, no live prices, no Polly.

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8080
```

Docs: http://localhost:8080/docs

Offline / no-AWS mode (works out of the box):
```bash
BEDROCK_ENABLED=false STORAGE_ENABLED=false uvicorn app.main:app --reload --port 8080
```

## Test

```bash
cd backend && pytest -q
```

## Locked targets

| Scenario | Start | End | Change |
|---|---|---|---|
| `market_crash` | $100,000.00 | **$87,050.00** | **-12.95%** |
| `oil_shock` | $100,000.00 | **$100,100.00** | **+0.10%** |
| `inflation` (purchasing power) | $100,000.00 | **$95,238.10** | **-4.76%** |

## Architecture rules

1. **Engine owns every number.** `engine.py` is Decimal-only, I/O-free, clock-free in the math. Holding-level values are penny-reconciled (largest remainder) so they always sum exactly to the portfolio total.
2. **Bedrock never emits numbers.** The explain prompt receives structured results + assumption text and is told the UI renders all figures. Any output containing a digit, `$`, or `%` is rejected and the `standard_explanation` template is returned (`BEDROCK_REJECT_NUMERIC_OUTPUT=true`).
3. **No silent mismatches.** `/api/interpret` compares direction, magnitude and horizon against the hardcoded preset. A difference returns `status="preset_offered"` with the preset to confirm — it never runs a different scenario on the user's behalf.
4. **Timeout + fallback.** Botocore connect/read timeouts *and* a hard wall-clock deadline on a worker thread. Any failure path returns the template explanation labelled `standard_explanation`.
5. **Server snapshot, not browser numbers.** `/api/analyze` writes the authoritative snapshot to DynamoDB. `POST /api/discussions` accepts only `analysis_id` + free text and copies the financials from that stored snapshot. The request schema has no numeric fields at all.
6. **Graceful degradation.** If DynamoDB or Bedrock are unavailable, the API still serves correct deterministic results (in-memory store + template prose) and reports it via `/api/health`.

## DynamoDB table

Single table, on-demand billing:

- Partition key `pk` (S), sort key `sk` (S)

| Record | pk | sk |
|---|---|---|
| Analysis snapshot | `ANALYSIS#<analysis_id>` | `SNAPSHOT` |
| Discussion request | `CLIENT#<client_id>` | `DISCUSSION#<created_at>#<discussion_id>` |

Advisor View is a single `Query` on `pk = CLIENT#…`, `begins_with(sk, "DISCUSSION#")`, `ScanIndexForward=false` — no Scans.

```bash
aws dynamodb create-table \
  --table-name scenariocraft-mvp \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

Saved discussion record preserves: synthetic `client_id`, `scenario_key`, `horizon`, `result` (current/scenario/impact $/impact %), `assumptions_version`, `created_at`/`updated_at`, `status`.

IAM needed: `bedrock:InvokeModel` on the model ARN; `dynamodb:PutItem|GetItem|Query|UpdateItem` on the table.

## API contract (frontend)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | versions + integration status |
| GET | `/api/portfolio` | synthetic $100k book |
| GET | `/api/scenarios` | preset catalogue |
| POST | `/api/interpret` | `{question}` → `matched` \| `preset_offered` \| `unsupported` |
| POST | `/api/analyze` | `{scenario_key, horizon?, confirmed?, question?}` |
| GET | `/api/analyses/{id}` | stored snapshot |
| POST | `/api/discussions` | `{analysis_id, client_note?, requested_by?, topic?}` |
| GET | `/api/discussions` | Advisor View feed |
| PATCH | `/api/discussions/{id}` | `{status}` |

`POST /api/analyze` response always includes: `analysis_id`, `scenario_key`, `horizon`, `assumptions_version`, `current_value`, `scenario_value`, `impact_dollars`, `impact_percent`, `holdings`, `explanation`, `explanation_source` — plus `attribution`, `top_detractors`/`top_contributors`, `nominal_value`, `assumptions`, `engine_version`.

`explanation_source` ∈ `{"bedrock", "standard_explanation"}` — badge it in the UI.