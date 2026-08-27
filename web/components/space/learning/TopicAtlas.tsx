"use client";

import { AlertCircle, Compass, Plus, RefreshCw, Sparkles } from "lucide-react";

import type { MasteryTopic } from "@/lib/learning-api";

import type { Translate } from "./format";
import { TopicMapCard } from "./TopicMapCard";

export function TopicAtlas({
  topics,
  loading,
  error,
  tr,
  onCreate,
  onRetry,
}: {
  topics: MasteryTopic[];
  loading: boolean;
  error: string | null;
  tr: Translate;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const activeTopics = topics.filter((topic) => topic.metadata.status === "active");
  const dueCount = activeTopics.reduce(
    (count, topic) => count + topic.reviews.filter((review) => review.due).length,
    0,
  );

  return (
    <main className="mastery-shell h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary)]">
              <Compass className="h-4 w-4" />
              {tr("学习疆域", "Learning territories")}
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[var(--foreground)] sm:text-[38px]">
              {tr("你的精通地图", "Your Mastery Atlas")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
              {tr(
                "每个主题都是一片可探索的疆域。沿路线闯过知识关卡，回到营地继续任意一次学习旅程。",
                "Each topic is a territory to explore. Clear its knowledge waypoints, then return to camp and resume any learning journey.",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-foreground)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            {tr("开启新主题", "Chart a new topic")}
          </button>
        </header>

        {dueCount > 0 && (
          <section className="mt-8 flex items-center gap-3 rounded-2xl border border-amber-700/20 bg-amber-500/[0.07] px-4 py-3.5 text-sm text-[var(--foreground)]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <div className="font-medium">
                {tr(`${dueCount} 个记忆信标已亮起`, `${dueCount} review beacons are glowing`)}
              </div>
              <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                {tr(
                  "进入对应地图即可开始短复习，不会打断当前主线。",
                  "Open their maps for a short review without losing your main route.",
                )}
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="mt-8 flex items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm">
            <span className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4" /> {error}
            </span>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 font-medium text-[var(--foreground)] hover:underline"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {tr("重试", "Retry")}
            </button>
          </div>
        )}

        {loading ? (
          <div className="mt-9 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-[360px] animate-pulse rounded-[22px] border border-[var(--border)] bg-[var(--muted)]/60"
              />
            ))}
          </div>
        ) : activeTopics.length > 0 ? (
          <section
            aria-label={tr("正在学习的主题", "Active learning topics")}
            className="mt-9 grid gap-6 md:grid-cols-2 xl:grid-cols-3"
          >
            {activeTopics.map((topic) => (
              <TopicMapCard key={topic.path_id} topic={topic} tr={tr} />
            ))}
          </section>
        ) : !error ? (
          <section className="mastery-map-paper relative mx-auto mt-12 max-w-3xl overflow-hidden rounded-[28px] border border-black/10 px-6 py-16 text-center sm:px-12">
            <svg
              aria-hidden="true"
              viewBox="0 0 700 280"
              className="absolute inset-0 h-full w-full opacity-25"
            >
              <path
                d="M -40 210 C 90 40, 180 270, 320 115 S 550 240, 760 40"
                className="mastery-route-line"
              />
              <path
                d="M 50 40 C 150 -10, 210 90, 320 35 S 520 50, 650 10"
                fill="none"
                stroke="var(--mastery-moss)"
                strokeWidth="35"
                strokeOpacity=".2"
              />
            </svg>
            <div className="relative z-[1] mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-black/10 bg-[var(--mastery-paper-raised)] shadow-sm">
              <Compass className="h-7 w-7 text-[var(--mastery-route)]" />
            </div>
            <h2 className="relative z-[1] mt-6 text-2xl font-semibold tracking-tight">
              {tr("地图仍是一张空白纸", "Your atlas is still uncharted")}
            </h2>
            <p className="relative z-[1] mx-auto mt-3 max-w-lg text-sm leading-6 opacity-70">
              {tr(
                "告诉 DeepTutor 你想抵达哪里，再混合你的书、笔记和知识库，我们会为你绘制第一条真正可走的路线。",
                "Tell DeepTutor where you want to arrive, mix in your books, notes, and knowledge bases, and we’ll chart your first traversable route.",
              )}
            </p>
            <button
              type="button"
              onClick={onCreate}
              className="relative z-[1] mt-7 inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--mastery-ink)] px-5 text-sm font-medium text-[var(--mastery-paper-raised)] transition hover:-translate-y-0.5"
            >
              <Plus className="h-4 w-4" />
              {tr("绘制第一张地图", "Chart the first map")}
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}
