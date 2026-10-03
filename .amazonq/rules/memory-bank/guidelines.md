# Development Guidelines

## Code Quality Standards

### Python (Backend)

1. **Type Hints**: Use type hints throughout, including return types and `from __future__ import annotations`
   ```python
   def analyze(scenario_key: str, horizon: str | None = None) -> dict:
   ```

2. **Docstrings**: Module-level docstrings explain design rules; function docstrings describe behavior
   ```python
   """
   Deterministic scenario engine.
   
   Design rules:
     * Decimal end-to-end — no floats, no float drift.
   """
   ```

3. **Error Classes**: Custom exception hierarchy with descriptive attributes
   ```python
   class UnsupportedScenarioError(EngineError):
       def __init__(self, requested: str | None):
           self.requested = requested
           super().__init__(f"Scenario {requested!r} is not supported.")
   ```

4. **Pydantic Models**: Use Field with examples and descriptions for API contracts
   ```python
   class AnalyzeRequest(BaseModel):
       scenario_key: str = Field(..., examples=list(SCENARIO_KEYS))
       horizon: str | None = Field(default=None, description="Horizon string.")
   ```

### TypeScript (Frontend)

1. **Explicit Types**: Define interfaces for all data structures, avoid `any`
   ```typescript
   export interface AnalysisResult {
     analysisId: string;
     scenarioKey: ScenarioKey;
     kind: ScenarioKind;
   }
   ```

2. **Type Guards**: Validate API responses with explicit type checks
   ```typescript
   if (typeof identifier !== "string" || identifier === "") 
     throw new Error("holding_id missing");
   ```

3. **Union Types**: Use discriminated unions for variant data
   ```typescript
   export type FeedRecordType = "analysis_discussion" | "unmodeled_question";
   ```

## Architectural Patterns

### Server-Authoritative Numbers
- All financial calculations happen in `engine.py` using `Decimal`
- Frontend never computes financial values
- API responses include all computed values; client displays only

### Adapter Pattern (Frontend)
Transform backend snake_case to frontend camelCase with validation:
```typescript
function adaptPortfolioHolding(raw: Record<string, unknown>): PortfolioHolding {
  const identifier = raw["holding_id"];
  if (typeof identifier !== "string") throw new Error("holding_id missing");
  return { identifier, name: raw["name"] as string ?? identifier };
}
```

### Graceful Degradation
- Backend works without AWS (Bedrock/DynamoDB) via env flags
- Frontend has mock mode with fixture data
- Tests run fully offline via `conftest.py` environment setup

### Idempotency
- Discussion requests support `idempotency_key` parameter
- Frontend generates unique keys for retry-safe operations

## Testing Patterns

### Backend (pytest)
```python
# conftest.py - deterministic, offline setup
os.environ["BEDROCK_ENABLED"] = "false"
os.environ["STORAGE_ENABLED"] = "false"

@pytest.fixture(autouse=True)
def _clean_store():
    reset_storage_for_tests()
    yield
    reset_storage_for_tests()
```

### Frontend
- Tests in `src/tests/` with `.test.mjs` extension
- Mock fixtures in `src/mocks/fixtures.ts`

## API Design Patterns

### Request/Response Naming
- Backend: snake_case (`scenario_key`, `impact_dollars`)
- Frontend: camelCase (`scenarioKey`, `impactDollars`)
- Adapters handle conversion at API boundary

### Error Responses
```python
raise HTTPException(
    status_code=400,
    detail={
        "error": "unsupported_scenario",
        "message": str(exc),
        "supported_scenarios": list(SCENARIO_KEYS),
    },
)
```

### Status Enums
- Interpret: `matched`, `preset_offered`, `unsupported`
- Discussion: `pending`, `reviewed`, `resolved`

## React Patterns

### State Management
- `useState` for local component state
- `useRef` for mutable values that don't trigger re-renders (request IDs, idempotency keys)
- `useCallback` for stable function references

### Abort Controllers
```typescript
useEffect(() => {
  const ac = new AbortController();
  fetchData(ac.signal).catch(handleError);
  return () => ac.abort();
}, []);
```

### Form Handling
```typescript
async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  // validation, API call, state updates
}
```

## Naming Conventions

| Context | Convention | Example |
|---------|------------|---------|
| Python modules | snake_case | `bedrock_service.py` |
| Python classes | PascalCase | `UnsupportedScenarioError` |
| Python functions | snake_case | `validate_custom_portfolio` |
| TypeScript interfaces | PascalCase | `AnalysisResult` |
| TypeScript functions | camelCase | `adaptPortfolioHolding` |
| React components | PascalCase | `AnalysisResults.tsx` |
| CSS classes | kebab-case | `scenario-option-selected` |
| API paths | kebab-case | `/api/advisor-questions` |
| Env variables | SCREAMING_SNAKE | `BEDROCK_ENABLED` |

## Common Idioms

### Decimal Precision (Backend)
```python
MONEY = Decimal("0.01")
def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)
```

### Safe JSON Conversion
```python
def to_jsonable(obj: Any) -> Any:
    if isinstance(obj, Decimal): return float(obj)
    if isinstance(obj, dict): return {k: to_jsonable(v) for k, v in obj.items()}
    return obj
```

### Currency Formatting (Frontend)
```typescript
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
```

## Configuration

### Environment-Based Feature Flags
```python
# Backend
BEDROCK_ENABLED=true|false
STORAGE_ENABLED=true|false
```

```typescript
// Frontend
export const API_MODE: ApiMode =
  import.meta.env.VITE_API_MODE === "real" ? "real" : "mock";
```

### Vite Proxy Configuration
```typescript
proxy: {
  "/ports/5176/api": {
    target: "http://127.0.0.1:8081",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/ports\/5176/, ""),
  },
},
```
