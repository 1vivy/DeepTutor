"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
  Check,
  ChevronRight,
  FileAudio,
  FileText,
  Film,
  Folder,
  FolderPlus,
  Globe2,
  Grid2X2,
  Library,
  Link2,
  List,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Tag,
  Upload,
  X,
  Youtube,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { uploadMaterial } from "@/lib/reading-api";
import {
  assignReadingFolder,
  assignReadingTag,
  createReadingFolder,
  createReadingTag,
  createReadingWorkspace,
  deleteReadingWorkspace,
  importReadingUrls,
  listReadingFolders,
  listReadingLibraryMaterials,
  listReadingTags,
  listReadingWorkspaces,
  type ReadingFolder,
  type ReadingLibraryMaterial,
  type ReadingSourceKind,
  type ReadingTag,
  type ReadingWorkspace,
} from "@/lib/reading-workspace-api";

type ViewMode = "grid" | "list";
type LibraryOrganizerState = {
  kind: "folder" | "tag";
  workspace: ReadingWorkspace | null;
};

const sourceIcon: Record<ReadingSourceKind, typeof FileText> = {
  file: FileText,
  web: Globe2,
  video: Film,
  youtube: Youtube,
  bilibili: Film,
  audio: FileAudio,
};

function relativeDate(timestamp: number, locale: string): string {
  if (!timestamp) return "";
  const seconds = Math.round((timestamp * 1000 - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 2_592_000)
    return formatter.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp * 1000);
}

export function ReadingLibraryPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<ReadingWorkspace[]>([]);
  const [materials, setMaterials] = useState<ReadingLibraryMaterial[]>([]);
  const [folders, setFolders] = useState<ReadingFolder[]>([]);
  const [tags, setTags] = useState<ReadingTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeFolder, setActiveFolder] = useState("");
  const [activeTag, setActiveTag] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [showImport, setShowImport] = useState(false);
  const [menuWorkspace, setMenuWorkspace] = useState<string | null>(null);
  const [organizer, setOrganizer] = useState<LibraryOrganizerState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReadingWorkspace | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [workspaceRows, materialRows, folderRows, tagRows] =
        await Promise.all([
          listReadingWorkspaces({
            search,
            folderId: activeFolder,
            tagId: activeTag,
          }),
          listReadingLibraryMaterials(search),
          listReadingFolders(),
          listReadingTags(),
        ]);
      setWorkspaces(workspaceRows);
      setMaterials(materialRows);
      setFolders(folderRows);
      setTags(tagRows);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("Unable to load library."),
      );
    } finally {
      setLoading(false);
    }
  }, [activeFolder, activeTag, search, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 140);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const recentWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => b.updated_at - a.updated_at),
    [workspaces],
  );

  const addFolder = () => setOrganizer({ kind: "folder", workspace: null });

  const addTag = () => setOrganizer({ kind: "tag", workspace: null });

  const removeWorkspace = async (workspace: ReadingWorkspace) => {
    await deleteReadingWorkspace(workspace.workspace_id);
    setMenuWorkspace(null);
    await refresh();
  };

  const moveWorkspace = (workspace: ReadingWorkspace) =>
    setOrganizer({ kind: "folder", workspace });

  const tagWorkspace = (workspace: ReadingWorkspace) =>
    setOrganizer({ kind: "tag", workspace });

  return (
    <main className="reading-v2 flex h-full min-h-0 bg-[var(--card)] text-[var(--foreground)] dark:bg-[var(--background)] dark:text-[var(--foreground)]">
      <aside className="hidden w-[228px] shrink-0 border-r border-[var(--border)] bg-[var(--secondary)] px-4 py-6 xl:block dark:border-[var(--border)] dark:bg-[var(--secondary)]">
        <div className="mb-7 flex items-center gap-3 px-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_8px_22px_rgba(0,0,0,.18)]">
            <BookOpenText size={18} />
          </span>
          <div>
            <p className="font-serif text-[16px] font-semibold tracking-[-0.01em]">
              {t("Reading Room")}
            </p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              {t("DeepTutor")}
            </p>
          </div>
        </div>

        <LibraryFilterButton
          active={!activeFolder && !activeTag}
          icon={Library}
          label={t("All workspaces")}
          count={workspaces.length}
          onClick={() => {
            setActiveFolder("");
            setActiveTag("");
          }}
        />

        <FilterHeading label={t("Folders")} onAdd={addFolder} />
        {folders.length ? (
          folders.map((folder) => (
            <LibraryFilterButton
              key={folder.folder_id}
              active={activeFolder === folder.folder_id}
              icon={Folder}
              label={folder.name}
              onClick={() => {
                setActiveFolder(folder.folder_id);
                setActiveTag("");
              }}
            />
          ))
        ) : (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {t("Create folders to group long-running reading projects.")}
          </p>
        )}

        <FilterHeading label={t("Tags")} onAdd={addTag} />
        <div className="flex flex-wrap gap-1.5 px-2">
          {tags.length ? (
            tags.map((tag) => (
              <button
                key={tag.tag_id}
                type="button"
                onClick={() => {
                  setActiveTag(activeTag === tag.tag_id ? "" : tag.tag_id);
                  setActiveFolder("");
                }}
                className={`rounded-full border px-2.5 py-1 text-[10.5px] transition ${
                  activeTag === tag.tag_id
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[var(--border)]"
                }`}
              >
                {tag.name}
              </button>
            ))
          ) : (
            <p className="py-1 text-[11px] text-[var(--muted-foreground)]">
              {t("No tags yet")}
            </p>
          )}
        </div>

        <div className="mt-auto pt-8">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3.5">
            <p className="text-[11px] font-semibold text-[var(--muted-foreground)]">
              {t("Private by default")}
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--muted-foreground)]">
              {t("Your sources, notes and reading conversations stay in your account.")}
            </p>
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1480px] px-5 py-6 md:px-8 lg:px-10 lg:py-8">
          <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--primary)]">
                {t("Immersive Reading")}
              </p>
              <h1 className="font-serif text-[31px] font-medium tracking-[-0.035em] text-[var(--foreground)] dark:text-[var(--foreground)] md:text-[38px]">
                {t("Your reading library")}
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--muted-foreground)] dark:text-[var(--muted-foreground)]">
                {t("Read documents, web pages and media with an AI companion that keeps every citation grounded.")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[12px] font-semibold text-[var(--primary-foreground)] shadow-[0_10px_28px_rgba(0,0,0,.18)] transition hover:opacity-90"
            >
              <Plus size={15} />
              {t("Add reading")}
            </button>
          </header>

          <div className="mt-7 flex flex-col gap-3 border-y border-[var(--border)] py-3 sm:flex-row sm:items-center sm:justify-between dark:border-[var(--border)]">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 sm:max-w-md dark:border-[var(--border)] dark:bg-[var(--card)]">
              <Search size={14} className="shrink-0 text-[var(--muted-foreground)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search workspaces and sources")}
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--muted-foreground)]"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")}>
                  <X size={13} />
                </button>
              )}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {t("{{count}} workspaces", { count: workspaces.length })}
              </span>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5 dark:border-[var(--border)] dark:bg-[var(--card)]">
                <ViewButton
                  icon={Grid2X2}
                  active={view === "grid"}
                  label={t("Grid view")}
                  onClick={() => setView("grid")}
                />
                <ViewButton
                  icon={List}
                  active={view === "list"}
                  label={t("List view")}
                  onClick={() => setView("list")}
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center gap-2 text-[12px] text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              {t("Opening your library…")}
            </div>
          ) : !recentWorkspaces.length ? (
            <EmptyLibrary onImport={() => setShowImport(true)} />
          ) : view === "grid" ? (
            <div className="mt-7 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {recentWorkspaces.map((workspace) => (
                <WorkspaceCard
                  key={workspace.workspace_id}
                  workspace={workspace}
                  locale={i18n.language}
                  menuOpen={menuWorkspace === workspace.workspace_id}
                  onToggleMenu={() =>
                    setMenuWorkspace((current) =>
                      current === workspace.workspace_id
                        ? null
                        : workspace.workspace_id,
                    )
                  }
                  onDelete={() => setDeleteTarget(workspace)}
                  onMove={() => moveWorkspace(workspace)}
                  onTag={() => tagWorkspace(workspace)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {recentWorkspaces.map((workspace) => (
                <WorkspaceListRow
                  key={workspace.workspace_id}
                  workspace={workspace}
                  locale={i18n.language}
                />
              ))}
            </div>
          )}

          {!!materials.length && (
            <section className="mt-12 border-t border-[var(--border)] pt-7 dark:border-[var(--border)]">
              <div className="flex items-end justify-between">
                <div>
                  <p className="font-serif text-[20px] font-medium text-[var(--foreground)] dark:text-[var(--foreground)]">
                    {t("Source shelf")}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    {t("Reusable materials across all reading workspaces")}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                {materials.slice(0, 12).map((material) => (
                  <SourceCard key={material.material_id} material={material} />
                ))}
              </div>
            </section>
          )}
        </div>
      </section>

      {showImport && (
        <ImportReadingDialog
          onClose={() => setShowImport(false)}
          onCreated={(workspace) => {
            setShowImport(false);
            router.push(`/reading/${workspace.workspace_id}`);
          }}
        />
      )}

      {organizer && (
        <LibraryOrganizerDialog
          state={organizer}
          folders={folders}
          tags={tags}
          onClose={() => setOrganizer(null)}
          onSaved={async () => {
            setOrganizer(null);
            setMenuWorkspace(null);
            await refresh();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteWorkspaceDialog
          workspace={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={async () => {
            await removeWorkspace(deleteTarget);
            setDeleteTarget(null);
          }}
        />
      )}
    </main>
  );
}

function LibraryOrganizerDialog({
  state,
  folders,
  tags,
  onClose,
  onSaved,
}: {
  state: LibraryOrganizerState;
  folders: ReadingFolder[];
  tags: ReadingTag[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const rows = state.kind === "folder" ? folders : tags;
  const assigning = Boolean(state.workspace && rows.length);
  const firstRow = rows[0] as ReadingFolder | ReadingTag | undefined;
  const [selectedId, setSelectedId] = useState(
    firstRow ? ("folder_id" in firstRow ? firstRow.folder_id : firstRow.tag_id) : "",
  );
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const title =
    state.kind === "folder"
      ? state.workspace
        ? t("Move to folder")
        : t("Folder name")
      : state.workspace
        ? t("Add tag")
        : t("Tag name");

  const submit = async () => {
    if (working || (assigning ? !selectedId : !name.trim())) return;
    setWorking(true);
    setError("");
    try {
      if (state.kind === "folder") {
        const folderId = assigning
          ? selectedId
          : (await createReadingFolder(name.trim())).folder_id;
        if (state.workspace) {
          await assignReadingFolder(state.workspace.workspace_id, folderId);
        }
      } else {
        const tagId = assigning
          ? selectedId
          : (await createReadingTag(name.trim())).tag_id;
        if (state.workspace) {
          await assignReadingTag(state.workspace.workspace_id, tagId);
        }
      }
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Save failed."));
    } finally {
      setWorking(false);
    }
  };

  return (
    <LibraryDialogShell title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {assigning ? (
          <select
            autoFocus
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-[12px] outline-none focus:border-[var(--ring)] dark:border-[var(--border)] dark:bg-[var(--background)]"
          >
            {rows.map((row) => {
              const id = "folder_id" in row ? row.folder_id : row.tag_id;
              return (
                <option key={id} value={id}>
                  {row.name}
                </option>
              );
            })}
          </select>
        ) : (
          <label className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
            {state.kind === "folder" ? t("Folder name") : t("Tag name")}
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-[12px] font-normal normal-case tracking-normal outline-none focus:border-[var(--ring)] dark:border-[var(--border)] dark:bg-[var(--background)]"
            />
          </label>
        )}
        {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-[11px]">
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={working || (assigning ? !selectedId : !name.trim())}
            className="flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
          >
            {working && <Loader2 size={12} className="animate-spin" />}
            {t("Save")}
          </button>
        </div>
      </form>
    </LibraryDialogShell>
  );
}

function DeleteWorkspaceDialog({
  workspace,
  onClose,
  onDelete,
}: {
  workspace: ReadingWorkspace;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  return (
    <LibraryDialogShell title={t("Delete workspace")} onClose={onClose}>
      <p className="text-[12px] leading-relaxed text-[var(--muted-foreground)]">
        {t("Delete this reading workspace?")} {workspace.title}
      </p>
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
            void onDelete()
              .catch((caught) =>
                setError(caught instanceof Error ? caught.message : t("Delete failed")),
              )
              .finally(() => setWorking(false));
          }}
          className="flex h-9 items-center gap-2 rounded-xl bg-red-700 px-4 text-[11px] font-semibold text-white disabled:opacity-60"
        >
          {working && <Loader2 size={12} className="animate-spin" />}
          {t("Delete")}
        </button>
      </div>
    </LibraryDialogShell>
  );
}

function LibraryDialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl dark:border-[var(--border)] dark:bg-[var(--popover)]">
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

function FilterHeading({
  label,
  onAdd,
}: {
  label: string;
  onAdd: () => void;
}) {
  return (
    <div className="mb-1 mt-6 flex items-center justify-between px-2">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
        {label}
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--muted-foreground)]"
        aria-label={label}
        title={label}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

function LibraryFilterButton({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: typeof Library;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[11.5px] transition ${
        active
          ? "bg-[var(--muted)] font-semibold text-[var(--primary)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
    >
      <Icon size={14} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span className="text-[10px] tabular-nums opacity-60">{count}</span>
      )}
    </button>
  );
}

function ViewButton({
  icon: Icon,
  active,
  label,
  onClick,
}: {
  icon: typeof Grid2X2;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex size-7 items-center justify-center rounded-md transition ${
        active ? "bg-[var(--muted)] text-[var(--primary)]" : "text-[var(--muted-foreground)]"
      }`}
    >
      <Icon size={13} />
    </button>
  );
}

function WorkspaceCard({
  workspace,
  locale,
  menuOpen,
  onToggleMenu,
  onDelete,
  onMove,
  onTag,
}: {
  workspace: ReadingWorkspace;
  locale: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onDelete: () => void;
  onMove: () => void;
  onTag: () => void;
}) {
  const { t } = useTranslation();
  const covers = workspace.tabs
    .map((tab) => tab.material)
    .filter((material) => material.cover_url)
    .slice(0, 3);
  return (
    <article className="group relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--card)] shadow-[0_10px_34px_rgba(0,0,0,.045)] transition hover:-translate-y-0.5 hover:border-[var(--border)] hover:shadow-[0_16px_40px_rgba(0,0,0,.08)] dark:border-[var(--border)] dark:bg-[var(--card)]">
      <Link href={`/reading/${workspace.workspace_id}`} className="block">
        <div className="relative flex h-[142px] items-end overflow-hidden border-b border-[var(--border)] bg-[var(--muted)] p-4 dark:border-[var(--border)] dark:bg-[var(--muted)]">
          {covers.length ? (
            <div className="absolute inset-0 grid grid-cols-3 gap-px opacity-95">
              {covers.map((material) => (
                <div
                  key={material.material_id}
                  className="bg-cover bg-center"
                  style={{ backgroundImage: `url(${material.cover_url})` }}
                />
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 bg-[var(--muted)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          <div className="relative flex w-full items-end justify-between text-white">
            <span className="flex size-9 items-center justify-center rounded-xl border border-white/25 bg-black/20 backdrop-blur-sm">
              <BookOpenText size={17} />
            </span>
            <span className="rounded-full border border-white/25 bg-black/25 px-2.5 py-1 text-[9.5px] backdrop-blur-sm">
              {t("{{count}} sources", { count: workspace.tabs.length })}
            </span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-serif text-[17px] font-semibold tracking-[-0.015em] text-[var(--foreground)] dark:text-[var(--foreground)]">
                {workspace.title}
              </h2>
              <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-relaxed text-[var(--muted-foreground)] dark:text-[var(--muted-foreground)]">
                {workspace.description ||
                  workspace.tabs.map((tab) => tab.material.title).join(" · ") ||
                  t("A focused space for close reading and grounded conversation.")}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
            <div className="flex flex-wrap gap-1">
              {workspace.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag.tag_id}
                  className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[var(--muted-foreground)] dark:bg-[var(--muted)] dark:text-[var(--muted-foreground)]"
                >
                  {tag.name}
                </span>
              ))}
            </div>
            <span>{relativeDate(workspace.updated_at, locale)}</span>
          </div>
        </div>
      </Link>
      <button
        type="button"
        onClick={onToggleMenu}
        className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg border border-white/20 bg-black/25 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100 focus:opacity-100"
        aria-label={t("Workspace menu")}
      >
        <MoreHorizontal size={14} />
      </button>
      {menuOpen && (
        <div className="absolute right-3 top-12 z-10 w-36 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 text-[11px] shadow-xl dark:border-[var(--border)] dark:bg-[var(--popover)]">
          <button
            type="button"
            onClick={onMove}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[var(--muted-foreground)] hover:bg-[var(--muted)] dark:text-[var(--foreground)] dark:hover:bg-[var(--muted)]"
          >
            <Folder size={12} /> {t("Move to folder")}
          </button>
          <button
            type="button"
            onClick={onTag}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[var(--muted-foreground)] hover:bg-[var(--muted)] dark:text-[var(--foreground)] dark:hover:bg-[var(--muted)]"
          >
            <Tag size={12} /> {t("Add tag")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded-lg px-2.5 py-2 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            {t("Delete workspace")}
          </button>
        </div>
      )}
    </article>
  );
}

function WorkspaceListRow({
  workspace,
  locale,
}: {
  workspace: ReadingWorkspace;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <Link
      href={`/reading/${workspace.workspace_id}`}
      className="flex items-center gap-4 px-2 py-4 transition hover:bg-[var(--card)] dark:hover:bg-[var(--muted)]"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--muted)] text-[var(--primary)]">
        <BookOpenText size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-[15px] font-semibold">
          {workspace.title}
        </p>
        <p className="mt-0.5 truncate text-[10.5px] text-[var(--muted-foreground)]">
          {t("{{count}} sources", { count: workspace.tabs.length })} · {relativeDate(workspace.updated_at, locale)}
        </p>
      </div>
      <ChevronRight size={15} className="text-[var(--muted-foreground)]" />
    </Link>
  );
}

function SourceCard({ material }: { material: ReadingLibraryMaterial }) {
  const { t } = useTranslation();
  const Icon = sourceIcon[material.source_kind];
  return (
    <div className="flex w-[220px] shrink-0 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 dark:border-[var(--border)] dark:bg-[var(--card)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)] text-[var(--primary)] dark:bg-[var(--muted)]">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11.5px] font-medium">{material.title}</p>
        <p className="mt-0.5 truncate text-[9.5px] uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          {material.status === "ready"
            ? t(material.source_kind)
            : t(material.status)}
        </p>
      </div>
    </div>
  );
}

function EmptyLibrary({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-[470px] max-w-lg flex-col items-center justify-center text-center">
      <span className="mb-5 flex size-16 items-center justify-center rounded-[22px] border border-[var(--border)] bg-[var(--muted)] text-[var(--primary)] shadow-[0_12px_30px_rgba(0,0,0,.08)]">
        <BookOpenText size={27} />
      </span>
      <h2 className="font-serif text-[23px] font-medium tracking-[-0.02em]">
        {t("Start your first reading workspace")}
      </h2>
      <p className="mt-2 max-w-md text-[12px] leading-relaxed text-[var(--muted-foreground)]">
        {t("Bring a paper, book, web page, lecture or recording. DeepTutor will keep the material, notes and conversations together.")}
      </p>
      <button
        type="button"
        onClick={onImport}
        className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[12px] font-semibold text-[var(--primary-foreground)]"
      >
        <Plus size={15} />
        {t("Add reading")}
      </button>
    </div>
  );
}

function ImportReadingDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (workspace: ReadingWorkspace) => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"files" | "links">("files");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      if (mode === "files") {
        if (!files.length) throw new Error(t("Choose one or more files."));
        const uploaded = await Promise.all(files.map((file) => uploadMaterial(file)));
        const workspace = await createReadingWorkspace({
          title: title.trim() || files[0].name.replace(/\.[^.]+$/, ""),
          material_ids: uploaded.map((item) => item.material_id),
        });
        onCreated(workspace);
      } else {
        const urls = links
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean);
        if (!urls.length) throw new Error(t("Paste at least one URL."));
        const result = await importReadingUrls({
          urls,
          workspace_title: title.trim() || t("Imported reading"),
        });
        onCreated(result.workspace);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Import failed."));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-xl overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--card)] shadow-2xl dark:border-[var(--border)] dark:bg-[var(--popover)]">
        <div className="flex items-start justify-between border-b border-[var(--border)] px-6 py-5 dark:border-[var(--border)]">
          <div>
            <p className="font-serif text-[21px] font-semibold">{t("Add reading")}</p>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              {t("Create one workspace from one or many sources.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-5 grid grid-cols-2 rounded-xl bg-[var(--muted)] p-1 dark:bg-[var(--muted)]">
            <ImportModeButton
              active={mode === "files"}
              icon={Upload}
              label={t("Files & media")}
              onClick={() => setMode("files")}
            />
            <ImportModeButton
              active={mode === "links"}
              icon={Link2}
              label={t("Web & video")}
              onClick={() => setMode("links")}
            />
          </div>

          <label className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
            {t("Workspace title")}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("Optional — inferred from the first source")}
              className="mt-2 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-[12px] font-normal normal-case tracking-normal outline-none focus:border-[var(--ring)] dark:border-[var(--border)] dark:bg-[var(--background)]"
            />
          </label>

          {mode === "files" ? (
            <div className="mt-5">
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.epub,.ppt,.pptx,.doc,.docx,.txt,.md,.html,.htm,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,.m4v,.webm,.mkv"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex min-h-[150px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-6 text-center transition hover:border-[var(--border)] hover:bg-[var(--card)] dark:border-[var(--border)] dark:bg-[var(--background)]"
              >
                <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[var(--muted)] text-[var(--primary)]">
                  <Upload size={17} />
                </span>
                <span className="text-[12px] font-semibold">
                  {files.length
                    ? t("{{count}} files selected", { count: files.length })
                    : t("Choose documents, slides, audio or video")}
                </span>
                <span className="mt-1 text-[10.5px] text-[var(--muted-foreground)]">
                  {t("PDF, EPUB, DOCX, PPTX, text, MP3, WAV, MP4, MOV")}
                </span>
              </button>
              {!!files.length && (
                <div className="mt-3 max-h-28 space-y-1 overflow-y-auto">
                  {files.map((file) => (
                    <div
                      key={`${file.name}-${file.size}`}
                      className="flex items-center gap-2 rounded-lg bg-[var(--muted)] px-3 py-2 text-[10.5px] dark:bg-[var(--muted)]"
                    >
                      <Check size={12} className="text-[var(--primary)]" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="text-[var(--muted-foreground)]">
                        {t("{{size}} MB", {
                          size: (file.size / 1024 / 1024).toFixed(1),
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <label className="mt-5 block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
              {t("Links")}
              <textarea
                value={links}
                onChange={(event) => setLinks(event.target.value)}
                rows={6}
                placeholder={t("One URL per line — articles, documentation, YouTube, or Bilibili")}
                className="mt-2 w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-[12px] font-normal normal-case leading-relaxed tracking-normal outline-none focus:border-[var(--ring)] dark:border-[var(--border)] dark:bg-[var(--background)]"
              />
            </label>
          )}

          {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-6 py-4 dark:border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl px-4 text-[11.5px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={working}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-[11.5px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
          >
            {working && <Loader2 size={13} className="animate-spin" />}
            {working ? t("Importing…") : t("Create workspace")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Upload;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[11.5px] font-medium transition ${
        active
          ? "bg-[var(--card)] text-[var(--primary)] shadow-sm dark:bg-[var(--card)]"
          : "text-[var(--muted-foreground)]"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
