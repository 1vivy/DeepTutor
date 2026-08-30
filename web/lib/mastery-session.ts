/**
 * Which mastery path a conversation belongs to — the one place that decides.
 *
 * A mastery study conversation is an ordinary chat session that happens to
 * carry `mastery_path_id` in its preferences. Two surfaces need to read that:
 * the sidebar, to file the conversation under its topic, and the click
 * handler, to open it on `/mastery/<path>/study/<session>` instead of `/home`.
 * If those two ever disagreed, a conversation would render under a topic and
 * then navigate somewhere else — so the rule lives here and neither owns it.
 *
 * Both signals are required. `capability` says the last turn actually ran the
 * mastery tutor, and `mastery_path_id` says which path it ran against; a
 * session that switched capability mid-conversation keeps the stale id, and a
 * course-study conversation about a path carries neither.
 */

import type { SessionSummary } from "@/lib/session-api";

export function masteryPathIdOf(session: SessionSummary): string {
  const preferences = session.preferences;
  if (!preferences) return "";
  if (preferences.capability !== "mastery_path") return "";
  return String(preferences.mastery_path_id || "");
}

/** Where clicking this conversation should land. */
export function sessionRoute(session: SessionSummary): string {
  const pathId = masteryPathIdOf(session);
  const sessionId = encodeURIComponent(session.session_id);
  if (pathId) {
    return `/mastery/${encodeURIComponent(pathId)}/study/${sessionId}`;
  }
  return `/home/${sessionId}`;
}
