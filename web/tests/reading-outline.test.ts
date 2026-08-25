import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  activeReaderHeading,
  buildOutlineTree,
  extractReaderHeadings,
  filterReaderHeadings,
  filterOutlineNodes,
  readerLinesWithHeadings,
} from "../lib/reading-outline";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("builds a nested outline without inventing impossible levels", () => {
  const tree = buildOutlineTree([
    { locator: 1, title: "Part", level: 1, synthesised: false },
    { locator: 2, title: "Suddenly deep", level: 6, synthesised: false },
    { locator: 3, title: "Nested", level: 3, synthesised: false },
  ]);

  assert.deepEqual(
    tree.map((node) => node.row.title),
    ["Part"],
  );
  assert.deepEqual(
    tree[0].children.map((node) => node.row.title),
    ["Suddenly deep"],
  );
  assert.deepEqual(
    tree[0].children[0].children.map((node) => node.row.title),
    ["Nested"],
  );
});

test("keeps an ancestor when only its child matches a filter", () => {
  const tree = buildOutlineTree([
    { locator: 1, title: "Installation", level: 1, synthesised: false },
    { locator: 2, title: "Docker", level: 2, synthesised: false },
    { locator: 3, title: "Providers", level: 2, synthesised: false },
  ]);
  const filtered = filterOutlineNodes(tree, "docker");

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].row.title, "Installation");
  assert.equal(filtered[0].children.length, 1);
  assert.equal(filtered[0].children[0].row.title, "Docker");
});

test("extracts Markdown headings and skips fenced code", () => {
  const headings = extractReaderHeadings(
    ["# Title\n\n```ts\n// # Not a heading\n```\n\n## Section ##"],
    3,
  );

  assert.deepEqual(headings, [
    { id: "dt-reader-heading-3-1", title: "Title", level: 1 },
    { id: "dt-reader-heading-3-2", title: "Section", level: 2 },
  ]);
});

test("heading anchors survive annotation run boundaries", () => {
  const headings = extractReaderHeadings(["# Title\nBody\n## Next"], 4);
  const mark = { id: "annotation" };
  const lines = readerLinesWithHeadings(
    [
      { text: "# Ti", mark: null },
      { text: "tle", mark },
      { text: "\nBody\n## Next", mark: null },
    ],
    headings,
  );

  assert.equal(lines[0].heading?.id, "dt-reader-heading-4-1");
  assert.deepEqual(lines[0].parts, [
    { text: "Ti", mark: null },
    { text: "tle", mark },
  ]);
  assert.equal(lines[2].heading?.id, "dt-reader-heading-4-2");
});

test("a fully highlighted heading cannot hide later anchors", () => {
  const headings = extractReaderHeadings(["# First\n## Second"], 2);
  const mark = { id: "annotation" };
  const lines = readerLinesWithHeadings(
    [
      { text: "# First\n", mark },
      { text: "## Second", mark: null },
    ],
    headings,
  );

  assert.equal(lines[0].heading?.id, "dt-reader-heading-2-1");
  assert.equal(lines[0].parts[0].mark, mark);
  assert.equal(lines[1].heading?.id, "dt-reader-heading-2-2");
});

test("active heading follows the reading container", () => {
  const headings = extractReaderHeadings(["# One\n## Two\n### Three"], 1);
  const active = activeReaderHeading(headings, (heading) =>
    heading.title === "One" ? -20 : heading.title === "Two" ? 12 : 80,
  );

  assert.equal(active, "dt-reader-heading-1-2");
});

test("page-heading filtering stays scoped to the current tab", () => {
  const headings = extractReaderHeadings(["# Install\n## Docker\n## Use"], 2);

  assert.deepEqual(
    filterReaderHeadings(headings, "dock").map((heading) => heading.title),
    ["Docker"],
  );
});

test("reader outline is persistent, searchable, and wired to page headings", () => {
  const outline = source("components/reading/ReaderOutline.tsx");
  const reader = source("components/reading/ReaderPane.tsx");
  const textReader = source("components/reading/TextUnitView.tsx");

  assert.match(outline, /aria-label=\{t\("Contents"\)\}/);
  assert.match(outline, /Filter contents/);
  assert.match(outline, /On this page/);
  assert.match(outline, /role="tablist"/);
  assert.match(outline, /filterReaderHeadings/);
  assert.match(reader, /dt\.reader\.outline\.\$\{material\.material_id\}/);
  assert.match(reader, /event\.key\.toLowerCase\(\) === "b"/);
  assert.match(reader, /onNavigateHeading/);
  assert.match(textReader, /data-reader-heading-id/);
  assert.match(textReader, /container\.scrollTo\(/);
  assert.match(textReader, /elementRect\.top - containerRect\.top/);
  assert.doesNotMatch(textReader, /element\.offsetTop - 72/);
});
