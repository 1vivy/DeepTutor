"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { CreateTopicWizard } from "@/components/space/learning/CreateTopicWizard";
import type { Translate } from "@/components/space/learning/format";
import { TopicAtlas } from "@/components/space/learning/TopicAtlas";
import {
  fetchMasteryTopics,
  type MasteryTopic,
} from "@/lib/learning-api";

export default function MasteryPathPage() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const zh = Boolean(i18n.language?.toLowerCase().startsWith("zh"));
  const [topics, setTopics] = useState<MasteryTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const wizardTriggerRef = useRef<HTMLElement | null>(null);

  const loadTopics = useCallback(async () => {
    setError(null);
    try {
      setTopics(await fetchMasteryTopics({ cache: "no-store" }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("The atlas could not be loaded."),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  return (
    <>
      <TopicAtlas
        topics={topics}
        loading={loading}
        error={error}
        onCreate={(trigger) => {
          wizardTriggerRef.current = trigger;
          setWizardOpen(true);
        }}
        onRetry={() => {
          setLoading(true);
          void loadTopics();
        }}
      />
      {wizardOpen && (
        <CreateTopicWizard
          returnFocusRef={wizardTriggerRef}
          onClose={() => setWizardOpen(false)}
          onCreated={(topic) => {
            setWizardOpen(false);
            router.push(`/mastery/${encodeURIComponent(topic.path_id)}`);
          }}
        />
      )}
    </>
  );
}
