# Project Structure

## Directory Layout

```
/workshop/
├── backend/                    # FastAPI Python backend
│   ├── app/
│   │   ├── __init__.py        # Package version
│   │   ├── main.py            # FastAPI app, routes, middleware
│   │   ├── engine.py          # Deterministic calculation engine (Decimal-only)
│   │   ├── scenarios.py       # Scenario definitions, portfolio data
│   │   ├── bedrock_service.py # AWS Bedrock integration for prose
│   │   ├── storage.py         # DynamoDB/memory storage abstraction
│   │   ├── auth.py            # Cognito JWT verification
│   │   └── config.py          # Settings via pydantic-settings
│   ├── tests/
│   │   ├── conftest.py        # Pytest fixtures
│   │   ├── test_api.py        # API endpoint tests
│   │   ├── test_engine.py     # Engine calculation tests
│   │   └── test_*.py          # Additional test modules
│   ├── requirements.txt       # Python dependencies
│   └── .env.example           # Environment template
│
├── frontend/                   # React TypeScript frontend
│   ├── src/
│   │   ├── main.tsx           # React entry point
│   │   ├── App.tsx            # Main application component
│   │   ├── api.ts             # Backend API client
│   │   ├── auth.ts            # Cognito auth helpers
│   │   ├── types.ts           # TypeScript interfaces
│   │   ├── demo-storage.ts    # Browser localStorage for demo mode
│   │   ├── components/
│   │   │   ├── AnalysisResults.tsx    # Scenario results display
│   │   │   ├── AdvisorView.tsx        # Advisor dashboard
│   │   │   ├── AuthGate.tsx           # Login/signup forms
│   │   │   ├── PortfolioPage.tsx      # Holdings editor
│   │   │   ├── MagnitudeControl.tsx   # Scenario magnitude slider
│   │   │   ├── ScenarioComparison.tsx # Side-by-side comparison
│   │   │   └── *.tsx                  # Other UI components
│   │   ├── mocks/
│   │   │   └── fixtures.ts    # Mock data for offline mode
│   │   └── tests/
│   │       └── *.test.mjs     # Frontend tests
│   ├── public/                # Static assets
│   ├── package.json           # Node dependencies
│   ├── vite.config.ts         # Vite build configuration
│   └── tsconfig.json          # TypeScript configuration
│
└── .amazonq/rules/memory-bank/ # Project documentation
```

## Core Components

### Backend Architecture

1. **Engine Layer** (`engine.py`)
   - Pure calculation logic with Decimal precision
   - No I/O, no randomness, no external dependencies
   - Penny-reconciliation via largest-remainder algorithm
   - Exports: `analyze()`, `get_portfolio()`, `validate_custom_portfolio()`

2. **API Layer** (`main.py`)
   - FastAPI routes with Pydantic request/response models
   - CORS middleware for frontend integration
   - Dependency injection for auth and services

3. **Service Layer**
   - `bedrock_service.py`: Interpret questions, generate explanations
   - `storage.py`: Abstract DynamoDB/memory backends
   - `auth.py`: JWT verification with Cognito

4. **Data Layer** (`scenarios.py`)
   - Scenario definitions with shocks per holding
   - Synthetic portfolio (7 holdings, $100k total)
   - Constants: `ASSUMPTIONS_VERSION`, `ENGINE_VERSION`

### Frontend Architecture

1. **State Management**: React hooks (useState, useEffect, useCallback)
2. **API Communication**: Fetch-based client with abort controller support
3. **Routing**: Single-page with tab-based navigation (Explore/Holdings)
4. **Styling**: CSS with custom properties, no framework

### Data Flow

```
User Question → /api/interpret → Bedrock → Scenario Match
     ↓
Scenario Selection → /api/analyze → Engine → Results + Bedrock Explanation
     ↓
Discussion Request → /api/discussions → DynamoDB → Advisor View
```

## Architectural Patterns

- **Server-Authoritative Numbers**: All financial calculations happen server-side
- **Graceful Degradation**: Works offline with mock data and memory storage
- **Idempotency**: Discussion requests support idempotency keys
- **Audit Trail**: Analysis snapshots stored before discussion creation
