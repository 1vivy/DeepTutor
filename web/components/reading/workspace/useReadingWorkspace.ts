"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useReading } from "@/context/ReadingContext";
import { useUnifiedChat } from "@/context/UnifiedChatContext";
import { getMaterial, getUnitText } from "@/lib/reading-api";
import {
  READER_ACTION_EVENT,
  type ReaderActionPayload,
} from "@/lib/reading-reader-action";
import {
  READING_CAPABILITY,
  setReadingWorkspace,
} from "@/lib/reading-turn-state";
import {
  activateReadingMaterial,
  createReadingConversation,
  generateMasteryPathFromReading,
  getReadingWorkspace,
  listReadingConversations,
  organizeReadingNotes,
  removeReadingWorkspaceMaterial,
  updateReadingWorkspace,
  type OrganizedReadingNotes,
  type ReadingConversation,
  type ReadingLibraryMaterial,
  type ReadingWorkspace,
} from "@/lib/reading-workspace-api";
import type { TranscriptRow } from "./types";

/**
 * Everything the reading workspace needs from the network, in one place.
 *
 * The page component owns only what the reader touches directly — selection,
 * composer text, which panels are open. Hydration, polling, conversation
 * bootstrapping and the source lifecycle live here so the view stays readable
 * and each effect has one obvious owner.
 */
export function useReadingWorkspace(
  workspaceId: string,
  sessionIdParam: string | null,
) {
  const router = useRouter();
  const { t } = useTranslation();
  const {
    material,
    annotations,
    openMaterial,
    closeMaterial,
    reportViewport,
  } = useReading();
  const { state, setCapability, setTools, loadSession } = useUnifiedChat();

  const [workspace, setWorkspace] = useState<ReadingWorkspace | null>(null);
  const [conversations, setConversations] = useState<ReadingConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeLocator, setActiveLocator] = useState(1);
  const [transcript, setTranscript] = useState<TranscriptRow[]>([]);
  const [organizedNotes, setOrganizedNotes] =
    useState<OrganizedReadingNotes | null>(null);
  const sessionBootRef = useRef("");
  const transcriptRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const result = await getReadingWorkspace(workspaceId);
    const sessionRows = await listReadingConversations(workspaceId);
    setWorkspace(result.workspace);
    setConversations(sessionRows);
    return { workspace: result.workspace, sessions: sessionRows };
  }, [workspaceId]);

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
              : t("This collection could not be opened."),
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
      ) ??
      workspace?.tabs[0] ??
      null,
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

  // Poll while anything is still being processed, backing off as the wait
  // grows. A flat 2.5s forever means a source wedged in "processing" quietly
  // hammers the API for as long as the tab stays open.
  useEffect(() => {
    if (
      !workspace?.tabs.some(
        (tab) =>
          tab.material.status === "processing" ||
          tab.material.status === "queued",
      )
    )
      return;
    let attempt = 0;
    let timer = 0;
    const tick = () => {
      attempt += 1;
      void refresh().finally(() => {
        timer = window.setTimeout(
          tick,
          Math.min(2500 * 2 ** Math.floor(attempt / 4), 30_000),
        );
      });
    };
    timer = window.setTimeout(tick, 2500);
    return () => window.clearTimeout(timer);
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
    if (!material || material.unit !== "segment") return;
    const requestId = ++transcriptRequestRef.current;
    const limit = Math.min(material.unit_count, 160);
    void Promise.allSettled(
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
      // allSettled, not all: one unreadable segment must not discard the other
      // 159. `all` rejected the whole batch and, with no catch, left the
      // transcript silently empty behind an unhandled rejection.
    ).then((results) => {
      if (transcriptRequestRef.current !== requestId) return;
      const rows = results
        .filter(
          (result): result is PromiseFulfilledResult<TranscriptRow | null> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value)
        .filter((row): row is TranscriptRow => row !== null);
      setTranscript(rows);
      if (!rows.length && results.some((r) => r.status === "rejected")) {
        setNotice(t("This transcript could not be loaded."));
      }
    });
  }, [material, t]);

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

  const switchMaterial = useCallback(
    async (candidate: ReadingLibraryMaterial) => {
      if (!workspace || candidate.material_id === workspace.active_material_id)
        return;
      try {
        const updated = await activateReadingMaterial(
          workspace.workspace_id,
          candidate.material_id,
        );
        setWorkspace(updated);
        setActiveLocator(1);
        reportViewport({ locator: 1, selection: "" });
      } catch (caught) {
        // Without this the tab click is a no-op with no explanation, which is
        // indistinguishable from the click not registering at all.
        setNotice(
          caught instanceof Error
            ? caught.message
            : t("This material could not be opened."),
        );
      }
    },
    [reportViewport, t, workspace],
  );

  useEffect(() => {
    const onReaderAction = (event: Event) => {
      const detail = (event as CustomEvent<ReaderActionPayload>).detail;
      if (detail?.reader_action !== "switch_tab" || !detail.material_id) return;
      const candidate = workspace?.tabs.find(
        (tab) => tab.material.material_id === detail.material_id,
      )?.material;
      if (candidate) void switchMaterial(candidate);
    };
    window.addEventListener(READER_ACTION_EVENT, onReaderAction);
    return () => window.removeEventListener(READER_ACTION_EVENT, onReaderAction);
  }, [switchMaterial, workspace?.tabs]);

  const removeMaterial = useCallback(
    async (candidate: ReadingLibraryMaterial) => {
      if (!workspace) return;
      setWorkspace(
        await removeReadingWorkspaceMaterial(
          workspace.workspace_id,
          candidate.material_id,
        ),
      );
    },
    [workspace],
  );

  const newConversation = useCallback(async () => {
    if (!workspace) return;
    const created = await createReadingConversation(
      workspace.workspace_id,
      t("New reading conversation"),
      workspace.active_material_id ?? "",
    );
    setConversations((current) => [created, ...current]);
    router.push(`/reading/${workspace.workspace_id}/${created.session_id}`);
    await loadSession(created.session_id);
    setCapability(READING_CAPABILITY);
  }, [loadSession, router, setCapability, t, workspace]);

  const openConversation = useCallback(
    async (sessionId: string) => {
      router.push(`/reading/${workspaceId}/${sessionId}`);
      await loadSession(sessionId);
      setCapability(READING_CAPABILITY);
    },
    [loadSession, router, setCapability, workspaceId],
  );

  const organizeNotes = useCallback(async () => {
    if (!workspace) return;
    try {
      setNotice(t("Organizing notes…"));
      const notes = await organizeReadingNotes(workspace.workspace_id);
      setOrganizedNotes(notes);
      setNotice(t("Notes organized, each one citing where it came from."));
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : t("Could not organize notes."),
      );
    }
  }, [t, workspace]);

  const buildMasteryPath = useCallback(
    async (bookId: string) => {
      if (!workspace) return;
      try {
        setNotice(t("Building Mastery Path…"));
        await generateMasteryPathFromReading(
          workspace.workspace_id,
          bookId.trim(),
        );
        setNotice(t("Mastery Path created. Open Learning Space to begin."));
      } catch (caught) {
        setNotice(
          caught instanceof Error
            ? caught.message
            : t("Mastery Path creation failed."),
        );
        throw caught;
      }
    },
    [t, workspace],
  );

  const renameWorkspace = useCallback(
    async (title: string) => {
      if (!workspace) return;
      if (!title?.trim() || title.trim() === workspace.title) return;
      setWorkspace(
        await updateReadingWorkspace(workspace.workspace_id, {
          title: title.trim(),
        }),
      );
    },
    [workspace],
  );

  return {
    workspace,
    setWorkspace,
    conversations,
    setConversations,
    loading,
    error,
    notice,
    setNotice,
    material,
    annotations,
    activeTab,
    activeConversation,
    linkedSessionIds,
    activeLocator,
    setActiveLocator,
    transcript,
    organizedNotes,
    setOrganizedNotes,
    refresh,
    switchMaterial,
    removeMaterial,
    newConversation,
    openConversation,
    organizeNotes,
    buildMasteryPath,
    renameWorkspace,
    reportViewport,
  };
}
