"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import ProviderIcon from "@/components/common/ProviderIcon";
import {
  LLM_TASK_KEYS,
  type LlmTaskKey,
  useSettings,
} from "./SettingsContext";
import { selectClass, selectOptionClass } from "./shared";

/**
 * Task models — the LLM behind work DeepTutor starts on its own.
 *
 * Two calls happen without anyone asking: naming a conversation after its
 * first exchange, and writing the three starting points under the home
 * composer. Both are short, frequent and latency-visible, and neither needs
 * the model a learner picked for their reasoning.
 *
 * Inheriting stays the default, and it is a real default rather than a hidden
 * one: with nothing chosen here both calls resolve exactly what they resolved
 * before this page existed.
 */

const TASK_COPY: Record<
  LlmTaskKey,
  {
    label: { en: string; zh: string };
    desc: { en: string; zh: string };
    inherit: { en: string; zh: string };
    href?: string;
    hrefLabel?: { en: string; zh: string };
  }
> = {
  session_title: {
    label: { en: "Conversation title", zh: "会话标题" },
    desc: {
      en: "Names a new conversation once it has its first question and answer.",
      zh: "新会话产生第一轮问答后，为它写一个标题。",
    },
    inherit: {
      en: "Follows the conversation's own model",
      zh: "跟随该会话使用的模型",
    },
  },
  starters: {
    label: { en: "Starting points", zh: "起始建议" },
    desc: {
      en: "The three lines offered under the home composer, drawn from recent work.",
      zh: "主页输入框下方那三行建议，来自最近的学习痕迹。",
    },
    inherit: { en: "Follows the active model", zh: "跟随当前模型" },
    href: "/settings/starters",
    hrefLabel: { en: "Material scope", zh: "素材范围" },
  },
};

export function TaskModelsEditor() {
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.toLowerCase().startsWith("zh");
  const { draft, catalogEditable, settingsError, setLlmTask } = useSettings();

  const options = useMemo(
    () =>
      draft.services.llm.profiles.flatMap((profile) =>
        profile.models
          .filter((model) => model.model.trim())
          .map((model) => ({
            value: `${profile.id}::${model.id}`,
            profileId: profile.id,
            modelId: model.id,
            binding: profile.binding || "",
            profileName: profile.name,
            model: model.model,
          })),
      ),
    [draft],
  );

  const activeValue = useMemo(() => {
    const llm = draft.services.llm;
    return `${llm.active_profile_id ?? ""}::${llm.active_model_id ?? ""}`;
  }, [draft]);

  if (catalogEditable !== true) {
    // Same shape the service editors use: an ordinary user reaches this page
    // from the Models grid, and an empty panel would read as a broken page
    // rather than a permission boundary.
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-5 py-10 text-center text-[13px] text-[var(--muted-foreground)]">
        {settingsError
          ? t(
              "Backend unreachable — model endpoints will appear once the connection is restored. See the banner above for details.",
            )
          : t(
              "Model endpoints are assigned by your administrator. You can still personalize theme and language here.",
            )}
      </div>
    );
  }

  const tr = (value: { en: string; zh: string }) => (zh ? value.zh : value.en);

  return (
    <div>
      {options.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-5">
          <p className="text-[13px] text-[var(--foreground)]">
            {t("No language models are configured yet.")}
          </p>
          <Link
            href="/settings/llm"
            className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            {t("Configure one")}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          {LLM_TASK_KEYS.map((task, index) => {
            const copy = TASK_COPY[task];
            const pinned = draft.services.llm.tasks?.[task];
            const value = pinned
              ? `${pinned.profile_id}::${pinned.model_id}`
              : "";
            const resolved =
              options.find((option) => option.value === value) ??
              (value
                ? null
                : (options.find((option) => option.value === activeValue) ??
                  null));
            return (
              <div
                key={task}
                className={`flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-4 ${
                  index === 0 ? "" : "border-t border-[var(--border)]"
                }`}
              >
                <div className="min-w-0 flex-1 basis-64">
                  <div className="text-[13px] font-medium text-[var(--foreground)]">
                    {tr(copy.label)}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
                    {tr(copy.desc)}
                  </p>
                  {copy.href && copy.hrefLabel && (
                    <Link
                      href={copy.href}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      {tr(copy.hrefLabel)}
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
                <div className="w-full sm:w-72">
                  <div className="relative">
                    <select
                      className={`${selectClass} pr-9`}
                      value={value}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) {
                          setLlmTask(task, null);
                          return;
                        }
                        const [profileId, modelId] = next.split("::");
                        setLlmTask(task, {
                          profile_id: profileId,
                          model_id: modelId,
                        });
                      }}
                    >
                      <option className={selectOptionClass} value="">
                        {tr(copy.inherit)}
                      </option>
                      {options.map((option) => (
                        <option
                          className={selectOptionClass}
                          key={option.value}
                          value={option.value}
                        >
                          {option.model} — {option.profileName}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  </div>
                  {/* What it resolves to right now — the inherit case is the
                      one users cannot otherwise see. */}
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                    {resolved ? (
                      <>
                        <ProviderIcon provider={resolved.binding} size={12} />
                        <span className="truncate font-mono">
                          {resolved.model}
                        </span>
                      </>
                    ) : (
                      <span>{t("Resolves at call time.")}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
        {t(
          "Both calls are short and frequent, so a smaller, faster model is usually the better trade here.",
        )}
      </p>
    </div>
  );
}

export default TaskModelsEditor;
