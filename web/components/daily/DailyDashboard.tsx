"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  CircleDashed,
  Library,
  ListChecks,
  Loader2,
  MessageSquare,
  NotebookPen,
  PenLine,
  Plus,
  RotateCcw,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";
import { stagePrompt } from "@/lib/composer-handoff";
import { chatPathForMode } from "@/lib/workspace-mode";

interface ActivityItem {
  ref: string;
  layer: string;
  /** Surface name: chat / quiz / notebook / kb / book / partner / cowriter. */
  key: string;
  label: string;
  ts?: string;
  days_ago: number | null;
}

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

interface LearningState {
  due_count?: number;
  due?: DueItem[];
  continuing?: ContinuingItem[];
  unresolved_errors?: number;
}

interface DailyPayload {
  days: number;
  activity: ActivityItem[];
  learning: LearningState;
  partial?: string[];
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

/** Per-surface presentation. Keys match the backend's surface names. */
const SURFACE: Record<string, { icon: LucideIcon; label: string; href?: string }> = {
  chat: { icon: MessageSquare, label: "Conversation" },
  quiz: { icon: ListChecks, label: "Question", href: "/space/questions" },
  notebook: { icon: NotebookPen, label: "Mistake", href: "/space/notebooks" },
  book: { icon: Library, label: "Book", href: "/book" },
  kb: { icon: BookOpen, label: "Knowledge base", href: "/knowledge" },
  cowriter: { icon: PenLine, label: "Draft", href: "/co-writer" },
  partner: { icon: UserRound, label: "Partner", href: "/partners" },
};

/** Lookback options. Daily defaults wider than the sidebar badge's 3 days. */
const WINDOWS = [3, 7, 30] as const;
const DEFAULT_WINDOW = 7;
/** Generous: this page exists to show a lot, and each row is one line. */
const ACTIVITY_LIMIT = 60;

/** ``L1:chat:<session_id>`` → the session id, for linking into the chat. */
function sessionIdFromRef(ref: string): string {
  const parts = ref.split(":");
  return parts.length > 2 ? parts.slice(2).join(":") : "";
}

/** Whole days a review item is past due; 0 means it came due today. */
function overdueDays(dueAt: number, now: number): number {
  return Math.max(0, Math.floor((now - dueAt) / 86_400));
}

/**
 * Daily — the learner's own page, not a chat empty state.
 *
 * It used to be the Tutor route's empty state, which capped it at whatever
 * height was left above the composer: a third section would slide under the
 * floating input. As its own route it owns the viewport and can show as much as
 * there is, which is the point — this is where you find out what you did and
 * what is waiting.
 *
 * The activity half comes from the same recall service the tutor's
 * ``memory_search`` tool reads, so what the learner sees here and what the
 * tutor can see are the same facts.
 */
export default function DailyDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const [days, setDays] = useState<number>(DEFAULT_WINDOW);
  const [data, setData] = useState<DailyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Stamped when the payload lands rather than read during render: a clock call
  // in the render body is impure and makes relative ages depend on which render
  // you happened to look at.
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const response = await apiFetch(
          apiUrl(`/api/v1/tutor/today?days=${days}&limit=${ACTIVITY_LIMIT}`),
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) {
          setFailed(true);
          return;
        }
        setData((await response.json()) as DailyPayload);
        setLoadedAt(Date.now() / 1000);
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [days]);

  /** Start a Tutor conversation, optionally seeded with a starting prompt. */
  const startChat = useCallback(
    (prompt?: string) => {
      if (prompt) stagePrompt(prompt);
      router.push(chatPathForMode("tutor"));
    },
    [router],
  );

  const learning = data?.learning ?? {};
  const due = learning.due ?? [];
  const continuing = learning.continuing ?? [];
  // Read off ``data`` so the identity is stable between renders; a `?? []`
  // fallback here would be a fresh array each time and defeat the memo below.
  const activity = data?.activity;

  // Grouped by age so a week's worth reads as a timeline rather than a list of
  // sixty equivalent rows.
  const groups = useMemo(() => groupByAge(activity ?? []), [activity]);

  const hasAnything =
    due.length > 0 || continuing.length > 0 || (activity?.length ?? 0) > 0;

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-6 pb-20 pt-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-[30px] font-medium leading-[1.15] tracking-[-0.015em] text-[var(--foreground)]">
              {t("What should I study today?")}
            </h1>
            <p className="mt-1.5 text-[13px] text-[var(--muted-foreground)]">
              {t("What you have been working on, and what is waiting for you.")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => startChat()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-3 py-2 text-[13px] font-medium text-[var(--background)] transition-opacity hover:opacity-90"
          >
            <Plus size={14} strokeWidth={2} />
            {t("New chat")}
          </button>
        </header>

        {loading && !data ? (
          <div className="grid h-[40vh] place-items-center text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}

        {failed && !data ? (
          <div className="rounded-xl border border-[var(--border)]/60 px-5 py-6 text-[13.5px] text-[var(--muted-foreground)]">
            {t("Could not load your recent activity.")}
          </div>
        ) : null}

        {data && !hasAnything ? (
          <div className="rounded-xl border border-[var(--border)]/60 px-5 py-6">
            <p className="text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
              {t(
                "Nothing recorded in this window. Start a conversation, or build a learning path from a book to get mastery gating and spaced review.",
              )}
            </p>
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                onClick={() => startChat()}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--foreground)] hover:underline"
              >
                {t("New chat")}
                <ArrowRight size={13} strokeWidth={1.8} />
              </button>
              <Link
                href="/space/learning"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--foreground)] hover:underline"
              >
                {t("Mastery Path")}
                <ArrowRight size={13} strokeWidth={1.8} />
              </Link>
            </div>
          </div>
        ) : null}

        {due.length > 0 ? (
          <Section title={t("Due for review")} count={learning.due_count ?? due.length}>
            <div className="space-y-px">
              {due.map((item) => (
                <Row
                  key={`${item.book_id}:${item.kp_id}`}
                  icon={RotateCcw}
                  label={item.kp_name}
                  tag={item.knowledge_type}
                  meta={
                    overdueDays(item.due_at, loadedAt) > 0
                      ? t("Overdue {{days}}d", {
                          days: overdueDays(item.due_at, loadedAt),
                        })
                      : t("Due today")
                  }
                  onClick={() =>
                    startChat(
                      `${t("Review this with me")}: ${item.kp_name} (${item.book_name})`,
                    )
                  }
                />
              ))}
            </div>
          </Section>
        ) : null}

        {continuing.length > 0 ? (
          <Section title={t("Continue learning")}>
            <div className="space-y-1.5">
              {continuing.map((item) => (
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
          </Section>
        ) : null}

        {(learning.unresolved_errors ?? 0) > 0 ? (
          <Section title={t("Worth revisiting")}>
            <Link
              href="/space/notebooks"
              className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--secondary)]"
            >
              <NotebookPen
                size={14}
                strokeWidth={1.6}
                className="shrink-0 text-[var(--muted-foreground)]/60"
              />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--foreground)]">
                {t("Unresolved mistakes")}
              </span>
              <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--muted-foreground)]/70">
                {learning.unresolved_errors}
              </span>
            </Link>
          </Section>
        ) : null}

        {data ? (
          <section className="mb-7">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]/70">
                  {t("Recent activity")}
                </h2>
                <span className="text-[11.5px] text-[var(--muted-foreground)]/60">
                  {activity?.length ?? 0}
                </span>
              </div>
              <div className="flex gap-0.5 rounded-lg bg-[var(--muted)] p-0.5">
                {WINDOWS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDays(option)}
                    className={
                      "rounded-md px-2 py-0.5 text-[11.5px] transition-all " +
                      (days === option
                        ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-sm"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")
                    }
                  >
                    {t("{{days}}d", { days: option })}
                  </button>
                ))}
              </div>
            </div>

            {(activity?.length ?? 0) === 0 ? (
              <p className="px-3 py-2 text-[13px] text-[var(--muted-foreground)]">
                {t("No activity in this window.")}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.title} className="mb-3">
                  <div className="px-3 py-1 text-[11px] text-[var(--muted-foreground)]/60">
                    {t(group.title)}
                  </div>
                  <div className="space-y-px">
                    {group.items.map((item) => (
                      <ActivityRow key={item.ref} item={item} onStartChat={startChat} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        ) : null}

        {data?.partial?.length ? (
          <p className="text-[12px] text-[var(--muted-foreground)]/70">
            {t("Some sections could not be loaded.")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Age buckets, newest first. Titles are i18n keys. */
function groupByAge(items: ActivityItem[]): { title: string; items: ActivityItem[] }[] {
  const today: ActivityItem[] = [];
  const yesterday: ActivityItem[] = [];
  const week: ActivityItem[] = [];
  const earlier: ActivityItem[] = [];
  for (const item of items) {
    const age = item.days_ago;
    if (age === null) earlier.push(item);
    else if (age === 0) today.push(item);
    else if (age === 1) yesterday.push(item);
    else if (age <= 7) week.push(item);
    else earlier.push(item);
  }
  return [
    { title: "Today", items: today },
    { title: "Yesterday", items: yesterday },
    { title: "Earlier this week", items: week },
    { title: "Earlier", items: earlier },
  ].filter((group) => group.items.length > 0);
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]/70">
          {title}
        </h2>
        {count !== undefined ? (
          <span className="text-[11.5px] text-[var(--muted-foreground)]/60">{count}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const ROW_SHELL =
  "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--secondary)]";

function Row({
  icon: Icon,
  label,
  tag,
  meta,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tag?: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={ROW_SHELL}>
      <Icon size={14} strokeWidth={1.6} className="shrink-0 text-[var(--muted-foreground)]/60" />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--foreground)]">
        {label}
      </span>
      {tag ? (
        <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-[var(--muted-foreground)]/50">
          {tag}
        </span>
      ) : null}
      {meta ? (
        <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--muted-foreground)]/70">
          {meta}
        </span>
      ) : null}
    </button>
  );
}

/**
 * One line of recent activity.
 *
 * A conversation opens itself; anything else opens the surface that owns it.
 * Both stay one click from "keep going on this", which seeds a fresh Tutor
 * chat rather than reopening the old thread — the learner is continuing the
 * topic, not the transcript.
 */
function ActivityRow({
  item,
  onStartChat,
}: {
  item: ActivityItem;
  onStartChat: (prompt?: string) => void;
}) {
  const { t } = useTranslation();
  const surface = SURFACE[item.key] ?? { icon: CircleDashed, label: item.key };
  const Icon = surface.icon;
  const sessionId = item.key === "chat" ? sessionIdFromRef(item.ref) : "";
  const href = sessionId ? `/tutor/${sessionId}` : surface.href;

  const age =
    item.days_ago === null
      ? ""
      : item.days_ago === 0
        ? t("Today")
        : t("{{days}}d ago", { days: item.days_ago });

  return (
    <div className="group/row flex items-center gap-1">
      {href ? (
        <Link href={href} className={ROW_SHELL}>
          <Icon
            size={14}
            strokeWidth={1.6}
            className="shrink-0 text-[var(--muted-foreground)]/60"
          />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--foreground)]">
            {item.label}
          </span>
          <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-[var(--muted-foreground)]/50">
            {t(surface.label)}
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--muted-foreground)]/70">
            {age}
          </span>
        </Link>
      ) : (
        <Row
          icon={Icon}
          label={item.label}
          tag={t(surface.label)}
          meta={age}
          onClick={() => onStartChat(`${t("Pick this up with me")}: ${item.label}`)}
        />
      )}
      <button
        type="button"
        title={t("Pick this up with me")}
        onClick={() => onStartChat(`${t("Pick this up with me")}: ${item.label}`)}
        className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)]/50 opacity-0 transition-opacity hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover/row:opacity-100"
      >
        <MessageSquare size={13} strokeWidth={1.7} />
      </button>
    </div>
  );
}
