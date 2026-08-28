"use client";

import { useMemo, useState, type RefObject } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import { useModalDialog } from "@/hooks/useModalDialog";
import {
  type MasteryTopic,
  type ModuleInit,
  type TopicDraft,
  updateMasteryTopicMap,
} from "@/lib/learning-api";

import type { Translate } from "./format";
import { RouteDraftEditor } from "./RouteDraftEditor";
import { isRouteDraftValid } from "./route-draft";

function topicDraft(topic: MasteryTopic): TopicDraft {
  return {
    description: topic.metadata.description,
    modules: topic.map.modules.map(
      (module): ModuleInit => ({
        id: module.id,
        name: module.name,
        order: module.order,
        knowledge_points: module.knowledge_points.map((point) => ({
          id: point.id,
          name: point.name,
          type: point.type,
          module_id: module.id,
        })),
      }),
    ),
  };
}

export function EditTopicRouteDialog({
  topic,
  tr,
  onClose,
  onSaved,
  returnFocusRef,
}: {
  topic: MasteryTopic;
  tr: Translate;
  onClose: () => void;
  onSaved: (topic: MasteryTopic) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const original = useMemo(() => topicDraft(topic), [topic]);
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useModalDialog(onClose, busy, returnFocusRef);

  const save = async () => {
    if (!isRouteDraftValid(draft)) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateMasteryTopicMap(topic.path_id, draft.modules));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("保存失败", "Save failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-route-title"
        tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[26px] border border-[var(--border)] bg-[var(--card)] shadow-2xl outline-none sm:rounded-[26px]"
      >
        <header className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4 sm:px-7">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
              {tr("地图工坊", "Map workshop")}
            </div>
            <h2 id="edit-route-title" className="mt-1 text-xl font-semibold tracking-tight">
              {tr("编辑学习路线", "Edit learning route")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={tr("关闭", "Close")}
            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-600/20 bg-amber-500/[0.06] p-3 text-xs leading-5 text-[var(--muted-foreground)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            {tr(
              "只修改名称会保留原关卡证据；删除关卡会同时移除它的掌握度、复习计划和学习者放行记录。保存前请确认路线结构。",
              "Renaming preserves existing evidence. Removing a waypoint also removes its mastery, review schedule, and learner override. Confirm the route structure before saving.",
            )}
          </div>
          <RouteDraftEditor
            draft={draft}
            tr={tr}
            onChange={setDraft}
            compact
            showDescription={false}
          />
          {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-10 rounded-xl px-4 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            {tr("取消", "Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !isRouteDraftValid(draft)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {tr("保存路线", "Save route")}
          </button>
        </footer>
      </div>
    </div>
  );
}
