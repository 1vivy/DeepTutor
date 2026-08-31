"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Library } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  clearGuardianMaterials,
  getGuardianReport,
  listGuardianRelationships,
  resetLearnerCredentials,
  type GuardianRelationship,
  type GuardianReport,
} from "@/lib/guardian-api";

type BusyAction = "report" | "materials" | "credentials" | null;
type ConfirmAction = "materials" | "credentials" | null;

const permissionKeys: Record<string, string> = {
  assign_materials: "Manage materials",
  reset_credentials: "Reset credentials",
  view_reports: "View reports",
};

export default function GuardianSettingsPage() {
  const { t } = useTranslation();
  const [relationships, setRelationships] = useState<GuardianRelationship[]>([]);
  const [selectedRelationship, setSelectedRelationship] =
    useState<GuardianRelationship | null>(null);
  const [report, setReport] = useState<GuardianReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listGuardianRelationships()
      .then((value) => {
        if (!cancelled) setRelationships(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError((reason as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const can = (permission: string) =>
    selectedRelationship?.permissions.includes(permission) ?? false;

  const selectLearner = async (relationship: GuardianRelationship) => {
    setSelectedRelationship(relationship);
    setReport(null);
    setTemporaryPassword(null);
    setCopied(false);
    setMessage(null);
    setError(null);
    if (!relationship.permissions.includes("view_reports")) return;
    setBusy("report");
    try {
      setReport(await getGuardianReport(relationship.learner_user_id));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resetCredentials = async () => {
    if (!selectedRelationship || !can("reset_credentials")) return;
    setConfirmAction(null);
    setBusy("credentials");
    setError(null);
    setMessage(null);
    setTemporaryPassword(null);
    try {
      setTemporaryPassword(
        await resetLearnerCredentials(selectedRelationship.learner_user_id),
      );
      setMessage(t("Learner credentials were reset."));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const clearMaterials = async () => {
    if (!selectedRelationship || !can("assign_materials")) return;
    setConfirmAction(null);
    setBusy("materials");
    setError(null);
    setMessage(null);
    try {
      await clearGuardianMaterials(selectedRelationship.learner_user_id);
      if (can("view_reports")) {
        setReport(await getGuardianReport(selectedRelationship.learner_user_id));
      }
      setMessage(t("Approved materials removed."));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold">{t("Guardian management")}</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        {t("Review authorized learners and their approved learning materials.")}
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-[var(--muted-foreground)]">
          {t("Loading guardian relationships…")}
        </p>
      ) : relationships.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted-foreground)]">
          {t("No active learner relationships.")}
        </p>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {relationships.map((relationship) => (
            <button
              key={relationship.id}
              type="button"
              onClick={() => void selectLearner(relationship)}
              className={`rounded-lg border p-4 text-left transition-colors hover:bg-[var(--muted)] ${
                selectedRelationship?.id === relationship.id
                  ? "border-[var(--primary)] bg-[var(--muted)]"
                  : "border-[var(--border)]"
              }`}
            >
              <strong>{relationship.learner_username}</strong>
              <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                {relationship.permissions
                  .map((permission) => t(permissionKeys[permission] ?? permission))
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedRelationship && (
        <section className="mt-8 border-t border-[var(--border)] pt-6">
          <h2 className="font-medium">
            {report?.learner.username ?? selectedRelationship.learner_username}
          </h2>

          {busy === "report" ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {t("Loading learner report…")}
            </p>
          ) : can("view_reports") && report ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] p-4">
                <Library className="mb-2 h-4 w-4 text-[var(--muted-foreground)]" />
                <div className="text-xs text-[var(--muted-foreground)]">
                  {t("Approved materials")}
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {report.assigned_materials.length}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-4">
                <div className="text-xs text-[var(--muted-foreground)]">
                  {t("Enabled learning resources")}
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {report.grant_summary.model_count +
                    report.grant_summary.knowledge_base_count +
                    report.grant_summary.skill_count}
                </div>
              </div>
            </div>
          ) : !can("view_reports") ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {t("You are not authorized to view this learner report.")}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            {can("assign_materials") && (
              <button
                type="button"
                onClick={() => setConfirmAction("materials")}
                disabled={
                  busy !== null ||
                  (report !== null && report.assigned_materials.length === 0)
                }
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
              >
                {busy === "materials"
                  ? t("Removing…")
                  : t("Remove approved materials")}
              </button>
            )}
            {can("reset_credentials") && (
              <button
                type="button"
                onClick={() => setConfirmAction("credentials")}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600 disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                {busy === "credentials"
                  ? t("Resetting…")
                  : t("Reset learner credentials")}
              </button>
            )}
          </div>

          {temporaryPassword && (
            <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {t("Temporary password")}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-[var(--background)] px-3 py-2 text-sm">
                  {temporaryPassword}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(temporaryPassword);
                    setCopied(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? t("Copied") : t("Copy")}
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                {t("Copy this password now. It will not be shown again.")}
              </p>
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction === "credentials"
            ? t("Reset learner credentials")
            : t("Remove approved materials")
        }
        confirmLabel={
          confirmAction === "credentials"
            ? t("Reset credentials")
            : t("Remove materials")
        }
        tone="danger"
        busy={busy !== null}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction === "credentials") void resetCredentials();
          if (confirmAction === "materials") void clearMaterials();
        }}
      >
        {confirmAction === "credentials"
          ? t(
              "This changes the learner password and revokes every learner device credential.",
            )
          : t("This removes every approved material from the learner account.")}
      </ConfirmDialog>
    </main>
  );
}
