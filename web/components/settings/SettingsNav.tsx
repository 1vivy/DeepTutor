"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  LayoutGrid,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { fetchAuthStatus } from "@/lib/auth";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_HUB_HREF,
  type Lang,
  type SettingsLeaf,
} from "@/lib/settings-nav";
import { serviceReadiness, useSettings } from "./SettingsContext";

/**
 * The settings navigator — one persistent column, every page one click away.
 *
 * Settings used to be a folder tree: the hub listed seven categories, four of
 * those opened a second grid, and the leaf was the third click. Changing two
 * things in different categories meant walking back up to the root in between,
 * because nothing but a breadcrumb ever showed where else you could go. Every
 * comparable product — VS Code, Slack, GitHub, Stripe, Dify, Open WebUI —
 * keeps the whole map on screen instead, and so does this.
 *
 * Search filters to matching pages rather than opening a separate results
 * view: with two dozen pages the question is almost always "which page is that
 * on", and the answer is more useful in place.
 */

type Row = { leaf: SettingsLeaf; category: Lang };

type Group = {
  key: string;
  label: Lang;
  rows: Row[];
  standalone: boolean;
};

/**
 * The same map both layouts render. A category with children contributes its
 * leaves; one without is itself a row, so a single-page category never costs
 * an extra level of nesting.
 */
function useGroups(hideAdminOnly: boolean): Group[] {
  return useMemo(
    () =>
      SETTINGS_CATEGORIES.map((category) => ({
        key: category.key,
        label: category.label,
        rows: (
          category.children ?? [
            {
              key: category.key,
              href: category.href,
              label: category.label,
              blurb: category.blurb,
              icon: category.icon,
              tile: "",
            } satisfies SettingsLeaf,
          ]
        )
          .filter((leaf) => !(leaf.adminOnly && hideAdminOnly))
          .map((leaf) => ({ leaf, category: category.label }) satisfies Row),
        standalone: !category.children,
      })),
    [hideAdminOnly],
  );
}

function useHideAdminOnly(): boolean {
  const [hideAdminOnly, setHideAdminOnly] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchAuthStatus().then((authStatus) => {
      if (cancelled || !authStatus) return;
      setHideAdminOnly(Boolean(authStatus.enabled) && !authStatus.is_admin);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return hideAdminOnly;
}

/**
 * Narrow-screen navigator.
 *
 * The column is hidden below `md`, and the breadcrumb it replaced is gone, so
 * without this a phone landing on a settings page has no way back to any other
 * one. A native select is the right control here: it groups, it is one tap,
 * and the platform renders it better than anything reimplemented.
 */
export function SettingsNavCompact() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.toLowerCase().startsWith("zh");
  const tr = (value: Lang) => (zh ? value.zh : value.en);
  const groups = useGroups(useHideAdminOnly());

  return (
    <div className="relative md:hidden">
      <select
        value={pathname}
        aria-label={t("Settings sections")}
        onChange={(event) => router.push(event.target.value)}
        className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-3 pr-8 text-[13px] font-medium text-[var(--foreground)] outline-none"
      >
        <option value={SETTINGS_HUB_HREF}>{t("Overview")}</option>
        {groups.map((group) =>
          group.standalone ? (
            <option key={group.key} value={group.rows[0]?.leaf.href}>
              {tr(group.label)}
            </option>
          ) : (
            <optgroup key={group.key} label={tr(group.label)}>
              {group.rows.map(({ leaf }) => (
                <option key={leaf.key} value={leaf.href}>
                  {tr(leaf.label)}
                </option>
              ))}
            </optgroup>
          ),
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
    </div>
  );
}

export default function SettingsNav() {
  const pathname = usePathname() ?? "";
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.toLowerCase().startsWith("zh");
  const tr = useCallback((value: Lang) => (zh ? value.zh : value.en), [zh]);
  const { catalog, catalogEditable, diagnosticsResults } = useSettings();

  const [query, setQuery] = useState("");
  const groups = useGroups(useHideAdminOnly());

  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (row: Row) =>
      !needle ||
      [row.leaf.label.en, row.leaf.label.zh, row.leaf.blurb.en, row.leaf.blurb.zh]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    [needle],
  );

  const visible = groups
    .map((group) => ({ ...group, rows: group.rows.filter(matches) }))
    .filter((group) => group.rows.length > 0);

  // Only the failure state earns a mark here: "not configured yet" is the
  // normal state of most of these services and would dot half the column.
  const failing = useCallback(
    (leaf: SettingsLeaf) =>
      leaf.service !== undefined &&
      catalogEditable === true &&
      serviceReadiness(catalog, leaf.service, diagnosticsResults) === "failed",
    [catalog, catalogEditable, diagnosticsResults],
  );

  return (
    <nav
      aria-label={t("Settings sections")}
      className="flex h-full w-[212px] shrink-0 flex-col overflow-y-auto px-1 pb-8"
    >
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]/50" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search settings")}
          aria-label={t("Search settings")}
          className="w-full rounded-lg bg-[var(--accent)]/60 py-1.5 pl-8 pr-7 text-[13px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/50 focus:bg-[var(--accent)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("Clear")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <Row
        href={SETTINGS_HUB_HREF}
        label={t("Overview")}
        icon={LayoutGrid}
        active={pathname === SETTINGS_HUB_HREF}
        tourId="tour-nav-overview"
      />

      {visible.length === 0 && (
        <p className="px-2.5 pt-2 text-[12px] leading-relaxed text-[var(--muted-foreground)]">
          {t("No settings match “{{query}}”.", { query: query.trim() })}
        </p>
      )}

      {visible.map((group) => (
        <div key={group.key} className="mt-3.5 first:mt-3">
          {!group.standalone && (
            <div className="px-2.5 pb-1 text-[11.5px] font-normal text-[var(--muted-foreground)]/60">
              {tr(group.label)}
            </div>
          )}
          <div className="space-y-px">
            {group.rows.map(({ leaf }, index) => (
              <Row
                key={leaf.key}
                href={leaf.href}
                label={tr(leaf.label)}
                icon={leaf.icon}
                active={pathname === leaf.href}
                failing={failing(leaf)}
                hint={tr(leaf.blurb)}
                tourId={index === 0 ? `tour-nav-${group.key}` : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * One row, in the app sidebar's language rather than an invented one: the same
 * icon + label pairing, radius, padding and accent-tinted active state that
 * `SidebarShell` uses, a half-step smaller because this is second-level
 * navigation. Without the icon the column was a wall of text with nothing to
 * aim at, and every page already declares one in `settings-nav.ts`.
 */
function Row({
  href,
  label,
  icon: Icon,
  active,
  failing,
  hint,
  tourId,
}: {
  href: string;
  label: string;
  icon?: LucideIcon;
  active: boolean;
  failing?: boolean;
  /** The one-line description the old sub-hub tiles showed under each name. */
  hint?: string;
  /** Only the first row of a group carries it, so the tour lands on the group. */
  tourId?: string;
}) {
  return (
    <Link
      href={href}
      data-tour={tourId}
      title={hint}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] leading-tight transition-colors ${
        active
          ? "bg-[var(--accent)] font-medium text-[var(--foreground)]"
          : "text-[var(--foreground)]/70 hover:bg-[var(--accent)]/50 hover:text-[var(--foreground)]"
      }`}
    >
      {Icon && (
        <Icon
          size={15}
          className={`shrink-0 ${active ? "" : "opacity-70"}`}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {failing && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400"
        />
      )}
    </Link>
  );
}
