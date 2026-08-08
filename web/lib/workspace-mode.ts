/**
 * Workspace mode — the top-level split between the General workspace and the
 * Tutor workspace.
 *
 * A mode is *not* a second application. Both modes share the same chat engine,
 * the same WebSocket protocol, the same turn runtime and the same session
 * store. A mode only decides three things:
 *
 *   1. which navigation table the sidebar renders,
 *   2. which capabilities / tools the composer offers, and
 *   3. which slice of the session history "Recents" is allowed to show.
 *
 * Authority rule
 * --------------
 * The chat routes own the mode: landing on ``/home`` *is* being in General and
 * landing on ``/tutor`` *is* being in Tutor, so a pasted link always resolves
 * to the workspace it belongs to. Every other route (Learning Space, Book,
 * Knowledge Center, Memory, Settings) is deliberately **mode-agnostic** — it is
 * reachable from both workspaces and must not disturb the mode the user is in.
 * That is why the mode has to live in client state rather than be derived from
 * the URL on every render: ``/space/questions`` genuinely carries no
 * information about which sidebar belongs next to it.
 */

import {
  BookOpen,
  Bot,
  Brain,
  GraduationCap,
  HeartHandshake,
  House,
  LayoutGrid,
  Library,
  ListChecks,
  NotebookPen,
  PenLine,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { Capability } from "@/lib/capability-routes";

export type WorkspaceMode = "general" | "tutor";

export const WORKSPACE_MODES: readonly WorkspaceMode[] = [
  "general",
  "tutor",
] as const;

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "general";

export function normalizeWorkspaceMode(
  value: string | null | undefined,
): WorkspaceMode {
  return value === "tutor" ? "tutor" : DEFAULT_WORKSPACE_MODE;
}

/** The chat route that owns each mode. Also each mode's "reset to a fresh
 *  session" destination. */
export const MODE_CHAT_ROOT: Record<WorkspaceMode, string> = {
  general: "/home",
  tutor: "/tutor",
};

export const MODE_LABEL: Record<WorkspaceMode, string> = {
  general: "General",
  tutor: "Tutor",
};

export const MODE_ICON: Record<WorkspaceMode, LucideIcon> = {
  general: House,
  tutor: GraduationCap,
};

/** Path of a chat session inside a mode; the session root when id is absent. */
export function chatPathForMode(
  mode: WorkspaceMode,
  sessionId?: string | null,
): string {
  const root = MODE_CHAT_ROOT[mode];
  return sessionId ? `${root}/${sessionId}` : root;
}

/**
 * The mode a pathname *asserts*, or null when the route is shared.
 *
 * Null is the meaningful answer here, not a failure: shared routes must leave
 * the current mode untouched, so callers distinguish "this URL demands General"
 * from "this URL has no opinion".
 */
export function modeFromPathname(
  pathname: string | null | undefined,
): WorkspaceMode | null {
  if (!pathname) return null;
  for (const mode of WORKSPACE_MODES) {
    const root = MODE_CHAT_ROOT[mode];
    if (pathname === root || pathname.startsWith(`${root}/`)) return mode;
  }
  return null;
}

export interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  tooltipKey?: string;
  /** Model capability this feature needs; locked when the user lacks it. */
  requires?: Capability;
  /**
   * Clicking this entry resets to a fresh chat session instead of a plain
   * navigation (the mode's chat root). Only the entry that *is* the mode's
   * chat root sets this.
   */
  isChatRoot?: boolean;
  /** Optional live counter shown as a badge, resolved by the sidebar. */
  badge?: "tutor-due";
}

interface ModeNav {
  primary: NavEntry[];
  secondary: NavEntry[];
}

/* ------------------------------------------------------------------ */
/*  Shared entries                                                    */
/* ------------------------------------------------------------------ */

/* Consoles rather than daily workspaces, and reachable from either mode, so
   both navigation tables end in the same three rows. Never gated: memory,
   embedding and search are shared infrastructure with no per-user grant. */
const SHARED_SECONDARY: NavEntry[] = [
  {
    href: "/memory",
    label: "Memory",
    icon: Brain,
    tooltipKey: "Memory tooltip",
  },
  {
    href: "/knowledge",
    label: "Knowledge Center",
    icon: BookOpen,
    tooltipKey: "Knowledge tooltip",
  },
  { href: "/settings", label: "Settings", icon: Settings },
];

/* ------------------------------------------------------------------ */
/*  Navigation per mode                                               */
/* ------------------------------------------------------------------ */

/**
 * Tutor deliberately points at the *existing* Learning Space and Book routes
 * rather than owning copies of them. Those surfaces stay reachable from
 * General too — a Tutor entry is a shortcut into shared territory, not a
 * relocation. The only route Tutor owns outright is its own chat root.
 */
export const NAV_BY_MODE: Record<WorkspaceMode, ModeNav> = {
  general: {
    primary: [
      {
        href: "/home",
        label: "Home",
        icon: House,
        tooltipKey: "Home tooltip",
        requires: "llm",
        isChatRoot: true,
      },
      {
        href: "/partners",
        label: "Partners",
        icon: HeartHandshake,
        tooltipKey: "Partners tooltip",
        requires: "llm",
      },
      {
        // Connect a live local Claude Code / Codex to consult in chat, and
        // manage imported agent conversations. Ungated — managing connections
        // and imports needs no per-user model grant.
        href: "/agents",
        label: "My Agents",
        icon: Bot,
        tooltipKey: "Agents tooltip",
      },
      {
        href: "/co-writer",
        label: "Co-Writer",
        icon: PenLine,
        tooltipKey: "Co-Writer tooltip",
        requires: "llm",
      },
      {
        href: "/book",
        label: "Book",
        icon: Library,
        tooltipKey: "Book tooltip",
        requires: "llm",
      },
      {
        href: "/space",
        label: "Learning Space",
        icon: LayoutGrid,
        tooltipKey: "Space tooltip",
      },
    ],
    secondary: SHARED_SECONDARY,
  },
  tutor: {
    primary: [
      {
        href: "/tutor",
        label: "Today",
        icon: Sun,
        tooltipKey: "Today tooltip",
        requires: "llm",
        isChatRoot: true,
        badge: "tutor-due",
      },
      {
        href: "/space/learning",
        label: "Mastery Path",
        icon: GraduationCap,
        tooltipKey: "Mastery Path tooltip",
        requires: "llm",
      },
      {
        href: "/book",
        label: "Book",
        icon: Library,
        tooltipKey: "Book tooltip",
        requires: "llm",
      },
      {
        href: "/space/questions",
        label: "Question Bank",
        icon: ListChecks,
        tooltipKey: "Question Bank tooltip",
      },
      {
        href: "/space/notebooks",
        label: "Mistakes",
        icon: NotebookPen,
        tooltipKey: "Mistakes tooltip",
      },
    ],
    secondary: SHARED_SECONDARY,
  },
};

export function navForMode(mode: WorkspaceMode): ModeNav {
  return NAV_BY_MODE[mode] ?? NAV_BY_MODE[DEFAULT_WORKSPACE_MODE];
}
