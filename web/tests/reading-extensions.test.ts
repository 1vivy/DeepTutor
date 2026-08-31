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
const english = readFileSync(path.resolve(process.cwd(), "locales/en/app.json"), "utf8");
const chinese = readFileSync(path.resolve(process.cwd(), "locales/zh/app.json"), "utf8");

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

test("browser speech is stoppable and cannot continue after navigation", () => {
  assert.match(component, /const \[speaking, setSpeaking\] = useState\(false\)/);
  assert.match(component, /function stopSpeaking\(\)/);
  assert.match(component, /window\.speechSynthesis\?\.cancel\(\)/);
  assert.match(component, /utterance\.onend = \(\) => setSpeaking\(false\)/);
  assert.match(component, /utterance\.onerror = \(\) => setSpeaking\(false\)/);
  assert.match(component, /\}, \[locator, materialId\]\);/);
  assert.match(component, /aria-label=\{t\("Stop reading aloud"\)\}/);
});

test("the built-in read-aloud action is localized", () => {
  assert.match(component, /extension\.id === "read_aloud" && action\.id === "read"/);
  assert.match(component, /t\("Read aloud"\)/);
  assert.match(english, /"Read aloud": "Read aloud"/);
  assert.match(chinese, /"Read aloud": "朗读"/);
  assert.match(english, /"Reading aloud": "Reading aloud"/);
  assert.match(chinese, /"Reading aloud": "正在朗读"/);
  assert.match(english, /"Stop reading aloud": "Stop reading aloud"/);
  assert.match(chinese, /"Stop reading aloud": "停止朗读"/);
});
