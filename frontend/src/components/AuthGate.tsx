import { useState, type FormEvent } from "react";
import {
  confirmNewPassword,
  confirmSignUp,
  forgotPassword,
  resendConfirmationCode,
  signIn,
  signUp,
  type StoredSession,
} from "../auth";

type Flow =
  | "role-select"
  | "sign-in"
  | "sign-up"
  | "verify"
  | "forgot-password"
  | "reset-password";

interface AuthGateProps {
  onAuthenticated: (session: StoredSession) => void;
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [flow, setFlow] = useState<Flow>("role-select");
  const [selectedRole, setSelectedRole] = useState<"investor" | "advisor" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  function clearMessages() {
    setError("");
    setInfo("");
  }

  function goToSignIn(role: "investor" | "advisor") {
    setSelectedRole(role);
    setFlow("sign-in");
    clearMessages();
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      const session = await signIn(email, password);
      // If user selected advisor but token says investor, explain the mismatch
      if (selectedRole === "advisor" && session.role !== "advisor") {
        setError(
          "Your account does not have advisor access. " +
          "Advisor accounts are provisioned by an administrator. " +
          "You have been signed in as an investor."
        );
        // Still authenticate — let the app show the correct role from the token
        onAuthenticated(session);
        return;
      }
      onAuthenticated(session);
    } catch (err: unknown) {
      const e2 = err as { code?: string; message?: string };
      if (e2.code === "UserNotConfirmedException") {
        setInfo("Please verify your email before signing in.");
        setFlow("verify");
      } else if (e2.code === "NewPasswordRequired") {
        setError("A new password is required. Please contact your administrator to reset your password.");
      } else {
        setError(e2.message ?? "Sign-in failed. Check your email and password.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      await signUp(email, password);
      setInfo("Account created. Check your email for a verification code.");
      setFlow("verify");
    } catch (err: unknown) {
      const e2 = err as { code?: string; message?: string };
      if (e2.code === "UsernameExistsException") {
        setError("An account with this email already exists. Sign in instead.");
      } else {
        setError(e2.message ?? "Sign-up failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      await confirmSignUp(email, verifyCode);
      setInfo("Email verified. You can now sign in.");
      setFlow("sign-in");
    } catch (err: unknown) {
      const e2 = err as { code?: string; message?: string };
      setError(e2.message ?? "Verification failed. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    clearMessages();
    setLoading(true);
    try {
      await resendConfirmationCode(email);
      setInfo("A new verification code has been sent to your email.");
    } catch (err: unknown) {
      const e2 = err as { message?: string };
      setError(e2.message ?? "Could not resend code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      await forgotPassword(email);
      setInfo("A reset code has been sent to your email.");
      setFlow("reset-password");
    } catch (err: unknown) {
      const e2 = err as { message?: string };
      setError(e2.message ?? "Could not send reset code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      await confirmNewPassword(email, resetCode, newPassword);
      setInfo("Password reset. You can now sign in with your new password.");
      setFlow("sign-in");
    } catch (err: unknown) {
      const e2 = err as { message?: string };
      setError(e2.message ?? "Password reset failed. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Role selection ──────────────────────────────────────────────────────
  if (flow === "role-select") {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-logo">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
              <circle cx="20" cy="20" r="18" fill="#102B46"/>
              <circle cx="20" cy="20" r="12" fill="#1a4a6b"/>
              <circle cx="20" cy="20" r="7.5" fill="#1a7972"/>
              <circle cx="20" cy="20" r="3.5" fill="#2da89e"/>
            </svg>
          </div>
          <h1 className="auth-title">WealthLens</h1>
          <p className="auth-tagline">How are you signing in today?</p>
          <div className="auth-role-grid">
            <button
              className="auth-role-btn"
              type="button"
              onClick={() => goToSignIn("investor")}
            >
              <span className="auth-role-icon" aria-hidden="true">👤</span>
              <strong>I'm an Investor</strong>
              <span>Sign in or create an account to explore your portfolio scenarios.</span>
            </button>
            <button
              className="auth-role-btn"
              type="button"
              onClick={() => goToSignIn("advisor")}
            >
              <span className="auth-role-icon" aria-hidden="true">💼</span>
              <strong>I'm an Advisor</strong>
              <span>Sign in with your administrator-provisioned advisor account.</span>
            </button>
          </div>
          <p className="auth-notice">
            Selecting a role here does not grant permissions. Your actual access is determined by your account.
          </p>
        </div>
      </div>
    );
  }

  // ── Sign-in ─────────────────────────────────────────────────────────────
  if (flow === "sign-in") {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <button className="auth-back-btn" type="button" onClick={() => { setFlow("role-select"); clearMessages(); }}>
            ← Back
          </button>
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-tagline">
            {selectedRole === "advisor" ? "Advisor account" : "Investor account"}
          </p>

          {error && <div className="auth-error" role="alert">{error}</div>}
          {info && <div className="auth-info" role="status">{info}</div>}

          <form className="auth-form" onSubmit={handleSignIn}>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <button className="primary-button auth-submit" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="auth-links">
            <button className="text-button" type="button" onClick={() => { setFlow("forgot-password"); clearMessages(); }}>
              Forgot password?
            </button>
            {selectedRole === "investor" && (
              <button className="text-button" type="button" onClick={() => { setFlow("sign-up"); clearMessages(); }}>
                Create an account
              </button>
            )}
            {selectedRole === "advisor" && (
              <p className="auth-advisor-note">
                Advisor accounts are provisioned by an administrator. Contact your administrator if you need access.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Sign-up (investor only) ─────────────────────────────────────────────
  if (flow === "sign-up") {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <button className="auth-back-btn" type="button" onClick={() => { setFlow("sign-in"); clearMessages(); }}>
            ← Back to sign in
          </button>
          <h1 className="auth-title">Create account</h1>
          <p className="auth-tagline">Investor account</p>

          {error && <div className="auth-error" role="alert">{error}</div>}
          {info && <div className="auth-info" role="status">{info}</div>}

          <form className="auth-form" onSubmit={handleSignUp}>
            <label htmlFor="su-email">Email</label>
            <input
              id="su-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <label htmlFor="su-password">Password</label>
            <input
              id="su-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <label htmlFor="su-confirm">Confirm password</label>
            <input
              id="su-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <p className="auth-password-hint">
              At least 8 characters, including uppercase, lowercase, and a number.
            </p>
            <button className="primary-button auth-submit" type="submit" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <div className="auth-links">
            <button className="text-button" type="button" onClick={() => { setFlow("sign-in"); clearMessages(); }}>
              Already have an account? Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Verify email ────────────────────────────────────────────────────────
  if (flow === "verify") {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <h1 className="auth-title">Verify your email</h1>
          <p className="auth-tagline">Enter the code sent to {email || "your email"}</p>

          {error && <div className="auth-error" role="alert">{error}</div>}
          {info && <div className="auth-info" role="status">{info}</div>}

          <form className="auth-form" onSubmit={handleVerify}>
            <label htmlFor="verify-email">Email</label>
            <input
              id="verify-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <label htmlFor="verify-code">Verification code</label>
            <input
              id="verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={verifyCode}
              onChange={(e) => { setVerifyCode(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <button className="primary-button auth-submit" type="submit" disabled={loading}>
              {loading ? "Verifying…" : "Verify email"}
            </button>
          </form>

          <div className="auth-links">
            <button className="text-button" type="button" onClick={handleResendCode} disabled={loading}>
              Resend code
            </button>
            <button className="text-button" type="button" onClick={() => { setFlow("sign-in"); clearMessages(); }}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Forgot password ─────────────────────────────────────────────────────
  if (flow === "forgot-password") {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <button className="auth-back-btn" type="button" onClick={() => { setFlow("sign-in"); clearMessages(); }}>
            ← Back to sign in
          </button>
          <h1 className="auth-title">Reset password</h1>
          <p className="auth-tagline">We'll send a reset code to your email</p>

          {error && <div className="auth-error" role="alert">{error}</div>}
          {info && <div className="auth-info" role="status">{info}</div>}

          <form className="auth-form" onSubmit={handleForgotPassword}>
            <label htmlFor="fp-email">Email</label>
            <input
              id="fp-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearMessages(); }}
              disabled={loading}
            />
            <button className="primary-button auth-submit" type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send reset code"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Reset password ──────────────────────────────────────────────────────
  return (
    <div className="auth-gate">
      <div className="auth-card">
        <h1 className="auth-title">Set new password</h1>
        <p className="auth-tagline">Enter the code sent to {email || "your email"}</p>

        {error && <div className="auth-error" role="alert">{error}</div>}
        {info && <div className="auth-info" role="status">{info}</div>}

        <form className="auth-form" onSubmit={handleResetPassword}>
          <label htmlFor="rp-email">Email</label>
          <input
            id="rp-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearMessages(); }}
            disabled={loading}
          />
          <label htmlFor="rp-code">Reset code</label>
          <input
            id="rp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={resetCode}
            onChange={(e) => { setResetCode(e.target.value); clearMessages(); }}
            disabled={loading}
          />
          <label htmlFor="rp-newpw">New password</label>
          <input
            id="rp-newpw"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); clearMessages(); }}
            disabled={loading}
          />
          <button className="primary-button auth-submit" type="submit" disabled={loading}>
            {loading ? "Resetting…" : "Reset password"}
          </button>
        </form>

        <div className="auth-links">
          <button className="text-button" type="button" onClick={() => { setFlow("sign-in"); clearMessages(); }}>
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
