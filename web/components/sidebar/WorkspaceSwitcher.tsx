"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  MODE_ICON,
  MODE_LABEL,
  WORKSPACE_MODES,
  type WorkspaceMode,
} from "@/lib/workspace-mode";

interface WorkspaceSwitcherProps {
  mode: WorkspaceMode;
  onSelect: (mode: WorkspaceMode) => void;
  /**
   * The expanded sidebar sits the two workspaces side by side; the collapsed
   * rail stacks them and drops the labels, so the pill slides on Y instead.
   */
  orientation?: "horizontal" | "vertical";
}

/**
 * The General / Tutor segmented control.
 *
 * A single pill slides between the two positions rather than a background
 * blinking from one button to the other — that motion is what makes the pair
 * read as one control with two states instead of two competing buttons. The
 * track / thumb colors live in ``globals.css`` (``.ws-track`` / ``.ws-thumb``)
 * because light and dark themes invert which token is the raised surface.
 */
export function WorkspaceSwitcher({
  mode,
  onSelect,
  orientation = "horizontal",
}: WorkspaceSwitcherProps) {
  const { t } = useTranslation();
  const vertical = orientation === "vertical";
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, WORKSPACE_MODES.indexOf(mode));

  // The stored workspace preference only arrives after hydration, so the mode
  // can legitimately flip on the second paint. Sliding for *that* looks like a
  // glitch, so the thumb stays put until a selection is actually made here.
  const [animated, setAnimated] = useState(false);

  const select = (next: WorkspaceMode) => {
    setAnimated(true);
    onSelect(next);
  };

  // Arrow keys move between the two positions, the way a segmented control is
  // expected to behave. Focus follows the selection so repeated presses keep
  // working against the roving tabindex.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    const delta = event.key === forward ? 1 : -1;
    const nextIndex =
      (activeIndex + delta + WORKSPACE_MODES.length) % WORKSPACE_MODES.length;
    tabsRef.current[nextIndex]?.focus();
    select(WORKSPACE_MODES[nextIndex]);
  };

  return (
    <div
      role="tablist"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={t("Workspace") as string}
      onKeyDown={handleKeyDown}
      className={`ws-track relative grid rounded-[10px] p-[3px] ${
        vertical ? "grid-rows-2" : "grid-cols-2"
      }`}
    >
      <span
        aria-hidden
        className={`ws-thumb pointer-events-none absolute rounded-[7px] ${
          vertical
            ? "inset-x-[3px] top-[3px] h-[calc(50%-3px)]"
            : "inset-y-[3px] left-[3px] w-[calc(50%-3px)]"
        } ${
          animated
            ? "transition-transform duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
            : ""
        } ${activeIndex === 0 ? "" : vertical ? "translate-y-full" : "translate-x-full"}`}
      />
      {WORKSPACE_MODES.map((entry, index) => {
        const Icon = MODE_ICON[entry];
        const isActive = entry === mode;
        const label = t(MODE_LABEL[entry]) as string;
        const tab = (
          <button
            key={entry}
            ref={(node) => {
              tabsRef.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            aria-label={vertical ? label : undefined}
            onClick={() => select(entry)}
            className={`relative z-10 flex items-center justify-center rounded-[7px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
              vertical ? "h-7 w-full" : "h-6 gap-1.5 text-[12.5px]"
            } ${
              isActive
                ? "font-medium text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-[var(--foreground)]"
            }`}
          >
            <Icon size={vertical ? 15 : 14} strokeWidth={isActive ? 1.9 : 1.6} />
            {vertical ? null : <span>{label}</span>}
          </button>
        );
        return vertical ? (
          <Tooltip key={entry} label={label} side="right">
            {tab}
          </Tooltip>
        ) : (
          tab
        );
      })}
    </div>
  );
}
