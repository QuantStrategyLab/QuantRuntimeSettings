/**
 * Pure model behind the logs page: today's run totals from the ribbon tape and the level
 * counts used by the filter chips. The log tail carries no totals of its own.
 */
import type { LogLevel, LogLine, Ribbon } from "../contract/types";

export type LevelFilter = "all" | LogLevel;

export function runSummary(tape: Ribbon["tape"]): { runs: number; drift: number } {
  return {
    runs: tape.filter(entry => entry.state === "done").length,
    drift: tape.filter(entry => entry.outcome === "drift").length,
  };
}

export function levelCounts(items: LogLine[]): Record<LevelFilter, number> {
  return {
    all: items.length,
    error: items.filter(line => line.level === "error").length,
    warn: items.filter(line => line.level === "warn").length,
    info: items.filter(line => line.level === "info").length,
    debug: items.filter(line => line.level === "debug").length,
  };
}

/** A scheduled entry shows its plan; a finished one shows what actually happened. */
export function tapeStateKey(entry: Ribbon["tape"][number]): string {
  return entry.state === "done" && entry.outcome ? `tape.outcome.${entry.outcome}` : `tape.state.${entry.state}`;
}
