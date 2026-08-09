"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAppShell } from "@/context/AppShellContext";
import {
  BookText,
  ChevronDown,
  Github,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import SessionList from "@/components/SessionList";
import { useSidebarDrawer } from "@/components/layout/AppShell";
import { useDevice } from "@/hooks/useDevice";
import { VersionBadge } from "@/components/sidebar/VersionBadge";
import type { SessionSummary } from "@/lib/session-api";
import { Tooltip } from "@/components/ui/Tooltip";
import { useCapabilityAccess } from "@/components/access/CapabilityAccessContext";
import { useTutorDueCount } from "@/hooks/useTutorDueCount";
import { WorkspaceSwitcher } from "@/components/sidebar/WorkspaceSwitcher";
import {
  chatPathForMode,
  modeCoversPath,
  navForMode,
  type NavEntry,
  type WorkspaceMode,
} from "@/lib/workspace-mode";

const GITHUB_REPO_URL = "https://github.com/HKUDS/DeepTutor";
const DOCS_URL = "https://deeptutor.info/";
const RECENTS_COLLAPSED_KEY = "deeptutor.sidebar.recentsCollapsed";

interface SidebarShellProps {
  sessions?: SessionSummary[];
  activeSessionId?: string | null;
  loadingSessions?: boolean;
  showSessions?: boolean;
  /** Clicking the Chat nav item resets to a fresh session via this handler. */
  onNewChat?: () => void;
  onSelectSession?: (sessionId: string) => void | Promise<void>;
  onRenameSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  /**
   * Footer content rendered below the nav. Pass a render function to receive
   * the current ``collapsed`` state so footer items (e.g. Admin / Sign out) can
   * switch to their icon-only variant when the rail is collapsed.
   */
  footerSlot?: ReactNode | ((collapsed: boolean) => ReactNode);
}

export function SidebarShell({
  sessions = [],
  activeSessionId = null,
  loadingSessions = false,
  showSessions = false,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  footerSlot,
}: SidebarShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { has } = useCapabilityAccess();
  const {
    sidebarCollapsed,
    setSidebarCollapsed: setCollapsed,
    mode,
    setMode,
  } = useAppShell();
  const { isMobile } = useDevice();
  const drawer = useSidebarDrawer();
  const { primary: primaryNav, secondary: secondaryNav } = navForMode(mode);
  const dueCount = useTutorDueCount(mode === "tutor");

  // Inside the mobile drawer the icon-only rail is pointless — the panel is
  // already hidden when you don't want it, so it always opens fully expanded
  // regardless of the persisted desktop preference.
  const collapsed = sidebarCollapsed && !isMobile;

  /** Dismiss the drawer on nav clicks that actually navigate in-place. */
  const closeDrawerOnNav = (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
      return;
    drawer?.close();
  };

  const navLocked = (item: NavEntry) =>
    item.requires ? !has(item.requires) : false;
  // Chatting needs a model, so the New chat action carries the same grant gate
  // the chat-root nav rows used to.
  const newChatLocked = !has("llm");
  const lockedTooltip = t("Locked — contact your administrator to get access.");
  const renderedFooter =
    typeof footerSlot === "function" ? footerSlot(collapsed) : footerSlot;
  const [recentsCollapsed, setRecentsCollapsed] = useState(false);

  // Hydrate Recents collapse from localStorage after first render to stay SSR-safe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentsCollapsed(
      window.localStorage.getItem(RECENTS_COLLAPSED_KEY) === "1",
    );
  }, []);

  const toggleRecents = () => {
    setRecentsCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENTS_COLLAPSED_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  // Clicking the mode's own chat root always resets to a fresh session
  // (mirrors the old "New Chat" affordance); modifier-clicks fall through to
  // default Link behavior so middle-click open-in-new-tab still works.
  const handleChatRootClick = (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
      return;
    event.preventDefault();
    drawer?.close();
    onNewChat?.();
    router.push(chatPathForMode(mode));
  };

  // The New chat action, for workspaces that offer no chat-root nav row.
  // Lands on the empty chat route; the page rewrites the URL to the session's
  // own path once the first message binds a session.
  const handleNewChatClick = () => {
    drawer?.close();
    onNewChat?.();
    router.push(chatPathForMode(mode));
  };

  // Switching workspace holds the current page whenever the destination
  // sidebar has an entry covering it — Book, Knowledge Center, Settings and the
  // Learning Space routes are in both tables, and being bounced to a chat root
  // from one of them throws away the page for nothing. Only a route the new
  // workspace genuinely cannot show falls back to its chat root.
  const switchMode = (next: WorkspaceMode) => {
    if (next === mode) return;
    drawer?.close();
    setMode(next);
    if (modeCoversPath(next, pathname)) return;
    onNewChat?.();
    router.push(chatPathForMode(next));
  };

  const badgeCount = (item: NavEntry) =>
    item.badge === "tutor-due" ? dueCount : null;

  /* ---- Collapsed state ---- */
  if (collapsed) {
    return (
      <aside className="group/sb relative flex h-dvh w-[60px] shrink-0 flex-col items-center bg-[var(--secondary)] py-3 transition-all duration-200">
        {/* Header: logo + collapse toggle (toggle replaces logo on hover) */}
        <div className="relative mb-2 flex h-9 w-9 items-center justify-center">
          <Link
            href="/"
            aria-label="DeepTutor"
            className="flex items-center justify-center transition-opacity duration-150 group-hover/sb:opacity-0"
          >
            <Image
              src="/logo.png"
              alt="DeepTutor"
              width={22}
              height={22}
              className="h-[22px] w-[22px] rounded-md"
            />
          </Link>
          <button
            onClick={() => setCollapsed(false)}
            className="absolute inset-0 flex items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all duration-150 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)] group-hover/sb:opacity-100"
            aria-label={t("Expand sidebar")}
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>

        {/* Workspace switcher — the same control as the expanded sidebar,
            stacked and label-less. It carries its own track, so the rail needs
            no extra rule between it and the nav. */}
        {/* w-9 matches the rail's nav buttons, so the track lines up with the
            column of icons below it rather than bulging past it. */}
        <div className="mb-2 w-9">
          <WorkspaceSwitcher
            mode={mode}
            onSelect={switchMode}
            orientation="vertical"
          />
        </div>

        {/* Same action as the expanded rail's, reduced to its glyph. */}
        <div className="mb-1.5">
          <Tooltip
            label={t("New chat")}
            description={newChatLocked ? lockedTooltip : undefined}
            side="right"
          >
            {newChatLocked ? (
              <div
                aria-label={`${t("New chat")} — ${lockedTooltip}`}
                aria-disabled
                className="relative flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl text-[var(--muted-foreground)]/40"
              >
                <Plus size={18} strokeWidth={1.7} />
              </div>
            ) : (
              <button
                type="button"
                onClick={handleNewChatClick}
                aria-label={t("New chat")}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                <Plus size={18} strokeWidth={1.7} />
              </button>
            )}
          </Tooltip>
        </div>

        {/* Primary nav */}
        <nav className="flex w-full flex-col items-center gap-1 px-1.5">
          {primaryNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const locked = navLocked(item);
            const description = locked
              ? lockedTooltip
              : item.tooltipKey
                ? t(item.tooltipKey)
                : undefined;
            if (locked) {
              return (
                <Tooltip
                  key={item.href}
                  label={t(item.label)}
                  description={description}
                  side="right"
                >
                  <div
                    aria-label={`${t(item.label)} — ${lockedTooltip}`}
                    aria-disabled
                    className="relative flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl text-[var(--muted-foreground)]/40"
                  >
                    <item.icon size={18} strokeWidth={1.6} />
                    <Lock
                      size={10}
                      strokeWidth={2}
                      className="absolute bottom-1 right-1 text-[var(--muted-foreground)]/70"
                    />
                  </div>
                </Tooltip>
              );
            }
            return (
              <Tooltip
                key={item.href}
                label={t(item.label)}
                description={description}
                side="right"
              >
                <Link
                  href={item.href}
                  onClick={item.isChatRoot ? handleChatRootClick : undefined}
                  aria-label={t(item.label)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                    active
                      ? "bg-[var(--accent)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
                  }`}
                >
                  <item.icon size={18} strokeWidth={active ? 2 : 1.6} />
                  {badgeCount(item) ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[9px] font-medium leading-none text-[var(--primary-foreground)]">
                      {badgeCount(item)}
                    </span>
                  ) : null}
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Secondary nav + footer */}
        <div className="flex w-full flex-col items-center gap-1 px-1.5">
          <div className="my-1 h-px w-7 bg-[color-mix(in_srgb,var(--border)_60%,transparent)]" />
          {secondaryNav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={t(item.label) as string}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                  active
                    ? "bg-[var(--accent)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
                }`}
              >
                <item.icon size={18} strokeWidth={active ? 2 : 1.6} />
              </Link>
            );
          })}
          {renderedFooter}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            title={t("Docs") as string}
            aria-label={t("Docs") as string}
            className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl text-[var(--muted-foreground)]/70 transition-colors hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
          >
            <BookText size={15} strokeWidth={1.6} />
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="GitHub"
            aria-label="GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--muted-foreground)]/70 transition-colors hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
          >
            <Github size={15} strokeWidth={1.6} />
          </a>
          <VersionBadge collapsed />
        </div>
      </aside>
    );
  }

  /* ---- Expanded state ---- */
  return (
    <aside className="flex w-[220px] h-dvh shrink-0 flex-col bg-[var(--secondary)] transition-all duration-200">
      {/* Header: logo + collapse toggle */}
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="group flex items-center gap-1.5">
          <Image
            src="/logo.png"
            alt="DeepTutor"
            width={22}
            height={22}
            className="h-[22px] w-[22px] transition-transform duration-200 group-hover:scale-105"
          />
          <Image
            src="/banner.png"
            alt="DeepTutor"
            width={897}
            height={236}
            priority
            className="h-[22px] w-auto transition-transform duration-200 group-hover:scale-105"
          />
        </Link>
        {/* The rail is a desktop affordance; in the drawer the scrim and the
            top-bar toggle already own "make this go away". */}
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] max-md:hidden"
          aria-label={t("Collapse sidebar")}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {/* Workspace switcher — the General / Tutor split */}
      <div className="mx-2 mb-2.5">
        <WorkspaceSwitcher mode={mode} onSelect={switchMode} />
      </div>

      {/* Starting a conversation is an action, not a destination, so it sits
          between the switcher and the nav rather than among the pages. It also
          reads as "new chat in the workspace I just picked", which is exactly
          what it does. */}
      <div className="mx-2 mb-1.5">
        {newChatLocked ? (
          <Tooltip label={t("New chat")} description={lockedTooltip} side="right">
            <div
              aria-label={`${t("New chat")} — ${lockedTooltip}`}
              aria-disabled
              className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[var(--muted-foreground)]/40"
            >
              <Plus size={16} strokeWidth={1.8} />
              <span>{t("New chat")}</span>
              <Lock size={13} strokeWidth={1.8} className="ml-auto" />
            </div>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={handleNewChatClick}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
          >
            <Plus size={16} strokeWidth={1.8} />
            <span>{t("New chat")}</span>
          </button>
        )}
      </div>

      {/* Primary nav */}
      <nav className="px-2">
        <div className="space-y-px">
          {primaryNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const locked = navLocked(item);
            if (locked) {
              return (
                <Tooltip
                  key={item.href}
                  label={t(item.label)}
                  description={lockedTooltip}
                  side="right"
                >
                  <div
                    aria-label={`${t(item.label)} — ${lockedTooltip}`}
                    aria-disabled
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[var(--muted-foreground)]/40"
                  >
                    <item.icon size={16} strokeWidth={1.5} />
                    <span>{t(item.label)}</span>
                    <Lock size={13} strokeWidth={1.8} className="ml-auto" />
                  </div>
                </Tooltip>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={
                  item.isChatRoot ? handleChatRootClick : closeDrawerOnNav
                }
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                  active
                    ? "bg-[var(--accent)] font-medium text-[var(--foreground)]"
                    : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
                }`}
              >
                <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
                <span>{t(item.label)}</span>
                {badgeCount(item) ? (
                  <span className="ml-auto flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-medium leading-none text-[var(--primary-foreground)]">
                    {badgeCount(item)}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Chat history — its own region below the nav, takes remaining height */}
      {showSessions && onSelectSession && onRenameSession && onDeleteSession ? (
        <section
          className={`mt-4 flex min-h-0 flex-col ${
            recentsCollapsed ? "" : "flex-1"
          }`}
        >
          <button
            type="button"
            onClick={toggleRecents}
            className="group/recents mx-2 flex items-center justify-between rounded-md px-2 py-1 text-left text-[11.5px] font-normal text-[var(--muted-foreground)]/60 transition-colors hover:bg-[var(--background)]/40 hover:text-[var(--muted-foreground)]"
            aria-expanded={!recentsCollapsed}
            aria-label={
              recentsCollapsed
                ? (t("Show recents") as string)
                : (t("Hide recents") as string)
            }
          >
            <span>{t("Recents")}</span>
            <ChevronDown
              size={13}
              strokeWidth={1.7}
              className={`transition-all duration-200 ${
                recentsCollapsed
                  ? "-rotate-90 opacity-60"
                  : "rotate-0 opacity-0 group-hover/recents:opacity-60"
              }`}
            />
          </button>
          {!recentsCollapsed && (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0.5">
              <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                loading={loadingSessions}
                onSelect={(sessionId) => {
                  drawer?.close();
                  return onSelectSession(sessionId);
                }}
                onRename={onRenameSession}
                onDelete={onDeleteSession}
                compact
              />
            </div>
          )}
        </section>
      ) : null}

      {/* When recents is collapsed or unavailable, fill the gap above the footer. */}
      {(!showSessions ||
        !onSelectSession ||
        !onRenameSession ||
        !onDeleteSession ||
        recentsCollapsed) && <div className="flex-1" />}

      {/* Secondary nav + footer */}
      <div className="border-t border-[var(--border)]/40 px-2 py-2">
        {secondaryNav.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeDrawerOnNav}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                active
                  ? "bg-[var(--accent)] font-medium text-[var(--foreground)]"
                  : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
              }`}
            >
              <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
        {renderedFooter}
        <div className="mt-0.5 flex items-center gap-0.5">
          <VersionBadge />
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            title={t("Docs") as string}
            aria-label={t("Docs") as string}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)]/55 transition-colors hover:bg-[var(--background)]/50 hover:text-[var(--muted-foreground)]"
          >
            <BookText size={13} strokeWidth={1.7} />
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="GitHub"
            aria-label="GitHub"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)]/55 transition-colors hover:bg-[var(--background)]/50 hover:text-[var(--muted-foreground)]"
          >
            <Github size={13} strokeWidth={1.7} />
          </a>
        </div>
      </div>
    </aside>
  );
}
