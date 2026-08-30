import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const component = readFileSync(
  path.resolve(process.cwd(), "components/reading/ReadingExtensionBar.tsx"),
  "utf8",
);
const pane = readFileSync(
  path.resolve(process.cwd(), "components/reading/ReaderPane.tsx"),
  "utf8",
);
const api = readFileSync(
  path.resolve(process.cwd(), "lib/reading-api.ts"),
  "utf8",
);

test("the Reader toolbar is empty when no extension is installed", () => {
  assert.match(component, /if \(actions\.length === 0\) return null/);
  assert.match(pane, /<ReadingExtensionBar/);
});

test("extension results never inject browser JavaScript or raw HTML", () => {
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|eval\(|new Function/);
  assert.match(component, /String\(result\.payload\.body/);
});

test("the browser sends a locator and selection, not trusted visible text", () => {
  assert.match(api, /runReadingExtension/);
  assert.doesNotMatch(api, /visible_text\?: string/);
});

test("a malformed extension catalog cannot crash the whole reader", () => {
  assert.match(api, /if \(!Array\.isArray\(payload\)\) return \[\]/);
  assert.match(
    api,
    /Array\.isArray\(\(row as ReadingExtensionManifest\)\.actions\)/,
  );
});

test("the built-in translation action is localized", () => {
  assert.match(
    component,
    /extensionId === "translation" && actionId === "translate"/,
  );
  const english = readFileSync(
    path.resolve(process.cwd(), "locales/en/app.json"),
    "utf8",
  );
  const chinese = readFileSync(
    path.resolve(process.cwd(), "locales/zh/app.json"),
    "utf8",
  );
  assert.match(english, /"Translate selection": "Translate selection"/);
  assert.match(chinese, /"Translate selection": "翻译选段"/);
});

test("translation results are rendered as text in the result card", () => {
  assert.match(component, /String\(result\.payload\.translation \|\| ""\)/);
  assert.match(component, /result\.payload\.alternatives/);
  assert.match(component, /String\(result\.payload\.note \|\| ""\)/);
  assert.match(component, /\{translation\.translation\}/);
  assert.match(component, /\{translation\.note\}/);
  assert.match(component, /translation\.alternatives\.map/);
});
