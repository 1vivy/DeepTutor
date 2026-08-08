"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowRight, CircleDashed, NotebookPen, RotateCcw } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

interface DueItem {
  book_id: string;
  book_name: string;
  kp_id: string;
  kp_name: string;
  knowledge_type: string;
  due_at: number;
  priority: number;
}

interface ContinuingItem {
  book_id: string;
  book_name: string;
  module_id: string;
  module_name: string;
  stage: string;
  updated_at: number;
}

interface TodayOverview {
  due_count: number;
  due: DueItem[];
  continuing: ContinuingItem[];
  unresolved_errors: number;
}

/** Backend ``LearningStage`` values, phrased as the learner's next action. */
const STAGE_LABEL: Record<string, string> = {
  diagnostic: "Diagnostic",
  explain: "Learn the concept",
  feynman_check: "Feynman check",
  practice: "Practice",
  error_diagnosis: "Review mistakes",
  review: "Spaced review",
  completed: "Completed",
};

/** Whole days a review item is past due; 0 means it came due today. */
function overdueDays(dueAt: number, now: number): number {
  return Math.max(0, Math.floor((now - dueAt) / 86_400));
}

/**
 * The Tutor workspace's landing surface.
 *
 * General opens on an empty composer because it is demand-driven — you arrive
 * with a question. Learning is state-driven: the useful question on arrival is
 * "what should I study now?", and the spaced-repetition scheduler has been
 * answering it into ``review_queue`` all along without anything ever reading
 * it back. This is that read.
 */
export default function TutorToday({
  onPick,
}: {
  /** Drops a starting prompt into the composer; the learner still sends it. */
  onPick?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<TodayOverview | null>(null);
  const [failed, setFailed] = useState(false);
  // Stamped when the payload lands rather than read during render: a clock
  // call in the render body is impure and makes "overdue by N days" depend on
  // which render you happened to look at.
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch(apiUrl("/api/v1/mastery-path/today"), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          setFailed(true);
          return;
        }
        setData((await response.json()) as TodayOverview);
        setLoadedAt(Date.now() / 1000);
      } catch {
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, []);

  const hasAnything =
    data && (data.due.length > 0 || data.continuing.length > 0);

  return (
    <div className="flex w-full flex-1 min-h-0 justify-center overflow-y-auto px-6 animate-fade-in">
      <div className="w-full max-w-[680px] pb-8 pt-10">
        <h1 className="mb-7 font-serif text-[30px] font-medium leading-[1.15] tracking-[-0.015em] text-[var(--foreground)]">
          {t("What should I study today?")}
        </h1>

        {/* An empty path list is the normal first-run state, not an error —
            say what to do next instead of showing three empty sections. */}
        {!hasAnything ? (
          <div className="rounded-xl border border-[var(--border)]/60 px-5 py-6">
            <p className="text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
              {failed
                ? t("Could not load your learning progress.")
                : t(
                    "No learning path yet. Build one from a book to get a mastery-gated path with spaced review.",
                  )}
            </p>
            <Link
              href="/space/learning"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--foreground)] hover:underline"
            >
              {t("Mastery Path")}
              <ArrowRight size={13} strokeWidth={1.8} />
            </Link>
          </div>
        ) : null}

        {data && data.due.length > 0 ? (
          <section className="mb-7">
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]/70">
                {t("Due for review")}
              </h2>
              <span className="text-[11.5px] text-[var(--muted-foreground)]/60">
                {data.due_count}
              </span>
            </div>
            <div className="space-y-px">
              {data.due.map((item) => (
                <button
                  key={`${item.book_id}:${item.kp_id}`}
                  type="button"
                  onClick={() =>
                    onPick?.(
                      `${t("Review this with me")}: ${item.kp_name} (${item.book_name})`,
                    )
                  }
                  className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--secondary)]"
                >
                  <RotateCcw
                    size={14}
                    strokeWidth={1.6}
                    className="shrink-0 text-[var(--muted-foreground)]/60"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--foreground)]">
                    {item.kp_name}
                  </span>
                  <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-[var(--muted-foreground)]/50">
                    {item.knowledge_type}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--muted-foreground)]/70">
                    {overdueDays(item.due_at, loadedAt) > 0
                      ? t("Overdue {{days}}d", {
                          days: overdueDays(item.due_at, loadedAt),
                        })
                      : t("Due today")}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {data && data.continuing.length > 0 ? (
          <section className="mb-7">
            <h2 className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]/70">
              {t("Continue learning")}
            </h2>
            <div className="space-y-1.5">
              {data.continuing.map((item) => (
                <Link
                  key={item.book_id}
                  href="/space/learning"
                  className="block rounded-xl border border-[var(--border)]/60 px-4 py-3 transition-colors hover:border-[var(--border)] hover:bg-[var(--secondary)]/60"
                >
                  <div className="truncate text-[13.5px] font-medium text-[var(--foreground)]">
                    {item.book_name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]">
                    <span className="truncate">{item.module_name}</span>
                    <CircleDashed size={11} strokeWidth={1.6} />
                    <span className="shrink-0">
                      {t(STAGE_LABEL[item.stage] ?? item.stage)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {data && data.unresolved_errors > 0 ? (
          <Link
            href="/space/notebooks"
            className="inline-flex items-center gap-2 text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <NotebookPen size={14} strokeWidth={1.6} />
            <span>
              {t("Unresolved mistakes")} · {data.unresolved_errors}
            </span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
