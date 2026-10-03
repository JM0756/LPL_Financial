# WealthLens - Project Structure

## Directory Overview

```
/workshop/
├── backend/                    # Python FastAPI backend
│   ├── app/                    # Application source code
│   │   ├── __init__.py         # Package init with version
│   │   ├── auth.py             # Cognito JWT verification
│   │   ├── bedrock_service.py  # AWS Bedrock integration
│   │   ├── config.py           # Settings via pydantic
│   │   ├── engine.py           # Deterministic calculation engine
│   │   ├── main.py             # FastAPI app and routes
│   │   ├── scenarios.py        # Scenario definitions and portfolio data
│   │   └── storage.py          # DynamoDB/memory storage abstraction
│   ├── tests/                  # Pytest test suite
│   │   ├── conftest.py         # Shared fixtures
│   │   ├── test_api.py         # API endpoint tests
│   │   ├── test_engine.py      # Engine calculation tests
│   │   └── test_*.py           # Additional test modules
│   ├── requirements.txt        # Python dependencies
│   └── .env.example            # Environment template
│
├── frontend/                   # React TypeScript frontend
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── AccountManager.tsx
│   │   │   ├── AccountMenu.tsx
│   │   │   ├── AnalysisResults.tsx
│   │   │   ├── AuthGate.tsx
│   │   │   ├── MyPortfolioPage.tsx
│   │   │   ├── PortfolioPage.tsx
│   │   │   ├── ProfileManager.tsx
│   │   │   └── ScenarioComparison.tsx
│   │   ├── mocks/              # Mock data for offline dev
│   │   ├── tests/              # Frontend tests
│   │   ├── api.ts              # Backend API client
│   │   ├── auth.ts             # Cognito authentication
│   │   ├── auth-storage.ts     # Auth user portfolio storage
│   │   ├── demo-storage.ts     # Demo mode local storage
│   │   ├── App.tsx             # Main application component
│   │   ├── types.ts            # TypeScript type definitions
│   │   └── theme.ts            # UI theming
│   ├── package.json            # Node dependencies
│   ├── vite.config.ts          # Vite build configuration
│   └── tsconfig.json           # TypeScript configuration
│
└── .amazonq/rules/memory-bank/ # Project documentation
```

## Core Components

### Backend Architecture

**Engine Layer** (`engine.py`)
- Pure Decimal arithmetic - no floats
- Zero I/O, zero randomness in calculations
- Largest-remainder reconciliation for penny-exact totals
- Validates custom portfolios and magnitude overrides

**API Layer** (`main.py`)
- FastAPI with CORS middleware
- Request validation via Pydantic models
- No numeric fields accepted from clients
- All calculations server-side

**Storage Layer** (`storage.py`)
- Dual backend: DynamoDB (production) or in-memory (dev)
- Single-table design with pk/sk pattern
- Graceful degradation when DynamoDB unavailable

**Bedrock Service** (`bedrock_service.py`)
- Lazy-loaded AWS Bedrock client
- Question interpretation (text → scenario mapping)
- Explanation generation (numbers → prose)
- Rejects any Bedrock output containing digits

### Frontend Architecture

**Authentication** (`auth.ts`, `AuthGate.tsx`)
- Amazon Cognito via amazon-cognito-identity-js
- SRP sign-in (no client secret)
- Role derived from cognito:groups claim
- Session storage (cleared on tab close)

**State Management** (`App.tsx`)
- React useState/useEffect hooks
- No external state library
- Request ID tracking for race condition prevention

**Storage Abstraction**
- `demo-storage.ts`: localStorage for unauthenticated users
- `auth-storage.ts`: localStorage keyed by user email

## Architectural Patterns

### Separation of Concerns
- Engine owns all numbers
- Bedrock owns all prose
- Frontend owns all presentation
- No component crosses these boundaries

### Graceful Degradation
- Backend works without Bedrock (template explanations)
- Backend works without DynamoDB (in-memory store)
- Frontend works without backend (mock mode)

### Idempotency
- Discussion requests use idempotency keys
- Analysis snapshots stored by analysis_id
- Prevents duplicate submissions

## Data Flow

```
User Question → /api/interpret → Bedrock (optional) → Scenario Match
                                                           ↓
User Confirms → /api/analyze → Engine (Decimal math) → Snapshot
                                      ↓
                              Bedrock (prose only) → Explanation
                                      ↓
                              Storage (DynamoDB/memory) → Response
```
