import { apiFetch, apiUrl } from "@/lib/api";

export interface GuardianRelationship {
  id: string;
  learner_user_id: string;
  learner_username: string;
  permissions: string[];
}

export interface GuardianReport {
  learner: { id: string; username: string; disabled: boolean };
  assigned_materials: Array<{
    book_id: string;
    title?: string;
    permission: string;
  }>;
  grant_summary: {
    model_count: number;
    knowledge_base_count: number;
    skill_count: number;
  };
}

function extractDetail(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("detail" in value)) {
    return null;
  }
  const detail = (value as { detail: unknown }).detail;
  return typeof detail === "string" ? detail : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(apiUrl(path), init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(extractDetail(data) ?? "Request failed");
  return data as T;
}

export async function listGuardianRelationships(): Promise<GuardianRelationship[]> {
  const data = await request<{ relationships: GuardianRelationship[] }>(
    "/api/v1/multi-user/me/guardianships",
  );
  return data.relationships;
}

export function getGuardianReport(learnerId: string): Promise<GuardianReport> {
  return request<GuardianReport>(
    `/api/v1/multi-user/learners/${encodeURIComponent(learnerId)}/guardian-report`,
  );
}

export async function resetLearnerCredentials(learnerId: string): Promise<string> {
  const data = await request<{ temporary_password: string }>(
    `/api/v1/multi-user/learners/${encodeURIComponent(learnerId)}/credentials/reset`,
    { method: "POST" },
  );
  return data.temporary_password;
}

export async function clearGuardianMaterials(learnerId: string): Promise<void> {
  await request(
    `/api/v1/multi-user/learners/${encodeURIComponent(learnerId)}/materials`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_ids: [] }),
    },
  );
}
