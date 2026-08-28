"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpenText,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  FileAudio,
  FileText,
  Film,
  GraduationCap,
  Highlighter,
  History,
  Library,
  Link2,
  ListTree,
  Loader2,
  MessageCirclePlus,
  MoreHorizontal,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  StickyNote,
  X,
  Youtube,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { ChatMessageList } from "@/components/chat/home/ChatMessages";
import type { JumpRequest } from "@/components/reading/PdfDocumentView";
import { READER_ASK_EVENT, ReaderPane } from "@/components/reading/ReaderPane";
import { useReading } from "@/context/ReadingContext";
import { useUnifiedChat } from "@/context/UnifiedChatContext";
import { listNotebooks, type NotebookSummary } from "@/lib/notebook-api";
import {
  getReadingPosition,
  getMaterial,
  getUnitText,
  rawMaterialUrl,
  saveReadingPosition,
  uploadMaterial,
  type OutlineRow,
  type UnitReference,
} from "@/lib/reading-api";
import {
  READER_ACTION_EVENT,
  READER_TURN_END_EVENT,
  type ReaderActionPayload,
} from "@/lib/reading-reader-action";
import { mediaTimeFromHref } from "@/lib/reading-media-citations";
import {
  buildOutlineTree,
  filterOutlineNodes,
  type OutlineNode,
} from "@/lib/reading-outline";
import {
  html5ReadingController,
  type ReadingMediaController,
} from "@/lib/reading-media-controller";
import {
  bilibiliOfficialUrl,
  parseBilibiliSource,
  youtubeEntryTime,
  youtubeVideoId,
} from "@/lib/reading-video-sources";
import {
  READING_CAPABILITY,
  setReadingViewport,
  setReadingWorkspace,
} from "@/lib/reading-turn-state";
import {
  activateReadingMaterial,
  addReadingWorkspaceMaterial,
  createReadingConversation,
  generateMasteryPathFromReading,
  getReadingWorkspace,
  importReadingUrls,
  linkReadingConversation,
  listReadingLibraryMaterials,
  listReadingConversations,
  organizeReadingNotes,
  removeReadingWorkspaceMaterial,
  retryReadingMaterial,
  sendReadingToNotebook,
  updateReadingWorkspace,
  unlinkReadingConversation,
  type OrganizedReadingNotes,
  type ReadingConversation,
  type ReadingLibraryMaterial,
  type ReadingWorkspace,
} from "@/lib/reading-workspace-api";
import { YouTubeReadingPlayer } from "./YouTubeReadingPlayer";
import { BilibiliReadingPlayer } from "./BilibiliReadingPlayer";

interface TranscriptRow {
  locator: number;
  title: string;
  text: string;
  sourceHref: string;
}

interface ReaderAskDetail {
  quote?: string;
  locator?: number;
  unit?: string;
}

export function ReadingWorkspacePage() {
  const params = useParams<{ workspaceId: string; sessionId?: string[] }>();
  const workspaceId = params.workspaceId;
  const sessionIdParam = params.sessionId?.[0] ?? null;
  const router = useRouter();
  const { t } = useTranslation();
  const {
    material,
    annotations,
    loading: materialLoading,
    openMaterial,
    closeMaterial,
    reportViewport,
  } = useReading();
  const {
    state,
    setCapability,
    setTools,
    sendMessage,
    cancelStreamingTurn,
    submitUserReply,
    regenerateLastMessage,
    deleteTurn,
    editMessage,
    switchBranch,
    loadSession,
  } = useUnifiedChat();

  const [workspace, setWorkspace] = useState<ReadingWorkspace | null>(null);
  const [conversations, setConversations] = useState<ReadingConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeLocator, setActiveLocator] = useState(1);
  const [transcript, setTranscript] = useState<TranscriptRow[]>([]);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [selection, setSelection] = useState<{
    quote: string;
    locator: number;
  } | null>(null);
  const [composer, setComposer] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [showLinker, setShowLinker] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showMastery, setShowMastery] = useState(false);
  const [removeTarget, setRemoveTarget] =
    useState<ReadingLibraryMaterial | null>(null);
  const [companionOpen, setCompanionOpen] = useState(true);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false);
  const [documentJump, setDocumentJump] = useState<JumpRequest | null>(null);
  const [organizedNotes, setOrganizedNotes] =
    useState<OrganizedReadingNotes | null>(null);
  const [notice, setNotice] = useState("");
  const sessionBootRef = useRef("");
  const transcriptRequestRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const refresh = useCallback(async () => {
    const result = await getReadingWorkspace(workspaceId);
    const sessionRows = await listReadingConversations(workspaceId);
    setWorkspace(result.workspace);
    setConversations(sessionRows);
    return { workspace: result.workspace, sessions: sessionRows };
  }, [workspaceId]);

  useEffect(() => {
    // On narrower screens the source remains the base layer. The outline and
    // companion open as intentional sheets instead of squeezing the reader
    // into an unusable three-column layout.
    const frame = window.requestAnimationFrame(() => {
      if (!window.matchMedia("(min-width: 1280px)").matches) {
        setCompanionOpen(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The async refresh owns the initial network hydration for this route.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : t("This reading workspace could not be opened."),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, t]);

  useEffect(() => {
    setReadingWorkspace(workspaceId);
    setCapability(READING_CAPABILITY);
    setTools(["web_search", "reason"]);
    return () => {
      setReadingWorkspace(null);
      closeMaterial();
    };
  }, [closeMaterial, setCapability, setTools, workspaceId]);

  const activeTab = useMemo(
    () =>
      workspace?.tabs.find(
        (tab) => tab.material.material_id === workspace.active_material_id,
      ) ?? workspace?.tabs[0] ?? null,
    [workspace],
  );

  useEffect(() => {
    const active = activeTab?.material;
    if (!active || active.status !== "ready") {
      closeMaterial();
      return;
    }
    let cancelled = false;
    void getMaterial(active.material_id)
      .then((detail) => {
        if (!cancelled) return openMaterial(detail);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : t("Open failed."));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab?.material, closeMaterial, openMaterial, t]);

  useEffect(() => {
    if (!workspace?.tabs.some((tab) => tab.material.status === "processing" || tab.material.status === "queued"))
      return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [refresh, workspace]);

  useEffect(() => {
    if (!workspace || loading) return;
    const bootKey = `${workspaceId}:${sessionIdParam ?? "new"}`;
    if (sessionBootRef.current === bootKey) return;
    sessionBootRef.current = bootKey;

    void (async () => {
      try {
        let target = sessionIdParam;
        if (!target) {
          const latest = conversations[0];
          if (latest) target = latest.session_id;
          else {
            const created = await createReadingConversation(
              workspaceId,
              t("Reading conversation"),
              workspace.active_material_id ?? "",
            );
            setConversations([created]);
            target = created.session_id;
          }
          router.replace(`/reading/${workspaceId}/${target}`, { scroll: false });
        }
        if (target) await loadSession(target);
        setCapability(READING_CAPABILITY);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : t("The reading conversation could not be loaded."),
        );
      }
    })();
  }, [
    conversations,
    loadSession,
    loading,
    router,
    sessionIdParam,
    setCapability,
    t,
    workspace,
    workspaceId,
  ]);

  useEffect(() => {
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<ReaderAskDetail>).detail;
      const quote = String(detail?.quote ?? "").trim();
      if (!quote) return;
      setSelection({ quote, locator: Number(detail.locator || activeLocator) });
      setReadingViewport({
        locator: Number(detail.locator || activeLocator),
        selection: quote,
      });
      textareaRef.current?.focus();
    };
    window.addEventListener(READER_ASK_EVENT, onAsk);
    return () => window.removeEventListener(READER_ASK_EVENT, onAsk);
  }, [activeLocator]);

  useEffect(() => {
    if (!material || material.unit !== "segment") return;
    const requestId = ++transcriptRequestRef.current;
    const limit = Math.min(material.unit_count, 160);
    void Promise.all(
      Array.from({ length: limit }, (_, index) => index + 1).map(
        async (locator) => {
          const unit = await getUnitText(material.material_id, locator);
          const ref = material.unit_refs.find((row) => row.locator === locator);
          if (unit.text === "[Transcript unavailable for this video.]") {
            return null;
          }
          return {
            locator,
            title: ref?.title || `${locator}`,
            text: unit.text,
            sourceHref: ref?.source_href || "",
          };
        },
      ),
    ).then((rows) => {
      if (transcriptRequestRef.current === requestId) {
        setTranscript(rows.filter((row): row is TranscriptRow => row !== null));
      }
    });
  }, [material]);

  const activeConversation = useMemo(
    () =>
      conversations.find((row) => row.session_id === state.sessionId) ??
      conversations.find((row) => row.session_id === sessionIdParam) ??
      null,
    [conversations, sessionIdParam, state.sessionId],
  );

  const linkedSessionIds = useMemo(
    () => activeConversation?.linked_session_ids ?? [],
    [activeConversation],
  );

  const send = useCallback(
    (value?: string) => {
      const content = (value ?? composer).trim();
      if (!content || state.isStreaming) return;
      if (selection) {
        setReadingViewport({
          locator: selection.locator,
          selection: selection.quote,
        });
      }
      sendMessage(
        content,
        undefined,
        undefined,
        undefined,
        linkedSessionIds,
      );
      setComposer("");
      setSelection(null);
      window.setTimeout(() => setReadingViewport({ selection: "" }), 0);
    }, [composer, linkedSessionIds, selection, sendMessage, state.isStreaming]);

  const switchMaterial = useCallback(
    async (candidate: ReadingLibraryMaterial) => {
      if (!workspace || candidate.material_id === workspace.active_material_id)
        return;
      const updated = await activateReadingMaterial(
        workspace.workspace_id,
        candidate.material_id,
      );
      setWorkspace(updated);
      setActiveLocator(1);
      reportViewport({ locator: 1, selection: "" });
    },
    [reportViewport, workspace],
  );

  useEffect(() => {
    const onReaderAction = (event: Event) => {
      const detail = (event as CustomEvent<ReaderActionPayload>).detail;
      if (detail?.reader_action !== "switch_tab" || !detail.material_id)
        return;
      const candidate = workspace?.tabs.find(
        (tab) => tab.material.material_id === detail.material_id,
      )?.material;
      if (candidate) void switchMaterial(candidate);
    };
    window.addEventListener(READER_ACTION_EVENT, onReaderAction);
    return () => window.removeEventListener(READER_ACTION_EVENT, onReaderAction);
  }, [switchMaterial, workspace?.tabs]);

  const removeMaterial = async (candidate: ReadingLibraryMaterial) => {
    if (!workspace) return;
    setWorkspace(
      await removeReadingWorkspaceMaterial(
        workspace.workspace_id,
        candidate.material_id,
      ),
    );
  };

  const newConversation = async () => {
    if (!workspace) return;
    const created = await createReadingConversation(
      workspace.workspace_id,
      t("New reading conversation"),
      workspace.active_material_id ?? "",
    );
    setConversations((current) => [created, ...current]);
    setShowSessions(false);
    router.push(`/reading/${workspace.workspace_id}/${created.session_id}`);
    await loadSession(created.session_id);
    setCapability(READING_CAPABILITY);
  };

  const handleOrganize = async () => {
    if (!workspace) return;
    try {
      setNotice(t("Organizing notes…"));
      const notes = await organizeReadingNotes(workspace.workspace_id);
      setOrganizedNotes(notes);
      setNotice(t("Notes organized with source provenance."));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t("Could not organize notes."));
    }
  };

  const handleMastery = async (bookId: string) => {
    if (!workspace) return;
    try {
      setNotice(t("Building Mastery Path…"));
      await generateMasteryPathFromReading(
        workspace.workspace_id,
        bookId.trim(),
      );
      setNotice(t("Mastery Path created. Open Learning Space to begin."));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t("Mastery Path creation failed."));
      throw caught;
    }
  };

  const renameWorkspace = async (title: string) => {
    if (!workspace) return;
    if (!title?.trim() || title.trim() === workspace.title) return;
    setWorkspace(
      await updateReadingWorkspace(workspace.workspace_id, {
        title: title.trim(),
      }),
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-[var(--background)] text-[12px] text-[var(--muted-foreground)] dark:bg-[var(--background)]">
        <Loader2 size={16} className="animate-spin" />
        {t("Opening reading workspace…")}
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--background)] px-6 text-center dark:bg-[var(--background)]">
        <CircleAlert size={25} className="text-[var(--primary)]" />
        <p className="mt-3 text-[13px] font-medium">{error}</p>
        <Link
          href="/reading"
          className="mt-5 rounded-xl bg-[var(--primary)] px-4 py-2 text-[11px] font-semibold text-[var(--primary-foreground)]"
        >
          {t("Back to library")}
        </Link>
      </div>
    );
  }

  if (!workspace) return null;

  const activeExtractor = material?.extractor || "";
  const transcriptUnavailable = [
    "youtube-no-captions",
    "bilibili-no-subtitles",
    "bilibili-chapters-only",
  ].includes(activeExtractor);
  const chaptersOnly = activeExtractor === "bilibili-chapters-only";

  const isMedia =
    activeTab?.material.source_kind === "youtube" ||
    activeTab?.material.render_mode === "video" ||
    activeTab?.material.render_mode === "audio";

  return (
    <main className="reading-v2 flex h-full min-h-0 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)] dark:bg-[var(--background)] dark:text-[var(--foreground)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--secondary)] px-3 dark:border-[var(--border)] dark:bg-[var(--secondary)]">
        <Link
          href="/reading"
          className="flex size-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
          aria-label={t("Back to library")}
        >
          <ArrowLeft size={15} />
        </Link>
        <span className="mx-1 h-5 w-px bg-[var(--card)]" />
        <BookOpenText size={15} className="text-[var(--primary)]" />
        <button
          type="button"
          onClick={() => setShowRename(true)}
          className="max-w-[340px] truncate font-serif text-[14px] font-semibold tracking-[-0.01em] hover:text-[var(--primary)]"
          title={t("Rename workspace")}
        >
          {workspace.title}
        </button>
        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--muted-foreground)] dark:bg-[var(--muted)]">
          {t("{{count}} sources", { count: workspace.tabs.length })}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {notice && (
            <span className="hidden max-w-[260px] truncate px-2 text-[10px] text-[var(--muted-foreground)] 2xl:inline">
              {notice}
            </span>
          )}
          <WorkspaceAction
            icon={StickyNote}
            label={t("Organize notes")}
            onClick={() => void handleOrganize()}
          />
          <WorkspaceAction
            icon={NotebookPen}
            label={t("Send to Notebook")}
            onClick={() => setShowNotebook(true)}
          />
          <WorkspaceAction
            icon={GraduationCap}
            label={t("Build Mastery Path")}
            onClick={() => setShowMastery(true)}
          />
          <span className="mx-1 h-5 w-px bg-[var(--card)]" />
          <WorkspaceAction
            icon={companionOpen ? PanelRightClose : PanelRightOpen}
            label={t("AI Companion")}
            onClick={() => {
              setNavigatorOpen(false);
              setCompanionOpen((current) => !current);
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (window.matchMedia("(min-width: 1024px)").matches) {
                setNavigatorCollapsed((current) => !current);
              } else {
                setCompanionOpen(false);
                setNavigatorOpen((current) => !current);
              }
            }}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--primary)]"
            aria-label={
              navigatorCollapsed ? t("Expand contents") : t("Collapse contents")
            }
            aria-expanded={navigatorOpen || !navigatorCollapsed}
          >
            {navigatorCollapsed ? (
              <PanelLeftOpen size={14} />
            ) : (
              <PanelLeftClose size={14} />
            )}
          </button>
        </div>
      </header>

      <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--card)] px-3 dark:border-[var(--border)] dark:bg-[var(--card)]">
        {workspace.tabs.map((tab) => {
          const active = tab.material.material_id === workspace.active_material_id;
          const TabIcon = iconForMaterial(tab.material);
          return (
            <div
              key={tab.material.material_id}
              className={`group/tab flex h-9 max-w-[230px] shrink-0 items-center gap-2 rounded-t-xl border border-b-0 px-3 transition ${
                active
                  ? "border-[var(--border)] bg-[var(--background)] text-[var(--primary)] dark:border-[var(--border)] dark:bg-[var(--background)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              }`}
            >
              <button
                type="button"
                onClick={() => void switchMaterial(tab.material)}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                {tab.material.status === "processing" || tab.material.status === "queued" ? (
                  <Loader2 size={12} className="shrink-0 animate-spin" />
                ) : (
                  <TabIcon size={12} className="shrink-0" />
                )}
                <span className="truncate text-[10.5px] font-medium">
                  {tab.material.title}
                </span>
              </button>
              {workspace.tabs.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(tab.material)}
                  className="opacity-0 transition group-hover/tab:opacity-70 hover:!opacity-100"
                  aria-label={t("Remove source")}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setShowAddSource(true)}
          className="mb-1.5 ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          aria-label={t("Add source")}
        >
          <Plus size={12} />
        </button>
      </div>

      <div
        className={`relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden ${
          companionOpen
            ? navigatorCollapsed
              ? "grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(360px,1fr)_minmax(330px,420px)]"
              : "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(184px,230px)_minmax(360px,1fr)] xl:grid-cols-[minmax(184px,230px)_minmax(360px,1fr)_minmax(330px,420px)]"
            : navigatorCollapsed
              ? "grid-cols-[minmax(0,1fr)]"
              : "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(184px,230px)_minmax(0,1fr)]"
        }`}
      >
        {(navigatorOpen || companionOpen) && (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-[var(--overlay)] xl:hidden"
            onClick={() => {
              setNavigatorOpen(false);
              setCompanionOpen(false);
            }}
            aria-label={t("Close panels")}
          />
        )}
        <SourceNavigator
          material={activeTab?.material ?? null}
          outline={material?.outline ?? []}
          refs={material?.unit_refs ?? []}
          transcript={material?.unit === "segment" ? transcript : []}
          transcriptUnavailable={
            transcriptUnavailable
          }
          chaptersOnly={chaptersOnly}
          search={transcriptSearch}
          onSearch={setTranscriptSearch}
          activeLocator={activeLocator}
          annotationCount={annotations.length}
          unitCount={material?.unit_count ?? 0}
          mobileOpen={navigatorOpen}
          desktopOpen={!navigatorCollapsed}
          onMobileClose={() => setNavigatorOpen(false)}
          onCollapse={() => setNavigatorCollapsed(true)}
          onNavigate={(locator, quote) => {
            setActiveLocator(locator);
            reportViewport({ locator });
            setDocumentJump((current) => ({
              locator,
              quote,
              nonce: (current?.nonce ?? 0) + 1,
            }));
            if (quote) {
              setSelection({ quote, locator });
              setReadingViewport({ locator, selection: quote });
            }
          }}
        />

        <section className="relative min-h-0 min-w-0 overflow-hidden border-r border-[var(--border)] bg-[var(--secondary)] dark:border-[var(--border)] dark:bg-[var(--secondary)]">
          {!activeTab ? (
            <EmptyWorkspace onAdd={() => setShowAddSource(true)} />
          ) : activeTab.material.status === "failed" ? (
            <MaterialFailure
              material={activeTab.material}
              onRetry={async () => {
                await retryReadingMaterial(activeTab.material.material_id);
                await refresh();
              }}
            />
          ) : activeTab.material.status !== "ready" ? (
            <MaterialProcessing material={activeTab.material} />
          ) : isMedia ? (
            <MediaReadingStage
              key={activeTab.material.material_id}
              material={activeTab.material}
              title={activeTab.material.title}
              refs={material?.unit_refs ?? []}
              transcriptUnavailable={
                transcriptUnavailable
              }
              chaptersOnly={chaptersOnly}
              activeLocator={activeLocator}
              onLocatorChange={(locator) => {
                setActiveLocator(locator);
                reportViewport({ locator });
              }}
            />
          ) : (
            <div className="h-full [&>div]:border-r-0">
              <ReaderPane
                embedded
                externalJump={documentJump}
                onClose={() => router.push("/reading")}
              />
            </div>
          )}

          {selection && (
            <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[82%] -translate-x-1/2 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 shadow-[0_12px_36px_rgba(0,0,0,.16)] dark:border-[var(--border)] dark:bg-[var(--popover)]">
              <Highlighter size={13} className="shrink-0 text-[var(--primary)]" />
              <p className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                “{selection.quote}”
              </p>
              <button
                type="button"
                onClick={() => textareaRef.current?.focus()}
                className="shrink-0 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[9.5px] font-semibold text-[var(--primary-foreground)]"
              >
                {t("Ask AI")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelection(null);
                  setReadingViewport({ selection: "" });
                }}
              >
                <X size={11} />
              </button>
            </div>
          )}
        </section>

        {companionOpen && (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,100%)] min-h-0 min-w-0 flex-col bg-[var(--card)] shadow-[-18px_0_42px_rgba(0,0,0,.12)] dark:bg-[var(--background)] xl:static xl:w-auto xl:shadow-none">
            <div className="relative flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 dark:border-[var(--border)]">
              <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--muted)] text-[var(--primary)] dark:bg-[var(--muted)]">
                <Sparkles size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-semibold">{t("AI Companion")}</p>
                <p className="truncate text-[8.5px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                  {activeTab?.material.title || t("Grounded in your sources")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLinker(true)}
                className={`flex size-7 items-center justify-center rounded-lg transition ${
                  linkedSessionIds.length
                    ? "bg-[var(--muted)] text-[var(--primary)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                }`}
                title={t("Link earlier reading conversations")}
              >
                <Link2 size={13} />
              </button>
              <button
                type="button"
                onClick={() => setShowSessions((current) => !current)}
                className="flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                title={t("Reading conversations")}
                aria-label={t("Reading conversations")}
                aria-expanded={showSessions}
              >
                <History size={12} />
                <ChevronDown size={10} />
              </button>
              <button
                type="button"
                onClick={() => setCompanionOpen(false)}
                className="flex size-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] xl:hidden"
                aria-label={t("Close AI Companion")}
              >
                <X size={12} />
              </button>
              {showSessions && (
                <ConversationMenu
                  conversations={conversations}
                  activeSessionId={state.sessionId}
                  onSelect={async (sessionId) => {
                    setShowSessions(false);
                    router.push(`/reading/${workspaceId}/${sessionId}`);
                    await loadSession(sessionId);
                    setCapability(READING_CAPABILITY);
                  }}
                  onNew={() => void newConversation()}
                />
              )}
            </div>

            <QuickReadingActions
              onAction={send}
              onOrganize={() => void handleOrganize()}
              sourceCount={workspace.tabs.length}
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 [scrollbar-gutter:stable]">
              {state.messages.length ? (
                <ChatMessageList
                  messages={state.messages}
                  isStreaming={state.isStreaming}
                  sessionId={state.sessionId}
                  language={state.language}
                  onCopyAssistantMessage={async (content) => {
                    await navigator.clipboard.writeText(content);
                  }}
                  onRegenerateMessage={regenerateLastMessage}
                  onDeleteTurn={deleteTurn}
                  selectedBranches={state.selectedBranches}
                  onEditMessage={editMessage}
                  onSwitchBranch={switchBranch}
                  onSubmitUserReply={submitUserReply}
                />
              ) : (
                <CompanionWelcome
                  title={activeTab?.material.title ?? ""}
                  onAction={send}
                />
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--card)] p-3 dark:border-[var(--border)] dark:bg-[var(--secondary)]">
              {selection && (
                <div className="mb-2 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 dark:border-[var(--border)] dark:bg-[var(--card)]">
                  <Highlighter size={12} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                  <p className="line-clamp-2 min-w-0 flex-1 text-[9.5px] leading-relaxed text-[var(--muted-foreground)]">
                    {selection.quote}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelection(null);
                      setReadingViewport({ selection: "" });
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
              {!!linkedSessionIds.length && (
                <div className="mb-2 flex items-center gap-1.5 text-[9px] text-[var(--muted-foreground)]">
                  <Link2 size={10} />
                  {t("Using {{count}} linked conversations as context", {
                    count: linkedSessionIds.length,
                  })}
                </div>
              )}
              <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-[0_8px_24px_rgba(0,0,0,.06)] focus-within:border-[var(--border)] dark:border-[var(--border)] dark:bg-[var(--card)]">
                <textarea
                  ref={textareaRef}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder={t("Ask about this source…")}
                  className="max-h-32 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-[11.5px] leading-relaxed outline-none placeholder:text-[var(--muted-foreground)]"
                />
                <button
                  type="button"
                  onClick={state.isStreaming ? cancelStreamingTurn : () => send()}
                  disabled={!state.isStreaming && !composer.trim()}
                  className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-50"
                  aria-label={state.isStreaming ? t("Stop") : t("Send")}
                >
                  {state.isStreaming ? <Square size={11} /> : <Send size={12} />}
                </button>
              </div>
              <p className="mt-1.5 text-center text-[8.5px] text-[var(--muted-foreground)]">
                {t("Answers stay bound to the active source unless you switch tabs.")}
              </p>
            </div>
          </aside>
        )}
      </div>

      {removeTarget && (
        <WorkspaceConfirmDialog
          title={t("Remove source")}
          body={`${t("Remove this source from the workspace?")} ${removeTarget.title}`}
          actionLabel={t("Remove")}
          onClose={() => setRemoveTarget(null)}
          onConfirm={async () => {
            await removeMaterial(removeTarget);
            setRemoveTarget(null);
          }}
        />
      )}

      {showRename && (
        <WorkspaceValueDialog
          title={t("Rename workspace")}
          label={t("Workspace title")}
          initialValue={workspace.title}
          actionLabel={t("Save")}
          onClose={() => setShowRename(false)}
          onSubmit={async (value) => {
            await renameWorkspace(value);
            setShowRename(false);
          }}
        />
      )}

      {showMastery && (
        <WorkspaceValueDialog
          title={t("Build Mastery Path")}
          label={t("Choose a Mastery Path ID for this reading workspace")}
          initialValue={`reading-${workspace.workspace_id.slice(0, 8)}`}
          actionLabel={t("Build Mastery Path")}
          onClose={() => setShowMastery(false)}
          onSubmit={async (value) => {
            await handleMastery(value);
            setShowMastery(false);
          }}
        />
      )}

      {showAddSource && (
        <WorkspaceSourceDialog
          workspace={workspace}
          onClose={() => setShowAddSource(false)}
          onAdded={(updated) => {
            setWorkspace(updated);
            setShowAddSource(false);
          }}
        />
      )}

      {showLinker && activeConversation && (
        <ConversationLinkDialog
          conversations={conversations}
          current={activeConversation}
          onClose={() => setShowLinker(false)}
          onSave={async (ids) => {
            for (const id of ids) {
              if (!linkedSessionIds.includes(id)) {
                await linkReadingConversation(
                  workspaceId,
                  activeConversation.session_id,
                  id,
                );
              }
            }
            for (const id of linkedSessionIds) {
              if (!ids.includes(id)) {
                await unlinkReadingConversation(
                  workspaceId,
                  activeConversation.session_id,
                  id,
                );
              }
            }
            setConversations(await listReadingConversations(workspaceId));
            setShowLinker(false);
          }}
        />
      )}

      {showNotebook && (
        <NotebookCaptureDialog
          workspaceId={workspaceId}
          onClose={() => setShowNotebook(false)}
          onSaved={() => {
            setShowNotebook(false);
            setNotice(t("Reading notes sent to Notebook."));
          }}
        />
      )}

      {organizedNotes && (
        <OrganizedNotesDialog
          notes={organizedNotes}
          onClose={() => setOrganizedNotes(null)}
        />
      )}
    </main>
  );
}

function iconForMaterial(material: ReadingLibraryMaterial) {
  if (material.source_kind === "youtube") return Youtube;
  if (material.source_kind === "bilibili") return Film;
  if (material.render_mode === "video") return Film;
  if (material.render_mode === "audio") return FileAudio;
  return FileText;
}

function WorkspaceAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof StickyNote;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--primary)]"
    >
      <Icon size={13} />
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}

function SourceNavigator({
  material,
  outline,
  refs,
  transcript,
  transcriptUnavailable,
  chaptersOnly,
  search,
  onSearch,
  activeLocator,
  annotationCount,
  unitCount,
  mobileOpen,
  desktopOpen,
  onMobileClose,
  onCollapse,
  onNavigate,
}: {
  material: ReadingLibraryMaterial | null;
  outline: OutlineRow[];
  refs: UnitReference[];
  transcript: TranscriptRow[];
  transcriptUnavailable: boolean;
  chaptersOnly: boolean;
  search: string;
  onSearch: (value: string) => void;
  activeLocator: number;
  annotationCount: number;
  unitCount: number;
  mobileOpen: boolean;
  desktopOpen: boolean;
  onMobileClose: () => void;
  onCollapse: () => void;
  onNavigate: (locator: number, quote?: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const mediaSource =
    material?.render_mode === "video" ||
    material?.render_mode === "audio" ||
    material?.source_kind === "youtube" ||
    material?.source_kind === "bilibili";
  const isPdf = material?.render_mode === "pdf";
  const reliableOutline = isPdf
    ? outline.filter((row) => !row.synthesised)
    : outline;
  const pageFallback = isPdf && reliableOutline.length === 0 && unitCount > 0;
  const documentOutline: OutlineRow[] = pageFallback
    ? Array.from({ length: unitCount }, (_, index) => ({
        locator: index + 1,
        title: t("Page {{page}}", { page: index + 1 }),
        level: 1,
        synthesised: false,
      }))
    : reliableOutline;
  const documentTree = useMemo(
    () => filterOutlineNodes(buildOutlineTree(documentOutline), search),
    [documentOutline, search],
  );
  const activeDocumentRow = documentOutline.reduce<OutlineRow | null>(
    (active, row) => (row.locator <= activeLocator ? row : active),
    null,
  );
  const outlineRows = outline.length
    ? outline.map((row) => ({
          locator: row.locator,
          title: chaptersOnly
            ? formatMediaTime(
                timeFromSourceHref(
                  refs.find((ref) => ref.locator === row.locator)?.source_href || "",
                ) || 0,
              )
            : refs.find((ref) => ref.locator === row.locator)?.title ||
              String(row.locator).padStart(2, "0"),
          text: row.title,
          sourceHref: refs.find((ref) => ref.locator === row.locator)?.source_href || "",
        }))
      : refs.map((row) => ({
          locator: row.locator,
          title: String(row.locator).padStart(2, "0"),
          text: row.title || "",
          sourceHref: row.source_href,
        }));
  const rows = transcriptUnavailable
    ? chaptersOnly
      ? outlineRows.filter((row) =>
          `${row.title} ${row.text}`.toLowerCase().includes(search.toLowerCase()),
        )
      : []
    : transcript.length
      ? transcript.filter((row) =>
          `${row.title} ${row.text}`.toLowerCase().includes(search.toLowerCase()),
        )
      : outlineRows;
  const rowCount = mediaSource ? rows.length : documentOutline.length;

  return (
    <aside
      className={`${
        mobileOpen
          ? "absolute inset-y-0 left-0 z-30 flex w-[min(300px,88vw)] shadow-[18px_0_42px_rgba(0,0,0,.12)]"
          : "hidden"
      } min-h-0 min-w-0 flex-col border-r border-[var(--border)] bg-[var(--secondary)] dark:border-[var(--border)] dark:bg-[var(--secondary)] ${
        desktopOpen
          ? "lg:static lg:flex lg:w-auto lg:shadow-none"
          : "lg:hidden"
      }`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 dark:border-[var(--border)]">
        <ListTree size={13} className="text-[var(--primary)]" />
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">
          {material?.render_mode === "video" ||
          material?.render_mode === "audio" ||
          material?.source_kind === "youtube"
            ? chaptersOnly
              ? t("Chapters")
              : t("Transcript")
            : pageFallback
              ? t("Pages")
              : t("Contents")}
        </p>
        {!!annotationCount && (
          <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[8.5px] text-[var(--muted-foreground)]">
            {annotationCount}
          </span>
        )}
        <button
          type="button"
          onClick={onMobileClose}
          className="flex size-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] lg:hidden"
          aria-label={t("Close contents")}
        >
          <X size={11} />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          className="hidden size-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] lg:flex"
          aria-label={t("Collapse contents")}
        >
          <PanelLeftClose size={12} />
        </button>
      </div>
      <label className="mx-2 mt-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 dark:border-[var(--border)] dark:bg-[var(--card)]">
        <Search size={11} className="text-[var(--muted-foreground)]" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t("Search this source")}
          className="min-w-0 flex-1 bg-transparent text-[10px] outline-none"
        />
      </label>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!rowCount ? (
          <div className="px-2 py-4 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
            {mediaSource && transcriptUnavailable ? (
              <>
                <p className="font-medium text-[var(--muted-foreground)]">
                  {t("No transcript available")}
                </p>
                <p className="mt-1">
                  {t("Playback still works. Transcript-grounded explanation and timestamp search are unavailable for this video.")}
                </p>
              </>
            ) : (
              <p>
                {material?.status === "ready"
                  ? t("This source has no navigable outline yet.")
                  : t("Source structure will appear after processing.")}
              </p>
            )}
          </div>
        ) : mediaSource ? (
          rows.map((row) => (
            <button
              key={row.locator}
              type="button"
              onClick={() =>
                onNavigate(
                  row.locator,
                  !chaptersOnly && transcript.length ? row.text : undefined,
                )
              }
              className={`group mb-0.5 flex w-full gap-2 rounded-lg px-2 py-2 text-left transition ${
                activeLocator === row.locator
                  ? "bg-[var(--muted)] text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              }`}
            >
              <span className="mt-0.5 w-9 shrink-0 text-[8.5px] font-medium tabular-nums text-[var(--primary)]">
                {row.title || row.locator}
              </span>
              <span className="line-clamp-3 text-[9.5px] leading-[1.45]">
                {row.text}
              </span>
            </button>
          ))
        ) : (
          <WorkspaceOutlineBranch
            nodes={documentTree}
            activeRow={activeDocumentRow}
            pageFallback={pageFallback}
            collapsedNodes={search ? new Set() : collapsedNodes}
            onToggle={(key) =>
              setCollapsedNodes((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onNavigate={onNavigate}
          />
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--border)] px-3 py-2 text-[8.5px] text-[var(--muted-foreground)] dark:border-[var(--border)]">
        {material?.status === "ready"
          ? mediaSource
            ? t("{{count}} passages available to the companion", { count: rowCount })
            : pageFallback
              ? t("{{count}} pages", { count: rowCount })
              : t("{{count}} outline entries", { count: rowCount })
          : t(material?.status || "queued")}
      </div>
    </aside>
  );
}

function WorkspaceOutlineBranch({
  nodes,
  activeRow,
  pageFallback,
  collapsedNodes,
  onToggle,
  onNavigate,
  depth = 0,
}: {
  nodes: OutlineNode[];
  activeRow: OutlineRow | null;
  pageFallback: boolean;
  collapsedNodes: Set<string>;
  onToggle: (key: string) => void;
  onNavigate: (locator: number) => void;
  depth?: number;
}) {
  const { t } = useTranslation();
  return (
    <ul className={depth ? "ml-2 border-l border-[var(--border)] pl-1" : ""}>
      {nodes.map((node) => {
        const key = `${node.row.locator}-${node.row.title}`;
        const active = node.row === activeRow;
        const collapsed = collapsedNodes.has(key);
        return (
          <li key={key} className="mb-0.5 min-w-0">
            <div
              className={`group flex items-center gap-1 rounded-lg transition ${
                active
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <button
                type="button"
                onClick={() => onNavigate(node.row.locator)}
                className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
              >
                <span className="mt-0.5 w-8 shrink-0 text-[8.5px] font-medium tabular-nums text-[var(--primary)]">
                  {pageFallback
                    ? String(node.row.locator).padStart(2, "0")
                    : t("p. {{page}}", { page: node.row.locator })}
                </span>
                <span className="line-clamp-3 min-w-0 text-[9.5px] leading-[1.45]">
                  {node.row.title}
                </span>
              </button>
              {node.children.length > 0 && (
                <button
                  type="button"
                  onClick={() => onToggle(key)}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? t("Expand section") : t("Collapse section")}
                  className="mr-1 shrink-0 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                >
                  {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
            </div>
            {node.children.length > 0 && !collapsed && (
              <WorkspaceOutlineBranch
                nodes={node.children}
                activeRow={activeRow}
                pageFallback={pageFallback}
                collapsedNodes={collapsedNodes}
                onToggle={onToggle}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MediaReadingStage({
  material,
  title,
  refs,
  transcriptUnavailable,
  chaptersOnly,
  activeLocator,
  onLocatorChange,
}: {
  material: ReadingLibraryMaterial;
  title: string;
  refs: UnitReference[];
  transcriptUnavailable: boolean;
  chaptersOnly: boolean;
  activeLocator: number;
  onLocatorChange: (locator: number) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controllerRef = useRef<ReadingMediaController | null>(null);
  const onLocatorChangeRef = useRef(onLocatorChange);
  const activeLocatorRef = useRef(activeLocator);
  const playbackLocatorRef = useRef(0);
  const stateRef = useRef({ time: 0, duration: 0 });
  const lastSavedRef = useRef(0);
  const youtubeId = youtubeVideoId(material.source_url);
  const bilibiliSource = useMemo(
    () => parseBilibiliSource(material.source_url),
    [material.source_url],
  );
  const sourceEntryTime =
    material.source_kind === "bilibili"
      ? bilibiliSource?.startSeconds || 0
      : youtubeEntryTime(material.source_url);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(material.duration_seconds || 0);
  const [startSeconds, setStartSeconds] = useState(sourceEntryTime);
  const [playerError, setPlayerError] = useState("");
  const activeRef = refs.find((row) => row.locator === activeLocator);
  const timedRefs = useMemo(
    () =>
      refs
        .map((row) => ({ ...row, time: timeFromSourceHref(row.source_href) }))
        .filter((row) => row.time !== null)
        .sort((left, right) => Number(left.time) - Number(right.time)),
    [refs],
  );

  useEffect(() => {
    onLocatorChangeRef.current = onLocatorChange;
  }, [onLocatorChange]);

  const notifyLocator = useCallback((locator: number) => {
    onLocatorChangeRef.current(locator);
  }, []);

  useEffect(() => {
    activeLocatorRef.current = activeLocator;
  }, [activeLocator]);

  const locatorAtTime = useCallback(
    (seconds: number) => {
      let locator = timedRefs[0]?.locator ?? 1;
      for (const row of timedRefs) {
        if (Number(row.time) > seconds + 0.05) break;
        locator = row.locator;
      }
      return locator;
    },
    [timedRefs],
  );

  const persist = useCallback(() => {
    const current = stateRef.current;
    if (current.time < 0 || !refs.length) return;
    const locator = Math.max(1, activeLocatorRef.current || locatorAtTime(current.time));
    void saveReadingPosition(material.material_id, {
      locator,
      source_anchor: `#t=${Math.floor(current.time)}`,
      percentage:
        current.duration > 0
          ? Math.min(1, Math.max(0, current.time / current.duration))
          : 0,
    }).catch(() => undefined);
    lastSavedRef.current = current.time;
  }, [locatorAtTime, material.material_id, refs.length]);

  const handleTime = useCallback(
    (nextTime: number, nextDuration: number) => {
      stateRef.current = { time: nextTime, duration: nextDuration };
      setTime(nextTime);
      setDuration(nextDuration);
      setReadingViewport({ timeSeconds: nextTime });
      const locator = locatorAtTime(nextTime);
      if (locator && locator !== activeLocatorRef.current) {
        playbackLocatorRef.current = locator;
        activeLocatorRef.current = locator;
        notifyLocator(locator);
      }
      if (Math.abs(nextTime - lastSavedRef.current) >= 5) persist();
    },
    [locatorAtTime, notifyLocator, persist],
  );

  const handleController = useCallback(
    (controller: ReadingMediaController | null) => {
      controllerRef.current = controller;
    },
    [],
  );

  const handlePlayerError = useCallback(
    (error: number | string) => {
      if (error === 101 || error === 150) {
        setPlayerError(
          t("This video's owner disabled embedded playback. Open it on YouTube; DeepTutor can still use captions when they are available."),
        );
      } else if (error === 153) {
        setPlayerError(
          t("YouTube could not verify this embedded player. Open the official video, or check the browser's referrer policy."),
        );
      } else if (typeof error === "number") {
        setPlayerError(t("YouTube playback failed ({{code}}).", { code: error }));
      } else {
        setPlayerError(error);
      }
    },
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    void getReadingPosition(material.material_id)
      .then((position) => {
        if (cancelled) return;
        const savedTime = timeFromSourceHref(position.source_anchor);
        const entry =
          material.source_kind === "bilibili"
            ? parseBilibiliSource(material.source_url)?.startSeconds || 0
            : youtubeEntryTime(material.source_url);
        const nextStart = savedTime ?? entry;
        setStartSeconds(nextStart);
        if (position.locator > 0 && refs.some((row) => row.locator === position.locator)) {
          activeLocatorRef.current = position.locator;
          notifyLocator(position.locator);
        }
        controllerRef.current?.seek(nextStart);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    material.material_id,
    material.source_kind,
    material.source_url,
    notifyLocator,
    refs,
  ]);

  useEffect(() => {
    if (
      material.source_kind === "youtube" ||
      material.source_kind === "bilibili"
    )
      return;
    const node =
      material.render_mode === "audio" ? audioRef.current : videoRef.current;
    if (!node) return;
    const controller = html5ReadingController(node);
    controllerRef.current = controller;
    const report = () => handleTime(controller.currentTime(), controller.duration());
    const ready = () => {
      if (startSeconds > 0) controller.seek(startSeconds);
      report();
    };
    node.addEventListener("loadedmetadata", ready);
    node.addEventListener("timeupdate", report);
    node.addEventListener("pause", persist);
    node.addEventListener("ended", persist);
    return () => {
      node.removeEventListener("loadedmetadata", ready);
      node.removeEventListener("timeupdate", report);
      node.removeEventListener("pause", persist);
      node.removeEventListener("ended", persist);
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.destroy();
    };
  }, [handleTime, material.render_mode, material.source_kind, persist, startSeconds]);

  useEffect(() => {
    if (playbackLocatorRef.current === activeLocator) {
      playbackLocatorRef.current = 0;
      return;
    }
    const target = timedRefs.find((row) => row.locator === activeLocator);
    if (target?.time !== null && target?.time !== undefined) {
      controllerRef.current?.seek(Number(target.time));
      setReadingViewport({
        locator: activeLocator,
        timeSeconds: Number(target.time),
      });
    }
  }, [activeLocator, timedRefs]);

  useEffect(() => {
    const onReaderAction = (event: Event) => {
      const detail = (event as CustomEvent<ReaderActionPayload>).detail;
      if (!detail || detail.material_id !== material.material_id) return;
      const locator = Number(detail.locator || 0);
      if (locator >= 1) notifyLocator(locator);
    };
    window.addEventListener(READER_ACTION_EVENT, onReaderAction);
    return () => window.removeEventListener(READER_ACTION_EVENT, onReaderAction);
  }, [material.material_id, notifyLocator]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      const seconds = mediaTimeFromHref(anchor?.getAttribute("href"));
      if (seconds === null) return;
      event.preventDefault();
      event.stopPropagation();
      controllerRef.current?.seek(seconds);
      const locator = locatorAtTime(seconds);
      if (locator) notifyLocator(locator);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [locatorAtTime, notifyLocator]);

  useEffect(() => {
    const onTurnEnd = (event: Event) => {
      if ((event as CustomEvent<{ moved?: boolean }>).detail?.moved) return;
      window.setTimeout(() => {
        const answers = document.querySelectorAll('[role="article"]');
        const anchor = answers[answers.length - 1]?.querySelector<HTMLAnchorElement>(
          'a[href^="#dt-media-time-"]',
        );
        const seconds = mediaTimeFromHref(anchor?.getAttribute("href"));
        if (seconds === null) return;
        controllerRef.current?.seek(seconds);
        notifyLocator(locatorAtTime(seconds));
      }, 120);
    };
    window.addEventListener(READER_TURN_END_EVENT, onTurnEnd);
    return () => window.removeEventListener(READER_TURN_END_EVENT, onTurnEnd);
  }, [locatorAtTime, notifyLocator]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      persist();
      setReadingViewport({ timeSeconds: null });
    };
  }, [persist]);

  const lastReferenceTime = timedRefs.length
    ? Number(timedRefs[timedRefs.length - 1].time || 0)
    : 0;
  const timelineDuration = Math.max(
    duration,
    material.duration_seconds || 0,
    lastReferenceTime,
  );
  const officialUrl = youtubeId
    ? `https://youtu.be/${youtubeId}?t=${Math.floor(time)}`
    : bilibiliSource
      ? bilibiliOfficialUrl(bilibiliSource, time)
      : "";
  const provider =
    material.source_kind === "youtube"
      ? "YouTube"
      : material.source_kind === "bilibili"
        ? "Bilibili"
        : t("Native media");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-3 dark:border-[var(--border)] dark:bg-[var(--background)]">
        <div className="min-w-0">
          <p className="truncate text-[10.5px] font-semibold">{title}</p>
          <p className="text-[8.5px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
            {provider} · {activeRef?.title || t("Transcript")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {officialUrl && (
            <a
              href={officialUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[8.5px] text-[var(--primary)] hover:underline"
            >
              {t("Open official")}
              <ExternalLink size={9} />
            </a>
          )}
          <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[8.5px] text-[var(--muted-foreground)] dark:border-[var(--border)] dark:bg-[var(--card)]">
            {t("Source grounded")}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-7">
        <div className="mx-auto flex h-full max-w-[980px] flex-col">
          {material.source_kind === "youtube" && youtubeId ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-[0_18px_50px_rgba(0,0,0,.18)]">
              <YouTubeReadingPlayer
                videoId={youtubeId}
                startSeconds={startSeconds}
                title={title}
                onController={handleController}
                onTime={handleTime}
                onPersist={persist}
                onError={handlePlayerError}
              />
            </div>
          ) : material.source_kind === "bilibili" && bilibiliSource ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-[0_18px_50px_rgba(0,0,0,.18)]">
              <BilibiliReadingPlayer
                key={`${material.material_id}-${Math.floor(startSeconds)}`}
                source={bilibiliSource}
                startSeconds={startSeconds}
                duration={timelineDuration}
                title={title}
                onController={handleController}
                onTime={handleTime}
              />
            </div>
          ) : material.render_mode === "audio" ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-[0_18px_50px_rgba(0,0,0,.08)] dark:border-[var(--border)] dark:bg-[var(--card)]">
              <span className="mb-5 flex size-20 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--primary)]">
                <FileAudio size={30} />
              </span>
              <p className="mb-5 max-w-md text-center font-serif text-[20px] font-medium">
                {title}
              </p>
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                src={rawMaterialUrl(material.material_id)}
                className="w-full max-w-xl"
              />
            </div>
          ) : (
            <video
              ref={videoRef}
              controls
              preload="metadata"
              poster={material.cover_url || undefined}
              src={rawMaterialUrl(material.material_id)}
              className="aspect-video w-full rounded-2xl bg-black object-contain shadow-[0_18px_50px_rgba(0,0,0,.18)]"
            />
          )}

          {(playerError || transcriptUnavailable) && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[9.5px] leading-relaxed text-[var(--muted-foreground)] dark:border-[var(--border)] dark:bg-[var(--card)]">
              {playerError ||
                (chaptersOnly
                  ? t("Only chapter markers are available for this video. You can navigate by chapter, but the companion will not treat them as a spoken transcript.")
                  : t("This video has no accessible transcript. Playback works, but the companion cannot ground explanations in its spoken content."))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 dark:border-[var(--border)] dark:bg-[var(--card)]">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--primary)]">
                {t("Current passage")}
              </p>
              <p className="mt-1 truncate text-[11px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {activeRef?.title || t("Beginning")}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onLocatorChange(Math.max(1, activeLocator - 1))}
                disabled={activeLocator <= 1}
                className="rounded-lg px-2 py-1 text-[9.5px] text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-30"
              >
                {t("Previous")}
              </button>
              <button
                type="button"
                onClick={() => onLocatorChange(Math.min(refs.length, activeLocator + 1))}
                disabled={activeLocator >= refs.length}
                className="rounded-lg px-2 py-1 text-[9.5px] text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-30"
              >
                {t("Next")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function timeFromSourceHref(value: string): number | null {
  const match = /^#t=(\d+(?:\.\d+)?)$/.exec(value || "");
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatMediaTime(value: number): string {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function QuickReadingActions({
  onAction,
  onOrganize,
  sourceCount,
}: {
  onAction: (prompt: string) => void;
  onOrganize: () => void;
  sourceCount: number;
}) {
  const { t } = useTranslation();
  const actions = [
    {
      label: t("Reading guide"),
      prompt: t("Create a concise reading guide for the active material. Identify its thesis, structure, difficult concepts, and the best order to study it. Cite every claim."),
    },
    {
      label: t("Summarize here"),
      prompt: t("Summarize the passage currently visible in the reader, explain why it matters, and cite the exact source location."),
    },
    ...(sourceCount > 1
      ? [
          {
            label: t("Compare sources"),
            prompt: t("Compare the materials open in this workspace. First list the tabs, then switch and read only the passages needed. Highlight agreements, tensions, and evidence with citations."),
          },
        ]
      : []),
  ];
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[var(--border)] px-3 py-2 dark:border-[var(--border)]">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onAction(action.prompt)}
          className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[8.8px] font-medium text-[var(--muted-foreground)] transition hover:border-[var(--border)] hover:text-[var(--primary)] dark:border-[var(--border)] dark:bg-[var(--card)]"
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onOrganize}
        className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[8.8px] font-medium text-[var(--muted-foreground)] hover:border-[var(--border)] hover:text-[var(--primary)] dark:border-[var(--border)] dark:bg-[var(--card)]"
      >
        {t("Organize notes")}
      </button>
    </div>
  );
}

function CompanionWelcome({
  title,
  onAction,
}: {
  title: string;
  onAction: (prompt: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-full max-w-[300px] flex-col items-center justify-center py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--muted)] text-[var(--primary)]">
        <BrainCircuit size={20} />
      </span>
      <p className="mt-4 font-serif text-[17px] font-medium tracking-[-0.01em]">
        {t("Read with a grounded companion")}
      </p>
      <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--muted-foreground)]">
        {title
          ? t("Ask about {{title}}, select a passage, or use a guided action above.", { title })
          : t("Open a source to begin a reading conversation.")}
      </p>
      <div className="mt-5 w-full space-y-2 text-left">
        {[t("Explain the key argument"), t("Challenge this evidence"), t("Turn this into study notes")].map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onAction(item)}
            className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-[9.5px] text-[var(--muted-foreground)] dark:border-[var(--border)] dark:bg-[var(--card)]"
          >
            <ChevronRight size={10} className="text-[var(--primary)]" />
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceSourceDialog({
  workspace,
  onClose,
  onAdded,
}: {
  workspace: ReadingWorkspace;
  onClose: () => void;
  onAdded: (workspace: ReadingWorkspace) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"files" | "links" | "library">("files");
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState("");
  const [library, setLibrary] = useState<ReadingLibraryMaterial[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const openIds = useMemo(
    () => new Set(workspace.tabs.map((tab) => tab.material.material_id)),
    [workspace.tabs],
  );

  useEffect(() => {
    if (mode !== "library") return;
    let cancelled = false;
    void listReadingLibraryMaterials()
      .then((rows) => {
        if (!cancelled) setLibrary(rows.filter((row) => !openIds.has(row.material_id)));
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : t("Could not load sources."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, openIds, t]);

  const submit = async () => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      if (mode === "files") {
        if (!files.length) throw new Error(t("Choose one or more files."));
        const uploaded = await Promise.all(files.map((file) => uploadMaterial(file)));
        let updated = workspace;
        for (const [index, item] of uploaded.entries()) {
          updated = await addReadingWorkspaceMaterial(
            workspace.workspace_id,
            item.material_id,
            index === 0,
          );
        }
        onAdded(updated);
        return;
      }
      if (mode === "links") {
        const urls = links
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean);
        if (!urls.length) throw new Error(t("Paste at least one URL."));
        const result = await importReadingUrls({
          urls,
          workspace_id: workspace.workspace_id,
        });
        onAdded(result.workspace);
        return;
      }
      if (!selectedMaterial) throw new Error(t("Choose a source from your library."));
      onAdded(
        await addReadingWorkspaceMaterial(
          workspace.workspace_id,
          selectedMaterial,
          true,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Source could not be added."));
    } finally {
      setWorking(false);
    }
  };

  return (
    <ModalShell title={t("Add source to workspace")} onClose={onClose}>
      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        {t("Each source opens as its own tab. The companion stays bound to one active tab at a time.")}
      </p>
      <div className="mt-4 flex rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 dark:border-[var(--border)] dark:bg-[var(--secondary)]">
        {([
          ["files", t("Files & media")],
          ["links", t("Web & video")],
          ["library", t("From library")],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-medium transition ${
              mode === value
                ? "bg-[var(--card)] text-[var(--primary)] shadow-sm dark:bg-[var(--card)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-40">
        {mode === "files" && (
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-5 text-center transition hover:border-[var(--border)] dark:border-[var(--border)] dark:bg-[var(--card)]">
            <FileText size={22} className="text-[var(--primary)]" />
            <span className="mt-2 text-[11px] font-medium">
              {files.length
                ? t("{{count}} files selected", { count: files.length })
                : t("Choose documents, slides, audio or video")}
            </span>
            <span className="mt-1 text-[9px] text-[var(--muted-foreground)]">
              {t("PDF, EPUB, DOCX, PPTX, text, MP3, WAV, MP4, MOV")}
            </span>
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
        )}
        {mode === "links" && (
          <label className="block">
            <span className="text-[10px] font-medium text-[var(--muted-foreground)]">{t("Links")}</span>
            <textarea
              value={links}
              onChange={(event) => setLinks(event.target.value)}
              rows={6}
              placeholder={t("One URL per line — articles, documentation, YouTube, or Bilibili")}
              className="mt-2 w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-[11px] leading-relaxed outline-none focus:border-[var(--ring)] dark:border-[var(--border)] dark:bg-[var(--card)]"
            />
          </label>
        )}
        {mode === "library" && (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {library.length ? (
              library.map((row) => {
                const selected = selectedMaterial === row.material_id;
                return (
                  <button
                    key={row.material_id}
                    type="button"
                    onClick={() => setSelectedMaterial(row.material_id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-[var(--border)] bg-[var(--muted)]"
                        : "border-[var(--border)] hover:bg-[var(--card)] dark:border-[var(--border)]"
                    }`}
                  >
                    <FileText size={14} className="shrink-0 text-[var(--primary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10.5px] font-medium">{row.title}</span>
                      <span className="mt-0.5 block text-[8.5px] uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                        {row.source_kind} · {t(row.status)}
                      </span>
                    </span>
                    {selected && <Check size={13} className="text-[var(--primary)]" />}
                  </button>
                );
              })
            ) : (
              <p className="py-12 text-center text-[10.5px] text-[var(--muted-foreground)]">
                {t("No unused sources in your library yet.")}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[10px] text-red-700">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-2 text-[11px]">
          {t("Cancel")}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={working}
          className="flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
        >
          {working && <Loader2 size={12} className="animate-spin" />}
          {working ? t("Adding…") : t("Add source")}
        </button>
      </div>
    </ModalShell>
  );
}

function ConversationMenu({
  conversations,
  activeSessionId,
  onSelect,
  onNew,
}: {
  conversations: ReadingConversation[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-2 top-10 z-50 w-64 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-[0_20px_50px_rgba(0,0,0,.18)] dark:border-[var(--border)] dark:bg-[var(--popover)]">
      <div className="mb-1 flex items-center justify-between px-2 py-1">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          {t("Reading conversations")}
        </p>
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-semibold text-[var(--primary)] hover:bg-[var(--muted)]"
        >
          <Plus size={10} /> {t("New")}
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {conversations.map((row) => (
          <button
            key={row.session_id}
            type="button"
            onClick={() => onSelect(row.session_id)}
            className={`mb-0.5 flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left ${
              row.session_id === activeSessionId
                ? "bg-[var(--muted)] text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            }`}
          >
            <MessageCirclePlus size={12} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium">{row.title}</p>
              <p className="mt-0.5 text-[8px] text-[var(--muted-foreground)]">
                {new Date(row.updated_at * 1000).toLocaleDateString()}
              </p>
            </div>
            {row.session_id === activeSessionId && <Check size={11} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConversationLinkDialog({
  conversations,
  current,
  onClose,
  onSave,
}: {
  conversations: ReadingConversation[];
  current: ReadingConversation;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(
    current.linked_session_ids ?? [],
  );
  const [saving, setSaving] = useState(false);
  const candidates = conversations.filter(
    (row) => row.session_id !== current.session_id,
  );
  return (
    <ModalShell title={t("Link reading conversations")} onClose={onClose}>
      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        {t("Linked conversations are passed explicitly as historical context. They remain separate and never appear in regular Chat history.")}
      </p>
      <div className="mt-4 max-h-72 space-y-1 overflow-y-auto">
        {candidates.length ? (
          candidates.map((row) => {
            const checked = selected.includes(row.session_id);
            return (
              <button
                key={row.session_id}
                type="button"
                onClick={() =>
                  setSelected((values) =>
                    checked
                      ? values.filter((id) => id !== row.session_id)
                      : [...values, row.session_id],
                  )
                }
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-3 text-left hover:bg-[var(--card)] dark:border-[var(--border)]"
              >
                <span
                  className={`flex size-4 items-center justify-center rounded border ${
                    checked
                      ? "border-[var(--border)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  {checked && <Check size={10} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px]">
                  {row.title}
                </span>
              </button>
            );
          })
        ) : (
          <p className="py-8 text-center text-[11px] text-[var(--muted-foreground)]">
            {t("Create another reading conversation first.")}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-2 text-[11px]">
          {t("Cancel")}
        </button>
        <button
          type="button"
          onClick={() => {
            setSaving(true);
            void onSave(selected).finally(() => setSaving(false));
          }}
          disabled={saving}
          className="flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {t("Link conversations")}
        </button>
      </div>
    </ModalShell>
  );
}

function NotebookCaptureDialog({
  workspaceId,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void listNotebooks()
      .then(setNotebooks)
      .catch((caught) => setError(caught instanceof Error ? caught.message : t("Could not load notebooks.")))
      .finally(() => setLoading(false));
  }, [t]);
  return (
    <ModalShell title={t("Send reading notes to Notebook")} onClose={onClose}>
      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        {t("Highlights and notes are organized by source and locator before they are copied. Your material stays private in the reading workspace.")}
      </p>
      <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={15} className="animate-spin" /></div>
        ) : notebooks.length ? (
          notebooks.map((notebook) => {
            const checked = selected.includes(notebook.id);
            return (
              <button
                key={notebook.id}
                type="button"
                onClick={() => setSelected((current) => checked ? current.filter((id) => id !== notebook.id) : [...current, notebook.id])}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-3 text-left hover:bg-[var(--card)] dark:border-[var(--border)]"
              >
                <span className={`flex size-4 items-center justify-center rounded border ${checked ? "border-[var(--border)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "border-[var(--border)]"}`}>
                  {checked && <Check size={10} />}
                </span>
                <NotebookPen size={13} className="text-[var(--primary)]" />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{notebook.name}</span>
                <span className="text-[9px] text-[var(--muted-foreground)]">{notebook.record_count ?? 0}</span>
              </button>
            );
          })
        ) : (
          <p className="py-8 text-center text-[11px] text-[var(--muted-foreground)]">{t("Create a Notebook first.")}</p>
        )}
      </div>
      {error && <p className="mt-3 text-[10px] text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-2 text-[11px]">{t("Cancel")}</button>
        <button
          type="button"
          disabled={!selected.length || saving}
          onClick={() => {
            setSaving(true);
            void sendReadingToNotebook(workspaceId, selected)
              .then(onSaved)
              .catch((caught) => setError(caught instanceof Error ? caught.message : t("Save failed.")))
              .finally(() => setSaving(false));
          }}
          className="flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {t("Send to Notebook")}
        </button>
      </div>
    </ModalShell>
  );
}

function OrganizedNotesDialog({
  notes,
  onClose,
}: {
  notes: OrganizedReadingNotes;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell title={t("Organized reading notes")} onClose={onClose} wide>
      <div className="mb-3 flex items-center justify-between text-[9.5px] text-[var(--muted-foreground)]">
        <span>{t("{{count}} annotations", { count: notes.annotation_count })}</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(notes.markdown)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-[var(--muted)]"
        >
          <Copy size={11} /> {t("Copy Markdown")}
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 font-sans text-[10.5px] leading-relaxed text-[var(--muted-foreground)] dark:border-[var(--border)] dark:bg-[var(--background)] dark:text-[var(--foreground)]">
        {notes.markdown}
      </pre>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]">
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl dark:border-[var(--border)] dark:bg-[var(--popover)]`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-[19px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function WorkspaceValueDialog({
  title,
  label,
  initialValue,
  actionLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  initialValue: string;
  actionLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (working || !value.trim()) return;
    setWorking(true);
    setError("");
    try {
      await onSubmit(value.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Save failed."));
    } finally {
      setWorking(false);
    }
  };

  return (
    <ModalShell title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
          {label}
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-[12px] font-normal normal-case tracking-normal outline-none focus:border-[var(--ring)] dark:border-[var(--border)] dark:bg-[var(--background)]"
          />
        </label>
        {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-[11px]">
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={working || !value.trim()}
            className="flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
          >
            {working && <Loader2 size={12} className="animate-spin" />}
            {actionLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function WorkspaceConfirmDialog({
  title,
  body,
  actionLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-[12px] leading-relaxed text-[var(--muted-foreground)]">{body}</p>
      {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-2 text-[11px]">
          {t("Cancel")}
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => {
            setWorking(true);
            setError("");
            void onConfirm()
              .catch((caught) =>
                setError(caught instanceof Error ? caught.message : t("Save failed.")),
              )
              .finally(() => setWorking(false));
          }}
          className="flex h-9 items-center gap-2 rounded-xl bg-red-700 px-4 text-[11px] font-semibold text-white disabled:opacity-60"
        >
          {working && <Loader2 size={12} className="animate-spin" />}
          {actionLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function EmptyWorkspace({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Library size={25} className="text-[var(--primary)]" />
      <p className="mt-3 font-serif text-[18px] font-medium">{t("Add a source to begin")}</p>
      <button type="button" onClick={onAdd} className="mt-5 rounded-xl bg-[var(--primary)] px-4 py-2 text-[11px] font-semibold text-[var(--primary-foreground)]">{t("Open library")}</button>
    </div>
  );
}

function MaterialProcessing({ material }: { material: ReadingLibraryMaterial }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
      <p className="mt-4 font-serif text-[18px] font-medium">{t("Preparing {{title}}", { title: material.title })}</p>
      <p className="mt-2 text-[10.5px] text-[var(--muted-foreground)]">{t("Extracting structure and grounded passages…")} {material.progress}%</p>
    </div>
  );
}

function MaterialFailure({
  material,
  onRetry,
}: {
  material: ReadingLibraryMaterial;
  onRetry: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  const retry = async () => {
    setRetrying(true);
    setRetryError("");
    try {
      await onRetry();
    } catch (caught) {
      setRetryError(
        caught instanceof Error ? caught.message : t("Try importing the source again."),
      );
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <CircleAlert size={24} className="text-red-600" />
      <p className="mt-4 font-serif text-[18px] font-medium">{t("This source could not be prepared")}</p>
      <p className="mt-2 max-w-lg text-[10.5px] leading-relaxed text-[var(--muted-foreground)]">{material.error_detail || t("Try importing the source again.")}</p>
      {retryError && (
        <p className="mt-2 max-w-lg text-[10.5px] text-red-700">{retryError}</p>
      )}
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[11px] font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        {retrying && <Loader2 size={12} className="animate-spin" />}
        {retrying ? t("Retrying…") : t("Retry")}
      </button>
    </div>
  );
}
