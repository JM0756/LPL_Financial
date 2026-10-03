# ScenarioCraft / WealthLens - Product Overview

## Project Purpose

ScenarioCraft (backend) / WealthLens (frontend) is a deterministic portfolio scenario analysis application that helps investors visualize the potential impact of market events on their portfolios. It combines a FastAPI backend with AWS Bedrock integration and a React TypeScript frontend.

## Value Proposition

- **Deterministic Analysis**: All financial calculations are performed server-side with Decimal precision, ensuring consistent and reproducible results
- **AI-Augmented Explanations**: AWS Bedrock provides qualitative prose explanations while the engine owns all numeric calculations
- **Transparent Assumptions**: Every scenario clearly displays its assumptions, methodology, and limitations
- **Advisor Workflow**: Built-in discussion request system connects investors with advisors for follow-up conversations

## Key Features

1. **Scenario Analysis Engine**
   - Market crash simulation (-12.95% impact)
   - Oil shock modeling (+0.10% impact)
   - Inflation/purchasing power illustration (-4.76% at 5% annual rate)
   - Custom magnitude controls for sensitivity analysis
   - Variable horizon support for inflation scenarios (1-60 months)

2. **Portfolio Management**
   - Synthetic $100,000 demo portfolio with 7 holdings
   - Custom portfolio support with per-holding value editing
   - Asset class attribution and contribution analysis
   - Top contributors/detractors identification

3. **Natural Language Interpretation**
   - Question interpretation via Bedrock to map user queries to supported scenarios
   - Preset offering when exact match isn't available
   - Unsupported question routing to advisors

4. **Advisor Integration**
   - Discussion request creation linked to analysis snapshots
   - Advisor view for reviewing client requests
   - Status workflow (pending → reviewed → resolved)
   - DynamoDB persistence for audit trail

5. **Authentication (Optional)**
   - AWS Cognito integration for investor/advisor roles
   - Demo mode with profile/account management when auth disabled

## Target Users

- **Investors**: Explore "what-if" scenarios on their portfolios before advisor meetings
- **Financial Advisors**: Review client scenario analyses and discussion requests
- **Demo Users**: Experience the platform with synthetic data and browser-local storage

## Use Cases

1. Pre-meeting preparation: Investor explores market crash impact before advisor call
2. Inflation planning: Visualize purchasing power erosion over different time horizons
3. Scenario comparison: Compare two scenarios side-by-side
4. Advisor handoff: Route complex questions outside supported scenarios to human advisors
