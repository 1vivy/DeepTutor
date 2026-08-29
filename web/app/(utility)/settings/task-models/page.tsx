"use client";

import { useTranslation } from "react-i18next";

import { TaskModelsEditor } from "@/components/settings/TaskModelsEditor";
import { SettingsPageHeader } from "@/components/settings/shared";

export default function TaskModelsSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Task models")}
        description={t(
          "The model behind work DeepTutor starts on its own, rather than in a turn you asked for.",
        )}
      />
      <TaskModelsEditor />
    </div>
  );
}
