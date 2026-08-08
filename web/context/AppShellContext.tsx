"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { apiFetch, apiUrl } from "@/lib/api";
import {
  DEFAULT_WORKSPACE_MODE,
  modeFromPathname,
  normalizeWorkspaceMode,
  type WorkspaceMode,
} from "@/lib/workspace-mode";
import {
  getStoredTheme,
  getSystemTheme,
  setTheme as applyThemePreference,
  subscribeToThemeChanges,
  type Theme,
} from "@/lib/theme";
import {
  ACTIVE_SESSION_EVENT,
  activeSessionStorageKey,
  WORKSPACE_MODE_EVENT,
  WORKSPACE_MODE_STORAGE_KEY,
  readStoredWorkspaceMode,
  writeStoredWorkspaceMode,
  CODE_BLOCK_SHOW_LINE_NUMBERS_STORAGE_KEY,
  CODE_BLOCK_SETTINGS_EVENT,
  CODE_BLOCK_THEME_STORAGE_KEY,
  CODE_BLOCK_WRAP_LONG_LINES_STORAGE_KEY,
  LANGUAGE_EVENT,
  LANGUAGE_STORAGE_KEY,
  hasStoredLanguage,
  SIDEBAR_COLLAPSED_EVENT,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  normalizeCodeBlockShowLineNumbers,
  normalizeCodeBlockTheme,
  normalizeCodeBlockWrapLongLines,
  normalizeLanguage,
  resolveResponseLanguage,
  readStoredActiveSessionId,
  readStoredCodeBlockShowLineNumbers,
  readStoredCodeBlockTheme,
  readStoredCodeBlockWrapLongLines,
  readStoredLanguage,
  writeStoredResponseLanguage,
  readStoredSidebarCollapsed,
  writeStoredActiveSessionId,
  writeStoredCodeBlockShowLineNumbers,
  writeStoredCodeBlockTheme,
  writeStoredCodeBlockWrapLongLines,
  writeStoredLanguage,
  writeStoredSidebarCollapsed,
  type AppLanguage,
} from "@/context/app-shell-storage";

interface AppShellContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  /** The workspace the user is currently in (General / Tutor). */
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  codeBlockTheme: string;
  setCodeBlockTheme: (theme: string) => void;
  codeBlockShowLineNumbers: boolean;
  setCodeBlockShowLineNumbers: (show: boolean) => void;
  codeBlockWrapLongLines: boolean;
  setCodeBlockWrapLongLines: (wrap: boolean) => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return getStoredTheme() ?? getSystemTheme();
  });
  // Always start with "en" to match SSR; hydrate from localStorage after mount
  const [language, setLanguageState] = useState<AppLanguage>("en");

  /* ---- Workspace mode ----
     The chat routes are authoritative: ``/home`` *is* General and ``/tutor``
     *is* Tutor, and both are known during SSR, so seeding from the pathname is
     hydration-safe. Shared routes assert nothing (``null``) and fall back to
     the default here, then adopt the stored preference once mounted. */
  const pathname = usePathname();
  const assertedMode = modeFromPathname(pathname);
  const [mode, setModeState] = useState<WorkspaceMode>(
    () => assertedMode ?? DEFAULT_WORKSPACE_MODE,
  );

  // A URL that asserts a mode also switches the workspace mid-session (e.g.
  // following a link from Tutor into /home). Compared during render rather
  // than in an effect — the same pattern AppShell uses to close its drawer —
  // so the sidebar never paints one mode's nav against the other's route.
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  if (trackedPathname !== pathname) {
    setTrackedPathname(pathname);
    if (assertedMode && assertedMode !== mode) setModeState(assertedMode);
  }

  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    () => readStoredActiveSessionId(assertedMode ?? DEFAULT_WORKSPACE_MODE),
  );
  // Always start expanded to match SSR; hydrate from localStorage after mount
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(false);
  // Code block settings - start with defaults, hydrate from localStorage after mount
  const [codeBlockTheme, setCodeBlockThemeState] = useState<string>(() =>
    readStoredCodeBlockTheme(),
  );
  const [codeBlockShowLineNumbers, setCodeBlockShowLineNumbersState] =
    useState<boolean>(() => readStoredCodeBlockShowLineNumbers());
  const [codeBlockWrapLongLines, setCodeBlockWrapLongLinesState] =
    useState<boolean>(() => readStoredCodeBlockWrapLongLines());

  useEffect(() => {
    // Hydrate client-only preferences after SSR-safe first render.
    setLanguageState(readStoredLanguage());
    setSidebarCollapsedState(readStoredSidebarCollapsed());
    setCodeBlockThemeState(readStoredCodeBlockTheme());
    setCodeBlockShowLineNumbersState(readStoredCodeBlockShowLineNumbers());
    setCodeBlockWrapLongLinesState(readStoredCodeBlockWrapLongLines());
    // Only a shared route defers to the stored preference. Landing directly on
    // a chat route means the URL already decided, and honouring localStorage
    // there would drag the user out of the workspace they linked into.
    if (!assertedMode) setModeState(readStoredWorkspaceMode());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist only what a chat route asserts. Shared routes leave the stored
  // preference alone, which is what makes "/space/questions keeps me in Tutor"
  // survive a refresh.
  useEffect(() => {
    if (assertedMode) writeStoredWorkspaceMode(assertedMode);
  }, [assertedMode]);

  // Each mode restores its own session; switching workspaces swaps which one
  // is current rather than carrying the other mode's session across.
  useEffect(() => {
    setActiveSessionIdState(readStoredActiveSessionId(mode));
  }, [mode]);

  useEffect(() => {
    // The saved languages live in the backend's ui settings, but only the
    // settings route ever read them, so every other page started in English
    // until the user changed it again in this browser. Adopt them once, and
    // only when this browser has made no choice of its own — a local selection
    // is the more specific signal and must win.
    //
    // One fetch carries both fields: the interface locale and the
    // reader-facing output language are stored together and are gated by the
    // same "has this browser chosen yet?" question, so splitting them into two
    // bootstraps would only give them a chance to disagree.
    if (hasStoredLanguage()) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch(apiUrl("/api/v1/settings/ui"), {
          signal: controller.signal,
          skipAuthRedirect: true,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          language?: unknown;
          response_language?: unknown;
        };
        if (payload.language !== "zh" && payload.language !== "en") return;
        writeStoredLanguage(payload.language);
        // A backend that predates the split sends no response_language;
        // resolveResponseLanguage inherits the interface locale, matching what
        // the server does for a legacy interface.json.
        writeStoredResponseLanguage(
          resolveResponseLanguage(
            typeof payload.response_language === "string"
              ? payload.response_language
              : null,
            payload.language,
          ),
        );
        setLanguageState(payload.language);
      } catch {
        // Offline or unauthenticated: keep the local default.
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    return subscribeToThemeChanges((nextTheme) => {
      setThemeState(nextTheme);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY) {
        setLanguageState(normalizeLanguage(event.newValue));
      }
      if (event.key === activeSessionStorageKey(mode)) {
        setActiveSessionIdState(event.newValue);
      }
      if (event.key === WORKSPACE_MODE_STORAGE_KEY) {
        setModeState(normalizeWorkspaceMode(event.newValue));
      }
      if (event.key === SIDEBAR_COLLAPSED_STORAGE_KEY) {
        setSidebarCollapsedState(event.newValue === "1");
      }
      if (event.key === CODE_BLOCK_THEME_STORAGE_KEY) {
        setCodeBlockThemeState(normalizeCodeBlockTheme(event.newValue));
      }
      if (event.key === CODE_BLOCK_SHOW_LINE_NUMBERS_STORAGE_KEY) {
        setCodeBlockShowLineNumbersState(
          normalizeCodeBlockShowLineNumbers(event.newValue),
        );
      }
      if (event.key === CODE_BLOCK_WRAP_LONG_LINES_STORAGE_KEY) {
        setCodeBlockWrapLongLinesState(
          normalizeCodeBlockWrapLongLines(event.newValue),
        );
      }
    };

    const onLanguage = (event: Event) => {
      const detail = (event as CustomEvent<{ language?: AppLanguage }>).detail;
      setLanguageState(normalizeLanguage(detail?.language));
    };

    const onActiveSession = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          sessionId?: string | null;
          mode?: WorkspaceMode;
        }>
      ).detail;
      // A write from the other workspace must not move this one's cursor.
      if (detail?.mode && detail.mode !== mode) return;
      setActiveSessionIdState(detail?.sessionId ?? null);
    };

    const onWorkspaceMode = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: WorkspaceMode }>).detail;
      setModeState(normalizeWorkspaceMode(detail?.mode));
    };

    const onSidebarCollapsed = (event: Event) => {
      const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
      setSidebarCollapsedState(Boolean(detail?.collapsed));
    };

    const onCodeBlockSettings = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          codeBlockTheme?: string;
          codeBlockShowLineNumbers?: boolean;
          codeBlockWrapLongLines?: boolean;
        }>
      ).detail;

      if (detail?.codeBlockTheme !== undefined) {
        setCodeBlockThemeState(normalizeCodeBlockTheme(detail.codeBlockTheme));
      }
      if (detail?.codeBlockShowLineNumbers !== undefined) {
        setCodeBlockShowLineNumbersState(
          Boolean(detail.codeBlockShowLineNumbers),
        );
      }
      if (detail?.codeBlockWrapLongLines !== undefined) {
        setCodeBlockWrapLongLinesState(Boolean(detail.codeBlockWrapLongLines));
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(LANGUAGE_EVENT, onLanguage);
    window.addEventListener(ACTIVE_SESSION_EVENT, onActiveSession);
    window.addEventListener(WORKSPACE_MODE_EVENT, onWorkspaceMode);
    window.addEventListener(SIDEBAR_COLLAPSED_EVENT, onSidebarCollapsed);
    window.addEventListener(CODE_BLOCK_SETTINGS_EVENT, onCodeBlockSettings);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LANGUAGE_EVENT, onLanguage);
      window.removeEventListener(ACTIVE_SESSION_EVENT, onActiveSession);
      window.removeEventListener(WORKSPACE_MODE_EVENT, onWorkspaceMode);
      window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, onSidebarCollapsed);
      window.removeEventListener(
        CODE_BLOCK_SETTINGS_EVENT,
        onCodeBlockSettings,
      );
    };
    // Re-bound on mode change: both the storage key these handlers match on
    // and the "is this event mine?" test close over the current mode.
  }, [mode]);

  const setTheme = useCallback((nextTheme: Theme) => {
    applyThemePreference(nextTheme);
    setThemeState(nextTheme);
  }, []);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    writeStoredLanguage(nextLanguage);
    setLanguageState(nextLanguage);
  }, []);

  const setActiveSessionId = useCallback(
    (sessionId: string | null) => {
      writeStoredActiveSessionId(sessionId, mode);
      setActiveSessionIdState(sessionId);
    },
    [mode],
  );

  const setMode = useCallback((nextMode: WorkspaceMode) => {
    writeStoredWorkspaceMode(nextMode);
    setModeState(nextMode);
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    writeStoredSidebarCollapsed(collapsed);
    setSidebarCollapsedState(collapsed);
  }, []);

  const setCodeBlockTheme = useCallback((nextTheme: string) => {
    const normalizedTheme = normalizeCodeBlockTheme(nextTheme);
    writeStoredCodeBlockTheme(normalizedTheme);
    setCodeBlockThemeState(normalizedTheme);
  }, []);

  const setCodeBlockShowLineNumbers = useCallback((show: boolean) => {
    writeStoredCodeBlockShowLineNumbers(show);
    setCodeBlockShowLineNumbersState(show);
  }, []);

  const setCodeBlockWrapLongLines = useCallback((wrap: boolean) => {
    writeStoredCodeBlockWrapLongLines(wrap);
    setCodeBlockWrapLongLinesState(wrap);
  }, []);

  const value = useMemo<AppShellContextValue>(
    () => ({
      theme,
      setTheme,
      language,
      setLanguage,
      mode,
      setMode,
      activeSessionId,
      setActiveSessionId,
      sidebarCollapsed,
      setSidebarCollapsed,
      codeBlockTheme,
      setCodeBlockTheme,
      codeBlockShowLineNumbers,
      setCodeBlockShowLineNumbers,
      codeBlockWrapLongLines,
      setCodeBlockWrapLongLines,
    }),
    [
      activeSessionId,
      codeBlockShowLineNumbers,
      codeBlockTheme,
      codeBlockWrapLongLines,
      language,
      mode,
      setActiveSessionId,
      setCodeBlockShowLineNumbers,
      setCodeBlockTheme,
      setCodeBlockWrapLongLines,
      setLanguage,
      setMode,
      setSidebarCollapsed,
      setTheme,
      sidebarCollapsed,
      theme,
    ],
  );

  return (
    <AppShellContext.Provider value={value}>
      {children}
    </AppShellContext.Provider>
  );
}

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error("useAppShell must be used inside AppShellProvider");
  }
  return context;
}
