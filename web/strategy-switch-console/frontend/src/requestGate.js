export function createRequestGate() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}

export function startVisibleRefreshLoop(refresh, {
  documentTarget = document,
  windowTarget = window,
  intervalMs = 300_000,
  immediate = false,
} = {}) {
  let active = true;
  let inFlight = false;
  const run = () => {
    if (!active || inFlight || documentTarget.visibilityState !== "visible") return;
    inFlight = true;
    void Promise.resolve()
      .then(refresh)
      .catch(() => {})
      .finally(() => { inFlight = false; });
  };
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") run();
  };
  const timer = windowTarget.setInterval(run, intervalMs);
  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  windowTarget.addEventListener("focus", run);
  if (immediate) run();
  return () => {
    active = false;
    windowTarget.clearInterval(timer);
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    windowTarget.removeEventListener("focus", run);
  };
}
