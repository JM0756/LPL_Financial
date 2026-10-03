# WealthLens

Deterministic scenario analysis platform for investment portfolios. Visualize how market events would impact portfolio values using transparent, predefined assumptions.

## Overview

WealthLens enables investors and financial advisors to explore "what-if" scenarios without black-box models or live market data. All calculations are server-side, Decimal-based, and fully reproducible.

**Key Features:**
- Market crash, oil shock, and inflation scenario modeling
- Per-holding attribution showing exactly which assets drive changes
- Custom portfolio creation (up to 7 holdings, $50M max)
- AI-assisted question interpretation via AWS Bedrock
- Advisor discussion workflow with audit trail

## Quick Start

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Run with AWS integrations
uvicorn app.main:app --reload --port 8080

# Run offline (no AWS required)
BEDROCK_ENABLED=false STORAGE_ENABLED=false uvicorn app.main:app --reload --port 8080
```

API docs: http://localhost:8080/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5176

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │────▶│   FastAPI   │────▶│   Engine    │
│  Frontend   │     │     API     │     │  (Decimal)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ Cognito │  │ Bedrock │  │DynamoDB │
        │  Auth   │  │  NLP    │  │ Storage │
        └─────────┘  └─────────┘  └─────────┘
```

**Design Principles:**
- Engine owns all numbers (Decimal arithmetic, no floats)
- Bedrock owns all prose (never generates numbers)
- Frontend owns all presentation
- Graceful degradation when AWS services unavailable

## Project Structure

```
/workshop/
├── backend/
│   ├── app/
│   │   ├── engine.py        # Deterministic calculations
│   │   ├── main.py          # FastAPI routes
│   │   ├── scenarios.py     # Scenario definitions
│   │   ├── bedrock_service.py
│   │   └── storage.py       # DynamoDB/memory abstraction
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── api.ts           # Backend client with adapters
│   │   ├── auth.ts          # Cognito authentication
│   │   └── types.ts         # TypeScript definitions
│   └── package.json
└── .amazonq/rules/memory-bank/  # Project documentation
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Service status |
| GET | `/api/portfolio` | Synthetic $100k portfolio |
| GET | `/api/scenarios` | Available scenario catalog |
| POST | `/api/interpret` | Map question to scenario |
| POST | `/api/analyze` | Run scenario analysis |
| POST | `/api/discussions` | Create advisor discussion |
| GET | `/api/discussions` | Advisor feed |

## Supported Scenarios

| Scenario | Default Impact | Description |
|----------|----------------|-------------|
| `market_crash` | -12.95% | Broad equity decline |
| `oil_shock` | +0.10% | Energy sector disruption |
| `inflation` | -4.76% | Purchasing power erosion (1-60 months) |

## Testing

```bash
# Backend
cd backend && pytest -q

# Frontend
cd frontend && npm run lint
```

## Environment Variables

### Backend (.env)
```bash
BEDROCK_ENABLED=true|false
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-...
STORAGE_ENABLED=true|false
DYNAMODB_TABLE_NAME=scenariocraft-mvp
COGNITO_USER_POOL_ID=us-east-1_xxx
COGNITO_CLIENT_ID=xxx
ALLOWED_ORIGINS=http://localhost:5173
```

### Frontend (.env.development)
```bash
VITE_API_BASE_URL=http://localhost:8080
VITE_API_MODE=real|mock
```

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, Pydantic, boto3
- **Frontend:** React 19, TypeScript 6, Vite 8
- **AWS:** Cognito, Bedrock (Claude), DynamoDB
- **Testing:** pytest, httpx, Oxlint

## Limitations

- Synthetic data only — no real portfolio uploads
- No live market prices
- No trading, rebalancing, tax, or fee calculations
- Illustrative scenarios only — not investment recommendations

## License

Internal use only.
