"use client";

import Link from "next/link";
import {
  BookOpen,
  CircleCheck,
  Flag,
  Mountain,
  Sparkles,
  TentTree,
} from "lucide-react";

import type { MasteryTopic } from "@/lib/learning-api";

import type { Translate } from "./format";

const ACCENTS = ["#6f7f58", "#567e7a", "#9a6b4d", "#76688a", "#8a7650"];

function miniPoints(seed: number, count: number) {
  const bounded = Math.max(2, Math.min(7, count));
  return Array.from({ length: bounded }, (_, index) => {
    const progress = index / (bounded - 1);
    const wobble = ((seed >>> ((index % 4) * 5)) & 15) - 7;
    return {
      x: 10 + progress * 80,
      y: 52 - Math.sin(progress * Math.PI) * 28 + wobble * 0.75,
    };
  });
}

function routePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function TopicMapCard({
  topic,
  tr,
}: {
  topic: MasteryTopic;
  tr: Translate;
}) {
  const { map, metadata } = topic;
  const total = map.counts.total;
  const mastered = map.counts.mastered;
  const progress = total ? mastered / total : 0;
  const points = miniPoints(metadata.map_seed, total || 4);
  const travelled = Math.max(0, Math.min(points.length - 1, Math.floor(progress * points.length)));
  const accent = ACCENTS[metadata.map_seed % ACCENTS.length];
  const due = topic.reviews.filter((review) => review.due).length;

  return (
    <Link
      href={`/space/learning/${encodeURIComponent(topic.path_id)}`}
      aria-label={tr(
        `打开 ${topic.name}，已完成 ${mastered}/${total} 个关卡`,
        `Open ${topic.name}, ${mastered} of ${total} waypoints complete`,
      )}
      className="mastery-map-card group block overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--card)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <div className="mastery-map-paper relative h-52 overflow-hidden border-b border-black/10">
        <svg
          aria-hidden="true"
          viewBox="0 0 100 66"
          preserveAspectRatio="none"
          className="absolute inset-0 z-[1] h-full w-full"
        >
          <path
            d="M -8 18 C 18 2, 29 31, 54 13 S 86 7, 112 24"
            fill="none"
            stroke={accent}
            strokeOpacity=".2"
            strokeWidth="7"
          />
          <path
            d="M -5 59 C 22 40, 37 66, 62 49 S 91 37, 108 54"
            fill="none"
            stroke="var(--mastery-water)"
            strokeOpacity=".18"
            strokeWidth="10"
          />
          <path d={routePath(points)} className="mastery-route-line" />
          {travelled > 0 && (
            <path
              d={routePath(points.slice(0, travelled + 1))}
              className="mastery-route-travelled"
            />
          )}
          {points.map((point, index) => {
            const complete = index <= travelled && mastered > 0;
            return (
              <g key={`${point.x}-${point.y}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={index === travelled && !map.complete ? 3.2 : 2.45}
                  fill={complete ? "var(--mastery-moss)" : "var(--mastery-paper-raised)"}
                  stroke={complete ? "var(--mastery-moss)" : "var(--mastery-route)"}
                  strokeWidth="1"
                />
                {complete && (
                  <path
                    d={`M ${point.x - 1.1} ${point.y} l .7 .8 l 1.5 -1.8`}
                    fill="none"
                    stroke="white"
                    strokeWidth=".65"
                  />
                )}
              </g>
            );
          })}
        </svg>

        <div className="absolute left-5 top-5 z-[2] flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-[var(--mastery-paper-raised)] text-2xl shadow-sm">
          {metadata.emoji}
        </div>
        <Mountain
          aria-hidden="true"
          className="absolute right-6 top-7 z-[2] h-11 w-11 opacity-30"
          style={{ color: accent }}
          strokeWidth={1.2}
        />
        <TentTree
          aria-hidden="true"
          className="absolute bottom-5 left-7 z-[2] h-8 w-8 text-[var(--mastery-moss)] opacity-70"
          strokeWidth={1.4}
        />
        <Flag
          aria-hidden="true"
          className="absolute bottom-6 right-7 z-[2] h-8 w-8 text-[var(--mastery-route)] opacity-80"
          strokeWidth={1.5}
        />
        {due > 0 && (
          <div className="absolute right-4 top-4 z-[3] flex items-center gap-1 rounded-full border border-amber-700/20 bg-amber-50/90 px-2 py-1 text-[10px] font-semibold text-amber-800 shadow-sm dark:bg-amber-950/80 dark:text-amber-200">
            <Sparkles className="h-3 w-3" />
            {due} {tr("待复习", "due")}
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {topic.name}
            </h2>
            <p className="mt-1 line-clamp-2 min-h-10 text-[13px] leading-5 text-[var(--muted-foreground)]">
              {metadata.description || metadata.goal}
            </p>
          </div>
          {map.complete && (
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          )}
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            {map.modules.length} {tr("片区域", "regions")}
          </span>
          <span>
            {mastered}/{total} {tr("关卡", "waypoints")}
          </span>
          <span>
            {topic.session_count} {tr("次旅程", "sessions")}
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--muted)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: accent }}
          />
        </div>
      </div>
    </Link>
  );
}
