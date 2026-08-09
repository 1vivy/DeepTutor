/**
 * The composer's tool and capability tables, scoped per workspace mode.
 *
 * Both workspaces run the same chat page and the same backend pipeline; what
 * changes between them is which capabilities the composer offers and which is
 * selected by default. Keeping that as data here — rather than branching
 * inside the page — is what lets one page serve both modes without forking.
 */

import {
  BarChart3,
  BrainCircuit,
  Clapperboard,
  Code2,
  Compass,
  FileSearch,
  Globe,
  GraduationCap,
  Image as ImageIcon,
  Lightbulb,
  MessageSquare,
  Microscope,
  PenLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceMode } from "@/lib/workspace-mode";

export type ToolName =
  | "brainstorm"
  | "geogebra_analysis"
  | "web_search"
  | "code_execution"
  | "reason"
  | "paper_search"
  | "imagegen"
  | "videogen";

export interface ToolDef {
  name: ToolName;
  label: string;
  icon: LucideIcon;
}

export const ALL_TOOLS: ToolDef[] = [
  { name: "brainstorm", label: "Brainstorm", icon: Lightbulb },
  { name: "geogebra_analysis", label: "GeoGebra", icon: Compass },
  { name: "web_search", label: "Web Search", icon: Globe },
  { name: "code_execution", label: "Code", icon: Code2 },
  { name: "reason", label: "Reason", icon: Sparkles },
  { name: "paper_search", label: "Arxiv Search", icon: FileSearch },
  { name: "imagegen", label: "Image Gen", icon: ImageIcon },
  { name: "videogen", label: "Video Gen", icon: Clapperboard },
];

export interface CapabilityDef {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  allowedTools: ToolName[];
  defaultTools: ToolName[];
  // Loop-engine capabilities run on the chat agent loop (solve / mastery) rather
  // than a bespoke pipeline. They are collapsed into the "More" flyout in the
  // capability picker instead of listed directly. Driven by the loop-capability
  // registry on the backend; mirrored here as a static flag.
  loopEngine?: boolean;
}

/* The free-conversation capability. Its identity differs per workspace: in
   General it is a general-purpose assistant, in Tutor the same empty
   capability value is a tutoring conversation, because TutorContextCapability
   brands every tutor-mode turn with the learner's current state server-side. */
const CHAT_CAPABILITY: CapabilityDef = {
  value: "",
  label: "Chat",
  description: "Flexible conversation with any tool",
  icon: MessageSquare,
  allowedTools: [
    "brainstorm",
    "geogebra_analysis",
    "web_search",
    "code_execution",
    "reason",
    "paper_search",
    "imagegen",
    "videogen",
  ],
  defaultTools: [],
};

const TUTOR_CHAT_CAPABILITY: CapabilityDef = {
  value: "",
  label: "Tutor",
  description: "Tutoring conversation that knows what you are learning",
  icon: GraduationCap,
  // Teaching-shaped surface: GeoGebra and code earn their place for working
  // through problems; image/video generation and paper search do not.
  allowedTools: [
    "brainstorm",
    "geogebra_analysis",
    "web_search",
    "code_execution",
    "reason",
  ],
  defaultTools: [],
};

const SOLVE_CAPABILITY: CapabilityDef = {
  value: "deep_solve",
  label: "Solve",
  description: "Multi-step reasoning & problem solving",
  icon: BrainCircuit,
  allowedTools: ["web_search", "code_execution", "reason"],
  defaultTools: ["web_search", "code_execution", "reason"],
  loopEngine: true,
};

const QUIZ_CAPABILITY: CapabilityDef = {
  value: "deep_question",
  label: "Quiz",
  description: "Auto-validated question generation",
  icon: PenLine,
  allowedTools: ["web_search", "code_execution"],
  defaultTools: ["web_search", "code_execution"],
};

const MASTERY_CAPABILITY: CapabilityDef = {
  value: "mastery_path",
  label: "Mastery Path",
  description: "Mastery-based tutoring with a hard gate",
  icon: GraduationCap,
  // The mastery tools (status/quiz/grade/assess/build) auto-mount server-side
  // when this capability is active; rag auto-mounts when a KB is attached.
  // These are only the extra optional tools the tutor may also reach for.
  allowedTools: ["web_search", "code_execution"],
  defaultTools: [],
  loopEngine: true,
};

const RESEARCH_CAPABILITY: CapabilityDef = {
  value: "deep_research",
  label: "Research",
  description: "Comprehensive multi-agent research",
  icon: Microscope,
  allowedTools: ["web_search", "paper_search", "code_execution"],
  defaultTools: ["web_search", "paper_search", "code_execution"],
};

const VISUALIZE_CAPABILITY: CapabilityDef = {
  value: "visualize",
  label: "Visualize",
  description:
    "Generate charts, diagrams, interactive pages, or math animations",
  icon: BarChart3,
  allowedTools: [],
  defaultTools: [],
};

/** The first entry of each list is that mode's default capability. */
const CAPABILITIES_BY_MODE: Record<WorkspaceMode, CapabilityDef[]> = {
  general: [
    CHAT_CAPABILITY,
    SOLVE_CAPABILITY,
    QUIZ_CAPABILITY,
    RESEARCH_CAPABILITY,
    VISUALIZE_CAPABILITY,
    MASTERY_CAPABILITY,
  ],
  // Exactly one, and that is the design: in Tutor the engine decides what a
  // request needs. Research, quizzing, visualization, solving and mastery
  // tutoring are all reachable — as subagents the tutor delegates to
  // (``run_subagent``), chosen from the question rather than from a menu the
  // learner has to understand first. A one-entry list renders as a label
  // instead of a picker, so the composer stays honest about there being no
  // choice to make.
  tutor: [TUTOR_CHAT_CAPABILITY],
};

export function capabilitiesForMode(mode: WorkspaceMode): CapabilityDef[] {
  return CAPABILITIES_BY_MODE[mode] ?? CAPABILITIES_BY_MODE.general;
}

/**
 * Resolve a stored capability value within a mode.
 *
 * Falls back to the mode's default when the value is unknown *there* — which
 * is what makes a session created in General (say, ``deep_research``) degrade
 * gracefully rather than render a blank picker if it is ever opened in Tutor.
 */
export function getCapabilityForMode(
  mode: WorkspaceMode,
  value: string | null,
): CapabilityDef {
  const list = capabilitiesForMode(mode);
  return list.find((c) => c.value === (value || "")) ?? list[0];
}
