import { useCallback, useEffect, useRef, useState } from "react";

export type Loadable<T> =
  | { state: "loading"; startedAt: number }
  | { state: "failed" }
  | { state: "ready"; result: T };

/**
 * One desk read with a retry epoch. Only the latest request commits, so a slow
 * earlier response can never replace a newer one. `startedAt` lets the skeleton
 * become "read failed" after its timeout instead of spinning forever.
 */
export function useDeskLoad<T>(loader: () => Promise<T>, deps: readonly unknown[]): { load: Loadable<T>; reload: () => void } {
  const [load, setLoad] = useState<Loadable<T>>(() => ({ state: "loading", startedAt: Date.now() }));
  const [epoch, setEpoch] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoad({ state: "loading", startedAt: Date.now() });
    loaderRef.current().then(
      result => { if (alive) setLoad({ state: "ready", result }); },
      () => { if (alive) setLoad({ state: "failed" }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, epoch]);

  const reload = useCallback(() => setEpoch(value => value + 1), []);
  return { load, reload };
}
