"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Compass,
  Flag,
  Loader2,
  Map,
  MessageCircle,
  Route,
  Square,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { ChatMessageList } from "@/components/chat/home/ChatMessages";
import { useUnifiedChat, type SessionConfiguration } from "@/context/UnifiedChatContext";
import { useMasteryPathActivity } from "@/hooks/useMasteryPathActivity";
import {
  fetchMasteryTopic,
  fetchMasteryTopicSessions,
  type MasteryTopic,
} from "@/lib/learning-api";
import { shouldSubmitOnEnter } from "@/lib/composer-keyboard";
import { useImeComposing } from "@/lib/use-ime-composing";
import {
  isMasteryDraftSessionReady,
  type MasteryDraftRouteGuard,
} from "@/lib/mastery-study-route";

import { topicDisplayName, type Translate } from "./format";

const STARTERS = [
  {
    icon: Compass,
    zh: "先用一道探查题看看我已经会了什么",
    en: "Start with a quick probe to see what I already know",
  },
  {
    icon: Sparkles,
    zh: "从直觉和一个具体例子开始教我",
    en: "Teach me from intuition and one concrete example",
  },
  {
    icon: Flag,
    zh: "直接给我一个有挑战性的关卡",
    en: "Give me a challenging waypoint right away",
  },
] as const;

function currentWaypoint(
  topic: MasteryTopic,
  fallback: string,
  tr: Translate,
) {
  if (topic.next.knowledge_point_name) return topic.next.knowledge_point_name;
  for (const region of topic.map.modules) {
    const point = region.knowledge_points.find(
      (item) => item.status !== "mastered",
    );
    if (point) return point.name;
  }
  return topic.map.complete ? tr("旅程已完成", "Journey complete") : fallback;
}

export function MasteryStudy({
  pathId,
  routeSessionId,
}: {
  pathId: string;
  routeSessionId?: string;
}) {
  const router = useRouter();
  const { i18n } = useTranslation();
  const zh = Boolean(i18n.language?.toLowerCase().startsWith("zh"));
  const tr: Translate = useCallback((cn, en) => (zh ? cn : en), [zh]);
  const {
    state,
    newSession,
    configureSession,
    loadSession,
    showCachedSession,
    sendMessage,
    cancelStreamingTurn,
    submitUserReply,
    regenerateLastMessage,
    deleteTurn,
    editMessage,
    switchBranch,
  } = useUnifiedChat();
  const [topic, setTopic] = useState<MasteryTopic | null>(null);
  const [topicError, setTopicError] = useState<string | null>(null);
  const currentRouteKey = `${pathId}:${routeSessionId || "new"}`;
  const [sessionResolution, setSessionResolution] = useState<{
    routeKey: string;
    error: string | null;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initializedRouteRef = useRef("");
  const draftRouteGuardRef = useRef<MasteryDraftRouteGuard | null>(null);
  const activity = useMasteryPathActivity(pathId || null);
  const { isComposingRef, onCompositionStart, onCompositionEnd } =
    useImeComposing();

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the route-owned request state before fetching.
    setTopicError(null);
    void fetchMasteryTopic(pathId, { cache: "no-store" })
      .then((result) => {
        if (active) setTopic(result);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setTopicError(
          reason instanceof Error
            ? reason.message
            : tr("学习地图读取失败", "The learning map could not be loaded"),
        );
      });
    return () => {
      active = false;
    };
  }, [activity.revision, pathId, tr]);

  const knowledgeBases = useMemo(
    () =>
      topic?.sources
        .filter(
          (source) =>
            source.kind === "knowledge_base" &&
            source.available &&
            source.source_id,
        )
        .map((source) => source.source_id) ?? [],
    [topic],
  );
  const sessionConfiguration = useMemo<SessionConfiguration>(
    () => ({
      capability: "mastery_path",
      masteryPathId: pathId,
      knowledgeBases,
    }),
    [knowledgeBases, pathId],
  );

  useEffect(() => {
    if (!topic) return;
    const routeKey = currentRouteKey;
    if (initializedRouteRef.current === routeKey) return;
    initializedRouteRef.current = routeKey;

    if (!routeSessionId) {
      draftRouteGuardRef.current = {
        routeKey,
        previousSessionId: state.sessionId,
      };
      newSession(sessionConfiguration);
      return;
    }

    draftRouteGuardRef.current = null;

    void fetchMasteryTopicSessions(pathId, { cache: "no-store" })
      .then((topicSessions) => {
        if (
          !topicSessions.some(
            (candidate) => candidate.session_id === routeSessionId,
          )
        ) {
          throw new Error(
            tr(
              "这个会话不属于当前学习主题。请从本主题的会话营地重新进入。",
              "This session belongs to a different learning topic. Open a session from this topic's camp instead.",
            ),
          );
        }
        const cached = showCachedSession(routeSessionId);
        if (cached) configureSession(sessionConfiguration, routeSessionId);
        return loadSession(
          routeSessionId,
          cached ? { revalidate: true } : undefined,
        );
      })
      .then(() => {
        configureSession(sessionConfiguration, routeSessionId);
        setSessionResolution({ routeKey, error: null });
      })
      .catch((reason: unknown) => {
        setSessionResolution({
          routeKey,
          error:
            reason instanceof Error
              ? reason.message
              : tr(
                  "这个学习会话无法打开",
                  "This learning session could not be opened",
                ),
        });
      });
  }, [
    configureSession,
    currentRouteKey,
    loadSession,
    newSession,
    pathId,
    routeSessionId,
    sessionConfiguration,
    showCachedSession,
    state.sessionId,
    topic,
    tr,
  ]);

  useEffect(() => {
    const newSessionId = state.sessionId;
    if (
      routeSessionId ||
      !newSessionId ||
      !isMasteryDraftSessionReady({
        guard: draftRouteGuardRef.current,
        routeKey: currentRouteKey,
        sessionId: newSessionId,
        masteryPathId: state.masteryPathId,
        pathId,
      })
    )
      return;
    router.replace(
      `/space/learning/${encodeURIComponent(pathId)}/study/${encodeURIComponent(newSessionId)}`,
      { scroll: false },
    );
  }, [
    currentRouteKey,
    pathId,
    routeSessionId,
    router,
    state.masteryPathId,
    state.sessionId,
  ]);

  const sessionError =
    sessionResolution?.routeKey === currentRouteKey
      ? sessionResolution.error
      : null;
  const sessionLoading = Boolean(
    routeSessionId &&
      sessionResolution?.routeKey !== currentRouteKey,
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: state.isStreaming ? "instant" : "smooth",
      block: "end",
    });
  }, [state.isStreaming, state.messages]);

  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(160, Math.max(48, area.scrollHeight))}px`;
  }, [draft]);

  const submit = useCallback(
    (value = draft) => {
      const content = value.trim();
      if (!content || state.isStreaming || sessionLoading || sessionError)
        return;
      sendMessage(content);
      setDraft("");
    },
    [draft, sendMessage, sessionError, sessionLoading, state.isStreaming],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSubmitOnEnter(event, isComposingRef.current)) return;
    event.preventDefault();
    submit();
  };

  const copyAssistantMessage = useCallback(async (content: string) => {
    if (content.trim()) await navigator.clipboard.writeText(content);
  }, []);

  if (!topic && !topicError) {
    return (
      <div className="mastery-shell flex h-full items-center justify-center text-[var(--muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="mastery-shell flex h-full flex-col items-center justify-center px-6 text-center">
        <Map className="h-10 w-10 text-[var(--muted-foreground)] opacity-40" />
        <h1 className="mt-4 text-lg font-semibold">
          {tr("找不到这张学习地图", "This learning map could not be found")}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {topicError}
        </p>
        <Link
          href="/space/learning"
          className="mt-5 text-sm font-medium text-[var(--primary)] hover:underline"
        >
          {tr("返回地图集", "Return to atlas")}
        </Link>
      </div>
    );
  }

  const displayName = topicDisplayName(topic, tr);
  const waypoint = currentWaypoint(topic, displayName, tr);
  const completed = topic.map.counts.mastered;
  const total = topic.map.counts.total;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const hasMessages = state.messages.length > 0;

  return (
    <main className="mastery-shell flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 backdrop-blur sm:px-6">
        <Link
          href={`/space/learning/${encodeURIComponent(pathId)}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label={tr("返回主题地图", "Back to topic map")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--mastery-paper)] text-xl shadow-sm">
          {topic.metadata.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-[var(--foreground)]">
              {displayName}
            </h1>
            <span className="hidden rounded-full bg-[var(--mastery-route)]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--mastery-route)] sm:inline">
              {tr("半引导学习", "Guided trail")}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-[var(--muted-foreground)]">
            <Flag className="h-3 w-3 text-[var(--mastery-gold)]" /> {waypoint}
          </p>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="h-full rounded-full bg-[var(--mastery-moss)] transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
            {completed}/{total}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[264px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)]/40 p-4 xl:block">
          <div className="mastery-map-paper relative overflow-hidden rounded-[22px] border border-black/10 p-4">
            <div className="relative z-[1]">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.17em] opacity-55">
                <Route className="h-3.5 w-3.5" /> {tr("随身路线", "Trail map")}
              </div>
              <div className="mt-4 space-y-4">
                {topic.map.modules.map((region, moduleIndex) => (
                  <div key={region.id}>
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--mastery-ink)]">
                      <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-[var(--mastery-route)]/10 text-[9px] text-[var(--mastery-route)]">
                        {moduleIndex + 1}
                      </span>
                      <span className="truncate">{region.name}</span>
                    </div>
                    <div className="ml-2.5 mt-2 space-y-2 border-l border-dashed border-[var(--mastery-ink)]/20 pl-3">
                      {region.knowledge_points.map((point) => (
                        <div
                          key={point.id}
                          className={`flex items-start gap-2 text-[11px] leading-4 ${
                            point.name === waypoint
                              ? "font-semibold text-[var(--mastery-route)]"
                              : "text-[var(--mastery-ink)]/60"
                          }`}
                        >
                          {point.status === "mastered" ? (
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--mastery-moss)]" />
                          ) : point.name === waypoint ? (
                            <Flag className="mt-0.5 h-3 w-3 shrink-0 text-[var(--mastery-gold)]" />
                          ) : (
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-30" />
                          )}
                          <span>{point.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-[var(--background)]">
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className="mx-auto w-full max-w-[900px] px-4 pb-8 pt-7 sm:px-7">
              {sessionLoading ? (
                <div className="flex min-h-[45vh] flex-col items-center justify-center text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="mb-3 h-5 w-5 animate-spin" />
                  {tr("正在回到这段旅程…", "Returning to this learning journey…")}
                </div>
              ) : sessionError ? (
                <div className="mx-auto mt-20 max-w-md rounded-[22px] border border-red-500/20 bg-red-500/5 p-6 text-center">
                  <MessageCircle className="mx-auto h-8 w-8 text-red-500/60" />
                  <h2 className="mt-3 text-sm font-semibold">
                    {tr("会话没有成功打开", "The session did not open")}
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                    {sessionError}
                  </p>
                  <Link
                    href={`/space/learning/${encodeURIComponent(pathId)}/study`}
                    className="mt-4 inline-flex rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)]"
                  >
                    {tr("开启新会话", "Start a new session")}
                  </Link>
                </div>
              ) : !hasMessages ? (
                <div className="mx-auto flex min-h-[54vh] max-w-2xl flex-col items-center justify-center text-center">
                  <div className="mastery-map-paper relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[24px] border border-black/10 text-3xl shadow-sm">
                    <span className="relative z-[1]">{topic.metadata.emoji}</span>
                  </div>
                  <div className="mt-5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--mastery-route)]">
                    {tr("下一处路标", "Your next waypoint")}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[var(--foreground)]">
                    {waypoint}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
                    {tr(
                      "导师会根据你的回答调整路线；你可以从探查、讲解或挑战任意一种方式出发。",
                      "Your tutor will adapt the route to your answers. Begin with a probe, an intuitive explanation, or a challenge.",
                    )}
                  </p>
                  <div className="mt-7 grid w-full gap-2 sm:grid-cols-3">
                    {STARTERS.map((starter) => {
                      const Icon = starter.icon;
                      const label = zh ? starter.zh : starter.en;
                      return (
                        <button
                          key={starter.en}
                          type="button"
                          onClick={() => submit(label)}
                          disabled={state.isStreaming || sessionLoading}
                          className="group rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--mastery-route)]/35 hover:shadow-md disabled:opacity-50"
                        >
                          <Icon className="h-4 w-4 text-[var(--mastery-route)]" />
                          <span className="mt-3 block text-xs font-medium leading-5 text-[var(--foreground)]">
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <ChatMessageList
                  messages={state.messages}
                  isStreaming={state.isStreaming}
                  sessionId={state.sessionId}
                  language={state.language}
                  onCopyAssistantMessage={copyAssistantMessage}
                  onRegenerateMessage={regenerateLastMessage}
                  onDeleteTurn={deleteTurn}
                  selectedBranches={state.selectedBranches}
                  onEditMessage={editMessage}
                  onSwitchBranch={switchBranch}
                  onSubmitUserReply={submitUserReply}
                  availableKbNames={new Set(knowledgeBases)}
                  variant="mastery"
                />
              )}
              <div ref={messagesEndRef} className="h-px" />
            </div>
          </div>

          {!sessionError && (
            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--background)]/95 px-3 pb-3 pt-3 backdrop-blur sm:px-6 sm:pb-5">
              <div className="mx-auto max-w-[900px]">
                <div className="relative rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-2 shadow-[0_12px_36px_rgba(0,0,0,0.08)] focus-within:border-[var(--mastery-route)]/40">
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={onCompositionEnd}
                    disabled={sessionLoading}
                    rows={1}
                    placeholder={tr(
                      `问导师关于「${waypoint}」的问题…`,
                      `Ask your tutor about “${waypoint}”…`,
                    )}
                    className="block min-h-12 w-full resize-none bg-transparent px-3 py-2.5 pr-14 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/70 disabled:opacity-50"
                  />
                  {state.isStreaming ? (
                    <button
                      type="button"
                      onClick={cancelStreamingTurn}
                      className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--foreground)] text-[var(--background)]"
                      aria-label={tr("停止回答", "Stop response")}
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => submit()}
                      disabled={!draft.trim() || sessionLoading}
                      className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--mastery-route)] text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={tr("发送", "Send")}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-2 text-center text-[10px] text-[var(--muted-foreground)]/65">
                  {tr(
                    "导师会用可验证的关卡证据更新地图；你始终可以手动覆盖掌握状态。",
                    "The tutor updates your map with verifiable checkpoint evidence; you can always override mastery yourself.",
                  )}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
