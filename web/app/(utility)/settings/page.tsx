"use client";

import { CategoryScroll } from "@/components/settings/CategoryScroll";
import SettingsOverview from "@/components/settings/SettingsOverview";

import AboutSettingsPage from "@/features/settings/sections/AboutSettingsSection";
import AgentsSettingsPage from "@/features/settings/sections/AgentsSettingsSection";
import AppearanceSettingsPage from "@/features/settings/sections/AppearanceSettingsSection";
import ChatSettingsPage from "@/features/settings/sections/ChatSettingsSection";
import DocumentParsingSettingsPage from "@/features/settings/sections/DocumentParsingSettingsSection";
import GuardianSettingsPage from "@/features/settings/sections/GuardianSettingsSection";
import LearnerProfileSettingsPage from "@/features/settings/sections/LearnerProfileSettingsSection";
import MemorySettingsPage from "@/features/settings/sections/MemorySettingsSection";
import ModelsSettingsPage from "@/features/settings/sections/ModelsSettingsSection";
import NetworkSettingsPage from "@/features/settings/sections/NetworkSettingsSection";

/**
 * Settings is one document: users can read it from Overview to About with a
 * normal scroll, while the persistent navigator links to these same anchors.
 * Every navigator target is an anchor in this document; no duplicate leaf
 * routes or redirect aliases remain.
 */
export default function SettingsPage() {
  return (
    <CategoryScroll
      sections={[
        { key: "overview", Component: SettingsOverview },
        { key: "appearance", Component: AppearanceSettingsPage },
        { key: "network", Component: NetworkSettingsPage },
        { key: "models", Component: ModelsSettingsPage },
        { key: "knowledge", Component: DocumentParsingSettingsPage },
        { key: "chat", Component: ChatSettingsPage },
        { key: "agents", Component: AgentsSettingsPage },
        { key: "learner-profile", Component: LearnerProfileSettingsPage },
        { key: "guardian", Component: GuardianSettingsPage },
        { key: "memory", Component: MemorySettingsPage },
        { key: "about", Component: AboutSettingsPage },
      ]}
    />
  );
}
