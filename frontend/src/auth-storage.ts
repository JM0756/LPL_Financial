/**
 * Portfolio storage for authenticated users.
 *
 * Scopes data to the authenticated user's stable identity (email).
 * Uses localStorage with user-specific keys to prevent data leakage.
 */

import type { CustomHolding, DemoAccount } from "./demo-storage";
import {
  MAX_PORTFOLIOS_PER_USER,
  validateHoldings,
} from "./demo-storage";

export { validateHoldings, MAX_PORTFOLIOS_PER_USER };

interface AuthUserPortfolioState {
  portfolios: DemoAccount[];
  activePortfolioId: string;
  version: number;
}

const STORAGE_PREFIX = "wealthlens_auth_";
const CURRENT_VERSION = 1;

function getStorageKey(userEmail: string): string {
  // Use a hash-like encoding of email to avoid special chars in key
  const encoded = btoa(userEmail.toLowerCase()).replace(/[^a-zA-Z0-9]/g, "_");
  return `${STORAGE_PREFIX}${encoded}`;
}

function loadState(userEmail: string): AuthUserPortfolioState {
  try {
    const key = getStorageKey(userEmail);
    const raw = localStorage.getItem(key);
    if (!raw) {
      return createDefaultState();
    }
    const parsed = JSON.parse(raw) as AuthUserPortfolioState;
    if (parsed.version !== CURRENT_VERSION) {
      return createDefaultState();
    }
    // Validate structure
    if (!Array.isArray(parsed.portfolios) || parsed.portfolios.length === 0) {
      return createDefaultState();
    }
    return parsed;
  } catch {
    return createDefaultState();
  }
}

function saveState(userEmail: string, state: AuthUserPortfolioState): void {
  try {
    const key = getStorageKey(userEmail);
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function createDefaultState(): AuthUserPortfolioState {
  const defaultPortfolio = makeDefaultPortfolio("My Portfolio");
  return {
    portfolios: [defaultPortfolio],
    activePortfolioId: defaultPortfolio.id,
    version: CURRENT_VERSION,
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeDefaultPortfolio(name: string): DemoAccount {
  return {
    id: makeId("port"),
    name,
    customHoldings: null,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getAuthPortfolios(userEmail: string): DemoAccount[] {
  return loadState(userEmail).portfolios;
}

export function getActiveAuthPortfolio(userEmail: string): DemoAccount | null {
  const state = loadState(userEmail);
  return state.portfolios.find((p) => p.id === state.activePortfolioId) ?? state.portfolios[0] ?? null;
}

export function getActiveAuthPortfolioId(userEmail: string): string {
  const state = loadState(userEmail);
  return state.activePortfolioId;
}

export function selectAuthPortfolio(userEmail: string, portfolioId: string): boolean {
  const state = loadState(userEmail);
  const portfolio = state.portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) return false;
  state.activePortfolioId = portfolioId;
  saveState(userEmail, state);
  return true;
}

export interface CreatePortfolioResult {
  portfolio: DemoAccount | null;
  error: string | null;
}

export function createAuthPortfolio(userEmail: string, name: string): CreatePortfolioResult {
  const state = loadState(userEmail);
  if (state.portfolios.length >= MAX_PORTFOLIOS_PER_USER) {
    return {
      portfolio: null,
      error: `You can have up to ${MAX_PORTFOLIOS_PER_USER} portfolios. Remove one to create another.`,
    };
  }
  const trimmedName = name.trim().slice(0, 60) || "New Portfolio";
  const portfolio = makeDefaultPortfolio(trimmedName);
  state.portfolios.push(portfolio);
  state.activePortfolioId = portfolio.id;
  saveState(userEmail, state);
  return { portfolio, error: null };
}

export interface RemovePortfolioResult {
  success: boolean;
  error: string | null;
  newActivePortfolioId: string | null;
}

export function removeAuthPortfolio(userEmail: string, portfolioId: string): RemovePortfolioResult {
  const state = loadState(userEmail);
  if (state.portfolios.length <= 1) {
    return {
      success: false,
      error: "Cannot remove your only portfolio. Create another first.",
      newActivePortfolioId: null,
    };
  }
  const idx = state.portfolios.findIndex((p) => p.id === portfolioId);
  if (idx === -1) {
    return { success: false, error: "Portfolio not found.", newActivePortfolioId: null };
  }
  state.portfolios.splice(idx, 1);
  // Select a remaining portfolio deterministically
  const newActive = state.portfolios[Math.min(idx, state.portfolios.length - 1)];
  state.activePortfolioId = newActive.id;
  saveState(userEmail, state);
  return { success: true, error: null, newActivePortfolioId: newActive.id };
}

export function renameAuthPortfolio(userEmail: string, portfolioId: string, name: string): boolean {
  const state = loadState(userEmail);
  const portfolio = state.portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) return false;
  portfolio.name = name.trim().slice(0, 60) || portfolio.name;
  saveState(userEmail, state);
  return true;
}

export function updateAuthPortfolioHoldings(
  userEmail: string,
  portfolioId: string,
  holdings: CustomHolding[] | null,
): boolean {
  const state = loadState(userEmail);
  const portfolio = state.portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) return false;
  portfolio.customHoldings = holdings;
  saveState(userEmail, state);
  return true;
}

export function resetAuthPortfolioToDefault(userEmail: string, portfolioId: string): boolean {
  return updateAuthPortfolioHoldings(userEmail, portfolioId, null);
}

export function getAuthPortfolioCount(userEmail: string): { current: number; max: number } {
  const state = loadState(userEmail);
  return { current: state.portfolios.length, max: MAX_PORTFOLIOS_PER_USER };
}
