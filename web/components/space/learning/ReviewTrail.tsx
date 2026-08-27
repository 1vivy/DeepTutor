"use client";

import { ArrowRight, BellRing, CheckCircle2, Clock3 } from "lucide-react";

import type { TopicReview } from "@/lib/learning-api";

import { formatRelative, type Translate } from "./format";

export function ReviewTrail({
  reviews,
  tr,
  zh,
  onSelect,
}: {
  reviews: TopicReview[];
  tr: Translate;
  zh: boolean;
  onSelect: (objectiveId: string) => void;
}) {
  return (
    <section className="rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <BellRing className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              {tr("复习小径", "Review trail")}
            </h2>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {tr("按记忆节奏重新点亮信标", "Relight beacons on your memory rhythm")}
            </p>
          </div>
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">{reviews.length}</span>
      </div>
      {reviews.length === 0 ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--muted)]/55 p-3 text-xs leading-5 text-[var(--muted-foreground)]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {tr("今天没有待复习的关卡。继续前进，系统会在合适的时候带你回来。", "Nothing is due today. Keep moving; the trail will bring you back at the right time.")}
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {reviews.slice(0, 5).map((review) => (
            <button
              key={review.id}
              type="button"
              onClick={() => onSelect(review.knowledge_point_id)}
              className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-[var(--accent)]/70"
            >
              <Clock3 className={`h-3.5 w-3.5 shrink-0 ${review.due ? "text-amber-600" : "text-[var(--muted-foreground)]"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-[var(--foreground)]">
                  {review.knowledge_point_name}
                </span>
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {review.due ? tr("现在可复习", "Ready now") : formatRelative(review.due_at, zh)}
                </span>
              </span>
              <ArrowRight className="h-3 w-3 text-[var(--muted-foreground)] transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
