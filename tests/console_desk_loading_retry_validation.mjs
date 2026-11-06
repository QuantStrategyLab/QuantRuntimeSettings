// LoadingState retry timeout lifecycle: a pending retry is a new read
// generation, so an expired flag from the previous attempt must not hide the
// loading state. Pure helpers plus source wiring; synthetic timestamps only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isReadExpired,
  readGeneration,
  readTimedOut,
} from "../web/strategy-switch-console/frontend/src/desk/components/stateModel.ts";

const stateBlocks = readFileSync(
  new URL("../web/strategy-switch-console/frontend/src/desk/components/StateBlocks.tsx", import.meta.url),
  "utf8",
);

const timeoutMs = 10_000;

// First attempt times out.
const firstStartedAt = 1_000;
const firstGeneration = readGeneration(firstStartedAt, timeoutMs);
assert.equal(readTimedOut(firstStartedAt, firstStartedAt + timeoutMs, timeoutMs), true);
let expiredGeneration = firstGeneration;
assert.equal(isReadExpired(expiredGeneration, firstGeneration), true);

// A retry passes a new startedAt and is still pending: it must show loading,
// not the previous read failure.
const retryStartedAt = 25_000;
const retryGeneration = readGeneration(retryStartedAt, timeoutMs);
assert.notEqual(retryGeneration, firstGeneration);
assert.equal(readTimedOut(retryStartedAt, retryStartedAt + 1, timeoutMs), false);
assert.equal(
  isReadExpired(expiredGeneration, retryGeneration),
  false,
  "a pending retry shows loading, not the previous error",
);

// The retry keeps its own timeout window; the previous marker never matches it.
expiredGeneration = retryGeneration;
assert.equal(isReadExpired(expiredGeneration, retryGeneration), true);
assert.equal(isReadExpired(firstGeneration, retryGeneration), false);
assert.equal(isReadExpired(null, retryGeneration), false);

// A changed timeout is also a new generation, so a stale expiry cannot leak in.
assert.equal(isReadExpired(firstGeneration, readGeneration(firstStartedAt, timeoutMs * 2)), false);

// Source wiring: the component keys the expired flag by read generation and no
// longer gates the effect on a mount-only boolean.
assert.match(stateBlocks, /const generation = readGeneration\(startedAt, timeoutMs\)/);
assert.match(stateBlocks, /isReadExpired\(expiredGeneration, generation\)/);
assert.match(stateBlocks, /setExpiredGeneration\(generation\)/);
assert.doesNotMatch(stateBlocks, /setTimedOut/);

console.log("console_desk_loading_retry_validation: PASS (pending retry clears an expired timeout)");
