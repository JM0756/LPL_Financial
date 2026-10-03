# WealthLens - Technology Stack

## Programming Languages

### Backend
- **Python 3.11+** - Primary backend language
- Type hints used throughout (`from __future__ import annotations`)

### Frontend
- **TypeScript 6.0** - Strict typing enabled
- **React 19** - Latest React with hooks

## Frameworks & Libraries

### Backend Dependencies
```
fastapi==0.115.5          # Web framework
uvicorn[standard]==0.32.1 # ASGI server
pydantic==2.10.3          # Data validation
boto3==1.35.76            # AWS SDK
botocore==1.35.76         # AWS core
python-dotenv==1.0.1      # Environment loading
python-jose[cryptography] # JWT handling
pytest==8.3.4             # Testing
httpx==0.28.1             # Async HTTP client (tests)
```

### Frontend Dependencies
```json
{
  "dependencies": {
    "@aws-sdk/client-cognito-identity-provider": "^3.1146.0",
    "amazon-cognito-identity-js": "^6.3.20",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.1.1",
    "oxlint": "^1.81.0",
    "typescript": "~6.0.2",
    "vite": "^8.3.0"
  }
}
```

## Build Systems

### Backend
- **pip** with requirements.txt
- **venv** for virtual environments
- No build step required (interpreted Python)

### Frontend
- **Vite 8** - Build tool and dev server
- **TypeScript compiler** - Type checking
- **Oxlint** - Fast linting (replaces ESLint)

## AWS Services

### Amazon Cognito
- User authentication and authorization
- User pools with groups (investors, advisors)
- SRP authentication flow

### Amazon Bedrock
- Claude model for NLP interpretation
- Explanation generation
- Optional - system works without it

### Amazon DynamoDB
- Single-table design
- On-demand billing
- Partition key: `pk`, Sort key: `sk`

## Development Commands

### Backend
```bash
# Setup
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Run (with AWS)
uvicorn app.main:app --reload --port 8080

# Run (offline mode)
BEDROCK_ENABLED=false STORAGE_ENABLED=false uvicorn app.main:app --reload --port 8080

# Test
pytest -q
```

### Frontend
```bash
# Setup
cd frontend
npm install

# Development
npm run dev

# Build
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

## Environment Configuration

### Backend (.env)
```bash
BEDROCK_ENABLED=true|false
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-...
BEDROCK_REGION=us-east-1
STORAGE_ENABLED=true|false
DYNAMODB_TABLE_NAME=scenariocraft-mvp
ALLOWED_ORIGINS=http://localhost:5173
COGNITO_USER_POOL_ID=us-east-1_xxx
COGNITO_CLIENT_ID=xxx
```

### Frontend (.env.development)
```bash
VITE_API_BASE_URL=http://localhost:8080
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/health | Service status |
| GET | /api/portfolio | Synthetic portfolio |
| GET | /api/scenarios | Available scenarios |
| POST | /api/interpret | NLP question mapping |
| POST | /api/analyze | Run scenario analysis |
| GET | /api/analyses/{id} | Retrieve snapshot |
| POST | /api/discussions | Create discussion |
| GET | /api/discussions | List discussions |
| PATCH | /api/discussions/{id} | Update status |
| POST | /api/advisor-questions | Save unmodeled question |

## Testing Strategy

### Backend
- **pytest** for unit and integration tests
- **httpx** for async API testing
- Fixtures in `conftest.py`
- Locked target values for regression testing

### Frontend
- Test files in `src/tests/`
- `.test.mjs` extension for test modules
