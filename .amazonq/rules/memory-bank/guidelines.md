# WealthLens - Development Guidelines

## Code Quality Standards

### Python Backend

**Type Annotations**
- Use `from __future__ import annotations` at module top
- Type hint all function parameters and return values
- Use `|` union syntax (Python 3.10+): `str | None`

```python
def validate_request(scenario_key: str | None, horizon: str | None = None) -> tuple[Scenario, str]:
```

**Decimal Arithmetic**
- Never use floats for financial calculations
- Use `Decimal` from the `decimal` module throughout
- Define precision constants:
```python
MONEY = Decimal("0.01")
PCT2 = Decimal("0.01")
PCT4 = Decimal("0.0001")
```

**Error Handling**
- Create domain-specific exception classes inheriting from a base
- Include context in exception messages
```python
class EngineError(Exception):
    """Base class for engine errors."""

class UnsupportedScenarioError(EngineError):
    def __init__(self, requested: str | None):
        self.requested = requested
        super().__init__(f"Scenario {requested!r} is not supported.")
```

**Docstrings**
- Use triple-quoted docstrings for modules and public functions
- Include design rules at module level
```python
"""
Deterministic scenario engine.

Design rules:
  * Decimal end-to-end — no floats, no float drift.
  * Zero I/O, zero randomness in the math.
"""
```

### TypeScript Frontend

**Type Safety**
- Define explicit interfaces for all data structures
- Use discriminated unions for variant types
- Avoid `any` - use `unknown` with type guards

```typescript
export type ScenarioKind = "market" | "purchasing-power";
export type FeedRecordType = "analysis_discussion" | "unmodeled_question";

export interface AnalysisResult {
  analysisId: string;
  scenarioKey: ScenarioKey;
  kind: ScenarioKind;
  // ...
}
```

**Adapter Pattern for API Responses**
- Transform snake_case to camelCase at API boundary
- Validate required fields with explicit checks
- Throw descriptive errors for missing data

```typescript
function adaptPortfolioHolding(raw: Record<string, unknown>): PortfolioHolding {
  const identifier = raw["holding_id"];
  if (typeof identifier !== "string" || identifier === "") {
    throw new Error("holding_id missing");
  }
  return { identifier, /* ... */ };
}
```

**React Patterns**
- Use functional components with hooks
- Prefer `useState` and `useEffect` over external state libraries
- Use `useCallback` for stable function references
- Track request IDs to prevent race conditions

```typescript
const requestIdRef = useRef(0);

async function handleAnalyze() {
  const requestId = ++requestIdRef.current;
  // ... async work ...
  if (requestId !== requestIdRef.current) return; // stale
  setAnalysis(result);
}
```

## Architectural Patterns

### Separation of Concerns

**Engine Layer** - Pure calculations
- No I/O, no network calls, no randomness
- Decimal-only arithmetic
- Same input always produces same output

**Service Layer** - External integrations
- Bedrock for NLP (optional)
- DynamoDB for persistence (optional)
- Graceful degradation when unavailable

**API Layer** - Request/response handling
- Validation via Pydantic models
- No business logic
- Transform errors to HTTP responses

### Graceful Degradation

```python
# Backend pattern
try:
    storage.save_analysis(analysis)
except Exception as exc:
    logger.warning("Snapshot persistence failed: %s", exc)
    # Continue - analysis still valid
```

```typescript
// Frontend pattern
export const API_MODE: ApiMode =
  import.meta.env.VITE_API_MODE === "real" ? "real" : "mock";

if (API_MODE === "mock") {
  await wait(250, signal);
  return structuredClone(portfolioFixture);
}
```

### Idempotency

- Use idempotency keys for create operations
- Store and check keys to prevent duplicates
- Return existing record on conflict

```python
class IdempotencyConflictError(StorageError):
    def __init__(self, key: str):
        self.key = key
        super().__init__(f"Idempotency conflict for key {key!r}")
```

## Testing Patterns

### Test Configuration

```python
# conftest.py - Disable external services
os.environ["BEDROCK_ENABLED"] = "false"
os.environ["STORAGE_ENABLED"] = "false"
os.environ["AUTH_ENABLED"] = "false"

@pytest.fixture(autouse=True)
def _clean_store():
    reset_storage_for_tests()
    yield
    reset_storage_for_tests()
```

### Locked Target Values

Document expected outputs for regression testing:
```markdown
| Scenario | Start | End | Change |
|---|---|---|---|
| `market_crash` | $100,000.00 | **$87,050.00** | **-12.95%** |
```

## Naming Conventions

### Python
- `snake_case` for functions, variables, modules
- `PascalCase` for classes
- `UPPER_SNAKE_CASE` for constants
- Prefix private helpers with `_`

### TypeScript
- `camelCase` for functions, variables
- `PascalCase` for types, interfaces, components
- `UPPER_SNAKE_CASE` for constants
- Suffix adapters with `adapt*`

### API
- `snake_case` for JSON fields (backend convention)
- Transform to `camelCase` at frontend boundary

## Security Patterns

### No Client-Side Numbers

```python
class DiscussionRequest(BaseModel):
    analysis_id: str = Field(...)
    client_note: str | None = Field(default=None)
    # NO numeric fields - all values from server snapshot
```

### JWT Validation

```typescript
// Frontend sends both tokens
authHeaders["Authorization"] = `Bearer ${session.accessToken}`;
authHeaders["X-Id-Token"] = session.idToken;
```

```python
# Backend validates and extracts claims
def get_identity(request: Request) -> VerifiedIdentity:
    # Verify JWT signature and expiration
    # Extract cognito:groups from ID token
```

## Common Idioms

### Decimal Conversion

```python
def to_jsonable(obj: Any) -> Any:
    """Recursively convert Decimals to floats for JSON."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    return obj
```

### Lazy Loading

```typescript
// Cognito SDK loaded only when needed
let _cognitoModule: CognitoModule | null = null;

async function getCognito(): Promise<CognitoModule> {
  if (_cognitoModule) return _cognitoModule;
  _cognitoModule = await import("amazon-cognito-identity-js");
  return _cognitoModule;
}
```

### Environment-Based Configuration

```python
# Backend
settings = get_settings()  # Pydantic Settings with env vars

# Frontend
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
```
