"use client";

import {
  normalizeWorkspaceMode,
  type WorkspaceMode,
} from "@/lib/workspace-mode";

export type AppLanguage = "en" | "zh";

/** General keeps the historical unsuffixed key so existing tabs never lose
 *  their restored session; only the new mode carries a suffix. */
export const ACTIVE_SESSION_STORAGE_KEY = "deeptutor.activeSessionId.tab";

/**
 * Per-mode key for the restored session.
 *
 * Sharing one key across modes would restore a Tutor session into the General
 * workspace (and vice versa) — a session the sidebar in that mode is not even
 * allowed to list, which reads as a phantom conversation.
 */
export function activeSessionStorageKey(mode: WorkspaceMode): string {
  return mode === "general"
    ? ACTIVE_SESSION_STORAGE_KEY
    : `${ACTIVE_SESSION_STORAGE_KEY}.${mode}`;
}

export const WORKSPACE_MODE_STORAGE_KEY = "deeptutor.workspaceMode";
export const LANGUAGE_STORAGE_KEY = "deeptutor-language";
export const RESPONSE_LANGUAGE_STORAGE_KEY = "deeptutor-response-language";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "deeptutor.sidebarCollapsed";
export const CHAT_RESPONSE_TIMEOUT_STORAGE_KEY =
  "deeptutor.chatResponseTimeout";
export const CODE_BLOCK_THEME_STORAGE_KEY = "deeptutor.code-block-theme";
export const CODE_BLOCK_SHOW_LINE_NUMBERS_STORAGE_KEY =
  "deeptutor.code-block-show-line-numbers";
export const CODE_BLOCK_WRAP_LONG_LINES_STORAGE_KEY =
  "deeptutor.code-block-wrap-long-lines";

// Mirror of the per-user ``chat_response_timeout`` UI preference. Cached in
// localStorage so the chat watchdog (a separate provider from Settings) can
// read it synchronously without its own fetch. Kept in sync on settings load.
export const DEFAULT_CHAT_RESPONSE_TIMEOUT_SECONDS = 180;
export const MIN_CHAT_RESPONSE_TIMEOUT_SECONDS = 30;
export const MAX_CHAT_RESPONSE_TIMEOUT_SECONDS = 1800;

export function clampChatResponseTimeout(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_CHAT_RESPONSE_TIMEOUT_SECONDS;
  return Math.min(
    MAX_CHAT_RESPONSE_TIMEOUT_SECONDS,
    Math.max(MIN_CHAT_RESPONSE_TIMEOUT_SECONDS, Math.round(seconds)),
  );
}

export function readStoredChatResponseTimeout(): number {
  if (typeof window === "undefined")
    return DEFAULT_CHAT_RESPONSE_TIMEOUT_SECONDS;
  try {
    const raw = window.localStorage.getItem(CHAT_RESPONSE_TIMEOUT_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? clampChatResponseTimeout(parsed)
      : DEFAULT_CHAT_RESPONSE_TIMEOUT_SECONDS;
  } catch {
    return DEFAULT_CHAT_RESPONSE_TIMEOUT_SECONDS;
  }
}

export function writeStoredChatResponseTimeout(seconds: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CHAT_RESPONSE_TIMEOUT_STORAGE_KEY,
      String(clampChatResponseTimeout(seconds)),
    );
  } catch {
    // localStorage may be unavailable
  }
}

export const ACTIVE_SESSION_EVENT = "deeptutor:active-session";
export const WORKSPACE_MODE_EVENT = "deeptutor:workspace-mode";
export const LANGUAGE_EVENT = "deeptutor:language";
export const RESPONSE_LANGUAGE_EVENT = "deeptutor:response-language";
export const SIDEBAR_COLLAPSED_EVENT = "deeptutor:sidebar-collapsed";
export const CODE_BLOCK_SETTINGS_EVENT = "deeptutor:code-block-settings";

export function normalizeLanguage(
  value: string | null | undefined,
): AppLanguage {
  return value === "zh" ? "zh" : "en";
}

export function resolveResponseLanguage(
  value: string | null | undefined,
  legacyLanguage: string | null | undefined = "en",
): AppLanguage {
  return value === "zh" || value === "en"
    ? value
    : normalizeLanguage(legacyLanguage);
}

export function readStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return "en";
  }
}

/** Whether this browser has ever recorded a choice.
 *
 * ``readStoredLanguage`` cannot answer this: it normalizes a missing value to
 * "en", which is indistinguishable from an explicit English selection. The
 * bootstrap needs the difference — it may only consult the server-side
 * preference when the browser has no choice of its own to honour.
 */
export function hasStoredLanguage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeStoredLanguage(language: AppLanguage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    window.dispatchEvent(
      new CustomEvent(LANGUAGE_EVENT, {
        detail: { language },
      }),
    );
  } catch {
    // localStorage may be unavailable
  }
}

export function readStoredResponseLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  try {
    return resolveResponseLanguage(
      window.localStorage.getItem(RESPONSE_LANGUAGE_STORAGE_KEY),
      window.localStorage.getItem(LANGUAGE_STORAGE_KEY),
    );
  } catch {
    return "en";
  }
}

export function writeStoredResponseLanguage(language: AppLanguage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RESPONSE_LANGUAGE_STORAGE_KEY, language);
    window.dispatchEvent(
      new CustomEvent(RESPONSE_LANGUAGE_EVENT, {
        detail: { language },
      }),
    );
  } catch {
    // localStorage may be unavailable
  }
}

export function readStoredActiveSessionId(
  mode: WorkspaceMode = "general",
): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(activeSessionStorageKey(mode));
  } catch {
    return null;
  }
}

export function writeStoredActiveSessionId(
  sessionId: string | null,
  mode: WorkspaceMode = "general",
): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionId) {
      window.sessionStorage.setItem(activeSessionStorageKey(mode), sessionId);
    } else {
      window.sessionStorage.removeItem(activeSessionStorageKey(mode));
    }
    window.dispatchEvent(
      new CustomEvent(ACTIVE_SESSION_EVENT, {
        detail: { sessionId, mode },
      }),
    );
  } catch {
    // sessionStorage may be unavailable
  }
}

/** The workspace the user was last in. localStorage, not sessionStorage: this
 *  is a durable preference, unlike the per-tab restored session. */
export function readStoredWorkspaceMode(): WorkspaceMode {
  if (typeof window === "undefined") return "general";
  try {
    return normalizeWorkspaceMode(
      window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY),
    );
  } catch {
    return "general";
  }
}

export function writeStoredWorkspaceMode(mode: WorkspaceMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_MODE_EVENT, {
        detail: { mode },
      }),
    );
  } catch {
    // localStorage may be unavailable
  }
}

export function readStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStoredSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0",
    );
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_COLLAPSED_EVENT, {
        detail: { collapsed },
      }),
    );
  } catch {
    // localStorage may be unavailable
  }
}

// Code block settings defaults
export const DEFAULT_CODE_BLOCK_THEME = "oneDark";
export const DEFAULT_CODE_BLOCK_SHOW_LINE_NUMBERS = false;
export const DEFAULT_CODE_BLOCK_WRAP_LONG_LINES = false;

export function normalizeCodeBlockTheme(
  value: string | null | undefined,
): string {
  if (!value || value.trim() === "") return DEFAULT_CODE_BLOCK_THEME;
  return value.trim();
}

export function readStoredCodeBlockTheme(): string {
  if (typeof window === "undefined") return DEFAULT_CODE_BLOCK_THEME;
  try {
    const raw = window.localStorage.getItem(CODE_BLOCK_THEME_STORAGE_KEY);
    return normalizeCodeBlockTheme(raw);
  } catch {
    return DEFAULT_CODE_BLOCK_THEME;
  }
}

export function writeStoredCodeBlockTheme(theme: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CODE_BLOCK_THEME_STORAGE_KEY,
      normalizeCodeBlockTheme(theme),
    );
    window.dispatchEvent(
      new CustomEvent(CODE_BLOCK_SETTINGS_EVENT, {
        detail: { codeBlockTheme: normalizeCodeBlockTheme(theme) },
      }),
    );
  } catch {
    // localStorage may be unavailable
  }
}

export function normalizeCodeBlockShowLineNumbers(
  value: string | null | undefined,
): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return DEFAULT_CODE_BLOCK_SHOW_LINE_NUMBERS;
}

export function readStoredCodeBlockShowLineNumbers(): boolean {
  if (typeof window === "undefined")
    return DEFAULT_CODE_BLOCK_SHOW_LINE_NUMBERS;
  try {
    const raw = window.localStorage.getItem(
      CODE_BLOCK_SHOW_LINE_NUMBERS_STORAGE_KEY,
    );
    return normalizeCodeBlockShowLineNumbers(raw);
  } catch {
    return DEFAULT_CODE_BLOCK_SHOW_LINE_NUMBERS;
  }
}

export function writeStoredCodeBlockShowLineNumbers(show: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CODE_BLOCK_SHOW_LINE_NUMBERS_STORAGE_KEY,
      String(show),
    );
    window.dispatchEvent(
      new CustomEvent(CODE_BLOCK_SETTINGS_EVENT, {
        detail: { codeBlockShowLineNumbers: show },
      }),
    );
  } catch {
    // localStorage may be unavailable
  }
}

export function normalizeCodeBlockWrapLongLines(
  value: string | null | undefined,
): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return DEFAULT_CODE_BLOCK_WRAP_LONG_LINES;
}

export function readStoredCodeBlockWrapLongLines(): boolean {
  if (typeof window === "undefined") return DEFAULT_CODE_BLOCK_WRAP_LONG_LINES;
  try {
    const raw = window.localStorage.getItem(
      CODE_BLOCK_WRAP_LONG_LINES_STORAGE_KEY,
    );
    return normalizeCodeBlockWrapLongLines(raw);
  } catch {
    return DEFAULT_CODE_BLOCK_WRAP_LONG_LINES;
  }
}

export function writeStoredCodeBlockWrapLongLines(wrap: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CODE_BLOCK_WRAP_LONG_LINES_STORAGE_KEY,
      String(wrap),
    );
    window.dispatchEvent(
      new CustomEvent(CODE_BLOCK_SETTINGS_EVENT, {
        detail: { codeBlockWrapLongLines: wrap },
      }),
    );
  } catch {
    // localStorage may be unavailable
  }
}
