import { UnifiedChatProvider } from "@/context/UnifiedChatContext";

import "@/components/space/learning/mastery-theme.css";

export default function MasteryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <UnifiedChatProvider>{children}</UnifiedChatProvider>;
}
