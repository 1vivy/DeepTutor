"use client";

/**
 * StandaloneComposer — the main chat composer, wired up for a surface that
 * is not the main chat page.
 *
 * ``ChatComposer`` is deliberately stateless: the chat page owns every one
 * of its ~70 props. That is right for the page, but it means any *other*
 * surface that wants the same composer has to reproduce the whole state
 * pool — attachments, drag-and-drop, paste, the six reference pickers, the
 * KB and LLM lists, the menu click-outside handlers. This component owns
 * that pool once, mounts the pickers, and hands the caller a single
 * ``onSubmit`` carrying everything the user attached.
 *
 * The caller supplies only what is specific to its surface: which
 * capability is active, whether a turn is streaming, and where a send
 * should go.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import ChatComposer, {
  type CapabilityDef,
} from "@/components/chat/home/ChatComposer";
import type { SelectedHistorySession } from "@/components/chat/HistorySessionPicker";
import type { SelectedQuestionEntry } from "@/components/chat/QuestionBankPicker";
import { useAttachmentLimits } from "@/lib/attachment-limits";
import {
  selectedBooksToPayload,
  type BookReferencePayload,
  type SelectedBookReference,
} from "@/lib/book-references";
import { classifyFile, isSvgFilename } from "@/lib/doc-attachments";
import {
  extractBase64FromDataUrl,
  readFileAsDataUrl,
} from "@/lib/file-attachments";
import {
  listKnowledgeBases,
  type KnowledgeBaseSummary,
} from "@/lib/knowledge-api";
import { listLLMOptions, type LLMOption } from "@/lib/llm-options";
import type { SelectedRecord } from "@/lib/notebook-selection-types";
import type { SpaceMemoryFile } from "@/lib/space-items";
import type { LLMSelection } from "@/lib/unified-ws";

const NotebookRecordPicker = dynamic(
  () => import("@/components/notebook/NotebookRecordPicker"),
  { ssr: false },
);
const HistorySessionPicker = dynamic(
  () => import("@/components/chat/HistorySessionPicker"),
  { ssr: false },
);
const QuestionBankPicker = dynamic(
  () => import("@/components/chat/QuestionBankPicker"),
  { ssr: false },
);
const PersonaPicker = dynamic(() => import("@/components/chat/PersonaPicker"), {
  ssr: false,
});
const MemoryPicker = dynamic(() => import("@/components/chat/MemoryPicker"), {
  ssr: false,
});
const BookReferencePicker = dynamic(
  () => import("@/components/chat/BookReferencePicker"),
  { ssr: false },
);

interface PendingAttachment {
  type: string;
  filename: string;
  base64?: string;
  previewUrl?: string;
  size?: number;
  mimeType?: string;
}

/** Everything the user attached to this send, already in wire shape. */
export interface StandaloneComposerSubmission {
  content: string;
  attachments: Array<{
    type: string;
    filename?: string;
    base64?: string;
    mime_type?: string;
  }>;
  knowledgeBases: string[];
  notebookReferences: Array<{ notebook_id: string; record_ids: string[] }>;
  historyReferences: string[];
  bookReferences: BookReferencePayload[];
  questionNotebookReferences: number[];
  memoryReferences: SpaceMemoryFile[];
  persona: string | null;
  llmSelection: LLMSelection | null;
}

/** Single-entry capability list for surfaces locked to plain chat. */
const CHAT_ONLY_CAPABILITY = {
  value: "",
  label: "Chat",
  description: "Flexible conversation with any tool",
  icon: MessageSquare,
  allowedTools: [],
} satisfies CapabilityDef;

interface StandaloneComposerProps {
  /** Route a send. The composer clears its own transient selections after. */
  onSubmit: (submission: StandaloneComposerSubmission) => void;
  onCancelStreaming: () => void;
  isStreaming: boolean;
  /** Drives the composer's empty-state → conversation layout transition. */
  hasMessages: boolean;
  /** The live turn is paused on an ask_user card and needs an answer. */
  awaitingUserReply?: boolean;
  inputPlaceholder?: string;
  /**
   * Capability chip contents. Defaults to a locked "Chat" entry — pass a
   * one-entry list to relabel it, or several to make the chip a picker.
   */
  capabilities?: CapabilityDef[];
  activeCapValue?: string;
  onSelectCapability?: (value: string) => void;
  /** Drop the capability chip — for a surface that names its mode elsewhere. */
  showCapabilityChip?: boolean;
  /**
   * Knowledge-base scope and pinned model are session-level state on some
   * surfaces (mastery study) and composer-local on others (quiz follow-up).
   * Passing a value makes that control controlled; omitting it leaves the
   * composer owning it.
   */
  selectedKnowledgeBases?: string[];
  onKnowledgeBasesChange?: (names: string[]) => void;
  llmSelection?: LLMSelection | null;
  onLLMSelectionChange?: (selection: LLMSelection | null) => void;
  /** Hide the My Agents reference entry. */
  agentsAvailable?: boolean;
  /** Receives a function that drops text into the textarea (ask_user chips). */
  prefillInputRef?: React.MutableRefObject<((text: string) => void) | null>;
}

function StandaloneComposerImpl({
  onSubmit,
  onCancelStreaming,
  isStreaming,
  hasMessages,
  awaitingUserReply = false,
  inputPlaceholder,
  capabilities,
  activeCapValue,
  onSelectCapability,
  showCapabilityChip = true,
  selectedKnowledgeBases: controlledKnowledgeBases,
  onKnowledgeBasesChange,
  llmSelection: controlledLLMSelection,
  onLLMSelectionChange,
  agentsAvailable = false,
  prefillInputRef,
}: StandaloneComposerProps) {
  const { t } = useTranslation();

  // ── Composer DOM refs ─────────────────────────────────────────
  const composerRef = useRef<HTMLDivElement>(null);
  const capMenuRef = useRef<HTMLDivElement>(null);
  const capBtnRef = useRef<HTMLButtonElement>(null);
  const spaceMenuRef = useRef<HTMLDivElement>(null);
  const spaceBtnRef = useRef<HTMLButtonElement>(null);
  const dragCounter = useRef(0);

  // ── Composer local state ──────────────────────────────────────
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentLimits = useAttachmentLimits();
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const [capMenuOpen, setCapMenuOpen] = useState(false);
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);

  const [ownKnowledgeBases, setOwnKnowledgeBases] = useState<string[]>([]);
  const selectedKnowledgeBases = controlledKnowledgeBases ?? ownKnowledgeBases;
  const [selectedBookReferences, setSelectedBookReferences] = useState<
    SelectedBookReference[]
  >([]);
  const [selectedNotebookRecords, setSelectedNotebookRecords] = useState<
    SelectedRecord[]
  >([]);
  const [selectedHistorySessions, setSelectedHistorySessions] = useState<
    SelectedHistorySession[]
  >([]);
  const [selectedQuestionEntries, setSelectedQuestionEntries] = useState<
    SelectedQuestionEntry[]
  >([]);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [selectedMemoryFiles, setSelectedMemoryFiles] = useState<
    SpaceMemoryFile[]
  >([]);

  // ── Picker dialog visibility ──────────────────────────────────
  const [showNotebookPicker, setShowNotebookPicker] = useState(false);
  const [showBookPicker, setShowBookPicker] = useState(false);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [showQuestionBankPicker, setShowQuestionBankPicker] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [showMemoryPicker, setShowMemoryPicker] = useState(false);

  // ── Shared data (KBs + LLMs) ──────────────────────────────────
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>(
    [],
  );
  const [llmOptions, setLLMOptions] = useState<LLMOption[]>([]);
  const [activeLLMDefault, setActiveLLMDefault] = useState<LLMSelection | null>(
    null,
  );
  const [ownLLMSelection, setOwnLLMSelection] = useState<LLMSelection | null>(
    null,
  );
  const llmSelection = controlledLLMSelection ?? ownLLMSelection;
  const [llmOptionsLoading, setLLMOptionsLoading] = useState(true);
  const [llmOptionsError, setLLMOptionsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const list = await listKnowledgeBases({ force: false });
        // Connected subagents travel the same request path but are their own
        // composer control, so they never belong in the knowledge picker.
        if (!cancelled) {
          setKnowledgeBases(
            list.filter((kb) => kb.metadata?.type !== "subagent"),
          );
        }
      } catch {
        if (!cancelled) setKnowledgeBases([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLLMOptionsLoading(true);
      try {
        const payload = await listLLMOptions();
        if (cancelled) return;
        setLLMOptions(payload.options);
        setActiveLLMDefault(payload.active);
        setLLMOptionsError(false);
      } catch {
        if (cancelled) return;
        setLLMOptionsError(true);
        setLLMOptions([]);
        setActiveLLMDefault(null);
      } finally {
        if (!cancelled) setLLMOptionsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Default to the server-side active LLM until the user picks one. A
  // controlled surface owns that decision itself.
  useEffect(() => {
    if (controlledLLMSelection !== undefined) return;
    if (ownLLMSelection || !activeLLMDefault) return;
    setOwnLLMSelection(activeLLMDefault);
  }, [activeLLMDefault, controlledLLMSelection, ownLLMSelection]);

  const applyLLMSelection = useCallback(
    (selection: LLMSelection | null) => {
      if (controlledLLMSelection === undefined) setOwnLLMSelection(selection);
      onLLMSelectionChange?.(selection);
    },
    [controlledLLMSelection, onLLMSelectionChange],
  );

  const applyKnowledgeBases = useCallback(
    (names: string[]) => {
      if (controlledKnowledgeBases === undefined) setOwnKnowledgeBases(names);
      onKnowledgeBasesChange?.(names);
    },
    [controlledKnowledgeBases, onKnowledgeBasesChange],
  );

  // Click-outside handlers for menu chrome (cap / space).
  useEffect(() => {
    if (!capMenuOpen && !spaceMenuOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        capMenuOpen &&
        capMenuRef.current &&
        !capMenuRef.current.contains(target) &&
        capBtnRef.current &&
        !capBtnRef.current.contains(target)
      ) {
        setCapMenuOpen(false);
      }
      if (
        spaceMenuOpen &&
        spaceMenuRef.current &&
        !spaceMenuRef.current.contains(target) &&
        spaceBtnRef.current &&
        !spaceBtnRef.current.contains(target)
      ) {
        setSpaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [capMenuOpen, spaceMenuOpen]);

  // ── Attachment helpers ────────────────────────────────────────
  const showAttachmentError = useCallback((message: string) => {
    setAttachmentError(message);
    if (attachmentErrorTimer.current) {
      clearTimeout(attachmentErrorTimer.current);
    }
    attachmentErrorTimer.current = setTimeout(() => {
      setAttachmentError(null);
      attachmentErrorTimer.current = null;
    }, 4000);
  }, []);

  const fileToAttachment = useCallback(
    (f: File): Promise<PendingAttachment> =>
      new Promise((resolve, reject) => {
        readFileAsDataUrl(f)
          .then((raw) => {
            const svg = isSvgFilename(f.name) || f.type === "image/svg+xml";
            const isImage = !svg && f.type.startsWith("image/");
            const b64 = extractBase64FromDataUrl(raw);
            resolve({
              type: isImage ? "image" : "file",
              filename: f.name,
              base64: b64,
              previewUrl: isImage || svg ? raw : undefined,
              size: f.size,
              mimeType: f.type || undefined,
            });
          })
          .catch(reject);
      }),
    [],
  );

  const filterAndReportFiles = useCallback(
    (files: File[]): File[] => {
      let runningTotal = attachments.reduce((s, a) => s + (a.size ?? 0), 0);
      const accepted: File[] = [];
      const rejected: {
        name: string;
        reason: "unsupported" | "too_large" | "quota";
      }[] = [];
      for (const f of files) {
        const kind = classifyFile(f);
        if (!kind) {
          rejected.push({ name: f.name, reason: "unsupported" });
          continue;
        }
        if (f.size > attachmentLimits.maxFileBytes) {
          rejected.push({ name: f.name, reason: "too_large" });
          continue;
        }
        if (runningTotal + f.size > attachmentLimits.maxTotalBytes) {
          rejected.push({ name: f.name, reason: "quota" });
          break;
        }
        runningTotal += f.size;
        accepted.push(f);
      }
      if (rejected.length) {
        const first = rejected[0];
        let msg: string;
        if (first.reason === "too_large") {
          msg = t("File too large: {{name}}", { name: first.name });
        } else if (first.reason === "quota") {
          msg = t("Too many files, skipped some");
        } else {
          msg = t("Unsupported file type: {{name}}", { name: first.name });
        }
        showAttachmentError(msg);
      }
      return accepted;
    },
    [attachments, attachmentLimits, showAttachmentError, t],
  );

  const handleAddFiles = useCallback(
    async (files: File[]) => {
      const accepted = filterAndReportFiles(files);
      if (!accepted.length) return;
      const next = await Promise.all(accepted.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
    },
    [fileToAttachment, filterAndReportFiles],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      const items = Array.from(event.clipboardData.items);
      const files = items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      const accepted = filterAndReportFiles(files);
      if (!accepted.length) return;
      event.preventDefault();
      const next = await Promise.all(accepted.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
    },
    [fileToAttachment, filterAndReportFiles],
  );

  // ── Drag-and-drop on the composer surface ─────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragging(false);
      await handleAddFiles(Array.from(e.dataTransfer.files));
    },
    [handleAddFiles],
  );

  // ── Picker handlers ───────────────────────────────────────────
  // PageIndex-OSS bases are mutually exclusive — the engine answers from one
  // index at a time, so picking a second silently dropped the first.
  const handleToggleKB = useCallback(
    (name: string) => {
      const providerOf = (kbName: string) => {
        const kb = knowledgeBases.find((item) => item.name === kbName);
        return (
          (kb?.metadata?.rag_provider as string | undefined) ||
          (kb?.statistics?.rag_provider as string | undefined) ||
          ""
        );
      };
      if (selectedKnowledgeBases.includes(name)) {
        applyKnowledgeBases(selectedKnowledgeBases.filter((kb) => kb !== name));
        return;
      }
      const kept =
        providerOf(name) === "pageindex-oss"
          ? selectedKnowledgeBases.filter(
              (kb) => providerOf(kb) !== "pageindex-oss",
            )
          : selectedKnowledgeBases;
      applyKnowledgeBases([...kept, name]);
    },
    [applyKnowledgeBases, knowledgeBases, selectedKnowledgeBases],
  );

  const handleClearPersona = useCallback(() => setSelectedPersona(null), []);
  const handleToggleMemoryFile = useCallback((file: SpaceMemoryFile) => {
    setSelectedMemoryFiles((prev) =>
      prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file],
    );
  }, []);
  const handleRemoveHistory = useCallback((sessionId: string) => {
    setSelectedHistorySessions((prev) =>
      prev.filter((s) => s.sessionId !== sessionId),
    );
  }, []);
  const handleRemoveBookReference = useCallback((bookId: string) => {
    setSelectedBookReferences((prev) =>
      prev.filter((b) => b.bookId !== bookId),
    );
  }, []);
  const handleRemoveNotebook = useCallback((notebookId: string) => {
    setSelectedNotebookRecords((prev) =>
      prev.filter((r) => r.notebookId !== notebookId),
    );
  }, []);
  const handleRemoveQuestion = useCallback((entryId: number) => {
    setSelectedQuestionEntries((prev) => prev.filter((e) => e.id !== entryId));
  }, []);

  // ── References payloads ───────────────────────────────────────
  const notebookReferencesPayload = useMemo(() => {
    const grouped = new Map<string, string[]>();
    selectedNotebookRecords.forEach((record) => {
      const current = grouped.get(record.notebookId) || [];
      current.push(record.id);
      grouped.set(record.notebookId, current);
    });
    return Array.from(grouped.entries()).map(([notebook_id, record_ids]) => ({
      notebook_id,
      record_ids,
    }));
  }, [selectedNotebookRecords]);

  const notebookReferenceGroups = useMemo(
    () =>
      notebookReferencesPayload.map((ref) => {
        const sample = selectedNotebookRecords.find(
          (r) => r.notebookId === ref.notebook_id,
        );
        return {
          notebookId: ref.notebook_id,
          notebookName: sample?.notebookName ?? ref.notebook_id,
          count: ref.record_ids.length,
        };
      }),
    [notebookReferencesPayload, selectedNotebookRecords],
  );

  const handleSend = useCallback(
    (content: string) => {
      if (isStreaming && !awaitingUserReply) return;
      const hasReferences =
        attachments.length > 0 ||
        selectedBookReferences.length > 0 ||
        selectedNotebookRecords.length > 0 ||
        selectedHistorySessions.length > 0 ||
        selectedQuestionEntries.length > 0 ||
        !!selectedPersona ||
        selectedMemoryFiles.length > 0;
      if (!content.trim() && !hasReferences) return;

      onSubmit({
        content,
        attachments: attachments.map((a) => ({
          type: a.type,
          filename: a.filename,
          base64: a.base64,
          mime_type: a.mimeType,
        })),
        knowledgeBases: selectedKnowledgeBases,
        notebookReferences: notebookReferencesPayload,
        historyReferences: selectedHistorySessions.map((s) => s.sessionId),
        bookReferences: selectedBooksToPayload(selectedBookReferences),
        questionNotebookReferences: selectedQuestionEntries.map((e) => e.id),
        memoryReferences: [...selectedMemoryFiles],
        persona: selectedPersona,
        llmSelection,
      });

      // One-shot references are consumed by the send; the knowledge-base
      // scope is sticky and deliberately survives it.
      setAttachments([]);
      setSelectedBookReferences([]);
      setSelectedNotebookRecords([]);
      setSelectedHistorySessions([]);
      setSelectedQuestionEntries([]);
      setSelectedPersona(null);
      setSelectedMemoryFiles([]);
    },
    [
      attachments,
      awaitingUserReply,
      isStreaming,
      llmSelection,
      notebookReferencesPayload,
      onSubmit,
      selectedBookReferences,
      selectedHistorySessions,
      selectedKnowledgeBases,
      selectedMemoryFiles,
      selectedNotebookRecords,
      selectedPersona,
      selectedQuestionEntries,
    ],
  );

  const resolvedCapabilities = useMemo(() => {
    const list = capabilities?.length ? capabilities : [CHAT_ONLY_CAPABILITY];
    return list.map((cap) => ({
      ...cap,
      label: t(cap.label),
      description: t(cap.description),
    }));
  }, [capabilities, t]);
  const activeCap =
    resolvedCapabilities.find((cap) => cap.value === activeCapValue) ??
    resolvedCapabilities[0];

  return (
    <>
      <ChatComposer
        composerRef={composerRef}
        capMenuRef={capMenuRef}
        capBtnRef={capBtnRef}
        spaceMenuRef={spaceMenuRef}
        spaceBtnRef={spaceBtnRef}
        dragCounter={dragCounter}
        dragging={dragging}
        capMenuOpen={capMenuOpen}
        spaceMenuOpen={spaceMenuOpen}
        hasMessages={hasMessages}
        attachments={attachments}
        attachmentError={attachmentError}
        activeCap={activeCap}
        knowledgeBases={knowledgeBases}
        llmOptions={llmOptions}
        activeLLMDefault={activeLLMDefault}
        llmSelection={llmSelection}
        llmOptionsLoading={llmOptionsLoading}
        llmOptionsError={llmOptionsError}
        selectedBookReferences={selectedBookReferences}
        selectedNotebookRecords={selectedNotebookRecords}
        selectedHistorySessions={selectedHistorySessions}
        selectedAgentSessions={[]}
        selectedQuestionEntries={selectedQuestionEntries}
        notebookReferenceGroups={notebookReferenceGroups}
        selectedPersona={selectedPersona}
        selectedMemoryFiles={selectedMemoryFiles}
        selectedKnowledgeBases={selectedKnowledgeBases}
        isStreaming={isStreaming}
        awaitingUserReply={awaitingUserReply}
        isVisualizeMode={false}
        capabilityNeedsConfig={false}
        capabilityConfigConfirmed={true}
        onRequestConfigConfirm={() => {}}
        capabilities={resolvedCapabilities}
        onSetCapMenuOpen={setCapMenuOpen}
        onSetSpaceMenuOpen={setSpaceMenuOpen}
        onToggleKB={handleToggleKB}
        onSelectLLM={applyLLMSelection}
        onSelectNotebookPicker={() => setShowNotebookPicker(true)}
        onSelectBookPicker={() => setShowBookPicker(true)}
        onSelectHistoryPicker={() => setShowHistoryPicker(true)}
        agentsAvailable={agentsAvailable}
        onSelectAgentsPicker={() => {}}
        onSelectQuestionBankPicker={() => setShowQuestionBankPicker(true)}
        onSelectPersonaPicker={() => setShowPersonaPicker(true)}
        onSelectMemoryPicker={() => setShowMemoryPicker(true)}
        onClearPersona={handleClearPersona}
        onToggleMemoryFile={handleToggleMemoryFile}
        onSend={handleSend}
        onRemoveAttachment={removeAttachment}
        onRemoveHistory={handleRemoveHistory}
        onRemoveAgent={() => {}}
        onRemoveBookReference={handleRemoveBookReference}
        onRemoveNotebook={handleRemoveNotebook}
        onRemoveQuestion={handleRemoveQuestion}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onAddFiles={handleAddFiles}
        onSelectCapability={onSelectCapability ?? (() => {})}
        showCapabilityChip={showCapabilityChip}
        onCancelStreaming={onCancelStreaming}
        prefillInputRef={prefillInputRef}
        inputPlaceholder={inputPlaceholder}
      />

      <NotebookRecordPicker
        open={showNotebookPicker}
        onClose={() => setShowNotebookPicker(false)}
        onApply={(records: SelectedRecord[]) => {
          setSelectedNotebookRecords(records);
          setShowNotebookPicker(false);
        }}
      />
      <BookReferencePicker
        open={showBookPicker}
        initialReferences={selectedBookReferences}
        onClose={() => setShowBookPicker(false)}
        onApply={(refs: SelectedBookReference[]) => {
          setSelectedBookReferences(refs);
          setShowBookPicker(false);
        }}
      />
      <HistorySessionPicker
        open={showHistoryPicker}
        onClose={() => setShowHistoryPicker(false)}
        onApply={(sessions: SelectedHistorySession[]) => {
          setSelectedHistorySessions(sessions);
          setShowHistoryPicker(false);
        }}
      />
      <QuestionBankPicker
        open={showQuestionBankPicker}
        onClose={() => setShowQuestionBankPicker(false)}
        onApply={(entries: SelectedQuestionEntry[]) => {
          setSelectedQuestionEntries(entries);
          setShowQuestionBankPicker(false);
        }}
      />
      <PersonaPicker
        open={showPersonaPicker}
        initialPersona={selectedPersona}
        onClose={() => setShowPersonaPicker(false)}
        onApply={(persona: string | null) => {
          setSelectedPersona(persona);
          setShowPersonaPicker(false);
        }}
      />
      <MemoryPicker
        open={showMemoryPicker}
        initialFiles={selectedMemoryFiles}
        onClose={() => setShowMemoryPicker(false)}
        onApply={(files: SpaceMemoryFile[]) => {
          setSelectedMemoryFiles(files);
          setShowMemoryPicker(false);
        }}
      />
    </>
  );
}

const StandaloneComposer = memo(StandaloneComposerImpl);
export default StandaloneComposer;
export type { StandaloneComposerProps };
