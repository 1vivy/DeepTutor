import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSelectionTutorConfig,
  normalizeSelectedText,
  selectionTutorKey,
} from "../lib/selection-tutor";

test("normalizes selected chat text without flattening paragraphs", () => {
  assert.equal(
    normalizeSelectedText("  first   line\r\n\r\n\r\n second\tline  "),
    "first line\n\nsecond line",
  );
});

test("selection tutor keys are stable per passage and parent session", () => {
  const a = selectionTutorKey("fork() returns twice", "session-a");
  assert.equal(a, selectionTutorKey("fork() returns twice", "session-a"));
  assert.notEqual(a, selectionTutorKey("fork() returns twice", "session-b"));
  assert.notEqual(a, selectionTutorKey("wait() blocks", "session-a"));
});

test("builds runtime-only selected text context", () => {
  assert.deepEqual(
    buildSelectionTutorConfig({
      selectedText: "  selected   passage ",
      parentSessionId: "parent-1",
    }),
    {
      selection_tutor_context: {
        selected_text: "selected passage",
        parent_session_id: "parent-1",
      },
    },
  );
});
