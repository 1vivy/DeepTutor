import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reader = readFileSync("components/reading/TextUnitView.tsx", "utf8");
const en = readFileSync("locales/en/app.json", "utf8");
const zh = readFileSync("locales/zh/app.json", "utf8");

test("text reader exposes persistent display preferences", () => {
  assert.match(reader, /dt\.reader\.textPreferences/);
  assert.match(reader, /DEFAULT_FONT_SIZE = 17/);
  assert.match(reader, /MIN_FONT_SIZE = 12/);
  assert.match(reader, /MAX_FONT_SIZE = 28/);
  assert.match(reader, /DEFAULT_LINE_WIDTH = 84/);
  assert.match(reader, /MIN_LINE_WIDTH = 48/);
  assert.match(reader, /MAX_LINE_WIDTH = 104/);
  assert.match(reader, /window\.localStorage\.setItem/);
});

test("keyboard zoom matches the button behavior", () => {
  assert.match(reader, /event\.key === "\+" \|\| event\.key === "="/);
  assert.match(reader, /event\.key === "-"/);
  assert.match(reader, /event\.key === "0"/);
  assert.match(reader, /event\.preventDefault\(\)/);
});

test("reader display copy is translated", () => {
  for (const key of [
    "Smaller text",
    "Larger text",
    "Reset reading display",
    "Use sans-serif font",
    "Use serif font",
    "Change line width",
    "Change reading theme",
  ]) {
    assert.match(en, new RegExp(`"${key}": "`));
    assert.match(zh, new RegExp(`"${key}": "[^"]+"`));
  }
});
