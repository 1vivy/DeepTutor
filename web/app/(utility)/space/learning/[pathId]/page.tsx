"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Compass,
  Loader2,
  MoreHorizontal,
  PencilRuler,
  Radio,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { AdventureMap } from "@/components/space/learning/AdventureMap";
import { ConfirmDialog } from "@/components/space/learning/ConfirmDialog";
import { EditTopicRouteDialog } from "@/components/space/learning/EditTopicRouteDialog";
import {
  topicDisplayName,
  type Translate,
} from "@/components/space/learning/format";
import { ReviewTrail } from "@/components/space/learning/ReviewTrail";
import { SessionCamp } from "@/components/space/learning/SessionCamp";
import { useMasteryPathActivity } from "@/hooks/useMasteryPathActivity";
import {
  deleteProgress,
  fetchMasteryTopic,
  fetchMasteryTopicSessions,
  redoProgress,
  setMasteryObjectiveOverride,
  type MasteryTopic,
  type TopicSession,
} from "@/lib/learning-api";

const NEXT_LABELS: Record<string, { zh: string; en: string }> = {
  probe: { zh: "先用一道探查题看看你是否已经掌握", en: "Start with a probe and test out if you already know it" },
  practice: { zh: "继续练习，直到稳定越过掌握门槛", en: "Practice until you reliably clear the mastery gate" },
  assess: { zh: "用自己的话讲清楚这个概念", en: "Explain this clearly in your own words" },
  review: { zh: "复习这个记忆信标", en: "Revisit this memory beacon" },
  answer_pending: { zh: "完成导师正在等待的回答", en: "Complete the answer your tutor is waiting for" },
  complete: { zh: "整片疆域已经点亮", en: "The whole territory is illuminated" },
};

const NEXT_CTA_LABELS: Record<string, { zh: string; en: string }> = {
  review: { zh: "开始本次复习", en: "Start this review" },
  answer_pending: { zh: "回到原会话作答", en: "Answer in the original session" },
  complete: { zh: "继续自由探索", en: "Keep exploring" },
};

export default function MasteryTopicPage() {
  const params = useParams<{ pathId: string }>();
  const pathId = String(params.pathId || "");
  const router = useRouter();
  const { i18n } = useTranslation();
  const zh = Boolean(i18n.language?.toLowerCase().startsWith("zh"));
  const tr: Translate = useCallback((cn, en) => (zh ? cn : en), [zh]);
  const [topic, setTopic] = useState<MasteryTopic | null>(null);
  const [sessions, setSessions] = useState<TopicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"reset" | "delete" | null>(
    null,
  );
  const [mutationBusy, setMutationBusy] = useState(false);
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const confirmTriggerRef = useRef<HTMLElement | null>(null);
  const activity = useMasteryPathActivity(pathId || null);

  const openEditor = (trigger: HTMLButtonElement) => {
    editorTriggerRef.current = trigger;
    setEditorOpen(true);
  };

  const openConfirmation = (
    action: "reset" | "delete",
    trigger: HTMLButtonElement,
  ) => {
    confirmTriggerRef.current = trigger;
    setConfirmAction(action);
  };

  const loadTopic = useCallback(async () => {
    try {
      const next = await fetchMasteryTopic(pathId, { cache: "no-store" });
      setTopic(next);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("地图读取失败", "The map could not be loaded"),
      );
    } finally {
      setLoading(false);
    }
  }, [pathId, tr]);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await fetchMasteryTopicSessions(pathId, { cache: "no-store" }));
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [pathId]);

  useEffect(() => {
    void loadTopic();
  }, [activity.revision, loadTopic]);

  useEffect(() => {
    void loadSessions();
  }, [activity.revision, activity.signal, loadSessions]);

  const sourceLabels = useMemo(
    () => topic?.sources.filter((source) => source.kind !== "goal").slice(0, 5) ?? [],
    [topic],
  );
  const displayName = topic ? topicDisplayName(topic, tr) : "";

  const refresh = async () => {
    await Promise.all([loadTopic(), loadSessions()]);
    activity.refresh();
  };

  const handleOverride = async (objectiveId: string, mastered: boolean, note: string) => {
    const result = await setMasteryObjectiveOverride(pathId, objectiveId, mastered, note);
    setTopic((previous) =>
      previous
        ? { ...previous, map: result.map, path_revision: result.path_revision }
        : previous,
    );
    await loadTopic();
  };

  const handleReset = async () => {
    setMutationBusy(true);
    try {
      await redoProgress(pathId);
      await refresh();
      setConfirmAction(null);
    } finally {
      setMutationBusy(false);
    }
  };

  const handleDelete = async () => {
    setMutationBusy(true);
    try {
      await deleteProgress(pathId);
      router.replace("/space/learning");
    } finally {
      setMutationBusy(false);
    }
  };

  if (loading && !topic) {
    return (
      <div className="mastery-shell flex h-full items-center justify-center text-[var(--muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="mastery-shell flex h-full flex-col items-center justify-center px-6 text-center">
        <Compass className="h-10 w-10 text-[var(--muted-foreground)] opacity-40" />
        <h1 className="mt-4 text-lg font-semibold">{tr("找不到这张地图", "This map could not be found")}</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{error}</p>
        <Link href="/space/learning" className="mt-5 text-sm font-medium text-[var(--primary)] hover:underline">
          {tr("返回地图集", "Return to atlas")}
        </Link>
      </div>
    );
  }

  const nextCopy = NEXT_LABELS[topic.next.action] ?? {
    zh: topic.next.reason,
    en: topic.next.reason,
  };
  const progress = topic.map.counts.total
    ? Math.round((topic.map.counts.mastered / topic.map.counts.total) * 100)
    : 0;
  const needsRouteRepair = topic.map.counts.total === 0;
  const nextCta = NEXT_CTA_LABELS[topic.next.action];
  const pendingSessionId =
    topic.next.session_id ||
    sessions.find((session) => session.has_pending_question)?.session_id;
  const continuationSessionId =
    topic.next.action === "answer_pending"
      ? pendingSessionId
      : sessions[0]?.session_id;

  return (
    <main className="mastery-shell h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-[1440px] px-4 pb-48 pt-6 sm:px-7 sm:pb-7 lg:px-9 lg:py-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/space/learning"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {tr("地图集", "Mastery Atlas")}
          </Link>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[10px] font-medium text-[var(--muted-foreground)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activity.connection === "live" ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {activity.connection === "live" ? tr("实时同步", "Live") : tr("正在重连", "Reconnecting")}
            </span>
            <button
              type="button"
              onClick={(event) => openEditor(event.currentTarget)}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-medium hover:bg-[var(--accent)]"
            >
              <PencilRuler className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tr("编辑路线", "Edit route")}</span>
            </button>
            <details className="relative">
              <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)]">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">{tr("更多操作", "More actions")}</span>
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-[var(--border)] bg-[var(--popover)] p-1.5 text-xs shadow-xl">
                <button
                  type="button"
                  onClick={(event) =>
                    openConfirmation("reset", event.currentTarget)
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--accent)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {tr("重置进度", "Reset progress")}
                </button>
                <button
                  type="button"
                  onClick={(event) =>
                    openConfirmation("delete", event.currentTarget)
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-red-600 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {tr("删除主题", "Delete topic")}
                </button>
              </div>
            </details>
          </div>
        </div>

        <header className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-2xl shadow-sm">
                {topic.metadata.emoji}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-semibold tracking-[-0.035em] text-[var(--foreground)] sm:text-[36px]">
                  {displayName}
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
                  {topic.metadata.description || topic.metadata.goal}
                </p>
              </div>
            </div>
            {sourceLabels.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 pl-0 sm:pl-[60px]">
                {sourceLabels.map((source) => (
                  <span
                    key={source.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-2.5 py-1 text-[10px] text-[var(--muted-foreground)]"
                  >
                    <BookOpen className="h-3 w-3" /> {source.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                {tr("疆域完成度", "Territory complete")}
              </div>
              <div className="mt-0.5 text-xl font-semibold text-[var(--foreground)]">{progress}%</div>
            </div>
            <div className="h-10 w-px bg-[var(--border)]" />
            <div className="text-xs text-[var(--muted-foreground)]">
              <div>{topic.map.counts.mastered}/{topic.map.counts.total} {tr("关卡", "waypoints")}</div>
              <div className="mt-1">{topic.map.modules.length} {tr("片区域", "regions")}</div>
            </div>
          </div>
        </header>

        <section className="fixed bottom-3 left-4 right-4 z-20 flex flex-col gap-4 rounded-[22px] border border-[var(--border)] bg-[var(--card)]/95 p-4 shadow-lg backdrop-blur sm:static sm:mt-7 sm:flex-row sm:items-center sm:justify-between sm:bg-[var(--card)] sm:p-5 sm:shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)]">
              {needsRouteRepair ? (
                <PencilRuler className="h-4 w-4" />
              ) : topic.next.action === "complete" ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <Compass className="h-4 w-4" />
              )}
            </span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                {tr("下一段路", "Next on the trail")}
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                {needsRouteRepair
                  ? tr("路线需要修复", "Route needs repair")
                  : topic.next.knowledge_point_name ||
                    tr("完成庆祝", "Celebrate completion")}
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                {needsRouteRepair
                  ? tr(
                      "这是一张旧版空地图。添加至少一个区域和关卡后即可开始学习。",
                      "This migrated map has no runnable route. Add at least one region and waypoint to begin.",
                    )
                  : zh
                    ? nextCopy.zh
                    : nextCopy.en}
              </p>
            </div>
          </div>
          {needsRouteRepair ? (
            <button
              type="button"
              onClick={(event) => openEditor(event.currentTarget)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] transition hover:-translate-y-0.5"
            >
              <PencilRuler className="h-4 w-4" />
              {tr("修复路线", "Repair route")}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Link
              href={
                continuationSessionId
                  ? `/space/learning/${encodeURIComponent(pathId)}/study/${encodeURIComponent(continuationSessionId)}`
                  : `/space/learning/${encodeURIComponent(pathId)}/study`
              }
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] transition hover:-translate-y-0.5"
            >
              <Radio className="h-4 w-4" />
              {nextCta
                ? zh
                  ? nextCta.zh
                  : nextCta.en
                : topic.session_count > 0
                  ? tr("继续远征", "Continue expedition")
                  : tr("开始第一关", "Begin first waypoint")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {needsRouteRepair ? (
            <section className="mastery-map-paper flex min-h-72 flex-col items-center justify-center rounded-[26px] border border-dashed border-black/15 p-8 text-center">
              <PencilRuler className="h-9 w-9 text-[var(--mastery-route)]" />
              <h2 className="mt-4 text-lg font-semibold">
                {tr("先补画学习路线", "Chart the missing route")}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted-foreground)]">
                {tr(
                  "旧版主题已安全迁移，但没有可运行的区域或关卡。学习证据不会凭空生成；请先定义你真正要掌握的路线。",
                  "The legacy topic migrated safely, but it has no runnable regions or waypoints. Define the abilities you want to master before tutoring begins.",
                )}
              </p>
              <button
                type="button"
                onClick={(event) => openEditor(event.currentTarget)}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--mastery-ink)] px-4 text-sm font-medium text-[var(--mastery-paper-raised)]"
              >
                <PencilRuler className="h-4 w-4" />
                {tr("添加区域和关卡", "Add regions and waypoints")}
              </button>
            </section>
          ) : (
            <AdventureMap
              topic={topic}
              revision={Math.max(topic.path_revision, activity.revision)}
              selectedId={selectedId}
              tr={tr}
              zh={zh}
              onSelect={setSelectedId}
              onOverride={handleOverride}
            />
          )}
          <div className="space-y-5 lg:sticky lg:top-6">
            <SessionCamp
              pathId={pathId}
              sessions={sessions}
              loading={sessionsLoading}
              tr={tr}
              zh={zh}
            />
            <ReviewTrail
              reviews={topic.reviews}
              tr={tr}
              zh={zh}
              onSelect={(objectiveId) => {
                setSelectedId(objectiveId);
                document.getElementById("mastery-map-start")?.scrollIntoView({
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth",
                });
              }}
            />
          </div>
        </div>
      </div>
      {editorOpen && (
        <EditTopicRouteDialog
          topic={topic}
          tr={tr}
          returnFocusRef={editorTriggerRef}
          onClose={() => setEditorOpen(false)}
          onSaved={(next) => {
            setTopic(next);
            setSelectedId(null);
            setEditorOpen(false);
            activity.refresh();
          }}
        />
      )}
      {confirmAction === "reset" && (
        <ConfirmDialog
          title={tr("重置学习进度？", "Reset learning progress?")}
          description={tr(
            "区域和关卡会保留；掌握证据、待回答问题和复习计划会被清空。",
            "Regions and waypoints stay. Mastery evidence, pending questions, and review schedules will be cleared.",
          )}
          confirmLabel={tr("确认重置", "Reset progress")}
          cancelLabel={tr("取消", "Cancel")}
          busy={mutationBusy}
          returnFocusRef={confirmTriggerRef}
          onConfirm={() => void handleReset()}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "delete" && (
        <ConfirmDialog
          title={tr("永久删除学习主题？", "Permanently delete this topic?")}
          description={tr(
            "地图、证据、复习计划和关联记录都会删除。此操作无法撤销。",
            "The map, evidence, review schedule, and linked records will be deleted. This cannot be undone.",
          )}
          confirmLabel={tr("永久删除", "Delete permanently")}
          cancelLabel={tr("取消", "Cancel")}
          destructive
          busy={mutationBusy}
          returnFocusRef={confirmTriggerRef}
          onConfirm={() => void handleDelete()}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </main>
  );
}
