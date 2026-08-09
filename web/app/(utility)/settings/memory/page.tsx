"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { apiFetch, apiUrl } from "@/lib/api";
import {
  SettingRow,
  SettingSection,
  SettingsPageHeader,
} from "@/components/settings/shared";
import { useSettings } from "@/components/settings/SettingsContext";

interface MemorySettingsDTO {
  update: { l2_budget: number; l3_budget: number };
  audit: { l2_budget: number; l3_budget: number };
  dedup: { iterations: number; auto_after_update: boolean };
  merge: {
    auto_after_update: boolean;
    auto_after_audit: boolean;
    auto_after_dedup: boolean;
  };
  chunking: {
    overlap_ratio: number;
    boundary: "paragraph" | "sentence";
    min_chunk_chars: number;
    max_chunk_chars: number;
  };
  reference: {
    enforce_required: boolean;
    drop_invalid_refs: boolean;
  };
  autopilot: {
    snapshot: "manual" | "auto";
    consolidate: "manual" | "auto";
    debounce_seconds: number;
    consolidate_after: number;
    consolidate_cooldown_seconds: number;
  };
}

export default function MemorySettingsPage() {
  const { t } = useTranslation();
  const { registerExtension } = useSettings();
  const [settings, setSettings] = useState<MemorySettingsDTO | null>(null);
  const [serverSnapshot, setServerSnapshot] =
    useState<MemorySettingsDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(apiUrl("/api/v1/memory/settings"))
      .then((res) => res.json() as Promise<MemorySettingsDTO>)
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setServerSnapshot(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty =
    !!settings &&
    !!serverSnapshot &&
    JSON.stringify(settings) !== JSON.stringify(serverSnapshot);

  // Latest-save ref so the closure handed to registerExtension always
  // reflects the current settings without re-registering on each render.
  const settingsRef = useRef<MemorySettingsDTO | null>(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const save = useCallback(async () => {
    const current = settingsRef.current;
    if (!current) return;
    const res = await apiFetch(apiUrl("/api/v1/memory/settings"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    });
    const data = (await res.json()) as MemorySettingsDTO;
    setSettings(data);
    setServerSnapshot(data);
  }, []);

  useEffect(() => {
    registerExtension("memory", { dirty, save });
    return () => registerExtension("memory", null);
  }, [dirty, save, registerExtension]);

  function patch<K extends keyof MemorySettingsDTO>(
    key: K,
    value: Partial<MemorySettingsDTO[K]>,
  ) {
    if (!settings) return;
    setSettings({ ...settings, [key]: { ...settings[key], ...value } });
  }

  if (!settings) {
    return (
      <div className="grid h-[60vh] place-items-center text-[13px] text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div data-tour="tour-memory">
      <SettingsPageHeader
        title={t("Memory")}
        description={t(
          "Decide whether memory keeps itself current, then tune the chunk-based consolidator: how many LLM rounds per Update / Audit / Dedup, how aggressively to chunk, and how strictly to validate references.",
        )}
      />

      <SettingSection
        title={t("Automatic upkeep")}
        description={t(
          "Two separate steps. Mirroring the workspace into L1 costs no model calls and runs after each conversation; folding L1 into L2 is an LLM pass, so it stays opt-in.",
        )}
      >
        <SelectRow
          label={t("Mirror the workspace into L1")}
          help={t(
            "On automatic, new conversations, quizzes and documents enter L1 by themselves — no Refresh needed in the workbench.",
          )}
          value={settings.autopilot.snapshot}
          options={[
            { value: "auto", label: t("Automatic") },
            { value: "manual", label: t("Manual") },
          ]}
          onChange={(v) =>
            patch("autopilot", { snapshot: v as "manual" | "auto" })
          }
        />
        <SelectRow
          label={t("Consolidate L1 into L2")}
          help={t(
            "Costs tokens: one LLM pass per surface that has enough new material.",
          )}
          value={settings.autopilot.consolidate}
          options={[
            { value: "manual", label: t("Manual") },
            { value: "auto", label: t("Automatic") },
          ]}
          onChange={(v) =>
            patch("autopilot", { consolidate: v as "manual" | "auto" })
          }
        />
        <NumberRow
          label={t("Debounce (seconds)")}
          help={t(
            "Conversations finishing back-to-back reconcile once, not once each.",
          )}
          value={settings.autopilot.debounce_seconds}
          onChange={(n) => patch("autopilot", { debounce_seconds: n })}
          min={1}
          max={600}
        />
        <NumberRow
          label={t("Consolidate after N new items")}
          help={t(
            "How much unseen material a surface must accumulate before an automatic L2 pass is worth its tokens.",
          )}
          value={settings.autopilot.consolidate_after}
          onChange={(n) => patch("autopilot", { consolidate_after: n })}
          min={1}
          max={1000}
        />
        <NumberRow
          label={t("Consolidation cooldown (seconds)")}
          help={t(
            "Minimum gap between two automatic consolidations of the same surface.",
          )}
          value={settings.autopilot.consolidate_cooldown_seconds}
          onChange={(n) =>
            patch("autopilot", { consolidate_cooldown_seconds: n })
          }
          min={60}
          max={86400}
          step={60}
        />
        <SyncNowRow />
      </SettingSection>

      <SettingSection
        title={t("Update mode")}
        description={t(
          "Default LLM rounds for chunk-based incremental fact extraction. Per-doc overrides live in the workbench.",
        )}
      >
        <NumberRow
          label={t("L2 budget (per surface)")}
          help={t("Maximum chunks the chunker emits for an L2 update.")}
          value={settings.update.l2_budget}
          onChange={(n) => patch("update", { l2_budget: n })}
          min={1}
          max={200}
        />
        <NumberRow
          label={t("L3 budget (per slot)")}
          help={t("Maximum chunks for an L3 update across the 7 L2 docs.")}
          value={settings.update.l3_budget}
          onChange={(n) => patch("update", { l3_budget: n })}
          min={1}
          max={200}
        />
      </SettingSection>

      <SettingSection
        title={t("Audit mode")}
        description={t(
          "Default LLM rounds for line-level edits against raw evidence.",
        )}
      >
        <NumberRow
          label={t("L2 budget (per surface)")}
          value={settings.audit.l2_budget}
          onChange={(n) => patch("audit", { l2_budget: n })}
          min={1}
          max={200}
        />
        <NumberRow
          label={t("L3 budget (per slot)")}
          value={settings.audit.l3_budget}
          onChange={(n) => patch("audit", { l3_budget: n })}
          min={1}
          max={200}
        />
      </SettingSection>

      <SettingSection
        title={t("Dedup")}
        description={t(
          "Iterative dedup over the full doc. Stops early when an iteration emits zero edits.",
        )}
      >
        <NumberRow
          label={t("Iterations")}
          value={settings.dedup.iterations}
          onChange={(n) => patch("dedup", { iterations: n })}
          min={1}
          max={20}
        />
        <ToggleRow
          label={t("Run dedup automatically after Update")}
          value={settings.dedup.auto_after_update}
          onChange={(v) => patch("dedup", { auto_after_update: v })}
        />
      </SettingSection>

      <SettingSection
        title={t("Merge footnotes")}
        description={t(
          "No-LLM consolidation: collapse duplicate ref rows into one footnote each, then renumber. Idempotent, safe to run any time.",
        )}
      >
        <ToggleRow
          label={t("Merge automatically after Update")}
          value={settings.merge.auto_after_update}
          onChange={(v) => patch("merge", { auto_after_update: v })}
        />
        <ToggleRow
          label={t("Merge automatically after Audit")}
          value={settings.merge.auto_after_audit}
          onChange={(v) => patch("merge", { auto_after_audit: v })}
        />
        <ToggleRow
          label={t("Merge automatically after Dedup")}
          value={settings.merge.auto_after_dedup}
          onChange={(v) => patch("merge", { auto_after_dedup: v })}
        />
      </SettingSection>

      <SettingSection
        title={t("Chunking")}
        description={t("Lower-level knobs that shape how content is split.")}
      >
        <NumberRow
          label={t("Overlap ratio")}
          help={t("Fraction of chunk size carried into the next chunk. 0–0.5.")}
          value={settings.chunking.overlap_ratio}
          onChange={(n) => patch("chunking", { overlap_ratio: n })}
          min={0}
          max={0.5}
          step={0.05}
          isFloat
        />
        <SelectRow
          label={t("Boundary")}
          help={t("Where the chunker prefers to cut.")}
          value={settings.chunking.boundary}
          options={[
            { value: "paragraph", label: t("Paragraph") },
            { value: "sentence", label: t("Sentence") },
          ]}
          onChange={(v) =>
            patch("chunking", { boundary: v as "paragraph" | "sentence" })
          }
        />
        <NumberRow
          label={t("Min chunk chars")}
          help={t("Floor for individual chunk size.")}
          value={settings.chunking.min_chunk_chars}
          onChange={(n) => patch("chunking", { min_chunk_chars: n })}
          min={200}
          max={64000}
          step={100}
        />
        <NumberRow
          label={t("Max chunk chars")}
          help={t("Ceiling for individual chunk size.")}
          value={settings.chunking.max_chunk_chars}
          onChange={(n) => patch("chunking", { max_chunk_chars: n })}
          min={200}
          max={64000}
          step={100}
        />
      </SettingSection>

      <SettingSection
        title={t("References")}
        description={t(
          "How strictly facts must cite the chunk they were extracted from.",
        )}
      >
        <ToggleRow
          label={t("Require ref on every fact")}
          help={t("Drops facts that come back without a ref.")}
          value={settings.reference.enforce_required}
          onChange={(v) => patch("reference", { enforce_required: v })}
        />
        <ToggleRow
          label={t("Drop invalid refs (vs reject the whole fact)")}
          help={t(
            "On: keep the fact, drop only out-of-pool refs. Off: any bad ref rejects the fact.",
          )}
          value={settings.reference.drop_invalid_refs}
          onChange={(v) => patch("reference", { drop_invalid_refs: v })}
        />
      </SettingSection>
    </div>
  );
}

// ── Field components ────────────────────────────────────────────────

/**
 * Reconcile L1 on demand.
 *
 * Not a duplicate of the workbench's per-surface Refresh: this runs the same
 * pass the autopilot runs, across every surface, so the switch above can be
 * verified without waiting for the next conversation. Reports what moved,
 * including "nothing" — silence would read as a failure.
 */
function SyncNowRow() {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "running">("idle");
  const [result, setResult] = useState<string>("");

  async function run() {
    setState("running");
    setResult("");
    try {
      const res = await apiFetch(apiUrl("/api/v1/memory/upkeep"), {
        method: "POST",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        surfaces_refreshed: string[];
        changes: number;
        skipped: string;
      };
      if (data.skipped === "disabled") {
        setResult(t("Automatic upkeep is off."));
      } else if (data.changes > 0) {
        setResult(
          t("Recorded {{count}} change(s) across {{surfaces}} surface(s).", {
            count: data.changes,
            surfaces: data.surfaces_refreshed.length,
          }),
        );
      } else {
        setResult(t("Already up to date."));
      }
    } catch {
      setResult(t("Sync failed."));
    } finally {
      setState("idle");
    }
  }

  return (
    <SettingRow
      title={t("Sync now")}
      description={result || t("Reconcile every surface immediately.")}
      control={
        <button
          type="button"
          onClick={() => void run()}
          disabled={state === "running"}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:opacity-50"
        >
          {state === "running" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw size={12} strokeWidth={1.8} />
          )}
          {t("Sync")}
        </button>
      }
    />
  );
}

interface NumberRowProps {
  label: string;
  help?: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  isFloat?: boolean;
}

function NumberRow({
  label,
  help,
  value,
  onChange,
  min,
  max,
  step = 1,
  isFloat = false,
}: NumberRowProps) {
  return (
    <SettingRow
      title={label}
      description={help}
      control={
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return;
            const n = isFloat ? parseFloat(raw) : parseInt(raw, 10);
            if (!Number.isNaN(n)) onChange(n);
          }}
          className="w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-right text-[12px] outline-none focus:border-[var(--primary)]"
        />
      }
    />
  );
}

interface ToggleRowProps {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, help, value, onChange }: ToggleRowProps) {
  return (
    <SettingRow
      title={label}
      description={help}
      control={
        <button
          type="button"
          role="switch"
          aria-checked={value}
          onClick={() => onChange(!value)}
          className={
            "relative inline-flex h-5 w-9 items-center rounded-full transition " +
            (value ? "bg-[var(--primary)]" : "bg-[var(--muted)]")
          }
        >
          <span
            className={
              "inline-block h-4 w-4 transform rounded-full bg-white shadow transition " +
              (value ? "translate-x-4" : "translate-x-0.5")
            }
          />
        </button>
      }
    />
  );
}

interface SelectRowProps {
  label: string;
  help?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}

function SelectRow({ label, help, value, options, onChange }: SelectRowProps) {
  return (
    <SettingRow
      title={label}
      description={help}
      control={
        <div className="flex gap-0.5 rounded-lg bg-[var(--muted)] p-0.5">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={
                "rounded-md px-2.5 py-1 text-[12px] transition-all " +
                (value === o.value
                  ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      }
    />
  );
}
