import { useCallback, useEffect, useRef, useState } from "react";

/** Monotonic request gate: only the latest begun request may commit results. */
export function createRequestGate() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token: number) {
      return token === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}

export type AsyncState<T> =
  | { phase: "loading"; data: null; error: null }
  | { phase: "ready"; data: T; error: null }
  | { phase: "error"; data: null; error: Error };

/**
 * Load data whenever deps change; only the latest request commits.
 * Re-render safe: loader identity changes restart the load.
 */
export function useApi<T>(loader: () => Promise<T>, deps: readonly unknown[], enabled = true): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ phase: "loading", data: null, error: null });
  const gate = useRef(createRequestGate());
  const [epoch, setEpoch] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      gate.current.invalidate();
      setState({ phase: "loading", data: null, error: null });
      return;
    }
    const token = gate.current.begin();
    setState({ phase: "loading", data: null, error: null });
    let cancelled = false;
    loaderRef.current()
      .then(data => {
        if (!cancelled && gate.current.isCurrent(token)) setState({ phase: "ready", data, error: null });
      })
      .catch(error => {
        if (!cancelled && gate.current.isCurrent(token)) {
          setState({ phase: "error", data: null, error: error instanceof Error ? error : new Error("request_failed") });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, epoch, enabled]);

  const reload = useCallback(() => setEpoch(value => value + 1), []);
  return { ...state, reload };
}
