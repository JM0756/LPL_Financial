# Technology Stack

## Backend

### Language & Runtime
- **Python 3.11+** (inferred from type hints and syntax)
- **FastAPI 0.115.5** - Async web framework
- **Uvicorn 0.32.1** - ASGI server

### Core Dependencies
- **Pydantic 2.10.3** - Data validation and settings
- **boto3 1.35.76** - AWS SDK (Bedrock, DynamoDB)
- **python-dotenv 1.0.1** - Environment configuration
- **python-jose[cryptography] >=3.3.0** - JWT handling for Cognito

### Testing
- **pytest 8.3.4** - Test framework
- **httpx 0.28.1** - Async HTTP client for API tests

### Development Commands
```bash
# Setup
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Run server
uvicorn app.main:app --reload --port 8080

# Run offline (no AWS)
BEDROCK_ENABLED=false STORAGE_ENABLED=false uvicorn app.main:app --reload --port 8080

# Run tests
pytest -q
```

## Frontend

### Language & Runtime
- **TypeScript ~6.0.2**
- **React 19.2.8** - UI framework
- **Vite 8.3.0** - Build tool and dev server

### Core Dependencies
- **react-dom 19.2.8** - React DOM renderer
- **@aws-sdk/client-cognito-identity-provider ^3.1146.0** - Cognito auth
- **amazon-cognito-identity-js ^6.3.20** - Cognito identity

### Development Dependencies
- **@vitejs/plugin-react 6.1.1** - Vite React plugin
- **oxlint 1.81.0** - Fast linter (Rust-based)
- **@types/react, @types/react-dom, @types/node** - Type definitions

### Development Commands
```bash
# Setup
cd frontend
npm install

# Development server
npm run dev

# Production build
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

## AWS Services

### Amazon Bedrock
- Model: Configurable via `BEDROCK_MODEL_ID` env var
- Used for: Question interpretation, explanation generation
- Fallback: Template explanations when unavailable

### Amazon DynamoDB
- Single table design with `pk`/`sk` keys
- On-demand billing mode
- Records: Analysis snapshots, Discussion requests
- Fallback: In-memory storage when unavailable

### Amazon Cognito (Optional)
- User pools for investor/advisor authentication
- JWT verification in backend
- Role-based access (advisor role for PATCH discussions)

## Environment Variables

### Backend (.env)
```
BEDROCK_ENABLED=true|false
BEDROCK_MODEL_ID=<model-arn>
STORAGE_ENABLED=true|false
DYNAMODB_TABLE_NAME=scenariocraft-mvp
DYNAMODB_ENDPOINT_URL=<local-endpoint>  # for local dev
COGNITO_USER_POOL_ID=<pool-id>
COGNITO_CLIENT_ID=<client-id>
ALLOWED_ORIGINS=http://localhost:5176
```

### Frontend (.env.development / .env.production)
```
VITE_API_BASE_URL=/ports/5176/api
VITE_COGNITO_USER_POOL_ID=<pool-id>
VITE_COGNITO_CLIENT_ID=<client-id>
```

## Build & Deployment

- Backend: Standard Python ASGI deployment (uvicorn, gunicorn)
- Frontend: Static build output via `vite build`
- Proxy: Vite dev server proxies `/api` to backend on port 8081
