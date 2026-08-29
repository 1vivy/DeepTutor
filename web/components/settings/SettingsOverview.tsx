"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import ProviderIcon from "@/components/common/ProviderIcon";
import SettingsStatusPanel from "@/components/settings/SettingsStatusPanel";
import { setPendingPrompt } from "@/lib/pending-prompt";
import {
  SETTINGS_CATEGORIES,
  type Lang,
  type SettingsLeaf,
} from "@/lib/settings-nav";
import {
  getActiveModel,
  getActiveProfile,
  serviceReadiness,
  useSettings,
} from "./SettingsContext";

/**
 * The settings landing page.
 *
 * It used to be a grid of seven cards whose only job was to link to the seven
 * categories — a directory, now that the navigator lists every page anyway.
 * What it could not answer, and what a landing page is for, is "what state am
 * I actually in": which services are set up, which failed their last test, and
 * whether something is sitting in a draft waiting to be applied.
 */
export default function SettingsOverview() {
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.toLowerCase().startsWith("zh");
  const tr = useCallback((value: Lang) => (zh ? value.zh : value.en), [zh]);
  const {
    catalog,
    catalogEditable,
    diagnosticsResults,
    draftState,
    storedDraft,
    startTour,
  } = useSettings();

  const modelLeaves = useMemo(
    () =>
      (
        SETTINGS_CATEGORIES.find((category) => category.key === "models")
          ?.children ?? []
      ).filter((leaf): leaf is SettingsLeaf & { service: NonNullable<SettingsLeaf["service"]> } =>
        Boolean(leaf.service),
      ),
    [],
  );

  const states = useMemo(
    () =>
      catalogEditable !== true
        ? []
        : modelLeaves.map((leaf) => ({
            leaf,
            readiness: serviceReadiness(catalog, leaf.service, diagnosticsResults),
          })),
    [catalog, catalogEditable, diagnosticsResults, modelLeaves],
  );

  const failed = states.filter((item) => item.readiness === "failed");
  const missing = states.filter((item) => item.readiness === "not_configured");
  const ready = states.length - failed.length - missing.length;

  // Everything the user can act on, most urgent first. An empty list is worth
  // saying out loud — "nothing needs attention" is information, and the blank
  // panel it replaces is not.
  const attention: { key: string; text: string; href: string; label: string }[] =
    [];
  if (draftState !== "clean") {
    attention.push({
      key: "draft",
      text:
        draftState === "saved"
          ? t("A saved draft is waiting to be applied.")
          : t("There are changes you have not saved anywhere yet."),
      href: "/settings/llm",
      label: t("Review"),
    });
  }
  for (const item of failed) {
    attention.push({
      key: `failed-${item.leaf.key}`,
      text: t("{{service}} failed its last connection test.", {
        service: tr(item.leaf.label),
      }),
      href: item.leaf.href,
      label: t("Open"),
    });
  }

  const active = useMemo(() => {
    if (catalogEditable !== true) return [];
    return (
      [
        { key: "llm", label: { zh: "语言模型", en: "Language model" } },
        { key: "embedding", label: { zh: "嵌入模型", en: "Embedding" } },
      ] as const
    ).map(({ key, label }) => {
      const profile = getActiveProfile(catalog, key);
      const model = getActiveModel(catalog, key);
      return {
        key,
        label,
        binding: profile?.binding ?? "",
        model: model?.model ?? "",
        href: key === "llm" ? "/settings/llm" : "/settings/embedding",
      };
    });
  }, [catalog, catalogEditable]);

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[24px] font-semibold leading-tight tracking-tight text-[var(--foreground)]">
            {t("Settings")}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
            {catalogEditable === true && states.length > 0
              ? t("{{ready}} of {{total}} model services set up.", {
                  ready,
                  total: states.length,
                })
              : t("Appearance, models, knowledge, chat, and memory.")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setPendingPrompt(
              tr({
                zh: "帮我配置一下 DeepTutor，先看看现在缺什么。",
                en: "Help me configure DeepTutor — start by checking what's missing.",
              }),
            );
          }}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:inline-flex"
        >
          {t("Set up with DeepTutor")}
        </button>
      </header>

      <SettingsStatusPanel />

      {catalogEditable === true && (
        <>
          <Section title={t("Needs attention")}>
            {attention.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-[var(--muted-foreground)]">
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                {t("Nothing to do — everything configured is working.")}
              </div>
            ) : (
              attention.map((item, index) => (
                <div
                  key={item.key}
                  className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 ${
                    index === 0 ? "" : "border-t border-[var(--border)]"
                  }`}
                >
                  <span className="text-[12.5px] text-[var(--foreground)]">
                    {item.text}
                  </span>
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1 text-[11.5px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {item.label}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              ))
            )}
          </Section>

          {active.some((item) => item.model) && (
          <Section title={t("In use")}>
            {active.filter((item) => item.model).map((item, index) => (
              <div
                key={item.key}
                className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 ${
                  index === 0 ? "" : "border-t border-[var(--border)]"
                }`}
              >
                <span className="text-[12.5px] text-[var(--muted-foreground)]">
                  {tr(item.label)}
                </span>
                <Link
                  href={item.href}
                  className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--foreground)] transition-opacity hover:opacity-70"
                >
                  {item.binding && (
                    <ProviderIcon provider={item.binding} size={13} />
                  )}
                  <span className="truncate font-mono text-[11.5px]">
                    {item.model}
                  </span>
                  <ArrowUpRight className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                </Link>
              </div>
            ))}
          </Section>
          )}

          {missing.length > 0 && (
            <Section title={t("Not set up yet")}>
              <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3">
                {missing.map((item) => (
                  <Link
                    key={item.leaf.key}
                    href={item.leaf.href}
                    className="inline-flex items-center gap-1 text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {tr(item.leaf.label)}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      <button
        type="button"
        onClick={startTour}
        className="mt-6 text-[11.5px] text-[var(--muted-foreground)] underline-offset-2 transition-colors hover:text-[var(--foreground)] hover:underline"
      >
        {t("Take the tour")}
      </button>
      {storedDraft?.updated_at && (
        <p className="mt-2 text-[11px] text-[var(--muted-foreground)]/70">
          {t("Draft saved {{when}}", { when: storedDraft.updated_at })}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[12px] font-medium text-[var(--muted-foreground)]">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-[var(--border)]">
        {children}
      </div>
    </section>
  );
}
