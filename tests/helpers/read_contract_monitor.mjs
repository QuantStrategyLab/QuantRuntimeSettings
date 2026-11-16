// Writer-entry monitor for the bounded executable read contract (ADR 0002).
//
// The graph builder in `read_contract_instrument.mjs` inserts a call to
// `enter(id)` at the start of every registered writer callable (W) in the
// temporary module graph, before parameter destructuring and the body run.
// Each entry is written synchronously to the result file named by the child
// runner, outside application-controlled state, and only then judged: in a
// zero-writer phase every entry latches a violation and throws; in a declared
// debt phase only the next expected identity is admitted. The record survives
// code that catches the error, returns a 200, or exits, so the parent asserts
// the latch rather than relying on the throw.
//
// Trusted test machinery, not a sandbox: application code that imports this
// module can call `enter`, but phase control is claimed once by the runner
// before any fixture module is evaluated.
import { writeSync } from "node:fs";

export class WriterEntryViolation extends Error {
  constructor(id, phase) {
    super(`writer_entry_violation:${id}`);
    this.name = "WriterEntryViolation";
    this.id = id;
    this.phase = phase;
  }
}

let fd = null;
let phase = { name: "unclaimed", mode: "closed", allow: [] };
let seq = 0;
let claimed = false;
const entries = [];

const emit = record => { if (fd !== null) writeSync(fd, `${JSON.stringify(record)}\n`); };

/** Entry into an instrumented callable; `site` is "original" or a clone's provenance. */
export function enter(id, site = "original") {
  seq += 1;
  const record = { t: "enter", seq, id, site, phase: phase.name, mode: phase.mode };
  entries.push(record);
  emit(record);
  if (phase.mode === "debt" && phase.allow[0] === id) { phase.allow.shift(); return; }
  emit({ t: "violation", seq, id, site, phase: phase.name, mode: phase.mode });
  throw new WriterEntryViolation(id, phase.name);
}

/** One-time capability for the child runner: result channel and phase control. */
export function claimControl(resultFd) {
  if (claimed) throw new Error("read_contract_monitor_already_claimed");
  claimed = true;
  fd = resultFd;
  return {
    emit,
    setPhase(name, mode, allow = []) {
      if (!["load", "debt", "zero-writer", "closed"].includes(mode)) throw new Error(`unknown monitor mode ${mode}`);
      phase = { name, mode, allow: [...allow] };
      emit({ t: "phase", name, mode, allow });
    },
    /** Identities a debt phase declared but did not enter. */
    remaining: () => [...phase.allow],
    entries: () => entries.map(entry => ({ ...entry })),
  };
}
