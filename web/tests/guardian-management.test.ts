import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const readWebFile = (...parts: string[]) =>
  readFileSync(path.join(process.cwd(), ...parts), "utf8");

const api = readWebFile("lib", "guardian-api.ts");
const page = readWebFile(
  "app",
  "(utility)",
  "settings",
  "guardian",
  "page.tsx",
);

test("guardian credential reset returns the one-time password to the UI", () => {
  assert.match(api, /Promise<string>/);
  assert.match(api, /return data\.temporary_password/);
  assert.match(page, /setTemporaryPassword/);
  assert.match(page, /Copy this password now\. It will not be shown again\./);
});

test("guardian actions follow each relationship permission", () => {
  assert.match(page, /can\("view_reports"\)/);
  assert.match(page, /can\("assign_materials"\)/);
  assert.match(page, /can\("reset_credentials"\)/);
  assert.match(page, /<ConfirmDialog/);
});

test("settings visibility uses the account preset rather than policy presence", () => {
  const nav = readWebFile("components", "settings", "SettingsNav.tsx");
  assert.match(nav, /showLearnerOnly: authStatus\.preset === "learner"/);
  assert.match(nav, /authStatus\.preset === "standard"/);
  assert.match(nav, /authStatus\.preset === "custom"/);
});

test("guardian management copy is localized", () => {
  const en = JSON.parse(readWebFile("locales", "en", "app.json")) as Record<
    string,
    string
  >;
  const zh = JSON.parse(readWebFile("locales", "zh", "app.json")) as Record<
    string,
    string
  >;
  for (const key of [
    "Guardian management",
    "Approved materials",
    "Reset learner credentials",
    "Temporary password",
    "This changes the learner password and revokes every learner device credential.",
  ]) {
    assert.ok(en[key], `missing English key: ${key}`);
    assert.ok(zh[key], `missing Chinese key: ${key}`);
  }
});
