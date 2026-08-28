import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

test("Reading V2 uses in-product dialogs instead of blocking browser prompts", () => {
  const library = source("components/reading/library/ReadingLibrary.tsx");
  const workspace = source("components/reading/workspace/ReadingWorkspace.tsx");

  assert.doesNotMatch(library, /window\.(?:prompt|confirm)\s*\(/);
  assert.doesNotMatch(workspace, /window\.(?:prompt|confirm)\s*\(/);
  assert.match(library, /LibraryOrganizerDialog/);
  assert.match(library, /DeleteWorkspaceDialog/);
  assert.match(workspace, /WorkspaceValueDialog/);
});

test("the dedicated workspace owns exactly one source navigator", () => {
  const workspace = source("components/reading/workspace/ReadingWorkspace.tsx");
  const reader = source("components/reading/ReaderPane.tsx");

  assert.match(workspace, /<ReaderPane\s+embedded/);
  assert.match(workspace, /grid-rows-\[minmax\(0,1fr\)\]/);
  assert.match(reader, /!embedded && showOutline/);
  assert.match(reader, /!embedded && <ReaderResizeHandle/);
});

test("Reading V2 inherits product theme tokens instead of a fixed cream palette", () => {
  const library = source("components/reading/library/ReadingLibrary.tsx");
  const workspace = source("components/reading/workspace/ReadingWorkspace.tsx");

  assert.match(library, /var\(--background\)/);
  assert.match(workspace, /var\(--primary\)/);
  assert.doesNotMatch(library, /#[0-9a-fA-F]{6}/);
  assert.doesNotMatch(workspace, /#[0-9a-fA-F]{6}/);
});

test("media relies on native player controls and PDF navigation is honest", () => {
  const workspace = source("components/reading/workspace/ReadingWorkspace.tsx");
  const reader = source("components/reading/ReaderPane.tsx");

  assert.doesNotMatch(workspace, /function MediaTimeline/);
  assert.doesNotMatch(workspace, /aria-label=\{t\("Video timeline"\)\}/);
  assert.match(workspace, /material\?\.render_mode === "pdf"/);
  assert.match(workspace, /synthesised/);
  assert.match(workspace, /Page \{\{page\}\}/);
  assert.match(workspace, /aria-label=\{t\("Collapse contents"\)\}/);
  assert.match(workspace, /externalJump=\{documentJump\}/);
  assert.match(reader, /requestJump\(externalJump\.locator/);
});

test("narrow reading workspaces keep the source primary and use dismissible panels", () => {
  const workspace = source("components/reading/workspace/ReadingWorkspace.tsx");

  assert.match(workspace, /min-width: 1280px/);
  assert.match(workspace, /xl:grid-cols-/);
  assert.match(workspace, /xl:static xl:w-auto xl:shadow-none/);
  assert.match(workspace, /mobileOpen/);
  assert.match(workspace, /aria-label=\{t\("Close AI Companion"\)\}/);
});

test("failed imports expose the durable retry endpoint in product UI", () => {
  const workspace = source("components/reading/workspace/ReadingWorkspace.tsx");
  const api = source("lib/reading-workspace-api.ts");

  assert.match(api, /export async function retryReadingMaterial/);
  assert.match(api, /\/materials\/\$\{materialId\}\/retry/);
  assert.match(workspace, /retryReadingMaterial/);
  assert.match(workspace, /retrying \? t\("Retrying…"\) : t\("Retry"\)/);
});

test("Markdown heading markers stay anchorable but are visually hidden", () => {
  const textReader = source("components/reading/TextUnitView.tsx");

  assert.match(textReader, /markerPrefix/);
  assert.match(textReader, /markerSuffix/);
  assert.match(textReader, /aria-hidden="true"/);
  assert.match(textReader, /text-\[0px\]/);
});
