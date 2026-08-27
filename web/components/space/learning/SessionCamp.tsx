"use client";

import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Flame,
  Loader2,
  MessageCircle,
  Plus,
  Radio,
} from "lucide-react";

import type { TopicSession } from "@/lib/learning-api";

import { formatRelative, type Translate } from "./format";

export function SessionCamp({
  pathId,
  sessions,
  loading,
  tr,
  zh,
}: {
  pathId: string;
  sessions: TopicSession[];
  loading: boolean;
  tr: Translate;
  zh: boolean;
}) {
  const router = useRouter();
  const openStudy = (sessionId?: string) =>
    router.push(
      sessionId
        ? `/space/learning/${encodeURIComponent(pathId)}/study/${encodeURIComponent(sessionId)}`
        : `/space/learning/${encodeURIComponent(pathId)}/study`,
    );

  return (
    <aside className="overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="mastery-map-paper relative overflow-hidden border-b border-black/10 px-5 py-5">
        <div className="relative z-[1] flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-60">
              <Flame className="mastery-campfire h-3.5 w-3.5 text-orange-700 dark:text-orange-300" />
              {tr("会话营地", "Session camp")}
            </div>
            <h2 className="mt-1.5 text-lg font-semibold">{tr("你的学习旅程", "Your learning journeys")}</h2>
          </div>
          <button
            type="button"
            onClick={() => openStudy()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mastery-ink)] text-[var(--mastery-paper-raised)] shadow-sm transition hover:-translate-y-0.5"
            aria-label={tr("新建学习会话", "Start a new learning session")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3">
        {loading ? (
          <div className="flex min-h-28 items-center justify-center text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <MessageCircle className="mx-auto h-7 w-7 text-[var(--muted-foreground)] opacity-45" />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {tr("营地还没有篝火", "No campfire stories yet")}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-[var(--muted-foreground)]">
              {tr(
                "开启第一次辅导。以后每次都可以回到同一段旅程，或从新视角出发。",
                "Start your first tutoring journey. Later, resume this exact thread or begin again from a fresh angle.",
              )}
            </p>
            <button
              type="button"
              onClick={() => openStudy()}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-3.5 text-xs font-medium text-[var(--primary-foreground)]"
            >
              <Plus className="h-3.5 w-3.5" />
              {tr("开始学习", "Begin learning")}
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((session) => {
              const running = session.status === "running" || Boolean(session.active_turn_id);
              return (
                <button
                  key={session.session_id}
                  type="button"
                  onClick={() => openStudy(session.session_id)}
                  className="group flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-[var(--accent)]/70"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      running
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    {running ? <Radio className="h-4 w-4 animate-pulse" /> : <MessageCircle className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                      {session.title || tr("未命名旅程", "Untitled journey")}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">
                      {running
                        ? tr("导师正在回应", "Tutor is responding")
                        : `${session.message_count} ${tr("条消息", "messages")} · ${formatRelative(session.updated_at, zh)}`}
                    </span>
                    {session.last_message && (
                      <span className="mt-1 block truncate text-[11px] text-[var(--muted-foreground)]/75">
                        {session.last_message}
                      </span>
                    )}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform group-hover:translate-x-0.5" />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => openStudy()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] py-2.5 text-xs font-medium text-[var(--muted-foreground)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
            >
              <Plus className="h-3.5 w-3.5" />
              {tr("从新视角开启会话", "Start from a fresh angle")}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
