/**
 * Handing a starting prompt from another page to the chat composer.
 *
 * Inside the chat page a click can prefill the composer directly through a ref.
 * Across a navigation there is no ref to reach — the composer does not exist
 * yet when Daily hands off — so the text waits in ``sessionStorage`` for the
 * chat page to pick it up on mount.
 *
 * ``sessionStorage`` rather than a query parameter: the prompt can be a
 * sentence, and a URL carrying it would survive refreshes and back-navigation,
 * re-seeding the composer every time the user returns to a session they had
 * moved on from. This handoff is consumed exactly once — :func:`takeStagedPrompt`
 * clears it as it reads.
 *
 * The prompt is never auto-sent. It lands in the composer for the learner to
 * edit or discard, because the wording came from a dashboard row, not from them.
 */

const KEY = "dt:composer-handoff";

/** Longer than any dashboard-generated prompt; guards against junk in storage. */
const MAX_CHARS = 2000;

/** Stage *text* for the next chat page to pick up. Safe to call anywhere. */
export function stagePrompt(text: string): void {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(KEY, trimmed.slice(0, MAX_CHARS));
  } catch {
    // Private-mode Safari and storage-quota failures: losing a prefill is a
    // cosmetic loss, so it must never break the navigation that follows.
  }
}

/** Read and clear the staged prompt. Returns "" when there is none. */
export function takeStagedPrompt(): string {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return (value || "").slice(0, MAX_CHARS);
  } catch {
    return "";
  }
}
