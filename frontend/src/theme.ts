/**
 * Theme management for WealthLens.
 * Supports system, light, and dark themes with localStorage persistence.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "wealthlens_theme";

export function getStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return "system";
}

export function setStoredTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
}

export function getEffectiveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function applyTheme(preference: ThemePreference): void {
  const effective = getEffectiveTheme(preference);
  document.documentElement.setAttribute("data-theme", effective);
}

// Apply theme immediately on load to prevent flash
const initialTheme = getStoredTheme();
applyTheme(initialTheme);
