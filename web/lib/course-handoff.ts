import type { StreamEvent } from "@/lib/unified-ws";

/**
 * Reading the `course_study` capability's hand-off signals off a turn's stream.
 *
 * Course Study does not teach. It reads the course's state, says what is worth
 * doing next, and hands the learner to the surface that actually does it — with
 * the opening message already written. That hand-off arrives as
 * `course_handoff` on a tool result's metadata and becomes a card.
 *
 * A card rather than an automatic redirect on purpose: the learner may still be
 * reading the paragraph that explains *why*, and a page that changes underneath
 * them reads as a malfunction. The card also makes the reasoning inspectable
 * and the suggestion refusable.
 *
 * Mirrors the metadata written by `deeptutor/capabilities/course_study/tools.py`.
 * Kept as pure functions, apart from the component that renders them, for the
 * same reason `lib/setup-signals.ts` is.
 */

/**
 * Where a hand-off may point.
 *
 * A closed set, not a free-form path: the target is resolved against the route
 * table below, so a malformed or hostile value cannot turn the card into an
 * open redirect. Same reasoning as the `/settings` prefix check in
 * `lib/setup-signals.ts`.
 */
export const COURSE_HANDOFF_TARGETS = [
  "immersive_reading",
  "mastery_path",
  "question_bank",
  "notebook",
  "chat",
] as const;

export type CourseHandoffTarget = (typeof COURSE_HANDOFF_TARGETS)[number];

export interface CourseHandoffPayload {
  target: CourseHandoffTarget;
  /** The opening message to hand the destination. May be empty. */
  prompt: string;
  /** Why this is worth doing now — shown on the card, never sent. */
  reason: string;
  /** Which resource to open there (workspace id, path id). May be empty. */
  ref_id: string;
  /** Display name of the destination resource. */
  label: string;
  /**
   * The course this hand-off belongs to.
   *
   * Supplied by the tool rather than re-derived here: the capability only runs
   * with a course bound, so the server already knows it, and threading it down
   * the message-component props would make every layer in between carry a
   * value only this card uses.
   */
  course_id: string;
}

/**
 * Targets that have a composer to receive an opening line.
 *
 * The question bank and notebook surfaces are lists — they have nothing to type
 * into. Handing them a prepared prompt writes it into a slot nobody reads, so
 * the card must not offer one, and a request phrased as a question ("walk me
 * through these") belongs in chat instead.
 */
const TARGETS_WITH_COMPOSER: ReadonlySet<CourseHandoffTarget> = new Set([
  "immersive_reading",
  "mastery_path",
  "chat",
]);

export function targetAcceptsPrompt(target: CourseHandoffTarget): boolean {
  return TARGETS_WITH_COMPOSER.has(target);
}

function isTarget(value: unknown): value is CourseHandoffTarget {
  return (
    typeof value === "string" &&
    (COURSE_HANDOFF_TARGETS as readonly string[]).includes(value)
  );
}

/**
 * Extract a hand-off from one stream event, or null.
 *
 * A tool's own `ToolResult.metadata` does not arrive at the top level of the
 * event: the dispatcher nests it under `tool_metadata` (see
 * `core/agentic/tool_dispatch.py`). Reading only the top level looks right and
 * type-checks fine, but silently finds nothing. The top level is still checked
 * as a fallback for callers that emit the event directly.
 */
export function courseHandoffFrom(event: {
  type?: string;
  metadata?: unknown;
}): CourseHandoffPayload | null {
  if (event?.type !== "tool_result") return null;
  const metadata = event.metadata;
  if (!metadata || typeof metadata !== "object") return null;

  const outer = metadata as Record<string, unknown>;
  const nested = outer.tool_metadata;
  const source = (
    nested && typeof nested === "object" ? nested : outer
  ) as Record<string, unknown>;

  const raw = source.course_handoff;
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  if (!isTarget(payload.target)) return null;

  return {
    target: payload.target,
    prompt: String(payload.prompt ?? ""),
    reason: String(payload.reason ?? ""),
    ref_id: String(payload.ref_id ?? ""),
    label: String(payload.label ?? ""),
    course_id: String(payload.course_id ?? ""),
  };
}

/**
 * Every hand-off in a message, de-duplicated by target and ref.
 *
 * A turn may legitimately suggest two different next steps ("finish the
 * reading, then drill the quiz"), so all of them are kept — but a model that
 * calls the tool twice for one destination should still produce one card.
 */
export function extractCourseHandoffs(
  events: StreamEvent[] | undefined,
): CourseHandoffPayload[] {
  if (!events || events.length === 0) return [];
  const seen = new Set<string>();
  const handoffs: CourseHandoffPayload[] = [];
  for (const event of events) {
    const payload = courseHandoffFrom(event);
    if (!payload) continue;
    const key = `${payload.target}:${payload.ref_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    handoffs.push(payload);
  }
  return handoffs;
}

/**
 * Resolve a hand-off to an in-app route.
 *
 * The course is carried into the query string so the destination can scope
 * itself — the question bank and notebook surfaces are global otherwise, and
 * arriving at an unfiltered list defeats the point of being sent there.
 */
export function courseHandoffHref(payload: CourseHandoffPayload): string {
  const course = encodeURIComponent(payload.course_id);
  const ref = encodeURIComponent(payload.ref_id);
  switch (payload.target) {
    case "immersive_reading":
      return payload.ref_id ? `/reading/${ref}` : "/reading";
    case "mastery_path":
      // The study route, not the path overview: the overview has no composer,
      // so a prepared opening line would have nowhere to land.
      return payload.ref_id ? `/mastery/${ref}/study` : "/mastery";
    case "question_bank":
      return `/space/questions?course=${course}`;
    case "notebook":
      // The console's own route: `/space/notebooks` only redirects here.
      return `/notebook?course=${course}`;
    case "chat":
      return `/home?course=${course}`;
  }
}
