/**
 * Demo profile and account persistence.
 *
 * IMPORTANT: This uses browser localStorage. It is NOT secure authentication.
 * Demo profiles are local browser identities only — not private accounts.
 * Data is visible to anyone with access to this browser.
 */

export const SUPPORTED_HOLDING_IDS = [
  "US_LARGE_CAP",
  "INTL_DEV_EQUITY",
  "ENERGY_EQUITY",
  "TECH_EQUITY",
  "US_AGG_BONDS",
  "TIPS",
  "CASH",
] as const;

export type HoldingId = (typeof SUPPORTED_HOLDING_IDS)[number];

export const HOLDING_LABELS: Record<HoldingId, string> = {
  US_LARGE_CAP: "US Large-Cap Equity Index",
  INTL_DEV_EQUITY: "International Developed Equity",
  ENERGY_EQUITY: "Energy Sector Equity",
  TECH_EQUITY: "Technology Sector Equity",
  US_AGG_BONDS: "US Aggregate Bond Fund",
  TIPS: "Treasury Inflation-Protected Securities",
  CASH: "Cash & Money Market",
};

export const HOLDING_ASSET_CLASS: Record<HoldingId, string> = {
  US_LARGE_CAP: "Equity",
  INTL_DEV_EQUITY: "Equity",
  ENERGY_EQUITY: "Equity",
  TECH_EQUITY: "Equity",
  US_AGG_BONDS: "Fixed Income",
  TIPS: "Fixed Income",
  CASH: "Cash",
};

/** Default synthetic portfolio values matching backend scenarios.py */
export const DEFAULT_HOLDINGS: Record<HoldingId, number> = {
  US_LARGE_CAP: 35000,
  INTL_DEV_EQUITY: 15000,
  ENERGY_EQUITY: 10000,
  TECH_EQUITY: 10000,
  US_AGG_BONDS: 20000,
  TIPS: 5000,
  CASH: 5000,
};

export const MAX_HOLDING_VALUE = 10_000_000; // $10M per holding
export const MAX_PORTFOLIO_TOTAL = 50_000_000; // $50M total
export const MAX_PORTFOLIOS_PER_USER = 5;

export interface CustomHolding {
  holdingId: HoldingId;
  value: number; // USD, non-negative integer cents rounded to dollar
}

export interface DemoAccount {
  id: string;
  name: string;
  /** null = use backend default synthetic portfolio */
  customHoldings: CustomHolding[] | null;
  createdAt: string;
}

export interface DemoProfile {
  id: string;
  name: string;
  accounts: DemoAccount[];
  activeAccountId: string;
  createdAt: string;
}

interface StorageState {
  profiles: DemoProfile[];
  activeProfileId: string | null;
  version: number;
}

const STORAGE_KEY = "wealthlens_demo_v1";
const CURRENT_VERSION = 1;

function loadState(): StorageState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profiles: [], activeProfileId: null, version: CURRENT_VERSION };
    const parsed = JSON.parse(raw) as StorageState;
    if (parsed.version !== CURRENT_VERSION) return { profiles: [], activeProfileId: null, version: CURRENT_VERSION };
    return parsed;
  } catch {
    return { profiles: [], activeProfileId: null, version: CURRENT_VERSION };
  }
}

function saveState(state: StorageState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeDefaultAccount(name = "My Portfolio"): DemoAccount {
  return {
    id: makeId("acct"),
    name,
    customHoldings: null,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getProfiles(): DemoProfile[] {
  return loadState().profiles;
}

export function getActiveProfile(): DemoProfile | null {
  const state = loadState();
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? null;
}

export function getActiveAccount(): DemoAccount | null {
  const profile = getActiveProfile();
  if (!profile) return null;
  return profile.accounts.find((a) => a.id === profile.activeAccountId) ?? profile.accounts[0] ?? null;
}

export function createProfile(name: string): DemoProfile {
  const state = loadState();
  const defaultAccount = makeDefaultAccount("My Portfolio");
  const profile: DemoProfile = {
    id: makeId("prof"),
    name: name.trim().slice(0, 60),
    accounts: [defaultAccount],
    activeAccountId: defaultAccount.id,
    createdAt: new Date().toISOString(),
  };
  state.profiles.push(profile);
  state.activeProfileId = profile.id;
  saveState(state);
  return profile;
}

export function switchProfile(profileId: string): DemoProfile | null {
  const state = loadState();
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) return null;
  state.activeProfileId = profileId;
  saveState(state);
  return profile;
}

export function signOut(): void {
  const state = loadState();
  state.activeProfileId = null;
  saveState(state);
}

export interface CreateAccountResult {
  account: DemoAccount | null;
  error: string | null;
}

export function createAccount(name: string): CreateAccountResult {
  const state = loadState();
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  if (!profile) return { account: null, error: "No active profile." };
  if (profile.accounts.length >= MAX_PORTFOLIOS_PER_USER) {
    return { account: null, error: `You can have up to ${MAX_PORTFOLIOS_PER_USER} portfolios. Remove one to create another.` };
  }
  const account = makeDefaultAccount(name.trim().slice(0, 60));
  profile.accounts.push(account);
  profile.activeAccountId = account.id;
  saveState(state);
  return { account, error: null };
}

export interface RemoveAccountResult {
  success: boolean;
  error: string | null;
  newActiveAccountId: string | null;
}

export function removeAccount(accountId: string): RemoveAccountResult {
  const state = loadState();
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  if (!profile) return { success: false, error: "No active profile.", newActiveAccountId: null };
  if (profile.accounts.length <= 1) {
    return { success: false, error: "Cannot remove your only portfolio. Create another first.", newActiveAccountId: null };
  }
  const idx = profile.accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return { success: false, error: "Portfolio not found.", newActiveAccountId: null };
  profile.accounts.splice(idx, 1);
  // Select a remaining portfolio deterministically (first one, or next if removed was first)
  const newActive = profile.accounts[Math.min(idx, profile.accounts.length - 1)];
  profile.activeAccountId = newActive.id;
  saveState(state);
  return { success: true, error: null, newActiveAccountId: newActive.id };
}

export function getPortfolioCount(): { current: number; max: number } {
  const profile = getActiveProfile();
  return { current: profile?.accounts.length ?? 0, max: MAX_PORTFOLIOS_PER_USER };
}

export function renameAccount(accountId: string, name: string): boolean {
  const state = loadState();
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  if (!profile) return false;
  const account = profile.accounts.find((a) => a.id === accountId);
  if (!account) return false;
  account.name = name.trim().slice(0, 60);
  saveState(state);
  return true;
}

export function selectAccount(accountId: string): boolean {
  const state = loadState();
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  if (!profile) return false;
  if (!profile.accounts.find((a) => a.id === accountId)) return false;
  profile.activeAccountId = accountId;
  saveState(state);
  return true;
}

export function updateAccountHoldings(accountId: string, holdings: CustomHolding[] | null): boolean {
  const state = loadState();
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  if (!profile) return false;
  const account = profile.accounts.find((a) => a.id === accountId);
  if (!account) return false;
  account.customHoldings = holdings;
  saveState(state);
  return true;
}

export function resetAccountToDefault(accountId: string): boolean {
  return updateAccountHoldings(accountId, null);
}

/** Validate custom holdings. Returns error string or null if valid. */
export function validateHoldings(holdings: CustomHolding[]): string | null {
  if (holdings.length === 0) return "Portfolio must have at least one holding.";
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (total <= 0) return "Portfolio total must be greater than zero.";
  if (total > MAX_PORTFOLIO_TOTAL) return `Portfolio total cannot exceed $${(MAX_PORTFOLIO_TOTAL / 1_000_000).toFixed(0)}M.`;
  for (const h of holdings) {
    if (!SUPPORTED_HOLDING_IDS.includes(h.holdingId)) return `Unknown holding: ${h.holdingId}`;
    if (!Number.isFinite(h.value) || h.value < 0) return `Invalid value for ${h.holdingId}.`;
    if (h.value > MAX_HOLDING_VALUE) return `${HOLDING_LABELS[h.holdingId]} cannot exceed $${(MAX_HOLDING_VALUE / 1_000_000).toFixed(0)}M.`;
  }
  // Check for duplicates
  const ids = holdings.map((h) => h.holdingId);
  if (new Set(ids).size !== ids.length) return "Duplicate holdings are not allowed.";
  return null;
}
