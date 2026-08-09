"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

interface GreetingPayload {
  text: string;
  language: string;
  generated_at: number;
  /** True when the backend is regenerating this line in the background. */
  stale: boolean;
}

/**
 * How long to wait before re-reading a line the backend said was stale.
 *
 * The backend answers instantly with the previous line and regenerates behind
 * the request, so the fresh one exists a moment later. One delayed re-read
 * picks it up without polling.
 */
const RESETTLE_MS = 3500;

/**
 * The Tutor workspace's opening line.
 *
 * Replaces "Good morning." — which told the learner something they already
 * knew — with a line generated from what they have actually been working on
 * ("Ready to nail how LangGraph nodes work?"). Generation, caching and its
 * staleness rules live on the backend; this only renders the line and offers
 * the refresh.
 */
export default function TutorGreeting() {
  const { t, i18n } = useTranslation();
  const language = i18n.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
  const [text, setText] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<GreetingPayload | null> => {
      try {
        const response = await apiFetch(
          apiUrl(`/api/v1/tutor/greeting?language=${language}`),
          { signal, cache: "no-store" },
        );
        if (!response.ok) return null;
        return (await response.json()) as GreetingPayload;
      } catch {
        return null;
      }
    },
    [language],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const payload = await load(controller.signal);
      if (!payload) return;
      setText(payload.text);
      if (!payload.stale) return;
      // A fresher line is being generated; collect it once rather than poll.
      timerRef.current = setTimeout(() => {
        void load(controller.signal).then((next) => {
          if (next?.text) setText(next.text);
        });
      }, RESETTLE_MS);
    })();
    return () => {
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await apiFetch(
        apiUrl(`/api/v1/tutor/greeting/refresh?language=${language}`),
        { method: "POST" },
      );
      if (response.ok) {
        const payload = (await response.json()) as GreetingPayload;
        if (payload.text) setText(payload.text);
      }
    } catch {
      // Keep whatever is on screen — a failed reroll is not worth an error.
    } finally {
      setRefreshing(false);
    }
  }, [language]);

  // Render nothing until there is a line: a skeleton heading flashing into
  // different text is worse than the text simply appearing.
  if (!text) return null;

  return (
    <div className="group/greeting flex items-center justify-center gap-2">
      <h1 className="text-balance text-center font-serif text-[32px] font-medium leading-[1.15] tracking-[-0.015em] text-[var(--foreground)]">
        {text}
      </h1>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={refreshing}
        title={t("Suggest something else")}
        aria-label={t("Suggest something else")}
        className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)]/40 opacity-0 transition-all hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:opacity-100 disabled:opacity-40 group-hover/greeting:opacity-100"
      >
        <RefreshCw
          size={14}
          strokeWidth={1.8}
          className={refreshing ? "animate-spin" : ""}
        />
      </button>
    </div>
  );
}
