"use client";

import { useEffect, useState } from "react";
import {
  BookOpenCheck,
  Check,
  Circle,
  CircleDot,
  Compass,
  Flag,
  Leaf,
  Loader2,
  LockKeyhole,
  Mountain,
  Sparkles,
  Undo2,
} from "lucide-react";

import {
  fetchObjectiveReport,
  type MapKnowledgePoint,
  type MasteryTopic,
  type ObjectiveReport,
} from "@/lib/learning-api";

import { knowledgeTypeLabel, type Translate } from "./format";
import { ObjectiveDetail } from "./ObjectiveDetail";

interface Point {
  x: number;
  y: number;
}

function routePoints(seed: number, count: number): Point[] {
  const total = Math.max(1, count);
  return Array.from({ length: total }, (_, index) => {
    const band = index % 4;
    const baseX = [22, 48, 76, 55][band];
    const wobble = ((seed >>> ((index % 5) * 4)) & 7) - 3;
    return {
      x: Math.max(13, Math.min(87, baseX + wobble * 2.1)),
      y: 18 + (index / Math.max(1, total - 1)) * 66,
    };
  });
}

function routeD(points: Point[]): string {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function statusLabel(point: MapKnowledgePoint, tr: Translate) {
  if (point.mastery_source === "learner") return tr("学习者确认", "Learner confirmed");
  if (point.status === "mastered") return tr("已掌握", "Mastered");
  if (point.status === "learning") return tr("学习中", "In progress");
  return tr("未探索", "Unexplored");
}

export function AdventureMap({
  topic,
  revision,
  selectedId,
  tr,
  zh,
  onSelect,
  onOverride,
}: {
  topic: MasteryTopic;
  revision: number;
  selectedId: string | null;
  tr: Translate;
  zh: boolean;
  onSelect: (id: string | null) => void;
  onOverride: (objectiveId: string, mastered: boolean, note: string) => Promise<void>;
}) {
  const nextId = topic.next.knowledge_point_id;

  return (
    <section id="mastery-map-start" aria-label={tr("精通路线地图", "Mastery route map")}>
      <div className="space-y-5">
        {topic.map.modules.map((module, moduleIndex) => {
          const points = routePoints(
            topic.metadata.map_seed + moduleIndex * 7919,
            module.knowledge_points.length,
          );
          const firstIncomplete = module.knowledge_points.findIndex(
            (point) => point.status !== "mastered",
          );
          const travelledCount =
            firstIncomplete === -1 ? points.length : Math.max(1, firstIncomplete + 1);
          return (
            <article
              key={module.id}
              className="mastery-map-paper relative overflow-hidden rounded-[26px] border border-black/10"
            >
              <header className="relative z-[3] flex items-center justify-between border-b border-black/10 bg-[var(--mastery-paper-raised)]/80 px-5 py-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-55">
                    {tr(`区域 ${moduleIndex + 1}`, `Region ${moduleIndex + 1}`)}
                  </div>
                  <h2 className="mt-1 text-base font-semibold tracking-tight">{module.name}</h2>
                </div>
                <div className="flex items-center gap-2 text-xs opacity-65">
                  {module.mastered === module.total ? (
                    <BookOpenCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                  ) : (
                    <Compass className="h-4 w-4" />
                  )}
                  {module.mastered}/{module.total}
                </div>
              </header>
              <div
                className="mastery-map-grid relative min-h-[360px]"
                style={{ height: Math.max(360, module.knowledge_points.length * 92) }}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 z-[1] h-full w-full"
                >
                  <path
                    d="M -15 20 C 10 2, 26 33, 50 13 S 85 9, 115 26"
                    fill="none"
                    stroke="var(--mastery-moss)"
                    strokeOpacity=".13"
                    strokeWidth="12"
                  />
                  <path
                    d="M -10 78 C 20 58, 38 96, 65 68 S 94 59, 112 82"
                    fill="none"
                    stroke="var(--mastery-water)"
                    strokeOpacity=".16"
                    strokeWidth="14"
                  />
                  <path d={routeD(points)} className="mastery-route-line" />
                  <path
                    d={routeD(points.slice(0, travelledCount))}
                    className="mastery-route-travelled"
                  />
                </svg>
                <Mountain
                  aria-hidden="true"
                  className="absolute right-[8%] top-[8%] z-[1] h-16 w-16 opacity-15"
                  strokeWidth={1}
                />
                <Leaf
                  aria-hidden="true"
                  className="absolute bottom-[10%] left-[8%] z-[1] h-12 w-12 text-[var(--mastery-moss)] opacity-20"
                  strokeWidth={1.2}
                />
                {points.map((position, pointIndex) => {
                  const point = module.knowledge_points[pointIndex];
                  const current = point.id === nextId;
                  const selected = point.id === selectedId;
                  return (
                    <div
                      key={point.id}
                      className="absolute z-[2]"
                      style={{ left: `${position.x}%`, top: `${position.y}%` }}
                    >
                      <button
                        type="button"
                        data-current={current ? "true" : "false"}
                        onClick={() => onSelect(selected ? null : point.id)}
                        aria-pressed={selected}
                        aria-label={`${point.name} — ${statusLabel(point, tr)}`}
                        className="mastery-waypoint group absolute left-0 top-0 flex w-44 -translate-x-1/2 -translate-y-6 flex-col items-center outline-none"
                      >
                        <span
                          className={`mastery-waypoint-icon flex h-12 w-12 items-center justify-center rounded-2xl border-2 shadow-md ${
                            point.status === "mastered"
                              ? "border-[var(--mastery-moss)] bg-[var(--mastery-moss)] text-white"
                              : point.status === "learning"
                                ? "border-[var(--mastery-gold)] bg-[var(--mastery-paper-raised)] text-[var(--mastery-gold)]"
                                : "border-[var(--mastery-route)]/45 bg-[var(--mastery-paper-raised)] text-[var(--mastery-route)]"
                          } ${
                            selected
                              ? "ring-2 ring-[var(--mastery-route)] ring-offset-2"
                              : ""
                          }`}
                        >
                          {point.mastery_source === "learner" ? (
                            <Sparkles className="h-5 w-5" />
                          ) : point.status === "mastered" ? (
                            <Check className="h-5 w-5" />
                          ) : point.status === "learning" ? (
                            <CircleDot className="h-5 w-5" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </span>
                        <span
                          className={`mt-3 w-full rounded-xl border px-2.5 py-2 text-center shadow-sm transition ${
                            selected
                              ? "border-[var(--mastery-route)] bg-[var(--mastery-paper-raised)]"
                              : "border-black/10 bg-[var(--mastery-paper-raised)]/90 group-hover:bg-[var(--mastery-paper-raised)]"
                          }`}
                        >
                          <span className="line-clamp-2 text-xs font-medium leading-4">
                            {point.name}
                          </span>
                          <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.12em] opacity-55">
                            {statusLabel(point, tr)}
                          </span>
                        </span>
                      </button>
                      {current && (
                        <Flag
                          aria-hidden="true"
                          className="absolute -right-9 -top-10 h-6 w-6 text-[var(--mastery-gold)]"
                          strokeWidth={1.8}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      {selectedId && (
        <ObjectiveDrawer
          key={selectedId}
          pathId={topic.path_id}
          objectiveId={selectedId}
          revision={revision}
          tr={tr}
          zh={zh}
          onClose={() => onSelect(null)}
          onOverride={onOverride}
        />
      )}
    </section>
  );
}

function ObjectiveDrawer({
  pathId,
  objectiveId,
  revision,
  tr,
  zh,
  onClose,
  onOverride,
}: {
  pathId: string;
  objectiveId: string;
  revision: number;
  tr: Translate;
  zh: boolean;
  onClose: () => void;
  onOverride: (objectiveId: string, mastered: boolean, note: string) => Promise<void>;
}) {
  const [report, setReport] = useState<ObjectiveReport | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchObjectiveReport(pathId, objectiveId, { signal: controller.signal })
      .then(setReport)
      .catch(() => {
        if (!controller.signal.aborted) setError(tr("证据读取失败", "Evidence could not be loaded"));
      });
    return () => controller.abort();
  }, [objectiveId, pathId, revision, tr]);

  const applyOverride = async (mastered: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await onOverride(objectiveId, mastered, note);
      setNoteOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("更新失败", "Update failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="mt-5 rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
      {!report ? (
        <div className="flex min-h-32 items-center justify-center text-[var(--muted-foreground)]">
          {error ? error : <Loader2 className="h-5 w-5 animate-spin" />}
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
                {tr("关卡证据", "Waypoint evidence")}
              </div>
              <h3 className="mt-1 text-lg font-semibold text-[var(--foreground)]">{report.name}</h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span>{report.module_name}</span>
                <span>·</span>
                <span>{knowledgeTypeLabel(report.type, tr)}</span>
                {report.mastery_source === "learner" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                    <Sparkles className="h-3 w-3" />
                    {tr("由你确认", "Learner confirmed")}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
            >
              {tr("收起", "Close")}
            </button>
          </div>
          <ObjectiveDetail report={report} tr={tr} zh={zh} />

          {!report.assessed_mastered && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              {report.mastery_source === "learner" ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs leading-5 text-[var(--muted-foreground)]">
                    {tr(
                      "这条路线已按你的确认放行，但测评证据仍保持原样。",
                      "The route advances on your confirmation while assessed evidence remains unchanged.",
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void applyOverride(false)}
                    disabled={busy}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                    {tr("回到正常测评", "Return to assessment")}
                  </button>
                </div>
              ) : noteOpen ? (
                <div>
                  <label className="text-xs font-medium text-[var(--foreground)]">
                    {tr("可选：为什么跳过这个关卡？", "Optional: why are you skipping this waypoint?")}
                    <textarea
                      autoFocus
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={2}
                      maxLength={500}
                      className="mt-2 w-full resize-none rounded-xl border border-[var(--input)] bg-[var(--background)] p-3 text-xs outline-none focus:border-[var(--ring)]"
                    />
                  </label>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setNoteOpen(false)}
                      className="h-9 rounded-xl px-3 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                    >
                      {tr("取消", "Cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyOverride(true)}
                      disabled={busy}
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                    >
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {tr("确认已掌握", "Confirm mastery")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--accent)]"
                >
                  <LockKeyhole className="h-3.5 w-3.5" />
                  {tr("我已经掌握，直接放行", "I already know this — advance")}
                </button>
              )}
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
