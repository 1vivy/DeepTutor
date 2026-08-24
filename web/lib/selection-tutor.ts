const MAX_SELECTED_TEXT_LENGTH = 12_000;

export interface SelectionTutorContext {
  selectedText: string;
  parentSessionId: string | null;
}

/** Collapse selection-only whitespace while preserving paragraph breaks. */
export function normalizeSelectedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SELECTED_TEXT_LENGTH);
}

/** Small deterministic id so selecting the same passage reuses its tutor tab. */
export function selectionTutorKey(
  selectedText: string,
  parentSessionId: string | null,
): string {
  let hash = 2166136261;
  const source = `${parentSessionId ?? "draft"}\u0000${selectedText}`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `selection-tutor:${parentSessionId ?? "draft"}:${(hash >>> 0).toString(36)}`;
}

export function buildSelectionTutorConfig(
  context: SelectionTutorContext,
): Record<string, unknown> {
  return {
    selection_tutor_context: {
      selected_text: normalizeSelectedText(context.selectedText),
      parent_session_id: context.parentSessionId ?? "",
    },
  };
}
