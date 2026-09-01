"use client";

import { CategoryScroll } from "@/components/settings/CategoryScroll";

import VideoLearningSettingsPage from "./VideoLearningSettingsSection";
import ToolsSettingsPage from "./ToolsSettingsSection";
import CapabilitiesSettingsPage from "./CapabilitiesSettingsSection";
import StarterSettingsPage from "./StartersSettingsSection";
import AttachmentSettingsPage from "./AttachmentsSettingsSection";

/**
 * The Chat category, in full — see `ModelsSettingsPage` for the pattern.
 */
export default function ChatSettingsPage() {
  return (
    <CategoryScroll
      sections={[
        { key: "video-learning", Component: VideoLearningSettingsPage },
        { key: "tools", Component: ToolsSettingsPage },
        { key: "capabilities", Component: CapabilitiesSettingsPage },
        { key: "starters", Component: StarterSettingsPage },
        { key: "attachments", Component: AttachmentSettingsPage },
      ]}
    />
  );
}
