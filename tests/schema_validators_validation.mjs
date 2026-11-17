import test from "node:test";
import assert from "node:assert/strict";

import {
  validateObjectSchema,
  assertExactObject,
  assertRequiredAndOptionalObject,
  cleanBoundedArray,
  cleanBoundedNumber,
  cleanBoundedText,
  cleanChoice,
  cleanHexDigest,
  cleanIsoTimestamp,
  cleanOptionalBoolean,
  containsSecretFragment,
  parseCalendarDate,
  staleTtlSecondsFromEnv,
  normalizeSourceSnapshotEnvelope,
  aggregateSnapshotMetrics,
} from "../web/strategy-switch-console/application/worker/schema_validators.js";

test("validateObjectSchema enforces required, optional, and exact key rules", () => {
  assertExactObject({ a: 1, b: 2 }, ["a", "b"], "obj");
  assert.throws(() => assertExactObject({ a: 1 }, ["a", "b"], "obj"), /obj has invalid fields/);
  assert.throws(() => assertExactObject({ a: 1, b: 2, c: 3 }, ["a", "b"], "obj"), /obj has invalid fields/);

  const checked = validateObjectSchema(
    { mode: "live", tag: "us-core" },
    {
      required: ["mode"],
      optional: ["tag"],
      fields: {
        mode: (v, name) => cleanChoice(v, ["live", "dry_run"], name),
        tag: (v, name) => cleanBoundedText(v, name, { maxLength: 32 }),
      },
    },
    "cfg",
  );
  assert.deepEqual(checked, { mode: "live", tag: "us-core" });
  assert.doesNotThrow(() => assertRequiredAndOptionalObject({ mode: "live" }, ["mode"], ["tag"], "cfg"));
});

test("primitive validators check bounds, calendar dates, timestamps, digests, and secrets", () => {
  assert.equal(
    cleanHexDigest("A".repeat(64), "digest", { length: 64, allowUppercase: true, lowercase: true }),
    "a".repeat(64),
  );
  assert.throws(() => cleanHexDigest("xyz", "digest", { length: 64 }), /digest is invalid/);

  assert.equal(cleanBoundedNumber("12.5", "n", { min: 0, max: 100 }), 12.5);
  assert.throws(() => cleanBoundedNumber(101, "n", { min: 0, max: 100 }), /n is invalid/);

  assert.equal(parseCalendarDate("2026-02-28"), "2026-02-28");
  assert.equal(parseCalendarDate("2026-02-30"), null);
  assert.equal(cleanIsoTimestamp("2026-02-28T01:02:03Z", "ts"), "2026-02-28T01:02:03Z");

  assert.equal(cleanOptionalBoolean("1"), true);
  assert.equal(cleanOptionalBoolean(0), false);
  assert.equal(cleanOptionalBoolean("maybe"), null);

  assert.equal(containsSecretFragment("Bearer abcdefghijklm"), true);
  assert.equal(containsSecretFragment("healthy baseline"), false);

  assert.deepEqual(cleanBoundedArray([1, 2], "arr", { maxLength: 5 }), [1, 2]);
  assert.throws(() => cleanBoundedArray([1, 2, 3], "arr", { maxLength: 2 }), /at most 2/);
});

test("snapshot envelope and aggregation helpers normalize sources deterministically", () => {
  assert.equal(staleTtlSecondsFromEnv("900", 3600), 900);
  assert.equal(staleTtlSecondsFromEnv("10", 3600), 3600);

  const envelope = normalizeSourceSnapshotEnvelope(
    {
      schema_version: "test.v1",
      source_id: "src_1",
      generated_at: "2026-02-28T00:00:00Z",
      computed_at: "2026-02-28T00:00:00Z",
      data_status: "ready",
      items: [{ id: "x" }],
      errors: [],
    },
    {
      schemaVersion: "test.v1",
      fieldName: "snap",
      itemsKey: "items",
      itemLabel: "id",
      uniqueKey: "id",
      dataStatuses: ["ready", "unavailable", "stale"],
      normalizeIdentifier: (v) => String(v),
      normalizeTimestamp: (v) => v,
      normalizeErrors: (v) => (Array.isArray(v) ? v : []),
      normalizeItem: (item) => item,
    },
  );
  assert.equal(envelope.items.length, 1);

  const summary = aggregateSnapshotMetrics([envelope], {
    ttlSeconds: 3600,
    freshnessFn: () => ({ data_status: "ready" }),
    earliestTimestampFn: (ts) => ts[0] || null,
    staleErrorCode: "stale_err",
    uniqueStrings: (items) => [...new Set(items)],
  });
  assert.equal(summary.data_status, "ready");
});
