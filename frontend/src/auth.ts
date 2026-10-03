/**
 * auth.ts — WealthLens Cognito authentication module.
 *
 * Uses amazon-cognito-identity-js for SRP sign-in (no client secret required).
 * The library is loaded via dynamic import only when an auth operation is
 * actually called — it never executes at module parse time, so it cannot
 * crash the app when AUTH_ENABLED is false.
 *
 * Tokens are stored in sessionStorage (cleared on tab close).
 * Role is derived from the "cognito:groups" claim in the verified ID token.
 * The UI role-selection screen only determines which sign-in flow to present;
 * it does NOT grant permissions. Actual role comes from the token.
 */

// ---------------------------------------------------------------------------
// Configuration — values injected via Vite env vars (never secrets)
// ---------------------------------------------------------------------------
export const COGNITO_REGION = import.meta.env.VITE_COGNITO_REGION as string | undefined;
export const COGNITO_USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
export const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;

export const AUTH_ENABLED =
  typeof COGNITO_USER_POOL_ID === "string" && COGNITO_USER_POOL_ID.length > 0 &&
  typeof COGNITO_CLIENT_ID === "string" && COGNITO_CLIENT_ID.length > 0;

// ---------------------------------------------------------------------------
// Lazy Cognito SDK loader — never imported at module parse time
// ---------------------------------------------------------------------------
type CognitoModule = typeof import("amazon-cognito-identity-js");

let _cognitoModule: CognitoModule | null = null;

async function getCognito(): Promise<CognitoModule> {
  if (_cognitoModule) return _cognitoModule;
  _cognitoModule = await import("amazon-cognito-identity-js");
  return _cognitoModule;
}

// ---------------------------------------------------------------------------
// User pool singleton
// ---------------------------------------------------------------------------
import type { CognitoUserPool, CognitoUserSession } from "amazon-cognito-identity-js";

let _pool: CognitoUserPool | null = null;

async function getPool(): Promise<CognitoUserPool> {
  if (_pool) return _pool;
  if (!AUTH_ENABLED) throw new Error("Cognito is not configured.");
  const { CognitoUserPool: Pool } = await getCognito();
  _pool = new Pool({
    UserPoolId: COGNITO_USER_POOL_ID!,
    ClientId: COGNITO_CLIENT_ID!,
  });
  return _pool;
}

// ---------------------------------------------------------------------------
// Token storage — sessionStorage only
// ---------------------------------------------------------------------------
const SESSION_KEY = "wl_auth_session";

export interface StoredSession {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email: string;
  role: "investor" | "advisor";
  sub: string;
}

export function getStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (Date.now() > s.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function storeSession(session: CognitoUserSession, email: string): StoredSession {
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload();
  const groups: string[] = Array.isArray(payload["cognito:groups"])
    ? (payload["cognito:groups"] as string[])
    : [];
  const role: StoredSession["role"] = groups.includes("advisors") ? "advisor" : "investor";
  const sub = typeof payload["sub"] === "string" ? payload["sub"] : "";
  const stored: StoredSession = {
    idToken: idToken.getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: idToken.getExpiration() * 1000,
    email,
    role,
    sub,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  return stored;
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  // Best-effort: sign out from SDK's internal storage if pool is already loaded
  if (_pool) {
    try {
      const user = _pool.getCurrentUser();
      if (user) user.signOut();
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Auth error type
// ---------------------------------------------------------------------------
export interface AuthError {
  code: string;
  message: string;
}

function toAuthError(err: unknown): AuthError {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    return {
      code: typeof e["code"] === "string" ? e["code"] : "UnknownError",
      message: typeof e["message"] === "string" ? e["message"] : "An unknown error occurred.",
    };
  }
  return { code: "UnknownError", message: String(err) };
}

// ---------------------------------------------------------------------------
// Auth operations — all lazy-load the Cognito SDK on first call
// ---------------------------------------------------------------------------

/** Sign in with email + password using SRP. Returns the stored session. */
export function signIn(email: string, password: string): Promise<StoredSession> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { CognitoUser, AuthenticationDetails } = await getCognito();
        const pool = await getPool();
        const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });
        const authDetails = new AuthenticationDetails({
          Username: email.trim().toLowerCase(),
          Password: password,
        });
        user.authenticateUser(authDetails, {
          onSuccess(session) {
            resolve(storeSession(session, email.trim().toLowerCase()));
          },
          onFailure(err) {
            reject(toAuthError(err));
          },
          newPasswordRequired() {
            reject({
              code: "NewPasswordRequired",
              message: "A new password is required. Please contact your administrator.",
            });
          },
        });
      } catch (err) {
        reject(toAuthError(err));
      }
    })();
  });
}

/** Sign up a new investor account. Advisor accounts are admin-provisioned only. */
export function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { CognitoUserAttribute } = await getCognito();
        const pool = await getPool();
        const attributes = [
          new CognitoUserAttribute({ Name: "email", Value: email.trim().toLowerCase() }),
        ];
        pool.signUp(email.trim().toLowerCase(), password, attributes, [], (err) => {
          if (err) reject(toAuthError(err));
          else resolve();
        });
      } catch (err) {
        reject(toAuthError(err));
      }
    })();
  });
}

/** Confirm sign-up with the emailed verification code. */
export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { CognitoUser } = await getCognito();
        const pool = await getPool();
        const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });
        user.confirmRegistration(code.trim(), true, (err) => {
          if (err) reject(toAuthError(err));
          else resolve();
        });
      } catch (err) {
        reject(toAuthError(err));
      }
    })();
  });
}

/** Resend the verification code. */
export function resendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { CognitoUser } = await getCognito();
        const pool = await getPool();
        const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });
        user.resendConfirmationCode((err) => {
          if (err) reject(toAuthError(err));
          else resolve();
        });
      } catch (err) {
        reject(toAuthError(err));
      }
    })();
  });
}

/** Initiate forgot-password flow — sends a reset code to the user's email. */
export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { CognitoUser } = await getCognito();
        const pool = await getPool();
        const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });
        user.forgotPassword({
          onSuccess() { resolve(); },
          onFailure(err) { reject(toAuthError(err)); },
        });
      } catch (err) {
        reject(toAuthError(err));
      }
    })();
  });
}

/** Confirm a new password using the reset code. */
export function confirmNewPassword(email: string, code: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { CognitoUser } = await getCognito();
        const pool = await getPool();
        const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });
        user.confirmPassword(code.trim(), newPassword, {
          onSuccess() { resolve(); },
          onFailure(err) { reject(toAuthError(err)); },
        });
      } catch (err) {
        reject(toAuthError(err));
      }
    })();
  });
}

/** Attempt a silent token refresh using the stored refresh token. */
export function refreshSession(): Promise<StoredSession | null> {
  return new Promise((resolve) => {
    const stored = getStoredSession();
    if (!stored) { resolve(null); return; }
    void (async () => {
      try {
        const { CognitoUser } = await getCognito();
        const pool = await getPool();
        const user = new CognitoUser({ Username: stored.email, Pool: pool });
        user.getSession((err: Error | null, session: CognitoUserSession | null) => {
          if (err || !session || !session.isValid()) { resolve(null); return; }
          resolve(storeSession(session, stored.email));
        });
      } catch {
        resolve(null);
      }
    })();
  });
}
