import test from "node:test";
import assert from "node:assert/strict";

import { topicDisplayName } from "../components/space/learning/format";

const tr = (cn: string) => cn;

test("mastery topic display names preserve authored titles", () => {
  assert.equal(
    topicDisplayName(
      { name: "Agentic RAG 核心架构设计", path_id: "unified_1_abcd" },
      tr,
    ),
    "Agentic RAG 核心架构设计",
  );
});

test("legacy generated topic ids become friendly traceable labels", () => {
  assert.equal(
    topicDisplayName(
      {
        name: "unified_1787837164040_28bb00dc",
        path_id: "unified_1787837164040_28bb00dc",
      },
      tr,
    ),
    "探索路线 · 00dc",
  );
});
