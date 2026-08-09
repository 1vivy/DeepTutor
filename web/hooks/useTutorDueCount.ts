"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";

/**
 * How many review items are due right now across every learning path.
 *
 * Drives the Tutor sidebar's badge. Returns ``null`` whenever there is nothing
 * to show — disabled, still loading, backend unreachable, or a genuine zero —
 * so the caller renders no badge at all rather than a "0" that reads like a
 * broken counter.
 */
export function useTutorDueCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch(apiUrl("/api/v1/learning/today"), {
          signal: controller.signal,
          cache: "no-store",
          skipAuthRedirect: true,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { due_count?: unknown };
        const due = Number(payload.due_count ?? 0);
        setCount(Number.isFinite(due) && due > 0 ? due : null);
      } catch {
        // Offline, unauthenticated, or aborted: leave the badge off.
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  // Gated on read rather than cleared in the effect: a stale count from the
  // last time Tutor was active must not leak into General's sidebar, and
  // clearing it in the effect body would cost an extra render pass.
  return enabled ? count : null;
}
