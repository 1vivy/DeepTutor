import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const SOURCE_ROOTS = [
  "app",
  "components",
  "context",
  "features",
  "hooks",
  "lib",
  "shared",
];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

test("the frontend has no v1 chat transport or compatibility import surface", () => {
  const cwd = process.cwd();
  const files = SOURCE_ROOTS.flatMap((root) => sourceFiles(path.resolve(cwd, root)));
  const forbidden = [
    /\/api\/v1\/chat/,
    /UnifiedWSClient/,
    /lib\/unified-ws/,
    /features\/chat\/compat\/UnifiedChatFacade/,
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${path.relative(cwd, file)} contains ${pattern}`);
    }
  }

  for (const relative of [
    "lib/unified-ws.ts",
    "lib/unified-ws-recovery.ts",
    "components/chat/home/ChatMessages.tsx",
    "components/chat/home/TracePanels.tsx",
    "lib/chat-capabilities.ts",
    "lib/capabilities-api.ts",
    "lib/settings-nav.ts",
  ]) {
    assert.equal(fs.existsSync(path.resolve(cwd, relative)), false, `${relative} must stay deleted`);
  }
});

test("all chat entry points share the validated v2 runtime", () => {
  const adapter = fs.readFileSync(
    path.resolve(process.cwd(), "features/chat/transport/UnifiedTurnClient.ts"),
    "utf8",
  );
  assert.match(adapter, /TurnRuntimeClient/);
  assert.match(adapter, /protocol_version: "2\.0"/);
});
