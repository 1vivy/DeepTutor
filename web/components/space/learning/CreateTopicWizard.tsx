"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Database,
  Loader2,
  Notebook,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { bookApi } from "@/lib/book-api";
import { listKnowledgeBases } from "@/lib/knowledge-api";
import {
  createMasteryTopic,
  generateMasteryTopicDraft,
  type CreateTopicInput,
  type MasteryTopic,
  type ModuleInit,
  type TopicDraft,
  type TopicSourceInput,
  type TopicSourceKind,
} from "@/lib/learning-api";
import { getNotebook, listNotebooks } from "@/lib/notebook-api";

import type { Translate } from "./format";

interface SourceCandidate {
  key: string;
  kind: Exclude<TopicSourceKind, "goal" | "file" | "chat">;
  sourceId: string;
  label: string;
  detail: string;
  available: boolean;
}

interface SourceLibrary {
  books: SourceCandidate[];
  notebooks: SourceCandidate[];
  knowledgeBases: SourceCandidate[];
  failures: string[];
}

const EMPTY_LIBRARY: SourceLibrary = {
  books: [],
  notebooks: [],
  knowledgeBases: [],
  failures: [],
};

const EMOJIS = ["🧭", "🏔️", "🌿", "🔭", "🧪", "🧠", "📐", "🌌"];

export function CreateTopicWizard({
  tr,
  onClose,
  onCreated,
}: {
  tr: Translate;
  onClose: () => void;
  onCreated: (topic: MasteryTopic) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [emoji, setEmoji] = useState("🧭");
  const [library, setLibrary] = useState<SourceLibrary>(EMPTY_LIBRARY);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<TopicDraft | null>(null);
  const [sources, setSources] = useState<TopicSourceInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    Promise.allSettled([bookApi.list(), listNotebooks(), listKnowledgeBases()]).then(
      ([booksResult, notebooksResult, knowledgeResult]) => {
        if (disposed) return;
        const failures: string[] = [];
        if (booksResult.status === "rejected") failures.push(tr("书架", "Books"));
        if (notebooksResult.status === "rejected")
          failures.push(tr("笔记本", "Notebooks"));
        if (knowledgeResult.status === "rejected")
          failures.push(tr("知识库", "Knowledge bases"));
        setLibrary({
          books:
            booksResult.status === "fulfilled"
              ? booksResult.value.books.map((book) => ({
                  key: `book:${book.id}`,
                  kind: "book" as const,
                  sourceId: book.id,
                  label: book.title,
                  detail: tr(
                    `${book.chapter_count} 章 · ${book.status}`,
                    `${book.chapter_count} chapters · ${book.status}`,
                  ),
                  available: book.status !== "error",
                }))
              : [],
          notebooks:
            notebooksResult.status === "fulfilled"
              ? notebooksResult.value.map((notebook) => ({
                  key: `notebook:${notebook.id}`,
                  kind: "notebook" as const,
                  sourceId: notebook.id,
                  label: notebook.name,
                  detail: tr(
                    `${notebook.record_count ?? 0} 条记录`,
                    `${notebook.record_count ?? 0} records`,
                  ),
                  available: !notebook.unreadable,
                }))
              : [],
          knowledgeBases:
            knowledgeResult.status === "fulfilled"
              ? knowledgeResult.value.map((knowledgeBase) => ({
                  key: `knowledge_base:${knowledgeBase.id || knowledgeBase.name}`,
                  kind: "knowledge_base" as const,
                  sourceId: knowledgeBase.name,
                  label: knowledgeBase.name,
                  detail:
                    knowledgeBase.provenance_label ||
                    tr(
                      knowledgeBase.status === "ready" ? "可检索" : "索引状态未知",
                      knowledgeBase.status === "ready" ? "Ready to retrieve" : "Index status unknown",
                    ),
                  available: knowledgeBase.available !== false,
                }))
              : [],
          failures,
        });
        setLibraryLoading(false);
      },
    );
    return () => {
      disposed = true;
    };
  }, [tr]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const candidates = useMemo(
    () => [...library.books, ...library.notebooks, ...library.knowledgeBases],
    [library],
  );

  const toggleSource = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hydrateSource = useCallback(
    async (candidate: SourceCandidate): Promise<TopicSourceInput> => {
      try {
        if (candidate.kind === "book") {
          const { spine } = await bookApi.getSpine(candidate.sourceId);
          return {
            kind: "book",
            source_id: candidate.sourceId,
            label: candidate.label,
            excerpt: spine.chapters
              .map(
                (chapter) =>
                  `${chapter.title}: ${[
                    ...chapter.learning_objectives,
                    chapter.summary,
                  ]
                    .filter(Boolean)
                    .join("; ")}`,
              )
              .join("\n")
              .slice(0, 8_000),
            available: true,
            metadata: { chapter_count: spine.chapters.length },
          };
        }
        if (candidate.kind === "notebook") {
          const notebook = await getNotebook(candidate.sourceId);
          return {
            kind: "notebook",
            source_id: candidate.sourceId,
            label: candidate.label,
            excerpt: notebook.records
              .slice(0, 16)
              .map(
                (record) =>
                  `${record.title}\n${record.summary || record.user_query || ""}\n${record.output || ""}`,
              )
              .join("\n\n")
              .slice(0, 8_000),
            available: true,
            metadata: { record_count: notebook.records.length },
          };
        }
        return {
          kind: "knowledge_base",
          source_id: candidate.sourceId,
          label: candidate.label,
          excerpt: candidate.detail,
          available: candidate.available,
        };
      } catch {
        return {
          kind: candidate.kind,
          source_id: candidate.sourceId,
          label: candidate.label,
          excerpt: "",
          available: false,
          metadata: { unavailable_during_generation: true },
        };
      }
    },
    [],
  );

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = candidates.filter((candidate) => selected.has(candidate.key));
      const hydrated = await Promise.all(chosen.map(hydrateSource));
      const nextSources: TopicSourceInput[] = [
        {
          kind: "goal",
          label: tr("学习目标", "Learning destination"),
          excerpt: goal.trim(),
        },
        ...hydrated,
      ];
      const nextDraft = await generateMasteryTopicDraft({
        name: name.trim(),
        goal: goal.trim(),
        sources: nextSources,
      });
      setSources(nextSources);
      setDraft(nextDraft);
      setStep(3);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("路线生成失败，请重试。", "Route generation failed. Please retry."),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const payload: CreateTopicInput = {
        name: name.trim(),
        goal: goal.trim(),
        description: draft.description.trim(),
        emoji,
        sources,
        modules: draft.modules,
      };
      onCreated(await createMasteryTopic(payload));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr("创建失败，请重试。", "Creation failed. Please retry."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-topic-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[26px] border border-[var(--border)] bg-[var(--card)] shadow-2xl sm:max-h-[88dvh] sm:rounded-[26px]">
        <header className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4 sm:px-7 sm:py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--primary)]">
              <Sparkles className="h-3.5 w-3.5" />
              {tr("新远征", "New expedition")}
            </div>
            <h2
              id="create-topic-title"
              className="mt-1 text-xl font-semibold tracking-tight text-[var(--foreground)]"
            >
              {tr("绘制一条精通路线", "Chart a mastery route")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={tr("关闭", "Close")}
            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-[var(--border)] px-5 py-3 sm:px-7">
          <ol className="grid grid-cols-3 gap-2" aria-label={tr("创建步骤", "Creation steps")}>
            {[
              tr("目的地", "Destination"),
              tr("补给", "Sources"),
              tr("路线", "Route"),
            ].map((label, index) => {
              const number = index + 1;
              const active = number === step;
              const done = number < step;
              return (
                <li key={label} className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                      active
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : done
                          ? "bg-emerald-600 text-white"
                          : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : number}
                  </span>
                  <span
                    className={`hidden text-xs sm:inline ${
                      active ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {step === 1 && (
            <DestinationStep
              name={name}
              goal={goal}
              emoji={emoji}
              tr={tr}
              onName={setName}
              onGoal={setGoal}
              onEmoji={setEmoji}
            />
          )}
          {step === 2 && (
            <SourcesStep
              library={library}
              loading={libraryLoading}
              selected={selected}
              tr={tr}
              onToggle={toggleSource}
            />
          )}
          {step === 3 && draft && (
            <RouteDraftEditor draft={draft} tr={tr} onChange={setDraft} />
          )}
          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-xs leading-5 text-red-700 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--border)] px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            disabled={step === 1 || busy}
            className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:invisible"
          >
            <ArrowLeft className="h-4 w-4" />
            {tr("上一步", "Back")}
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!name.trim() || !goal.trim()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tr("选择补给", "Choose sources")}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : step === 2 ? (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? tr("正在绘图…", "Charting…") : tr("生成路线", "Generate route")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || !draft?.modules.length}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {busy ? tr("正在落图…", "Saving map…") : tr("开启远征", "Start expedition")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function DestinationStep({
  name,
  goal,
  emoji,
  tr,
  onName,
  onGoal,
  onEmoji,
}: {
  name: string;
  goal: string;
  emoji: string;
  tr: Translate;
  onName: (value: string) => void;
  onGoal: (value: string) => void;
  onEmoji: (value: string) => void;
}) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)]">
        <Target className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--foreground)]">
        {tr("你想抵达哪里？", "Where do you want to arrive?")}
      </h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
        {tr(
          "目标越具体，地图上的关卡就越贴近你真正想获得的能力。",
          "The more specific the destination, the closer each waypoint will be to the ability you actually want.",
        )}
      </p>
      <label className="mt-6 block text-xs font-medium text-[var(--foreground)]">
        {tr("主题名称", "Topic name")}
        <input
          autoFocus
          value={name}
          onChange={(event) => onName(event.target.value)}
          maxLength={120}
          placeholder={tr("例如：线性代数", "e.g. Linear algebra")}
          className="mt-2 h-11 w-full rounded-xl border border-[var(--input)] bg-[var(--background)] px-3.5 text-sm outline-none transition focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/15"
        />
      </label>
      <label className="mt-5 block text-xs font-medium text-[var(--foreground)]">
        {tr("学习目的地", "Learning destination")}
        <textarea
          value={goal}
          onChange={(event) => onGoal(event.target.value)}
          maxLength={2000}
          rows={5}
          placeholder={tr(
            "我希望能从几何直觉出发，理解向量空间、线性变换，并能独立解决特征值问题。",
            "I want to build geometric intuition for vector spaces and transformations, then solve eigenvalue problems independently.",
          )}
          className="mt-2 w-full resize-none rounded-xl border border-[var(--input)] bg-[var(--background)] px-3.5 py-3 text-sm leading-6 outline-none transition focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/15"
        />
      </label>
      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-[var(--foreground)]">
          {tr("地图徽记", "Map emblem")}
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {EMOJIS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onEmoji(item)}
              aria-pressed={emoji === item}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border text-lg transition ${
                emoji === item
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 shadow-sm"
                  : "border-[var(--border)] hover:bg-[var(--accent)]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function SourcesStep({
  library,
  loading,
  selected,
  tr,
  onToggle,
}: {
  library: SourceLibrary;
  loading: boolean;
  selected: Set<string>;
  tr: Translate;
  onToggle: (key: string) => void;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-[var(--foreground)]">
        {tr("带上哪些学习补给？", "Which learning supplies should come along?")}
      </h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
        {tr(
          "可混合多个来源。目标本身始终会作为第一份材料，其他来源会让路线更贴近你的上下文。",
          "Mix as many sources as useful. Your destination is always included; the rest grounds the route in your own context.",
        )}
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--muted-foreground)]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <SourceSection
            icon={BookOpen}
            title={tr("Books", "Books")}
            empty={tr("书架里还没有可用内容", "No books are available yet")}
            items={library.books}
            selected={selected}
            onToggle={onToggle}
            tr={tr}
          />
          <SourceSection
            icon={Notebook}
            title={tr("Notebooks", "Notebooks")}
            empty={tr("还没有保存过笔记", "No saved notebooks yet")}
            items={library.notebooks}
            selected={selected}
            onToggle={onToggle}
            tr={tr}
          />
          <SourceSection
            icon={Database}
            title={tr("知识库", "Knowledge bases")}
            empty={tr("还没有可检索的知识库", "No retrievable knowledge bases yet")}
            items={library.knowledgeBases}
            selected={selected}
            onToggle={onToggle}
            tr={tr}
          />
          {library.failures.length > 0 && (
            <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-3.5 w-3.5" />
              {tr(
                `${library.failures.join("、")} 暂时无法读取；仍可只用现有来源生成。`,
                `${library.failures.join(", ")} could not be loaded; you can still generate from the available sources.`,
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SourceSection({
  icon: Icon,
  title,
  empty,
  items,
  selected,
  onToggle,
  tr,
}: {
  icon: typeof BookOpen;
  title: string;
  empty: string;
  items: SourceCandidate[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  tr: Translate;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-[var(--muted-foreground)]">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-xs text-[var(--muted-foreground)]">
          {empty}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const active = selected.has(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onToggle(item.key)}
                aria-pressed={active}
                className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)]/[0.06]"
                    : "border-[var(--border)] hover:bg-[var(--accent)]/60"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--input)]"
                  }`}
                >
                  {active && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
                    {item.available ? item.detail : tr("当前不可用", "Currently unavailable")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function RouteDraftEditor({
  draft,
  tr,
  onChange,
  compact = false,
  showDescription = true,
}: {
  draft: TopicDraft;
  tr: Translate;
  onChange: (draft: TopicDraft) => void;
  compact?: boolean;
  showDescription?: boolean;
}) {
  const updateModule = (index: number, module: ModuleInit) => {
    const modules = [...draft.modules];
    modules[index] = module;
    onChange({ ...draft, modules });
  };
  const removeModule = (index: number) =>
    onChange({
      ...draft,
      modules: draft.modules.filter((_, moduleIndex) => moduleIndex !== index),
    });
  const addModule = () => {
    const index = draft.modules.length;
    const id = `draft_m${Date.now()}`;
    onChange({
      ...draft,
      modules: [
        ...draft.modules,
        {
          id,
          name: tr(`新区域 ${index + 1}`, `New region ${index + 1}`),
          order: index,
          knowledge_points: [],
        },
      ],
    });
  };

  return (
    <div>
      {!compact && (
        <>
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {tr("检查并调整路线", "Inspect and tune the route")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
            {tr(
              "区域决定学习阶段，关卡决定每次导师要帮助你真正掌握的能力。现在改好，以后也能继续编辑。",
              "Regions define learning phases; waypoints define the abilities your tutor must help you truly master. Tune it now—you can edit it later too.",
            )}
          </p>
        </>
      )}
      {showDescription && (
        <label className={`${compact ? "" : "mt-5"} block text-xs font-medium text-[var(--foreground)]`}>
          {tr("地图简介", "Map description")}
          <textarea
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            maxLength={500}
            rows={compact ? 2 : 3}
            className="mt-2 w-full resize-none rounded-xl border border-[var(--input)] bg-[var(--background)] px-3 py-2.5 text-sm leading-5 outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/15"
          />
        </label>
      )}
      <div className="mt-5 space-y-3">
        {draft.modules.map((module, moduleIndex) => (
          <div key={module.id} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[11px] font-semibold text-[var(--primary)]">
                {moduleIndex + 1}
              </span>
              <input
                aria-label={tr(`第 ${moduleIndex + 1} 个区域名称`, `Region ${moduleIndex + 1} name`)}
                value={module.name}
                onChange={(event) =>
                  updateModule(moduleIndex, { ...module, name: event.target.value })
                }
                maxLength={200}
                className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold outline-none hover:border-[var(--border)] focus:border-[var(--ring)]"
              />
              <button
                type="button"
                onClick={() => removeModule(moduleIndex)}
                disabled={draft.modules.length === 1}
                aria-label={tr("删除区域", "Remove region")}
                className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-600 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 space-y-1.5 pl-8">
              {module.knowledge_points.map((point, pointIndex) => (
                <div key={point.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full border-2 border-[var(--primary)]/60" />
                  <input
                    aria-label={tr("关卡名称", "Waypoint name")}
                    value={point.name}
                    onChange={(event) => {
                      const knowledgePoints = [...module.knowledge_points];
                      knowledgePoints[pointIndex] = { ...point, name: event.target.value };
                      updateModule(moduleIndex, {
                        ...module,
                        knowledge_points: knowledgePoints,
                      });
                    }}
                    maxLength={200}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-xs outline-none hover:border-[var(--border)] focus:border-[var(--ring)]"
                  />
                  <select
                    aria-label={tr("关卡类型", "Waypoint type")}
                    value={point.type}
                    onChange={(event) => {
                      const knowledgePoints = [...module.knowledge_points];
                      knowledgePoints[pointIndex] = { ...point, type: event.target.value };
                      updateModule(moduleIndex, {
                        ...module,
                        knowledge_points: knowledgePoints,
                      });
                    }}
                    className="h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-[11px] text-[var(--muted-foreground)] outline-none"
                  >
                    <option value="concept">{tr("概念", "Concept")}</option>
                    <option value="memory">{tr("记忆", "Memory")}</option>
                    <option value="procedure">{tr("过程", "Procedure")}</option>
                    <option value="design">{tr("设计", "Design")}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      updateModule(moduleIndex, {
                        ...module,
                        knowledge_points: module.knowledge_points.filter(
                          (_, index) => index !== pointIndex,
                        ),
                      })
                    }
                    disabled={module.knowledge_points.length === 1}
                    aria-label={tr("删除关卡", "Remove waypoint")}
                    className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:text-red-600 disabled:opacity-25"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const id = `${module.id}_kp${Date.now()}`;
                  updateModule(moduleIndex, {
                    ...module,
                    knowledge_points: [
                      ...module.knowledge_points,
                      {
                        id,
                        name: tr("新关卡", "New waypoint"),
                        type: "concept",
                        module_id: module.id,
                      },
                    ],
                  });
                }}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[var(--primary)] hover:bg-[var(--primary)]/[0.06]"
              >
                <Plus className="h-3 w-3" />
                {tr("添加关卡", "Add waypoint")}
              </button>
            </div>
          </div>
        ))}
      </div>
      {draft.modules.length < 8 && (
        <button
          type="button"
          onClick={addModule}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 text-xs text-[var(--muted-foreground)] hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr("添加区域", "Add region")}
        </button>
      )}
    </div>
  );
}
