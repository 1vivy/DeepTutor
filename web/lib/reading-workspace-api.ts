import { apiFetch, apiUrl } from "@/lib/api";

const BASE = "/api/v1/reading";

export type ReadingSourceKind =
  | "file"
  | "web"
  | "video"
  | "youtube"
  | "bilibili"
  | "audio";
export type ReadingIngestionStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export interface ReadingLibraryMaterial {
  material_id: string;
  content_id: string;
  filename: string;
  title: string;
  source_kind: ReadingSourceKind;
  source_url: string;
  mime: string;
  render_mode: "text" | "pdf" | "epub" | "video" | "audio";
  cover_url: string;
  duration_seconds: number;
  status: ReadingIngestionStatus;
  progress: number;
  error_code: string;
  error_detail: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
}

export interface ReadingFolder {
  folder_id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
}

export interface ReadingTag {
  tag_id: string;
  name: string;
  color: string;
  created_at: number;
}

export interface ReadingWorkspaceTab {
  material: ReadingLibraryMaterial;
  tab_order: number;
  pinned: boolean;
  opened: boolean;
  added_at: number;
}

export interface ReadingWorkspace {
  workspace_id: string;
  title: string;
  description: string;
  active_material_id: string | null;
  created_at: number;
  updated_at: number;
  tabs: ReadingWorkspaceTab[];
  folders: ReadingFolder[];
  tags: ReadingTag[];
}

export interface ReadingConversation {
  workspace_id: string;
  session_id: string;
  title: string;
  active_material_id: string | null;
  created_at: number;
  updated_at: number;
  linked_session_ids?: string[];
}

export interface OrganizedReadingNotes {
  workspace_id: string;
  title: string;
  markdown: string;
  material_ids: string[];
  annotation_count: number;
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  let message = `Request failed: ${response.status}`;
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") message = body.detail;
  } catch {
    // Keep the HTTP status for proxy/non-JSON responses.
  }
  throw new Error(message);
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return unwrap(
    await apiFetch(apiUrl(`${BASE}${path}`), {
      cache: "no-store",
      ...init,
      headers: init?.body
        ? { "Content-Type": "application/json", ...init.headers }
        : init?.headers,
    }),
  );
}

export async function listReadingLibraryMaterials(
  search = "",
): Promise<ReadingLibraryMaterial[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const payload = await json<{ materials: ReadingLibraryMaterial[] }>(
    `/library/materials${params.size ? `?${params}` : ""}`,
  );
  return payload.materials ?? [];
}

export async function listReadingWorkspaces(filters?: {
  search?: string;
  folderId?: string;
  tagId?: string;
}): Promise<ReadingWorkspace[]> {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.folderId) params.set("folder_id", filters.folderId);
  if (filters?.tagId) params.set("tag_id", filters.tagId);
  const payload = await json<{ workspaces: ReadingWorkspace[] }>(
    `/workspaces${params.size ? `?${params}` : ""}`,
  );
  return payload.workspaces ?? [];
}

export async function getReadingWorkspace(
  workspaceId: string,
): Promise<{
  workspace: ReadingWorkspace;
  sessions: ReadingConversation[];
}> {
  return json(`/workspaces/${workspaceId}`);
}

export async function createReadingWorkspace(payload: {
  title: string;
  description?: string;
  material_ids?: string[];
}): Promise<ReadingWorkspace> {
  const result = await json<{ workspace: ReadingWorkspace }>("/workspaces", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return result.workspace;
}

export async function updateReadingWorkspace(
  workspaceId: string,
  patch: { title?: string; description?: string },
): Promise<ReadingWorkspace> {
  const result = await json<{ workspace: ReadingWorkspace }>(
    `/workspaces/${workspaceId}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return result.workspace;
}

export async function deleteReadingWorkspace(
  workspaceId: string,
): Promise<void> {
  await json(`/workspaces/${workspaceId}`, { method: "DELETE" });
}

export async function importReadingUrls(payload: {
  urls: string[];
  workspace_id?: string;
  workspace_title?: string;
}): Promise<{
  materials: ReadingLibraryMaterial[];
  workspace: ReadingWorkspace;
}> {
  return json("/library/import-urls", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function retryReadingMaterial(
  materialId: string,
): Promise<ReadingLibraryMaterial> {
  const result = await json<{ material: ReadingLibraryMaterial }>(
    `/materials/${materialId}/retry`,
    { method: "POST" },
  );
  return result.material;
}

export async function addReadingWorkspaceMaterial(
  workspaceId: string,
  materialId: string,
  makeActive = false,
): Promise<ReadingWorkspace> {
  const result = await json<{ workspace: ReadingWorkspace }>(
    `/workspaces/${workspaceId}/materials`,
    {
      method: "POST",
      body: JSON.stringify({ material_id: materialId, make_active: makeActive }),
    },
  );
  return result.workspace;
}

export async function activateReadingMaterial(
  workspaceId: string,
  materialId: string,
): Promise<ReadingWorkspace> {
  const result = await json<{ workspace: ReadingWorkspace }>(
    `/workspaces/${workspaceId}/materials/${materialId}/active`,
    { method: "PUT" },
  );
  return result.workspace;
}

export async function removeReadingWorkspaceMaterial(
  workspaceId: string,
  materialId: string,
): Promise<ReadingWorkspace> {
  const result = await json<{ workspace: ReadingWorkspace }>(
    `/workspaces/${workspaceId}/materials/${materialId}`,
    { method: "DELETE" },
  );
  return result.workspace;
}

export async function listReadingFolders(): Promise<ReadingFolder[]> {
  return (await json<{ folders: ReadingFolder[] }>("/folders")).folders ?? [];
}

export async function createReadingFolder(name: string): Promise<ReadingFolder> {
  return (
    await json<{ folder: ReadingFolder }>("/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    })
  ).folder;
}

export async function assignReadingFolder(
  workspaceId: string,
  folderId: string,
): Promise<ReadingWorkspace> {
  return (
    await json<{ workspace: ReadingWorkspace }>(
      `/workspaces/${workspaceId}/folders/${folderId}`,
      { method: "PUT" },
    )
  ).workspace;
}

export async function listReadingTags(): Promise<ReadingTag[]> {
  return (await json<{ tags: ReadingTag[] }>("/tags")).tags ?? [];
}

export async function createReadingTag(
  name: string,
  color = "terracotta",
): Promise<ReadingTag> {
  return (
    await json<{ tag: ReadingTag }>("/tags", {
      method: "POST",
      body: JSON.stringify({ name, color }),
    })
  ).tag;
}

export async function assignReadingTag(
  workspaceId: string,
  tagId: string,
): Promise<ReadingWorkspace> {
  return (
    await json<{ workspace: ReadingWorkspace }>(
      `/workspaces/${workspaceId}/tags/${tagId}`,
      { method: "PUT" },
    )
  ).workspace;
}

export async function createReadingConversation(
  workspaceId: string,
  title = "New reading conversation",
  activeMaterialId = "",
): Promise<ReadingConversation> {
  return (
    await json<{ session: ReadingConversation }>(
      `/workspaces/${workspaceId}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          active_material_id: activeMaterialId,
        }),
      },
    )
  ).session;
}

export async function listReadingConversations(
  workspaceId: string,
): Promise<ReadingConversation[]> {
  return (
    await json<{ sessions: ReadingConversation[] }>(
      `/workspaces/${workspaceId}/sessions`,
    )
  ).sessions ?? [];
}

export async function renameReadingConversation(
  workspaceId: string,
  sessionId: string,
  title: string,
): Promise<ReadingConversation> {
  return (
    await json<{ session: ReadingConversation }>(
      `/workspaces/${workspaceId}/sessions/${sessionId}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    )
  ).session;
}

export async function deleteReadingConversation(
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  await json(`/workspaces/${workspaceId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function linkReadingConversation(
  workspaceId: string,
  sessionId: string,
  targetSessionId: string,
): Promise<string[]> {
  return (
    await json<{ linked_session_ids: string[] }>(
      `/workspaces/${workspaceId}/sessions/${sessionId}/links`,
      {
        method: "POST",
        body: JSON.stringify({ target_session_id: targetSessionId }),
      },
    )
  ).linked_session_ids;
}

export async function unlinkReadingConversation(
  workspaceId: string,
  sessionId: string,
  targetSessionId: string,
): Promise<string[]> {
  return (
    await json<{ linked_session_ids: string[] }>(
      `/workspaces/${workspaceId}/sessions/${sessionId}/links/${targetSessionId}`,
      { method: "DELETE" },
    )
  ).linked_session_ids;
}

export async function organizeReadingNotes(
  workspaceId: string,
  materialIds: string[] = [],
): Promise<OrganizedReadingNotes> {
  return (
    await json<{ notes: OrganizedReadingNotes }>(
      `/workspaces/${workspaceId}/notes/organize`,
      { method: "POST", body: JSON.stringify({ material_ids: materialIds }) },
    )
  ).notes;
}

export async function sendReadingToNotebook(
  workspaceId: string,
  notebookIds: string[],
  materialIds: string[] = [],
): Promise<Record<string, unknown>> {
  return json(`/workspaces/${workspaceId}/notebook`, {
    method: "POST",
    body: JSON.stringify({
      notebook_ids: notebookIds,
      material_ids: materialIds,
    }),
  });
}

export async function generateMasteryPathFromReading(
  workspaceId: string,
  bookId: string,
  materialIds: string[] = [],
): Promise<Record<string, unknown>> {
  return unwrap(
    await apiFetch(
      apiUrl(`/api/v1/learning/progress/${encodeURIComponent(bookId)}/generate-from-reading`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          material_ids: materialIds,
        }),
      },
    ),
  );
}
