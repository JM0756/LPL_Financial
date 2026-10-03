# WealthLens - Product Overview

## Project Purpose

WealthLens (also known as ScenarioCraft) is a deterministic scenario analysis platform for investment portfolios. It enables investors and financial advisors to visualize how market events would impact portfolio values using predefined, transparent assumptions.

## Value Proposition

- **Transparent Analysis**: All calculations are deterministic and server-side computed - no hidden algorithms or black-box models
- **Educational Tool**: Helps investors understand portfolio sensitivity to market scenarios without making predictions
- **Advisor Collaboration**: Facilitates informed conversations between investors and their financial advisors
- **No Live Data Risk**: Uses synthetic data only, eliminating compliance concerns around real portfolio data

## Key Features

### Scenario Analysis Engine
- Market crash simulation with configurable magnitude
- Oil shock impact modeling
- Inflation/purchasing power illustrations (1-60 month horizons)
- Per-holding attribution showing exactly which assets drive portfolio changes

### Portfolio Management
- Custom portfolio creation with up to 7 holdings
- Portfolio scaling to different total values
- Multiple portfolio support per user
- Browser-local storage for demo mode, Cognito auth for production

### Advisor Integration
- Discussion request system for unmodeled questions
- Advisor view feed for managing client inquiries
- Status tracking (pending, reviewed, resolved)
- Server-side snapshot preservation for audit trail

### AI-Assisted Interpretation
- Natural language question interpretation via AWS Bedrock
- Maps free-text questions to supported scenarios
- Graceful fallback when Bedrock unavailable (template explanations)
- Bedrock never generates numbers - only qualitative prose

## Target Users

### Investors
- Self-directed investors exploring "what-if" scenarios
- Clients preparing for advisor meetings
- Users wanting to understand portfolio risk exposure

### Financial Advisors
- Reviewing client scenario questions
- Explaining market impact in client-friendly terms
- Managing discussion requests from multiple clients

## Use Cases

1. **Pre-Meeting Preparation**: Investor explores market crash scenario, saves discussion request for advisor review
2. **Risk Education**: Advisor walks client through inflation impact on purchasing power over different time horizons
3. **Portfolio Comparison**: User compares two scenarios side-by-side to understand relative risk
4. **Custom Portfolio Analysis**: User creates custom allocation and tests against market scenarios

## Technical Boundaries

- Synthetic data only - no real portfolio uploads
- No live market prices
- No trading, rebalancing, tax, or fee calculations
- Illustrative scenarios only - not investment recommendations
