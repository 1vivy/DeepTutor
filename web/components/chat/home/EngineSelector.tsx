"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLingerExpand } from "@/hooks/use-linger-expand";

export interface EngineOption {
  /** ``null`` is DeepTutor's own loop — always available, always first. */
  kind: string | null;
  label: string;
  /** Set when a connectable CLI was detected but isn't installed/reachable. */
  unavailable?: boolean;
}

/**
 * Picks what drives this turn's loop: DeepTutor's own agent loop (default),
 * or a connected local CLI (Codex today) running with DeepTutor's tools and
 * context bridged in over a turn-scoped MCP server — see
 * ``deeptutor/core/engine/`` on the backend.
 *
 * Sibling of ``AgentSelector`` (same lingering-pill-plus-dropdown shape), but
 * a different axis: AgentSelector consults a connected agent as a *tool*
 * mid-turn; this picks what *drives* the whole turn. Only rendered once more
 * than the default option exists (i.e. a CLI engine was detected) — no
 * DeepTutor-only control for every user who has never connected a CLI.
 */
export default function EngineSelector({
  options,
  value,
  onChange,
  placement = "top",
}: {
  /** Always includes the DeepTutor default (``kind: null``) plus 1+ CLIs. */
  options: EngineOption[];
  value: string | null;
  onChange: (kind: string | null) => void;
  placement?: "top" | "bottom";
}) {
  const { t } = useTranslation();
  const [open, setOpenState] = useState(false);
  const { expanded, linger, triggerProps: lingerProps } = useLingerExpand(open);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) linger();
  };
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = options.find((o) => o.kind === value) ?? options[0];
  const isDefault = !selected || selected.kind === null;
  const menuPlacementClass =
    placement === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t("Select the engine driving this turn")}
        aria-expanded={open}
        {...lingerProps}
        className={`inline-flex h-8 shrink-0 items-center rounded-lg px-2 text-[14px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
          open
            ? "bg-[var(--muted)] text-[var(--foreground)]"
            : !isDefault
              ? "text-[var(--primary)] hover:bg-[var(--primary)]/[0.07]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/55 hover:text-[var(--foreground)]"
        }`}
      >
        {isDefault ? (
          <Cpu size={16} strokeWidth={1.7} className="shrink-0" />
        ) : (
          <Terminal size={16} strokeWidth={1.7} className="shrink-0" />
        )}
        <span
          className={`flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin-left] duration-300 ease-out ${
            expanded
              ? "ml-1.5 max-w-[160px] opacity-100"
              : "ml-0 max-w-0 opacity-0"
          }`}
        >
          <span className="min-w-0 truncate">
            {selected?.label ?? t("DeepTutor")}
          </span>
          <ChevronDown
            size={13}
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div
          className={`dt-popup-up absolute right-0 z-50 ${menuPlacementClass} w-[min(240px,calc(100vw-32px))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--popover)] shadow-lg backdrop-blur-md`}
        >
          <div className="max-h-[280px] overflow-y-auto py-1">
            {options.map((option) => {
              const active = option.kind === (selected?.kind ?? null);
              const Glyph = option.kind === null ? Cpu : Terminal;
              return (
                <button
                  key={option.kind ?? "deeptutor"}
                  type="button"
                  disabled={option.unavailable}
                  onClick={() => {
                    onChange(option.kind);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors disabled:opacity-40 ${
                    active
                      ? "bg-[var(--primary)]/[0.06]"
                      : "hover:bg-[var(--muted)]/45"
                  }`}
                >
                  <Glyph size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--foreground)]">
                    {option.label}
                  </span>
                  {option.unavailable && (
                    <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                      {t("not installed")}
                    </span>
                  )}
                  {active && !option.unavailable && (
                    <Check
                      size={14}
                      strokeWidth={2}
                      className="shrink-0 text-[var(--primary)]"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
