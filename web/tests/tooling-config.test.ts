import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const webRoot = process.cwd();

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.resolve(webRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

test("ESLint ignores generated and scratch output", () => {
  const config = readFileSync(
    path.resolve(webRoot, "eslint.config.mjs"),
    "utf8",
  );

  for (const ignored of [
    "tmp/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "contracts/generated/.tmp/**",
  ]) {
    assert.match(config, new RegExp(`["]${ignored.replaceAll("*", "\\*")}["]`));
  }
});

test("TypeScript includes canonical source roots and no named build output", () => {
  const tsconfig = readJson("tsconfig.json");
  const include = tsconfig.include as string[];

  for (const root of [
    "app",
    "components",
    "context",
    "features",
    "hooks",
    "i18n",
    "lib",
    "shared",
    "contracts",
    "scripts",
    "tests",
  ]) {
    assert.ok(
      include.some((entry) => entry.startsWith(`${root}/`)),
      `missing explicit ${root} include`,
    );
  }

  assert.equal(include.includes("**/*.ts"), false);
  assert.equal(include.includes("**/*.tsx"), false);
  assert.equal(
    include.some((entry) => /^\.next-[^/]+\//.test(entry)),
    false,
    "named one-off Next.js build directories must not enter typecheck",
  );
  assert.ok(include.includes(".next/types/**/*.ts"));
});

test("package exposes deterministic frontend checks", () => {
  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts as Record<string, string>;

  assert.equal(scripts.typecheck, "tsc --noEmit --incremental false");
  assert.ok(scripts["check:fast"]);
  assert.ok(scripts.check);
  assert.match(scripts.check, /build/);
  assert.match(scripts.check, /perf:check/);
});

test("tracked frontend files contain no generated or backup artifacts", () => {
  const result = spawnSync("git", ["ls-files", "--", "web"], {
    cwd: path.resolve(webRoot, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const forbidden = result.stdout
    .split("\n")
    .filter(Boolean)
    .filter((file) =>
      /(?:\.orig$|\.DS_Store$|(?:^|\/)\.next[^/]*(?:\/|$)|(?:^|\/)tmp\/|\.tsbuildinfo$)/.test(
        file,
      ),
    );

  assert.deepEqual(forbidden, []);
});
