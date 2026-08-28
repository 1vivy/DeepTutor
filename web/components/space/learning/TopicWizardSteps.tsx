"use client";

import {
  AlertCircle,
  BookOpen,
  Check,
  Database,
  Loader2,
  Notebook,
  Target,
} from "lucide-react";

import type {
  SourceCandidate,
  SourceLibrary,
} from "@/hooks/useTopicSourceLibrary";

import type { Translate } from "./format";

const EMOJIS = ["🧭", "🏔️", "🌿", "🔭", "🧪", "🧠", "📐", "🌌"];

export function DestinationStep({
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
          data-modal-initial-focus
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
              aria-label={tr(
                `选择地图徽记 ${item}`,
                `Choose map emblem ${item}`,
              )}
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

export function SourcesStep({
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
            title={tr("书籍", "Books")}
            empty={tr("书架里还没有可用内容", "No books are available yet")}
            items={library.books}
            selected={selected}
            onToggle={onToggle}
            tr={tr}
          />
          <SourceSection
            icon={Notebook}
            title={tr("笔记本", "Notebooks")}
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
                disabled={!item.available}
                className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
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
                    {item.available
                      ? item.detail
                      : tr("当前不可用", "Currently unavailable")}
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
