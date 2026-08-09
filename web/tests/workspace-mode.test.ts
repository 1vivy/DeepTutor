import test from "node:test";
import assert from "node:assert/strict";

import {
  MODE_ICON,
  NAV_BY_MODE,
  chatPathForMode,
  modeCoversPath,
  modeFromPathname,
} from "../lib/workspace-mode";

/* ``modeCoversPath`` decides whether switching workspaces keeps the current
   page or falls back to the destination's chat root, so each answer below is a
   navigation the user either does or does not get thrown out of. */

test("shared consoles are covered by both workspaces", () => {
  for (const path of ["/book", "/knowledge", "/memory", "/settings"]) {
    assert.equal(modeCoversPath("general", path), true, path);
    assert.equal(modeCoversPath("tutor", path), true, path);
  }
});

test("a nested route is covered by its parent entry", () => {
  // General lists /space; Tutor lists the leaves underneath it. Either way the
  // user stays on the page when switching.
  assert.equal(modeCoversPath("general", "/space/questions"), true);
  assert.equal(modeCoversPath("tutor", "/space/questions"), true);
  assert.equal(modeCoversPath("general", "/space/learning"), true);
});

test("a route only one workspace lists is not covered by the other", () => {
  assert.equal(modeCoversPath("tutor", "/partners"), false);
  assert.equal(modeCoversPath("tutor", "/agents"), false);
  assert.equal(modeCoversPath("tutor", "/co-writer"), false);
});

test("each chat root belongs to its own workspace only", () => {
  assert.equal(modeCoversPath("tutor", "/home"), false);
  assert.equal(modeCoversPath("general", "/tutor"), false);
  assert.equal(modeCoversPath("general", "/home"), true);
  assert.equal(modeCoversPath("tutor", "/tutor"), true);
});

test("a prefix that only looks like a nav entry is not covered", () => {
  // Guards the startsWith check against matching /booking against /book.
  assert.equal(modeCoversPath("general", "/booking"), false);
  assert.equal(modeCoversPath("general", "/spaceship"), false);
});

test("no pathname is covered by nothing", () => {
  assert.equal(modeCoversPath("general", null), false);
  assert.equal(modeCoversPath("general", undefined), false);
  assert.equal(modeCoversPath("general", ""), false);
});

test("chat session paths still resolve back to their own mode", () => {
  for (const mode of ["general", "tutor"] as const) {
    const path = chatPathForMode(mode, "abc123");
    assert.equal(modeFromPathname(path), mode);
    assert.equal(modeCoversPath(mode, path), true);
  }
});

test("the workspace switcher does not reuse a nav icon of its own mode", () => {
  // The switcher sits directly above the nav it belongs to; the same glyph in
  // both places makes it read as a duplicated nav row rather than a level up.
  for (const mode of ["general", "tutor"] as const) {
    const { primary, secondary } = NAV_BY_MODE[mode];
    const navIcons = [...primary, ...secondary].map((entry) => entry.icon);
    assert.equal(navIcons.includes(MODE_ICON[mode]), false, mode);
  }
});
