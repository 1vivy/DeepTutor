import test from "node:test";
import assert from "node:assert/strict";
import {
  reconnectDelayMs,
  shouldStopReconnecting,
} from "../lib/unified-ws-recovery";

test("an active turn keeps reconnecting after the normal attempt budget", () => {
  assert.equal(
    shouldStopReconnecting({ attempt: 99, activeTurnId: "turn_research" }),
    false,
  );
  assert.equal(
    shouldStopReconnecting({ attempt: 5, activeTurnId: null }),
    true,
  );
});

test("active-turn reconnect backoff is capped", () => {
  assert.equal(reconnectDelayMs(0), 200);
  assert.equal(reconnectDelayMs(4), 3200);
  assert.equal(reconnectDelayMs(99), 3200);
});
