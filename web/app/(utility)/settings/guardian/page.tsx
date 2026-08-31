"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { clearGuardianMaterials, getGuardianReport, listGuardianRelationships, resetLearnerCredentials, type GuardianRelationship, type GuardianReport } from "@/lib/guardian-api";

export default function GuardianSettingsPage() {
  const { t } = useTranslation();
  const [relationships, setRelationships] = useState<GuardianRelationship[]>([]);
  const [selected, setSelected] = useState<GuardianReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void listGuardianRelationships().then(setRelationships).catch((err: Error) => setError(err.message)); }, []);
  const selectLearner = async (relationship: GuardianRelationship) => { setError(null); try { setSelected(await getGuardianReport(relationship.learner_user_id)); } catch (err) { setError((err as Error).message); } };
  const resetCredentials = async () => { if (!selected) return; setError(null); try { await resetLearnerCredentials(selected.learner.id); setMessage(t("Learner credentials were reset.")); } catch (err) { setError((err as Error).message); } };
  const clearMaterials = async () => { if (!selected) return; setError(null); try { await clearGuardianMaterials(selected.learner.id); setSelected(await getGuardianReport(selected.learner.id)); setMessage(t("Approved materials removed.")); } catch (err) { setError((err as Error).message); } };

  return <main className="mx-auto max-w-3xl px-6 py-8"><h1 className="text-xl font-semibold">{t("Guardian management")}</h1><p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("Review authorized learners and their approved learning materials.")}</p>{error && <p className="mt-4 text-sm text-red-600">{error}</p>}{message && <p className="mt-4 text-sm text-green-700">{message}</p>}{relationships.length === 0 ? <p className="mt-8 text-sm text-[var(--muted-foreground)]">{t("No active learner relationships.")}</p> : <div className="mt-6 grid gap-3">{relationships.map((relationship) => <button key={relationship.id} type="button" onClick={() => void selectLearner(relationship)} className="rounded-md border border-[var(--border)] p-4 text-left hover:bg-[var(--muted)]"><strong>{relationship.learner_username}</strong><span className="mt-1 block text-xs text-[var(--muted-foreground)]">{relationship.permissions.join(", ")}</span></button>)}</div>}{selected && <section className="mt-8 border-t border-[var(--border)] pt-6"><h2 className="font-medium">{selected.learner.username}</h2><p className="mt-2 text-sm">{t("Approved materials")}: {selected.assigned_materials.length}</p><button type="button" onClick={() => void clearMaterials()} disabled={!selected.assigned_materials.length} className="mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">{t("Remove approved materials")}</button><p className="mt-3 text-sm">{t("Enabled learning resources")}: {selected.grant_summary.model_count + selected.grant_summary.knowledge_base_count + selected.grant_summary.skill_count}</p><button type="button" onClick={() => void resetCredentials()} className="mt-4 rounded-md border border-[var(--border)] px-3 py-2 text-sm">{t("Reset learner credentials")}</button></section>}</main>;
}
